/**
 * @fileoverview NPC × プレイヤー の関係性管理。
 * rel:{npcId}:{playerUuid} の Hash に最終対話時刻と直近履歴(10件)を保持し、
 * 会話の「時間差」を AI サーバの文脈として供給する。
 */

/** 保持する発話履歴の上限。 */
const HISTORY_LIMIT = 10;

export class RelationshipManager {
  /**
   * @param {import('redis').RedisClientType} redis
   */
  constructor(redis) {
    this.redis = redis;
  }

  /**
   * @param {string} npcId
   * @param {string} uuid
   * @returns {string}
   */
  key(npcId, uuid) {
    return `rel:${npcId}:${uuid}`;
  }

  /**
   * 対話開始時: 最終対話時刻と履歴を返す。
   * @param {string} npcId
   * @param {string} uuid
   * @returns {Promise<{lastInteractionTime: number, history: Array<{t:number,player:string,npc:string}>}>}
   */
  async get(npcId, uuid) {
    const h = await this.redis.hGetAll(this.key(npcId, uuid));
    let history = [];
    try {
      history = JSON.parse(h.history ?? '[]');
    } catch {
      history = [];
    }
    return {
      lastInteractionTime: Number(h.lastInteractionTime ?? 0),
      history: Array.isArray(history) ? history : [],
    };
  }

  /**
   * 対話終了時: 最終対話時刻を現在に更新し、直近発話を履歴へ積む。
   * @param {string} npcId
   * @param {string} uuid
   * @param {string} playerText
   * @param {string} npcText
   * @returns {Promise<{previous: number, now: number}>}
   */
  async touch(npcId, uuid, playerText = '', npcText = '') {
    const { lastInteractionTime, history } = await this.get(npcId, uuid);
    const now = Date.now();
    if (playerText || npcText) {
      history.push({ t: now, player: playerText, npc: npcText });
      while (history.length > HISTORY_LIMIT) history.shift();
    }
    await this.redis.hSet(this.key(npcId, uuid), {
      lastInteractionTime: String(now),
      history: JSON.stringify(history),
    });
    return { previous: lastInteractionTime, now };
  }
}
