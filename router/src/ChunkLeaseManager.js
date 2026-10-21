/**
 * @fileoverview チャンク所有権リース管理。
 * - クライアントは存在チャンクに対し SET NX EX でリースを要求
 * - オーナーはハートビート（2s毎）で TTL(5s) を延長
 * - オーナー切断時は TTL 失効 → 他クライアントが自動的に継承する
 */

/** リース TTL（秒）。ハートビート間隔より長く取る。 */
export const LEASE_TTL_SEC = 5;

export class ChunkLeaseManager {
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
    return `chunk:lease:${cx}:${cy}`;
  }

  /**
   * リース獲得を試みる。保持者が自分なら期限を延長する。
   * @param {number} cx
   * @param {number} cy
   * @param {string} uuid - 要求者の永続プレイヤーID
   * @returns {Promise<{owner: string, granted: boolean, ttlMs: number}>}
   */
  async acquire(cx, cy, uuid) {
    const k = this.key(cx, cy);
    const created = await this.redis.set(k, uuid, { EX: LEASE_TTL_SEC, NX: true });
    if (created) return { owner: uuid, granted: true, ttlMs: LEASE_TTL_SEC * 1000 };
    const owner = await this.redis.get(k);
    const granted = owner === uuid;
    if (granted) await this.redis.expire(k, LEASE_TTL_SEC);
    return { owner: owner ?? '', granted, ttlMs: await this.redis.pTTL(k) };
  }

  /**
   * ハートビート: 自分が保持するリースの TTL を延長する。
   * @param {Array<[number, number]>} chunks
   * @param {string} uuid
   * @returns {Promise<number>} 延長できた件数
   */
  async heartbeat(chunks, uuid) {
    let renewed = 0;
    for (const [cx, cy] of chunks) {
      const k = this.key(cx, cy);
      const owner = await this.redis.get(k);
      if (owner === uuid) {
        await this.redis.expire(k, LEASE_TTL_SEC);
        renewed++;
      }
    }
    return renewed;
  }

  /**
   * 現在のリース所有者を返す（未リースなら空文字）。
   * @param {number} cx
   * @param {number} cy
   * @returns {Promise<string>}
   */
  async owner(cx, cy) {
    return (await this.redis.get(this.key(cx, cy))) ?? '';
  }
}
