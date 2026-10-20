/**
 * @fileoverview 仲間（コンパニオン）状態ストア。
 * 信頼度が閾値を超えたMOBを「仲間にする」とフィールドで追従・援護する。
 */

import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { P_INDEX } from '@/constants/parameters.js';
import { useParameterStore } from '@/stores/parameterStore.js';

/** 仲間化に必要な信頼度（P_INDEX.TRUST_PLAYER の値）。 */
export const COMPANION_TRUST_THRESHOLD = 0.6;

export const useCompanionStore = defineStore('companion', () => {
  /** @type {import('vue').ShallowRef<{npcId: string, name: string} | null>} */
  const current = shallowRef(null);

  const isCompanion = computed(() => current.value !== null);
  const companionName = computed(() => current.value?.name ?? '');

  /**
   * 現在の対話相手の信頼度が閾値を超えているか。
   * parameterStore.revision を依存にして追従させる。
   * @returns {boolean}
   */
  function canRecruit() {
    const params = useParameterStore();
    return params.get(P_INDEX.TRUST_PLAYER) >= COMPANION_TRUST_THRESHOLD;
  }

  /**
   * 仲間化する。フィールドへ COMPANION_JOIN を発行する。
   * @param {{npcId: string, name: string}} npc
   * @returns {void}
   */
  function join(npc) {
    current.value = npc;
    eventBus.emit(GAME_EVENTS.COMPANION_JOIN, {
      npcId: npc.npcId,
      name: npc.name,
    });
  }

  /**
   * @returns {void}
   */
  function leave() {
    if (!current.value) return;
    eventBus.emit(GAME_EVENTS.COMPANION_LEAVE, undefined);
    current.value = null;
  }

  return { current, isCompanion, companionName, canRecruit, join, leave };
});
