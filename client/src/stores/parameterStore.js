/**
 * @fileoverview 1000パラメータを Float32Array で保持するストア。
 * 仕様: 1000キーのオブジェクトは持たず、インデックス参照で直接更新する。
 * Vue のリアクティビティは revision カウンタ経由でのみ購読する
 * （Float32Array の要素書き換えは Proxy 検知されないため）。
 */

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

import { isValidParamIndex, PARAM_COUNT } from '@/constants/parameters.js';

/**
 * 0〜1 にクランプする。
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export const useParameterStore = defineStore('parameters', () => {
  /**
   * 生データ。リアクティブ化せず参照保持に留める。
   * @type {Float32Array}
   */
  const values = new Float32Array(PARAM_COUNT);

  /** 更新通知用リビジョン。applyDiffs/set のたびに増加する。 */
  const revision = ref(0);

  /** このパラメータセットが属する NPC 識別子。 */
  const npcId = shallowRef('');

  /**
   * 1要素を読む。
   * @param {number} index
   * @returns {number}
   */
  function get(index) {
    return values[index];
  }

  /**
   * 1要素を絶対値で書き込む（0〜1にクランプ）。
   * @param {number} index
   * @param {number} value
   * @returns {void}
   */
  function set(index, value) {
    if (!isValidParamIndex(index)) return;
    values[index] = clamp01(value);
    revision.value++;
  }

  /**
   * サーバからの差分配列をまとめて適用する。
   * @param {import('@/types.js').ParameterDiff[]} diffs
   * @returns {void}
   */
  function applyDiffs(diffs) {
    let touched = false;
    for (const d of diffs) {
      if (!d || !isValidParamIndex(d.index)) continue;
      values[d.index] = clamp01(values[d.index] + d.delta);
      touched = true;
    }
    if (touched) revision.value++;
  }

  /**
   * 送信用に plain array へスナップショットする。
   * @returns {number[]} PARAM_COUNT 要素の配列
   */
  function toArray() {
    return Array.from(values);
  }

  /**
   * サーバ側スナップショットで全置換する。
   * @param {number[] | Float32Array} arr
   * @returns {void}
   */
  function loadAll(arr) {
    if (arr.length !== PARAM_COUNT) {
      throw new Error(`parameters length must be ${PARAM_COUNT}, got ${arr.length}`);
    }
    for (let i = 0; i < PARAM_COUNT; i++) values[i] = clamp01(arr[i]);
    revision.value++;
  }

  /**
   * 対象 NPC を切り替えて全パラメータを初期化する。
   * @param {string} id - NPC識別子
   * @returns {void}
   */
  function resetFor(id) {
    values.fill(0);
    npcId.value = id;
    revision.value++;
  }

  return {
    npcId,
    revision,
    get,
    set,
    applyDiffs,
    toArray,
    loadAll,
    resetFor,
  };
});
