/**
 * @fileoverview DeltaMap レジストリ。
 * 手続きノイズ生成の上に「整地・建築・破壊」の上書きスタンプを
 * チャンク単位の Redis Hash として永続化する。
 * 判定式: Tile = DeltaMap.get(key) ?? ProceduralNoise(tx, ty)
 */

/** 1チャンクのタイル数（512px / 32px = 16）。 */
export const CHUNK_TILES = 16;

/** DeltaMap の保持期間（30日）。 */
const DELTA_TTL_SEC = 30 * 86400;

export class DeltaMapRegistry {
  /**
   * @param {import('redis').RedisClientType} redis
   */
  constructor(redis) {
    this.redis = redis;
  }

  /**
   * @param {number} cx
   * @param {number} cy
   * @returns {string}
   */
  key(cx, cy) {
    return `dmap:${cx}:${cy}`;
  }

  /**
   * タイルスタンプを書き込む。チャンクを跨ぐ場合は内部で分割する。
   * @param {Array<{tx: number, ty: number, v: object}>} tiles
   * @returns {Promise<{ok: boolean, stamped: number}>}
   */
  async stamp(tiles) {
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const t of tiles) {
      const cx = Math.floor(t.tx / CHUNK_TILES);
      const cy = Math.floor(t.ty / CHUNK_TILES);
      const k = this.key(cx, cy);
      const g = groups.get(k) ?? [];
      g.push(`${t.tx},${t.ty}`, JSON.stringify(t.v));
      groups.set(k, g);
    }
    for (const [k, args] of groups) {
      await this.redis.hSet(k, args);
      await this.redis.expire(k, DELTA_TTL_SEC);
    }
    return { ok: true, stamped: tiles.length };
  }

  /**
   * チャンク内の全スタンプを返す。
   * @param {number} cx
   * @param {number} cy
   * @returns {Promise<Record<string, object>>} "tx,ty" → tile delta
   */
  async getChunk(cx, cy) {
    const all = await this.redis.hGetAll(this.key(cx, cy));
    /** @type {Record<string, object>} */
    const tiles = {};
    for (const [f, s] of Object.entries(all)) {
      try {
        tiles[f] = JSON.parse(s);
      } catch {
        /* 壊れたエントリは無視 */
      }
    }
    return tiles;
  }
}
