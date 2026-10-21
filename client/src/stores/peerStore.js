/**
 * @fileoverview P2P 接続状態を保持するストア。
 * 実際の接続管理は net/p2pSync.js が行い、ここは表示用の状態のみ持つ。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';

export const usePeerStore = defineStore('p2p', () => {
  /** 自分の PeerJS ID（ホスト/接続開始で採番される）。 */
  const myId = ref('');

  /**
   * 接続状態。
   * @type {import('vue').Ref<'idle'|'open'|'error'>}
   */
  const status = ref('idle');

  /** 接続中ピアの ID 一覧。 */
  const connectedIds = ref(/** @type {string[]} */ ([]));

  /** peerId → 永続UUID の対応表（router の peers 応答で更新）。 */
  const uuidByPeerId = ref(/** @type {Map<string, string>} */ (new Map()));

  /** 直近エラーメッセージ。 */
  const error = ref('');

  /**
   * @param {string} peerId
   * @returns {void}
   */
  function addPeer(peerId) {
    if (!connectedIds.value.includes(peerId)) {
      connectedIds.value = [...connectedIds.value, peerId];
    }
  }

  /**
   * @param {string} peerId
   * @returns {void}
   */
  function removePeer(peerId) {
    connectedIds.value = connectedIds.value.filter((id) => id !== peerId);
  }

  /**
   * peerId と永続UUIDの対応を記録する。
   * @param {string} peerId
   * @param {string} uuid
   * @returns {void}
   */
  function mapPeerUuid(peerId, uuid) {
    if (uuidByPeerId.value.get(peerId) === uuid) return;
    const next = new Map(uuidByPeerId.value);
    next.set(peerId, uuid);
    uuidByPeerId.value = next;
  }

  /**
   * @param {string} peerId
   * @returns {string} 永続UUID（不明なら peerId そのまま）
   */
  function uuidOf(peerId) {
    return uuidByPeerId.value.get(peerId) ?? peerId;
  }

  /**
   * @returns {void}
   */
  function reset() {
    myId.value = '';
    status.value = 'idle';
    connectedIds.value = [];
    error.value = '';
  }

  return {
    myId,
    status,
    connectedIds,
    error,
    uuidByPeerId,
    addPeer,
    removePeer,
    mapPeerUuid,
    uuidOf,
    reset,
  };
});
