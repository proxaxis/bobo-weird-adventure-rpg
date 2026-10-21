/**
 * @fileoverview Router サーバの REST クライアント（単発呼び出し用）。
 * 高頻度の座標申告・リース・エンティティ同期は
 * net/network.js → workers/NetworkWorker.js 経由の WS/REST を使う。
 * ここは低頻度の単発呼び出し（DeltaMap 取得・関係性・チャンクseed）を担当。
 */

const BASE = import.meta.env?.VITE_ROUTER_URL ?? '/rtr';

/**
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

/**
 * チャンクが生成済みか問い合わせる。
 * @param {number} cx
 * @param {number} cy
 * @returns {Promise<{exists: boolean, seed?: number, owner?: string}>}
 */
export async function queryChunk(cx, cy) {
  const res = await fetch(`${BASE}/chunk/${cx}/${cy}`);
  if (!res.ok) return { exists: false };
  return res.json();
}

/**
 * チャンク生成結果を登録。既登録なら既存 seed/owner が返る。
 * @param {number} cx
 * @param {number} cy
 * @param {number} seed
 * @param {string} owner - プレイヤーUUID
 * @returns {Promise<{owner: string, seed: number, created: boolean}>}
 */
export async function registerChunk(cx, cy, seed, owner) {
  return post('/chunk/register', { key: `${cx},${cy}`, seed, owner });
}

/**
 * DeltaMap スタンプを書き込む（整地・建築・破壊の上書き）。
 * @param {string} uuid
 * @param {Array<{tx: number, ty: number, v: object}>} tiles
 * @returns {Promise<{ok: boolean, stamped: number}>}
 */
export async function stampDelta(uuid, tiles) {
  return post('/delta/stamp', { uuid, tiles });
}

/**
 * チャンクの DeltaMap を取得する。
 * @param {number} cx
 * @param {number} cy
 * @returns {Promise<Record<string, object>>} "tx,ty" → tile delta
 */
export async function fetchDelta(cx, cy) {
  const res = await fetch(`${BASE}/delta/${cx}/${cy}`);
  if (!res.ok) return {};
  const data = await res.json().catch(() => ({}));
  return data.tiles ?? {};
}

/**
 * NPC × プレイヤー関係性（最終対話時刻・履歴）を取得する。
 * @param {string} npcId
 * @param {string} uuid
 * @returns {Promise<{lastInteractionTime: number, history: Array<{t:number,player:string,npc:string}>}>}
 */
export async function getRelation(npcId, uuid) {
  const res = await fetch(`${BASE}/rel/${encodeURIComponent(npcId)}/${encodeURIComponent(uuid)}`);
  if (!res.ok) return { lastInteractionTime: 0, history: [] };
  return res.json().catch(() => ({ lastInteractionTime: 0, history: [] }));
}

/**
 * 対話終了を記録する（最終対話時刻の更新＋履歴追加）。
 * @param {string} npcId
 * @param {string} uuid
 * @param {string} playerText
 * @param {string} npcText
 * @returns {Promise<{previous: number, now: number}>}
 */
export async function touchRelation(npcId, uuid, playerText, npcText) {
  return post('/rel/touch', { npcId, uuid, player: playerText, npc: npcText });
}
