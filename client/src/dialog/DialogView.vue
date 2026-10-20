<script setup>
/**
 * @fileoverview 対話フェーズ UI。
 * 左: VrmCanvas（3Dアバター）、下部: 会話ログ + 入力。
 * ui-layer は pointer-events:none なので本パネルのみ auto を指定する。
 */
import { computed, nextTick, ref, watch } from 'vue';

import VrmCanvas from '@/dialog/VrmCanvas.vue';
import { P_INDEX } from '@/constants/parameters.js';
import { useDialogStore } from '@/stores/dialogStore.js';
import { useParameterStore } from '@/stores/parameterStore.js';

const dialog = useDialogStore();
const parameters = useParameterStore();
const inputText = ref('');

// 内面パラメータ→姿勢モーション用の気分（revision で追従）
const mood = computed(() => {
  void parameters.revision;
  return {
    trust: parameters.get(P_INDEX.TRUST_PLAYER),
    fear: parameters.get(P_INDEX.TRUST_FEAR),
    joy: parameters.get(P_INDEX.EMO_JOY),
    aggression: parameters.get(P_INDEX.CBT_AGGRESSION),
  };
});
const logEl = ref(null);
/** @type {import('vue').Ref<InstanceType<typeof VrmCanvas> | null>} */
const vrmRef = ref(null);

// ストリーミングチャンクをリップシンクへ流す
watch(
  () => dialog.speechSeq,
  () => {
    vrmRef.value?.feedSpeech(dialog.speechText);
  },
);

// 身振りをVRMへ流す
watch(
  () => dialog.motionSeq,
  () => {
    vrmRef.value?.triggerMotion(dialog.motionName);
  },
);

// ログ追加時に最下部へスクロール
watch(
  () => dialog.messages.length && dialog.messages[dialog.messages.length - 1].text,
  async () => {
    await nextTick();
    logEl.value?.scrollTo({ top: logEl.value.scrollHeight });
  },
);

/**
 * 送信。
 * @returns {void}
 */
function onSubmit() {
  const text = inputText.value;
  inputText.value = '';
  void dialog.send(text);
}
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog-panel">
      <div class="avatar-area">
        <VrmCanvas
          ref="vrmRef"
          :model-url="dialog.vrmModelUrl"
          :expression="dialog.expression"
          :thinking="dialog.isThinking"
          :mood="mood"
        />
        <div v-if="dialog.isThinking" class="thinking-badge">考え中…</div>
        <img
          class="player-portrait"
          src="/sprites/player.png"
          alt="あなた"
          title="あなた"
        />
      </div>

      <div class="chat-area">
        <header class="chat-header">
          <span class="npc-name">{{ dialog.displayName }}</span>
          <button class="close-btn" type="button" @click="dialog.close()">
            × 閉じる
          </button>
        </header>

        <div ref="logEl" class="chat-log">
          <div
            v-for="(m, i) in dialog.messages"
            :key="i"
            class="msg"
            :class="m.role"
          >
            <img
              v-if="m.role === 'player'"
              class="msg-avatar"
              src="/sprites/player.png"
              alt=""
            />
            <span class="role">{{
              m.role === 'player' ? 'あなた' : m.role === 'npc' ? dialog.displayName : ''
            }}</span>
            <span class="text">{{ m.text }}<span v-if="m.streaming" class="caret">▌</span></span>
          </div>
        </div>

        <form class="chat-input" @submit.prevent="onSubmit">
          <input
            v-model="inputText"
            type="text"
            :placeholder="`${dialog.displayName} に話しかける…`"
            :disabled="dialog.isStreaming"
            autofocus
          />
          <button type="submit" :disabled="dialog.isStreaming || !inputText.trim()">
            送信
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: rgba(4, 6, 9, 0.55);
  pointer-events: auto;
}

.dialog-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  width: 100%;
  height: 100%;
}

.avatar-area {
  position: relative;
  min-width: 0;
  background: radial-gradient(
    ellipse at 50% 80%,
    rgba(60, 80, 110, 0.35),
    rgba(8, 12, 20, 0.9) 75%
  );
}

.player-portrait {
  position: absolute;
  left: 14px;
  bottom: 14px;
  width: 88px;
  height: 88px;
  image-rendering: pixelated;
  border: 1px solid rgba(159, 230, 255, 0.4);
  border-radius: 6px;
  background: rgba(10, 15, 25, 0.5);
}

.msg-avatar {
  width: 22px;
  height: 22px;
  image-rendering: pixelated;
  border-radius: 4px;
  vertical-align: middle;
}

.thinking-badge {
  position: absolute;
  bottom: 16px;
  left: 16px;
  font-size: 12px;
  color: #cfe0ee;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 10px;
  border-radius: 12px;
}

.chat-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: rgba(10, 13, 18, 0.92);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.npc-name {
  font-size: 16px;
  font-weight: 600;
  color: #ffb7d5;
}

.close-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #9fb2c4;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}

.close-btn:hover {
  color: #fff;
}

.chat-log {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.msg .role {
  font-size: 11px;
  color: #8a9bad;
}

.msg.system .text {
  color: #8a9bad;
  font-size: 12px;
  font-style: italic;
}

.msg.player .text {
  align-self: flex-end;
  background: rgba(80, 140, 200, 0.25);
  border-radius: 10px;
  padding: 6px 12px;
}

.msg.npc .text {
  align-self: flex-start;
  background: rgba(255, 183, 213, 0.12);
  border-radius: 10px;
  padding: 6px 12px;
}

.msg .text {
  white-space: pre-wrap;
  line-height: 1.6;
}

.caret {
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.chat-input input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #dfe7ee;
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
}

.chat-input input:focus {
  border-color: rgba(255, 183, 213, 0.5);
}

.chat-input button {
  background: #c46a8a;
  border: none;
  color: #fff;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
}

.chat-input button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
