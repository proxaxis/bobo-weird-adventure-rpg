/**
 * @fileoverview 表情プリセット ↔ VRM 表情名の解決。
 * VRM 1.0 は happy/sad/relaxed/surprised、VRM 0.x は joy/sorrow/fun 等と
 * 名前が異なるため、候補リストを順に試す。
 */

/**
 * 仕様の表情プリセット名一覧。
 * @type {readonly import('@/types.js').ExpressionPreset[]}
 */
export const EXPRESSION_PRESETS = Object.freeze([
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
]);

/**
 * プリセット名 → VRM 側の候補名（VRM1.0 → VRM0.x の順）。
 * @type {Record<import('@/types.js').ExpressionPreset, string[]>}
 */
const EXPRESSION_ALIASES = {
  neutral: ['neutral'],
  happy: ['happy', 'joy'],
  angry: ['angry'],
  sad: ['sad', 'sorrow'],
  relaxed: ['relaxed', 'fun'],
  surprised: ['surprised'],
};

/**
 * VRMExpressionManager が持つ表情名の集合を返す。
 * @param {import('@pixiv/three-vrm').VRMExpressionManager} manager
 * @returns {Set<string>}
 */
export function listExpressionNames(manager) {
  try {
    return new Set(Object.keys(manager.expressionMap ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * プリセットをモデルが実装する表情名へ解決する。
 * @param {import('@pixiv/three-vrm').VRMExpressionManager} manager
 * @param {import('@/types.js').ExpressionPreset} preset
 * @returns {string | null} 解決できた表情名。見つからなければ null
 */
export function resolveExpressionName(manager, preset) {
  const available = listExpressionNames(manager);
  for (const name of EXPRESSION_ALIASES[preset] ?? []) {
    if (available.has(name)) return name;
  }
  return null;
}
