/**
 * @fileoverview 耐環境装備の所持・クラフト状態。
 * ボイドを消費して装備を作成/強化する。実際のボイド消費は
 * 'player:spend-void' イベント経由で FieldScene が処理する。
 *
 * - 耐汚染服 Lv1-16:  汚染蓄積レート低減（lv/16 まで最大100%軽減）
 * - 耐水服   Lv1-3:   耐水性（将来の水場バイオーム向け）+ 微少な汚染耐性
 * - 酸素マスク:       HP減少の発生閾値を底上げ + 減少レート半減
 * - 耐放射能服 Lv1-16: 放射線による HP 減少レート低減（lv/16）
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';

/** @typedef {'pollution'|'water'|'mask'|'radiation'} GearId */

const GEAR_DEFS = /** @type {Record<GearId, {name: string, max: number}>} */ ({
  pollution: { name: '耐汚染服', max: 16 },
  water: { name: '耐水服', max: 3 },
  mask: { name: '酸素マスク', max: 1 },
  radiation: { name: '耐放射能服', max: 16 },
});

/**
 * @param {GearId} id
 * @param {number} lv - 現行レベル（次レベルのコストを返す）
 * @returns {number}
 */
export function gearCost(id, lv) {
  if (id === 'mask') return 12;
  if (id === 'water') return 8 * (lv + 1);
  return 4 + lv * 2;
}

export const useGearStore = defineStore('gear', () => {
  const levels = ref(/** @type {Record<GearId, number>} */ ({
    pollution: 0,
    water: 0,
    mask: 0,
    radiation: 0,
  }));
  const panelOpen = ref(false);

  const defs = computed(() =>
    (Object.keys(GEAR_DEFS)).map((id) => ({
      id: /** @type {GearId} */ (id),
      name: GEAR_DEFS[/** @type {GearId} */ (id)].name,
      max: GEAR_DEFS[/** @type {GearId} */ (id)].max,
      lv: levels.value[/** @type {GearId} */ (id)],
      nextCost: levels.value[/** @type {GearId} */ (id)] < GEAR_DEFS[/** @type {GearId} */ (id)].max
        ? gearCost(/** @type {GearId} */ (id), levels.value[/** @type {GearId} */ (id)])
        : -1,
    })),
  );

  /** 汚染蓄積レートの乗数（1=無効, 0=完全耐性）。耐水服も微寄与。 */
  const pollutionMul = computed(
    () => Math.max(0, 1 - levels.value.pollution / 16) * (1 - levels.value.water * 0.05),
  );
  /** 放射線HP減少レートの乗数。 */
  const radiationMul = computed(() => Math.max(0, 1 - levels.value.radiation / 16));
  /** HP減少が発生する汚染閾値（マスクで +0.15）。 */
  const drainThreshold = computed(() => 0.8 + (levels.value.mask ? 0.15 : 0));
  /** マスクはHP減少レートを半減する。 */
  const maskDrainMul = computed(() => (levels.value.mask ? 0.5 : 1));

  /**
   * クラフト要求を発行する（FieldScene がボイド消費を処理）。
   * @param {GearId} id
   * @param {number} voidCount
   * @returns {boolean} 要求を出したか
   */
  function craft(id, voidCount) {
    const cost = gearCost(id, levels.value[id]);
    if (levels.value[id] >= GEAR_DEFS[id].max || voidCount < cost) return false;
    levels.value = { ...levels.value, [id]: levels.value[id] + 1 };
    eventBus.emit(GAME_EVENTS.PLAYER_SPEND_VOID, { amount: cost });
    return true;
  }

  /**
   * @returns {void}
   */
  function togglePanel() {
    panelOpen.value = !panelOpen.value;
  }

  return {
    levels,
    defs,
    panelOpen,
    pollutionMul,
    radiationMul,
    drainThreshold,
    maskDrainMul,
    craft,
    togglePanel,
  };
});
