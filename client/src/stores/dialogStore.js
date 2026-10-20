/**
 * @fileoverview 対話フェーズの状態と AI ストリーミングを統括するストア。
 * - dialog:open / dialog:close は eventBindings から呼ばれる
 * - send() が AI サーバ（未接続時はモック）との JSON-Lines ストリームを駆動する
 */

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { streamDialogChunks } from '@/net/aiClient.js';
import { useParameterStore } from '@/stores/parameterStore.js';
import { usePlayerStore } from '@/stores/playerStore.js';

export const useDialogStore = defineStore('dialog', () => {
  /** 対話 UI が開いているか。 */
  const isOpen = ref(false);

  /** 対話相手の NPC 識別子。 */
  const npcId = shallowRef('');

  /** 対話相手の表示名。 */
  const npcName = shallowRef('');

  /** 相手の VRM モデル URL。 */
  const vrmModelUrl = shallowRef('');

  /**
   * 会話ログ。
   * @type {import('vue').Ref<import('@/types.js').ChatMessage[]>}
   */
  const messages = ref([]);

  /** 応答をストリーミング中か。 */
  const isStreaming = ref(false);

  /** 最初のチャンク到着前（=思考演出中）か。 */
  const isThinking = ref(false);

  /**
   * 現在の表情プリセット。
   * @type {import('vue').ShallowRef<import('@/types.js').ExpressionPreset>}
   */
  const expression = shallowRef('neutral');

  /**
   * リップシンク用：直近チャンクのテキスト。
   * speechSeq が変わるたびに DialogView が VrmCanvas.feedSpeech へ流す。
   */
  const speechText = ref('');
  const speechSeq = ref(0);

  /**
   * 対話を開く（Phaser の dialog:open から呼ばれる）。
   * @param {import('@/types.js').DialogOpenPayload} payload
   * @returns {void}
   */
  function open(payload) {
    npcId.value = payload.npcId;
    npcName.value = payload.name;
    vrmModelUrl.value = payload.vrmModelUrl;
    messages.value = [
      { role: 'system', text: `${payload.name} と遭遇した。` },
    ];
    expression.value = 'neutral';
    isOpen.value = true;
    // 探索フェーズを停止
    eventBus.emit(GAME_EVENTS.GAME_PAUSE, true);
  }

  /**
   * 対話を閉じて探索フェーズを再開する。
   * @returns {void}
   */
  function close() {
    isOpen.value = false;
    isStreaming.value = false;
    isThinking.value = false;
    eventBus.emit(GAME_EVENTS.GAME_PAUSE, false);
  }

  /**
   * プレイヤー発言を送信し、ストリーミング応答を messages に流し込む。
   * @param {string} text
   * @returns {Promise<void>}
   */
  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming.value) return;

    const parameters = useParameterStore();
    const player = usePlayerStore();

    messages.value.push({ role: 'player', text: trimmed });
    /** @type {import('@/types.js').ChatMessage} */
    const reply = { role: 'npc', text: '', streaming: true };
    messages.value.push(reply);

    isStreaming.value = true;
    isThinking.value = true;

    /** @type {import('@/types.js').DialogRequest} */
    const request = {
      message: trimmed,
      parameters: parameters.toArray(),
      environment: player.environment,
      npcId: npcId.value,
      npcName: npcName.value,
    };

    try {
      for await (const chunk of streamDialogChunks(request)) {
        isThinking.value = false;
        if (chunk.e) expression.value = chunk.e;
        if (chunk.u?.length) parameters.applyDiffs(chunk.u);
        if (chunk.t) {
          reply.text += chunk.t;
          speechText.value = chunk.t;
          speechSeq.value++;
        }
      }
    } catch (err) {
      reply.text += '\n（応答に失敗しました）';
      console.error('[dialog] stream failed', err);
    } finally {
      reply.streaming = false;
      isStreaming.value = false;
      isThinking.value = false;
    }
  }

  return {
    isOpen,
    npcId,
    npcName,
    vrmModelUrl,
    messages,
    isStreaming,
    isThinking,
    expression,
    speechText,
    speechSeq,
    open,
    close,
    send,
  };
});
