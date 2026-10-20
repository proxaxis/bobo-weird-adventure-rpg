/**
 * @fileoverview 仲間（コンパニオン）状態と NPC 関係性を保持するストア。
 * - 仲間化は AI のツール呼出し(join_companion) 経由で行われる
 * - NPC の名前は reveal_name ツールで名乗られるまで「？？？」表示
 */

import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';

export const useCompanionStore = defineStore('companion', () => {
  /** @type {import('vue').ShallowRef<{npcId: string, name: string} | null>} */
  const current = shallowRef(null);

  /** 名前を名乗ったNPCのID集合（セッション中保持）。 */
  const knownNpcIds = shallowRef(/** @type {Set<string>} */ (new Set()));

  /** NPCごとの信頼度（対話差分 u の index100 を蓄積したローカル推定）。 */
  const trustByNpc = shallowRef(/** @type {Map<string, number>} */ (new Map()));

  /**
   * NPC への信頼度を加算する。
   * @param {string} npcId
   * @param {number} delta
   * @returns {void}
   */
  function addTrust(npcId, delta) {
    const next = new Map(trustByNpc.value);
    next.set(npcId, Math.min(1, Math.max(0, (next.get(npcId) ?? 0.2) + delta)));
    trustByNpc.value = next;
  }

  /**
   * @param {string} npcId
   * @returns {number}
   */
  function trustOf(npcId) {
    return trustByNpc.value.get(npcId) ?? 0.2;
  }

  const isCompanion = computed(() => current.value !== null);
  const companionName = computed(() => current.value?.name ?? '');

  /**
   * @param {string} npcId
   * @returns {boolean}
   */
  function isKnown(npcId) {
    return knownNpcIds.value.has(npcId);
  }

  /**
   * NPC が名乗ったことを記録し、フィールド表示へ通知する。
   * @param {{npcId: string, name: string}} npc
   * @returns {void}
   */
  function markKnown(npc) {
    if (knownNpcIds.value.has(npc.npcId)) return;
    const next = new Set(knownNpcIds.value);
    next.add(npc.npcId);
    knownNpcIds.value = next;
    eventBus.emit(GAME_EVENTS.NPC_NAME_REVEALED, {
      npcId: npc.npcId,
      name: npc.name,
    });
  }

  /**
   * 仲間化する。フィールドへ COMPANION_JOIN を発行する。
   * @param {{npcId: string, name: string}} npc
   * @returns {void}
   */
  function join(npc) {
    current.value = npc;
    markKnown(npc);
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

  return {
    current,
    knownNpcIds,
    trustByNpc,
    isCompanion,
    companionName,
    isKnown,
    markKnown,
    addTrust,
    trustOf,
    join,
    leave,
  };
});
