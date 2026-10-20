<script setup>
/**
 * @fileoverview 装備クラフトパネル。Gキーまたはボタンで開閉。
 * ボイドを消費して耐環境装備を作成/強化する。
 */
import { onBeforeUnmount, onMounted } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { useGearStore } from '@/stores/gearStore.js';
import { usePlayerStore } from '@/stores/playerStore.js';

const gear = useGearStore();
const player = usePlayerStore();

/** @param {KeyboardEvent} e */
const onKey = (e) => {
  if (e.key === 'g' || e.key === 'G') gear.togglePanel();
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <button class="craft-toggle" type="button" @click="gear.togglePanel()">
    装備 [G]
  </button>
  <div v-if="gear.panelOpen" class="craft-panel">
    <div class="craft-title">装備クラフト（ボイド × {{ player.voidCount }}）</div>
    <div v-for="g in gear.defs" :key="g.id" class="gear-row">
      <span class="gear-name">
        {{ g.name }}<template v-if="g.max > 1"> Lv{{ g.lv }}/{{ g.max }}</template>
      </span>
      <button
        type="button"
        class="craft-btn"
        :disabled="g.nextCost < 0 || player.voidCount < g.nextCost"
        @click="gear.craft(g.id, player.voidCount)"
      >
        {{ g.nextCost < 0 ? 'MAX' : `作成 ×${g.nextCost}` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.craft-toggle {
  position: absolute;
  right: 12px;
  bottom: 48px;
  pointer-events: auto;
  background: rgba(7, 9, 12, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #c8d6e2;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.craft-panel {
  position: absolute;
  right: 12px;
  bottom: 82px;
  pointer-events: auto;
  min-width: 240px;
  background: rgba(7, 9, 12, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
}

.craft-title {
  color: #8fe6cf;
  margin-bottom: 8px;
}

.gear-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  color: #c8d6e2;
}

.craft-btn {
  background: rgba(174, 247, 228, 0.12);
  border: 1px solid rgba(174, 247, 228, 0.4);
  color: #aef7e4;
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 11px;
}

.craft-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
