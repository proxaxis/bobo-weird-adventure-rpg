/**
 * @fileoverview 1000パラメータシステムのインデックス設計。
 * Float32Array(1000) を帯域分割し、意味のある先頭パラメータに名前を付ける。
 * 未命名領域はバックエンド/拡張用に予約。
 */

/** パラメータ総数。 */
export const PARAM_COUNT = 1000;

/**
 * 帯域割り当て（開始Index, 終了Index は両端含む）。
 * - 0-99   : 生体情報（ウイルス感染度・放射能蓄積・疲労など）
 * - 100-199: 対人信頼（プレイヤーへの信頼・親密さ・恐怖）
 * - 200-299: 戦闘思考（攻撃性・慎重さ・逃走閾値・護衛意識・命中）
 * - 300-399: 性格（開放性・優しさ・好奇心・倫理観）
 * - 400-499: 趣味嗜好（話題・物品への関心）
 * - 500-599: 感情状態（喜怒哀楽・平静・驚き）
 * - 600-699: 記憶要約（贈り物・共闘回数・裏切り経験）
 * - 700-999: 予約（派生状態・実験用）
 * @type {Readonly<Record<string, readonly [number, number]>>}
 */
export const PARAM_BANDS = Object.freeze({
  BIOLOGICAL: /** @type {const} */ ([0, 99]),
  TRUST: /** @type {const} */ ([100, 199]),
  COMBAT: /** @type {const} */ ([200, 299]),
  PERSONALITY: /** @type {const} */ ([300, 399]),
  PREFERENCE: /** @type {const} */ ([400, 499]),
  EMOTION: /** @type {const} */ ([500, 599]),
  MEMORY: /** @type {const} */ ([600, 699]),
  RESERVED: /** @type {const} */ ([700, 999]),
});

/**
 * 命名済みパラメータのインデックス定数。
 * @type {Readonly<Record<string, number>>}
 */
export const P_INDEX = Object.freeze({
  // --- 生体情報 (0-99) ---
  BIO_VIRUS_INFECTION: 0,
  BIO_RADIATION: 1,
  BIO_FATIGUE: 2,
  BIO_HUNGER: 3,
  BIO_PAIN: 4,

  // --- 対人信頼 (100-199) ---
  TRUST_PLAYER: 100,
  TRUST_FAMILIARITY: 101,
  TRUST_DEPENDENCE: 102,
  TRUST_FEAR: 103,
  TRUST_LOYALTY: 104,

  // --- 戦闘思考 (200-299) ---
  CBT_AGGRESSION: 200,
  CBT_CAUTION: 201,
  CBT_FLEE_THRESHOLD: 202,
  CBT_PROTECT_PLAYER: 203,
  CBT_SKILL_ACCURACY: 204,

  // --- 性格 (300-399) ---
  PER_OPENNESS: 300,
  PER_KINDNESS: 301,
  PER_CURIOSITY: 302,
  PER_STUBBORNNESS: 303,
  PER_HUMOR: 304,
  PER_ETHIC_ALTRUISM: 305,

  // --- 趣味嗜好 (400-499) ---
  PRF_TOPIC_NATURE: 400,
  PRF_TOPIC_TECH: 401,
  PRF_TOPIC_FOOD: 402,
  PRF_TOPIC_OLDWORLD: 403,
  PRF_ITEM_VOID: 404,

  // --- 感情状態 (500-599) ---
  EMO_JOY: 500,
  EMO_ANGER: 501,
  EMO_SADNESS: 502,
  EMO_FEAR: 503,
  EMO_CALM: 504,
  EMO_SURPRISE: 505,

  // --- 記憶要約 (600-699) ---
  MEM_LAST_GIFT: 600,
  MEM_SHARED_BATTLES: 601,
  MEM_TIMES_BETRAYED: 602,
});

/**
 * インデックスが有効範囲かを判定する。
 * @param {number} index
 * @returns {boolean}
 */
export function isValidParamIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < PARAM_COUNT;
}
