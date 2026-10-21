/**
 * @fileoverview 拠点（ドア許可）の状態。
 * permittedIds に含まれる peerId だけが自分の拠点ドアを通過できる。
 * エンティティ報告の meta.permitted に同期される。
 */

import { defineStore } from 'pinia';
import { shallowRef } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';

export const useBaseStore = defineStore('base', () => {
  /** @type {import('vue').ShallowRef<Set<string>>} */
  const permittedIds = shallowRef(new Set());

  /**
   * @param {string} peerId
   * @returns {boolean}
   */
  function isPermitted(peerId) {
    return permittedIds.value.has(peerId);
  }

  /**
   * @param {string} peerId
   * @param {boolean} allowed
   * @returns {void}
   */
  function setPermitted(peerId, allowed) {
    const next = new Set(permittedIds.value);
    if (allowed) next.add(peerId);
    else next.delete(peerId);
    permittedIds.value = next;
    // ドアのDeltaMapスタンプを更新するためシーンへ通知
    eventBus.emit(GAME_EVENTS.BASE_PERM_CHANGED, { peerId, allowed });
  }

  /**
   * @param {string} peerId
   * @returns {void}
   */
  function toggle(peerId) {
    setPermitted(peerId, !isPermitted(peerId));
  }

  return { permittedIds, isPermitted, setPermitted, toggle };
});
