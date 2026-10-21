/**
 * @fileoverview 会話内容に応じた動的モーション（身振り）プリセット。
 * - サーバのストリームチャンク m フィールド（LLM が任意で指定）
 * - 未指定時は表情プリセットから既定ジェスチャを導出
 * 各ジェスチャは「基準姿勢＋アイドル揺れ」へ加算するボーン差分曲線。
 */

/**
 * 身振りプリセット名。
 * @typedef {'nod'|'shake'|'tilt'|'bow'|'startle'|'slump'|'bounce'} MotionPreset
 */

/** @type {readonly MotionPreset[]} */
export const MOTION_PRESETS = Object.freeze([
  'nod',
  'shake',
  'tilt',
  'bow',
  'startle',
  'slump',
  'bounce',
]);

/**
 * 表情プリセット → 既定ジェスチャ（サーバが m を出さない場合の推定）。
 * @type {Record<string, MotionPreset>}
 */
const EXPRESSION_TO_MOTION = {
  happy: 'bounce',
  sad: 'slump',
  angry: 'shake',
  surprised: 'startle',
  relaxed: 'nod',
};

/**
 * @param {string} expression
 * @returns {MotionPreset | null}
 */
export function motionForExpression(expression) {
  return EXPRESSION_TO_MOTION[expression] ?? null;
}

/** 単発の山なり曲線（0→1→0）。 */
const hump = (/** @type {number} */ t) => Math.sin(Math.PI * t);

/** 減衰する往復振動。 */
const wobble = (/** @type {number} */ t, /** @type {number} */ n = 3) =>
  Math.sin(n * Math.PI * t) * Math.max(0, 1 - t);

/** 立ち上がり→保持→戻りの台形曲線。 */
const hold = (/** @type {number} */ t, /** @type {number} */ edge = 0.2) =>
  t < edge ? t / edge : t > 1 - edge ? (1 - t) / edge : 1;

/**
 * ジェスチャ定義。
 * curves[boneName][axis] = (t:0..1) => 加算量。
 * - hips.y のみ position.y へ適用、それ以外は rotation 軸への加算。
 * @type {Record<MotionPreset, {
 *   duration: number,
 *   curves: Record<string, Record<string, (t: number) => number>>,
 * }>}
 */
export const GESTURES = {
  // うなずき
  nod: {
    duration: 0.7,
    curves: {
      head: { x: (t) => 0.3 * hump(t) },
      spine: { x: (t) => 0.06 * hump(t) },
    },
  },
  // 首を横に振る（否定・不満）
  shake: {
    duration: 1.0,
    curves: {
      head: { y: (t) => 0.25 * wobble(t, 3) },
    },
  },
  // 首かしげ（疑問・思案）
  tilt: {
    duration: 1.4,
    curves: {
      head: { z: (t) => 0.22 * hold(t) },
    },
  },
  // おじぎ
  bow: {
    duration: 1.2,
    curves: {
      spine: { x: (t) => 0.32 * hump(t) },
      head: { x: (t) => 0.15 * hump(t) },
    },
  },
  // びっくり（身を引く）
  startle: {
    duration: 0.5,
    curves: {
      spine: { x: (t) => -0.18 * hump(t) },
      head: { x: (t) => -0.1 * hump(t) },
      hips: { y: (t) => 0.02 * hump(t) },
    },
  },
  // しょんぼり（肩を落とす、2秒保持）
  slump: {
    duration: 1.8,
    curves: {
      spine: { x: (t) => 0.22 * hold(t, 0.15) },
      head: { x: (t) => 0.18 * hold(t, 0.15) },
    },
  },
  // ぴょん（喜びの小ジャンプ）
  bounce: {
    duration: 0.7,
    curves: {
      hips: { y: (t) => 0.05 * hump(t) },
      head: { z: (t) => 0.06 * hump(t) },
    },
  },
};
