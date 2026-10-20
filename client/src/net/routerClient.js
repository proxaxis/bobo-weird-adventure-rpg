/**
 * @fileoverview Router サーバのクライアント。
 * - /presence: 座標申告 → 近接 peerId 一覧
 * - /chunk: チャンク生成レジストリ（重複生成防止）
 */

const BASE = import.meta.env?.VITE_ROUTER_URL ?? '/rtr';

/**
 * @param {string} peerId
 * @param {number} x
 * @param {number} y
 * @returns {Promise<Array<{peerId: string, x: number, y: number}>>}
 */
export async function reportPresence(peerId, x, y) {
  const res = await fetch(`${BASE}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId, x, y }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.peers ?? [];
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
 * チャンク内エンティティ位置を報告する（所有者のみ）。
 * @param {string} chunkKey - "cx,cy"
 * @param {string} owner
 * @param {Array<{id: string, type: string, x: number, y: number, meta?: object}>} entities
 * @returns {Promise<void>}
 */
export async function reportEntities(chunkKey, owner, entities) {
  await fetch(`${BASE}/entities/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chunk: chunkKey, owner, entities }),
  });
}

/**
 * チャンク内エンティティを取得する。
 * @param {number} cx
 * @param {number} cy
 * @returns {Promise<{owner: string, entities: Array<{id: string, type: string, x: number, y: number, meta?: object}>}>}
 */
export async function getEntities(cx, cy) {
  const res = await fetch(`${BASE}/entities/${cx}/${cy}`);
  if (!res.ok) return { owner: '', entities: [] };
  return res.json();
}

/**
 * チャンク生成結果を登録。既登録なら既存 seed/owner が返る。
 * @param {number} cx
 * @param {number} cy
 * @param {number} seed
 * @param {string} owner
 * @returns {Promise<{owner: string, seed: number, created: boolean}>}
 */
export async function registerChunk(cx, cy, seed, owner) {
  const res = await fetch(`${BASE}/chunk/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `${cx},${cy}`, seed, owner }),
  });
  return res.json();
}
