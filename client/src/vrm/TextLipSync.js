/**
 * @fileoverview テキスト駆動リップシンク。
 * ストリーミング文字列を1文字ずつ消費し、仮名の母音を VRM の
 * 口形状（aa/ih/ou/ee/oh）へマップする。音声合成を挟まずテキストだけで駆動。
 */

/** 口形状として使う VRM 表情名（VRM 1.0 命名）。 */
export const VOWEL_EXPRESSIONS = Object.freeze(['aa', 'ih', 'ou', 'ee', 'oh']);

/**
 * VRM 1.0 名 → VRM 0.x 名の口形状エイリアス。
 * @type {Record<string, string[]>}
 */
export const VOWEL_ALIASES = Object.freeze({
  aa: ['aa', 'a'],
  ih: ['ih', 'i'],
  ou: ['ou', 'u'],
  ee: ['ee', 'e'],
  oh: ['oh', 'o'],
});

/**
 * 仮名 → 口形状の対応表。
 * @type {Record<string, string>}
 */
const VOWEL_MAP = (() => {
  /** @type {Record<string, string>} */
  const map = {};
  /**
   * @param {string} chars
   * @param {string} vowel
   */
  const assign = (chars, vowel) => {
    for (const ch of chars) map[ch] = vowel;
  };
  assign('あかさたなはまやらわがざだばぱぁゃアカサタナハマヤラワガザダバパァャ', 'aa');
  assign('いきしちにひみりぎじぢびぴぃイキシチニヒミリギジヂビピィ', 'ih');
  assign('うくすつぬふむゆるぐずづぶぷぅゅっウクスツヌフムユルグズヅブプゥュッ', 'ou');
  assign('えけせてねへめれげぜでべぺぇエケセテネヘメレゲゼデベペェ', 'ee');
  assign('おこそとのほもよろをごぞどぼぽぉょオコソトノホモヨロヲゴゾドボポォョ', 'oh');
  return map;
})();

/**
 * 1文字を口形状名へ変換する。
 * @param {string} ch
 * @returns {string | null} VOWEL_EXPRESSIONS のいずれか。口を動かさない文字は null
 */
export function charToVowel(ch) {
  return VOWEL_MAP[ch] ?? null;
}
