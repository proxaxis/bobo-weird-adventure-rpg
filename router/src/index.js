/**
 * @fileoverview 中央ルーター（Hono.js on Node.js）。
 * - WS /ws: 座標集約・近接Peer選出・リース・AIサーバからのpush中継
 * - HTTP : チャンクseedレジストリ・エンティティ同期・DeltaMap・関係性
 *
 * Redis キー:
 *   chunks                 Hash  "cx,cy" → "seed,owner"（生成seedの重複防止）
 *   chunk:lease:{cx}:{cy}  String → uuid（所有権リース, EX 5 NX）
 *   ents:{cx},{cy}         String → JSON（所有者のエンティティ報告, EX 60）
 *   dmap:{cx}:{cy}         Hash  "tx,ty" → JSON（整地/建築スタンプ）
 *   rel:{npcId}:{uuid}     Hash  lastInteractionTime / history
 *
 * presence は WS 接続に付随する揮発情報のためインメモリで管理する。
 */

import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient } from 'redis';

import { ChunkLeaseManager } from './ChunkLeaseManager.js';
import { DeltaMapRegistry } from './DeltaMapRegistry.js';
import { RelationshipManager } from './RelationshipManager.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PORT = Number(process.env.PORT ?? 8788);
// Peer 接続対象距離（描画 ±1024 の外側マージン込み ±2048）
const CONNECT_RADIUS = Number(process.env.CONNECT_RADIUS ?? 2048);
const PRESENCE_TTL_MS = 30000;
const CHUNK_TTL_SEC = 7 * 86400;
const ENT_TTL_SEC = 60;
const REDIS_POOL = 8;

// Redis コネクションプール（ラウンドロビンで負荷分散）
/** @type {import('redis').RedisClientType[]} */
const pool = [];
for (let i = 0; i < REDIS_POOL; i++) {
  const c = createClient({ url: REDIS_URL });
  c.on('error', (e) => console.error('[redis]', e.message));
  pool.push(/** @type {import('redis').RedisClientType} */ (c));
}
await Promise.all(pool.map((c) => c.connect()));
let _rr = 0;
const r = () => pool[(_rr = (_rr + 1) % pool.length)];

const leases = new ChunkLeaseManager(/** @type {any} */ (r()));
const dmaps = new DeltaMapRegistry(/** @type {any} */ (r()));
const rels = new RelationshipManager(/** @type {any} */ (r()));

const app = new Hono();
app.use('*', cors());
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

/**
 * WS 接続中クライアント。uuid → 状態。
 * @type {Map<string, {ws: import('ws').WebSocket, peerId: string, x: number, y: number, t: number}>}
 */
const clients = new Map();

/**
 * 近接クライアントを列挙する。
 * @param {string} selfUuid
 * @param {number} x
 * @param {number} y
 * @returns {Array<{uuid: string, peerId: string, x: number, y: number}>}
 */
function nearby(selfUuid, x, y) {
  const now = Date.now();
  const out = [];
  for (const [uuid, c] of clients) {
    if (uuid === selfUuid || now - c.t > PRESENCE_TTL_MS) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    if (dx * dx + dy * dy <= CONNECT_RADIUS * CONNECT_RADIUS) {
      out.push({ uuid, peerId: c.peerId, x: c.x, y: c.y });
    }
  }
  return out;
}

// ------------------------------------------------------------------
// WebSocket /ws — 座標集約・リース・push 中継
// ------------------------------------------------------------------

app.get(
  '/ws',
  upgradeWebSocket(() => {
    /** @type {{uuid: string, peerId: string} | null} */
    let ctx = null;
    return {
      onOpen(_evt, ws) {
        ctx = { uuid: '', peerId: '' };
        // Node の ws は生 WebSocket — コンテキスト保持のため ws に紐付ける
        /** @type {any} */ (ws)._ctx = ctx;
      },
      async onMessage(evt, ws) {
        /** @type {any} */
        let msg;
        try {
          msg = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        const c0 = /** @type {any} */ (ws)._ctx;
        switch (msg.type) {
          case 'hello': {
            c0.uuid = String(msg.uuid ?? '');
            c0.peerId = String(msg.peerId ?? '');
            if (c0.uuid) {
              clients.set(c0.uuid, {
                ws: /** @type {any} */ (ws),
                peerId: c0.peerId,
                x: 0,
                y: 0,
                t: Date.now(),
              });
            }
            break;
          }
          case 'pos': {
            const c1 = clients.get(c0.uuid);
            if (!c1) break;
            c1.x = Number(msg.x) || 0;
            c1.y = Number(msg.y) || 0;
            c1.t = Date.now();
            ws.send(JSON.stringify({
              type: 'peers',
              peers: nearby(c0.uuid, c1.x, c1.y),
            }));
            break;
          }
          case 'lease': {
            if (!c0.uuid) break;
            const res = await leases.acquire(
              Number(msg.cx) | 0,
              Number(msg.cy) | 0,
              c0.uuid,
            );
            ws.send(JSON.stringify({
              type: 'lease',
              cx: Number(msg.cx) | 0,
              cy: Number(msg.cy) | 0,
              ...res,
            }));
            break;
          }
          case 'lease-hb': {
            if (!c0.uuid || !Array.isArray(msg.chunks)) break;
            await leases.heartbeat(msg.chunks, c0.uuid);
            break;
          }
          default:
            break;
        }
      },
      onClose(_evt, ws) {
        const c0 = /** @type {any} */ (ws)._ctx;
        if (c0?.uuid) clients.delete(c0.uuid);
      },
    };
  }),
);

// ------------------------------------------------------------------
// HTTP — レジストリ / エンティティ / DeltaMap / 関係性 / push
// ------------------------------------------------------------------

app.get('/health', async (c) => {
  try {
    await r().ping();
    return c.json({ ok: true, clients: clients.size });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// 互換: REST presence（WS 未使用クライアント/デバッグ用）
app.post('/presence', async (c) => {
  const b = await c.req.json();
  const uuid = String(b.uuid ?? b.peerId ?? '');
  if (!uuid) return c.json({ peers: [] });
  const x = Number(b.x) || 0;
  const y = Number(b.y) || 0;
  const existing = clients.get(uuid);
  if (existing) {
    existing.x = x;
    existing.y = y;
    existing.t = Date.now();
  } else {
    clients.set(uuid, { ws: /** @type {any} */ (null), peerId: String(b.peerId ?? ''), x, y, t: Date.now() });
  }
  return c.json({ peers: nearby(uuid, x, y) });
});

// --- チャンク生成 seed レジストリ（重複生成防止） ---

app.post('/chunk/register', async (c) => {
  const b = await c.req.json();
  const key = String(b.key ?? '');
  const created = await r().hSetNX('chunks', key, `${b.seed},${b.owner}`);
  if (created) {
    await r().expire('chunks', CHUNK_TTL_SEC);
    return c.json({ owner: b.owner, seed: b.seed, created: true });
  }
  const v = await r().hGet('chunks', key);
  const [seed, owner] = (v ?? '0,').split(',');
  return c.json({ owner, seed: Number(seed), created: false });
});

app.get('/chunk/:cx/:cy', async (c) => {
  const v = await r().hGet('chunks', `${c.req.param('cx')},${c.req.param('cy')}`);
  if (!v) return c.json({ exists: false });
  const [seed, owner] = v.split(',');
  return c.json({ exists: true, seed: Number(seed), owner });
});

// --- チャンクリース（HTTP フォールバック。通常は WS で行う） ---

app.post('/lease/acquire', async (c) => {
  const b = await c.req.json();
  const res = await leases.acquire(Number(b.cx) | 0, Number(b.cy) | 0, String(b.uuid ?? ''));
  return c.json(res);
});

app.post('/lease/heartbeat', async (c) => {
  const b = await c.req.json();
  const renewed = await leases.heartbeat(b.chunks ?? [], String(b.uuid ?? ''));
  return c.json({ renewed });
});

app.get('/lease/:cx/:cy', async (c) => {
  const owner = await leases.owner(Number(c.req.param('cx')) | 0, Number(c.req.param('cy')) | 0);
  return c.json({ owner });
});

// --- エンティティ同期（リース所有者のみ報告可） ---

app.post('/entities/report', async (c) => {
  const b = await c.req.json();
  const chunk = String(b.chunk ?? '');
  const owner = String(b.owner ?? '');
  const [cx, cy] = chunk.split(',').map(Number);
  const leaseOwner = await leases.owner(cx | 0, cy | 0);
  if (leaseOwner && leaseOwner !== owner) {
    return c.json({ ok: false, reason: 'not-lease-owner', owner: leaseOwner }, 409);
  }
  await r().set(
    `ents:${chunk}`,
    JSON.stringify({ owner, entities: b.entities ?? [], t: Date.now() }),
    { EX: ENT_TTL_SEC },
  );
  return c.json({ ok: true });
});

app.get('/entities/:cx/:cy', async (c) => {
  const v = await r().get(`ents:${c.req.param('cx')},${c.req.param('cy')}`);
  if (!v) return c.json({ owner: '', entities: [] });
  return c.json(JSON.parse(v));
});

// --- DeltaMap ---

app.post('/delta/stamp', async (c) => {
  const b = await c.req.json();
  const tiles = Array.isArray(b.tiles) ? b.tiles : [];
  return c.json(await dmaps.stamp(tiles));
});

app.get('/delta/:cx/:cy', async (c) => {
  const tiles = await dmaps.getChunk(
    Number(c.req.param('cx')) | 0,
    Number(c.req.param('cy')) | 0,
  );
  return c.json({ tiles });
});

// --- NPC × プレイヤー関係性 ---

app.get('/rel/:npcId/:uuid', async (c) => {
  return c.json(await rels.get(c.req.param('npcId'), c.req.param('uuid')));
});

app.post('/rel/touch', async (c) => {
  const b = await c.req.json();
  return c.json(await rels.touch(
    String(b.npcId ?? ''),
    String(b.uuid ?? ''),
    String(b.player ?? ''),
    String(b.npc ?? ''),
  ));
});

// --- AI サーバ → クライアント push 中継（Deep Path 差分配信） ---

app.post('/push', async (c) => {
  const b = await c.req.json();
  const uuid = String(b.uuid ?? '');
  const target = clients.get(uuid);
  if (!target || !target.ws) return c.json({ delivered: false });
  try {
    target.ws.send(JSON.stringify({ type: 'push', payload: b.payload ?? null }));
    return c.json({ delivered: true });
  } catch {
    return c.json({ delivered: false });
  }
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[router] listening on :${info.port}`);
});
injectWebSocket(server);
