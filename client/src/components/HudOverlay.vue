<script setup>
/**
 * @fileoverview 探索フェーズの HUD。playerStore をそのまま表示。
 * ui-layer は pointer-events:none なので操作要素のみ auto を付ける。
 */
import { computed } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { NPC_DEFS } from '@/game/npcs.js';
import { usePlayerStore } from '@/stores/playerStore.js';

const player = usePlayerStore();

const pollutionPct = computed(() => `${Math.round(player.pollution * 100)}%`);
const hpPct = computed(() => `${Math.round(player.hp * 100)}%`);

/**
 * デバッグ用：最初のNPCとの対話を強制開始する。
 * @returns {void}
 */
function debugOpenDialog() {
  const npc = NPC_DEFS[0];
  eventBus.emit(GAME_EVENTS.DIALOG_OPEN, {
    npcId: npc.id,
    name: npc.name,
    vrmModelUrl: npc.vrmModelUrl,
  });
}
</script>

<template>
  <div class="hud">
    <div class="vitals">
      <div class="bar-row">
        <span class="label">HP</span>
        <div class="bar"><div class="fill hp" :style="{ width: hpPct }"></div></div>
        <span class="value">{{ hpPct }}</span>
      </div>
      <div class="bar-row">
        <span class="label">汚染</span>
        <div class="bar">
          <div class="fill pollution" :style="{ width: pollutionPct }"></div>
        </div>
        <span class="value">{{ pollutionPct }}</span>
      </div>
      <div class="void-count">ボイド × {{ player.voidCount }}</div>
    </div>

    <button class="debug-btn" type="button" @click="debugOpenDialog">
      [debug] 対話テスト
    </button>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.vitals {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 10px 12px;
  background: rgba(7, 9, 12, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  min-width: 220px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.label {
  width: 32px;
  font-size: 12px;
  color: #9fb2c4;
}

.bar {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.fill {
  height: 100%;
  transition: width 0.2s;
}

.fill.hp {
  background: #6fd48a;
}

.fill.pollution {
  background: #d4a04a;
}

.value {
  width: 38px;
  text-align: right;
  font-size: 12px;
  color: #c8d6e2;
}

.void-count {
  font-size: 13px;
  color: #8fe6cf;
}

.debug-btn {
  position: absolute;
  right: 12px;
  bottom: 12px;
  pointer-events: auto;
  padding: 6px 10px;
  font-size: 12px;
  color: #9fb2c4;
  background: rgba(7, 9, 12, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  cursor: pointer;
}

.debug-btn:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.4);
}
</style>
