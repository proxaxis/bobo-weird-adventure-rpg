<script setup>
/**
 * @fileoverview レイヤー構成:
 *   layer-game  : Phaser キャンバス（最背面）
 *   layer-ui    : Vue HUD/対話UI（pointer-events:none、必要箇所のみ auto）
 */
import GameCanvas from '@/components/GameCanvas.vue';
import HudOverlay from '@/components/HudOverlay.vue';
import P2pPanel from '@/components/P2pPanel.vue';
import DialogView from '@/dialog/DialogView.vue';
import { useDialogStore } from '@/stores/dialogStore.js';

const dialog = useDialogStore();
</script>

<template>
  <div class="app-root">
    <GameCanvas class="layer-game" />
    <div class="layer-ui">
      <HudOverlay />
      <P2pPanel />
      <DialogView v-if="dialog.isOpen" />
    </div>
  </div>
</template>

<style scoped>
.app-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.layer-game {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.layer-ui {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
</style>
