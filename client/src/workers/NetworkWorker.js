/**
 * @fileoverview NetworkWorker — 通信/パースをメインスレッドから分離する。
 * 担当: router との WebSocket（presence・リース）と REST（エンティティ同期）。
 * 描画/入力はメインスレッド（Phaser/Vue）に残す。
 *
 * 注: PeerJS は RTCPeerConnection を使うため Worker 内では動作せず、
 * P2P データ接続はメインスレッドの p2pSync.js が担当する。
 * Worker は router が返す近接 peerId 一覧だけをメインへ転送する。
 *
 * main → worker:
 *   {cmd:'init', uuid, peerId, wsUrl, httpBase}
 *   {cmd:'peer-id', peerId}                PeerId 確定時に再 hello
 *   {cmd:'pos', x, y}                      座標申告（絶対座標）
 *   {cmd:'lease', cx, cy}                  リース要求（自チャンク）
 *   {cmd:'lease-hb', chunks:[[cx,cy],..]}  リース延長
 *   {cmd:'report-entities', chunk, owner, entities}
 *   {cmd:'fetch-entities', reqId, cx, cy}
 * worker → main:
 *   {ev:'ws-state', state}
 *   {ev:'peers', peers:[{uuid,peerId,x,y}]}
 *   {ev:'lease', cx, cy, owner, granted}
 *   {ev:'entities', reqId, cx, cy, owner, entities}
 *   {ev:'push', payload}                   AIサーバ Deep Path からの中継
 */

let uuid = '';
let peerId = '';
let httpBase = '';
let wsUrl = '';
/** @type {WebSocket | null} */
let ws = null;
let wsOpen = false;
let reconnectTimer = 0;
/** 切断中に溜める座標（最新1件のみ）。 */
let pendingPos = /** @type {{x:number,y:number} | null} */ (null);

const RECONNECT_MS = 2000;

/**
 * @param {unknown} data
 * @returns {void}
 */
function wsSend(data) {
  if (ws && wsOpen) ws.send(JSON.stringify(data));
}

/**
 * @returns {void}
 */
function connect() {
  if (ws) {
    try { ws.close(); } catch { /* noop */ }
  }
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    wsOpen = true;
    wsSend({ type: 'hello', uuid, peerId });
    if (pendingPos) {
      wsSend({ type: 'pos', x: pendingPos.x, y: pendingPos.y, peerId });
    }
    postMessage({ ev: 'ws-state', state: 'open' });
  };
  ws.onmessage = (evt) => {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(String(evt.data));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'peers':
        postMessage({ ev: 'peers', peers: msg.peers ?? [] });
        break;
      case 'lease':
        postMessage({
          ev: 'lease',
          cx: msg.cx,
          cy: msg.cy,
          owner: msg.owner,
          granted: msg.granted,
        });
        break;
      case 'push':
        postMessage({ ev: 'push', payload: msg.payload });
        break;
      default:
        break;
    }
  };
  ws.onclose = () => {
    wsOpen = false;
    postMessage({ ev: 'ws-state', state: 'closed' });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  };
  ws.onerror = () => {
    ws?.close();
  };
}

/**
 * REST POST（リース検証は router 側）。
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
async function post(path, body) {
  const res = await fetch(`${httpBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

/**
 * @param {number} cx
 * @param {number} cy
 * @returns {Promise<any>}
 */
async function getEntities(cx, cy) {
  const res = await fetch(`${httpBase}/entities/${cx}/${cy}`);
  if (!res.ok) return { owner: '', entities: [] };
  return res.json().catch(() => ({ owner: '', entities: [] }));
}

self.onmessage = (evt) => {
  const msg = /** @type {any} */ (evt.data);
  switch (msg.cmd) {
    case 'init':
      uuid = msg.uuid;
      peerId = msg.peerId ?? '';
      wsUrl = msg.wsUrl;
      httpBase = msg.httpBase;
      connect();
      break;
    case 'peer-id':
      peerId = msg.peerId;
      if (wsOpen) wsSend({ type: 'hello', uuid, peerId });
      break;
    case 'pos':
      pendingPos = { x: msg.x, y: msg.y };
      wsSend({ type: 'pos', x: msg.x, y: msg.y, peerId });
      break;
    case 'lease':
      wsSend({ type: 'lease', cx: msg.cx, cy: msg.cy });
      break;
    case 'lease-hb':
      wsSend({ type: 'lease-hb', chunks: msg.chunks });
      break;
    case 'report-entities':
      void post('/entities/report', {
        chunk: msg.chunk,
        owner: msg.owner,
        entities: msg.entities,
      });
      break;
    case 'fetch-entities':
      void getEntities(msg.cx, msg.cy).then((r) => {
        postMessage({
          ev: 'entities',
          reqId: msg.reqId,
          cx: msg.cx,
          cy: msg.cy,
          owner: r.owner ?? '',
          entities: r.entities ?? [],
        });
      });
      break;
    default:
      break;
  }
};
