<script setup>
/**
 * @fileoverview Phaser キャンバスのマウントと game:pause 連携。
 * dialog:open 時に対話フェーズへ切り替わるよう、GAME_PAUSE を購読して
 * FieldScene を pause/resume する。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { createGame } from '@/game/index.js';

const container = ref(null);
/** @type {Phaser.Game | null} */
let game = null;

/**
 * @param {boolean} paused
 * @returns {void}
 */
function applyPause(paused) {
  const scene = game?.scene.getScene('FieldScene');
  if (!scene) return;
  if (paused) {
    scene.scene.pause();
  } else {
    scene.scene.resume();
  }
}

onMounted(() => {
  if (!container.value) return;
  game = createGame(container.value);
  eventBus.on(GAME_EVENTS.GAME_PAUSE, applyPause);
});

onBeforeUnmount(() => {
  eventBus.off(GAME_EVENTS.GAME_PAUSE, applyPause);
  game?.destroy(true);
  game = null;
});
</script>

<template>
  <div ref="container" class="game-canvas"></div>
</template>

<style scoped>
.game-canvas {
  position: absolute;
  inset: 0;
}

.game-canvas :deep(canvas) {
  display: block;
}
</style>
