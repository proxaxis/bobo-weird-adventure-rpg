/**
 * @fileoverview プレイヤーのバイタル（汚染度・HP・ボイド所持数）を保持するストア。
 * Phaser 側は player:vital_update イベントを発行し、eventBindings 経由でここに反映される。
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const usePlayerStore = defineStore('player', () => {
  /** 汚染度（0〜1）。1 に近づくほど危険。 */
  const pollution = ref(0);

  /** 体力（0〜1）。 */
  const hp = ref(1);

  /** 所持ボイド数。 */
  const voidCount = ref(0);

  /** 最寄り脅威までの距離（Phaser が将来書き込む。不明時は -1）。 */
  const nearestThreatDistance = ref(-1);

  /** 死亡判定。 */
  const isDead = computed(() => hp.value <= 0);

  /**
   * Phaser からのバイタル更新を適用する。
   * @param {import('@/types.js').VitalUpdate} vital
   * @returns {void}
   */
  function applyVitalUpdate(vital) {
    pollution.value = vital.pollution;
    hp.value = vital.hp;
    voidCount.value = vital.voidCount;
  }

  /**
   * AI リクエスト同梱用の環境スナップショット。
   * @returns {import('@/types.js').EnvironmentState}
   */
  const environment = computed(() => ({
    pollutionLevel: pollution.value,
    nearestThreatDistance: nearestThreatDistance.value,
    voidCount: voidCount.value,
  }));

  /**
   * リセット。
   * @returns {void}
   */
  function reset() {
    pollution.value = 0;
    hp.value = 1;
    voidCount.value = 0;
    nearestThreatDistance.value = -1;
  }

  return {
    pollution,
    hp,
    voidCount,
    nearestThreatDistance,
    isDead,
    environment,
    applyVitalUpdate,
    reset,
  };
});
