/**
 * @fileoverview DeltaMap（クライアント側キャッシュ）。
 * Router の dmap スタンプをチャンク単位で保持し、
 * 手続きノイズの結果を上書きする。
 *   Tile = DeltaMap.get(key) ?? ProceduralNoise(tx, ty)
 *
 * スタンプ値 v:
 *   {kind:'flat'}                      整地（平地・非汚染・障害なし）
 *   {kind:'block', owner, permitted?}  拠点壁ブロック
 *   {kind:'door',  owner, permitted?}  拠点ドアブロック
 */

import { chunkKey, keyX, keyY, tileKey } from '@/core/spatial.js';
import { biomeAt, CHUNK_SIZE, TILE_PX } from '@/game/noise.js';

export class DeltaMap {
  constructor() {
    /** @type {Map<bigint, Map<bigint, object>>} チャンクキー → (タイルキー → delta) */
    this.chunks = new Map();
  }

  /**
   * router 応答 {"tx,ty": v} をチャンクキャッシュへ登録する。
   * @param {number} cx
   * @param {number} cy
   * @param {Record<string, object>} tiles
   * @returns {void}
   */
  loadChunk(cx, cy, tiles) {
    /** @type {Map<bigint, object>} */
    const m = new Map();
    for (const [k, v] of Object.entries(tiles ?? {})) {
      const [tx, ty] = k.split(',').map(Number);
      if (Number.isFinite(tx) && Number.isFinite(ty)) m.set(tileKey(tx, ty), v);
    }
    this.chunks.set(chunkKey(cx, cy), m);
  }

  /**
   * ワールド絶対座標のタイル情報。スタンプがあればそれを優先する。
   * @param {number} absX - ワールドX(px)
   * @param {number} absY - ワールドY(px)
   * @param {number} seed - ワールドシード
   * @returns {{ground: number, toxic: boolean, obstacle: boolean, delta?: object}}
   */
  tileAt(absX, absY, seed) {
    const tx = Math.floor(absX / TILE_PX);
    const ty = Math.floor(absY / TILE_PX);
    const ck = chunkKey(Math.floor(tx / 16), Math.floor(ty / 16));
    const delta = this.chunks.get(ck)?.get(tileKey(tx, ty));
    if (delta) {
      const d = /** @type {any} */ (delta);
      if (d.kind === 'flat') {
        return { ground: 0, toxic: false, obstacle: false, delta: d };
      }
      // block/door は整地済みの上に乗る。衝突はスプライト側で行うため
      // 地形としては平地を返す。
      return { ground: 0, toxic: false, obstacle: false, delta: d };
    }
    const b = biomeAt(absX, absY, seed);
    return { ground: b.ground, toxic: b.toxic, obstacle: b.obstacle };
  }

  /**
   * スタンプをローカルキャッシュへ即時反映する（自分の整地/建築用）。
   * @param {Array<{tx: number, ty: number, v: object}>} tiles
   * @returns {void}
   */
  applyLocal(tiles) {
    for (const t of tiles) {
      const ck = chunkKey(Math.floor(t.tx / 16), Math.floor(t.ty / 16));
      let m = this.chunks.get(ck);
      if (!m) {
        m = new Map();
        this.chunks.set(ck, m);
      }
      m.set(tileKey(t.tx, t.ty), t.v);
    }
  }

  /**
   * チャンク内のスタンプを列挙する（リモート拠点ブロック描画用）。
   * @param {number} cx
   * @param {number} cy
   * @returns {Array<{tx: number, ty: number, v: object}>}
   */
  entriesOfChunk(cx, cy) {
    const m = this.chunks.get(chunkKey(cx, cy));
    if (!m) return [];
    const out = [];
    for (const [k, v] of m) out.push({ tx: keyX(k), ty: keyY(k), v });
    return out;
  }

  /**
   * @param {number} cx
   * @param {number} cy
   * @returns {boolean}
   */
  hasChunk(cx, cy) {
    return this.chunks.has(chunkKey(cx, cy));
  }
}

export const deltaMap = new DeltaMap();
export { CHUNK_SIZE };
