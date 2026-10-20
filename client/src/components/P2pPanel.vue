<script setup>
/**
 * @fileoverview P2P 接続パネル。
 * 「開始」でピアID採番（ホスト）、相手IDを入れて「接続」で join。
 */
import { ref } from 'vue';

import { p2pSession } from '@/net/p2pSync.js';
import { usePeerStore } from '@/stores/peerStore.js';

const p2p = usePeerStore();
const remoteId = ref('');
const collapsed = ref(false);

/** @returns {void} */
function startHosting() {
  p2pSession.start();
}

/** @returns {void} */
function join() {
  const id = remoteId.value.trim();
  if (!id) return;
  if (p2p.status !== 'open') {
    p2pSession.start(id);
  } else {
    p2pSession.connect(id);
  }
}
</script>

<template>
  <div class="p2p-panel">
    <button class="p2p-toggle" type="button" @click="collapsed = !collapsed">
      P2P {{ p2p.connectedIds.length ? `(${p2p.connectedIds.length})` : '' }}
      {{ collapsed ? '▸' : '▾' }}
    </button>
    <div v-if="!collapsed" class="p2p-body">
      <div class="row">
        <span class="label">自分のID</span>
        <code class="id">{{ p2p.myId || '—' }}</code>
      </div>
      <div class="row" v-if="p2p.error">
        <span class="error">{{ p2p.error }}</span>
      </div>
      <div class="row">
        <input
          v-model="remoteId"
          type="text"
          placeholder="相手のピアID"
          spellcheck="false"
        />
        <button type="button" @click="join">接続</button>
      </div>
      <div class="row">
        <button type="button" :disabled="p2p.status === 'open'" @click="startHosting">
          ホスト開始
        </button>
        <span class="status" :class="p2p.status">{{ p2p.status }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.p2p-panel {
  position: absolute;
  left: 12px;
  bottom: 12px;
  pointer-events: auto;
  min-width: 220px;
  background: rgba(7, 9, 12, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  font-size: 12px;
}

.p2p-toggle {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: #9fb2c4;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}

.p2p-body {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  color: #8a9bad;
}

.id {
  color: #8fe6cf;
  font-size: 11px;
  user-select: all;
}

input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: #dfe7ee;
  padding: 4px 8px;
  font-size: 12px;
}

button {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #c8d6e2;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

.error {
  color: #e08a8a;
}

.status.open {
  color: #6fd48a;
}
.status.error {
  color: #e08a8a;
}
.status.idle {
  color: #8a9bad;
}
</style>
