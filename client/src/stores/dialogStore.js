/**
 * @fileoverview 対話フェーズの状態と AI ストリーミングを統括するストア。
 * - dialog:open / dialog:close は eventBindings から呼ばれる
 * - send() が AI サーバ（未接続時はモック）との JSON-Lines ストリームを駆動する
 */

import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { getPlayerUuid } from '@/core/Identity.js';
import { motionForExpression } from '@/vrm/motions.js';
import { streamDialogChunks } from '@/net/aiClient.js';
import { getRelation, touchRelation } from '@/net/routerClient.js';
import { useCompanionStore } from '@/stores/companionStore.js';
import { useParameterStore } from '@/stores/parameterStore.js';
import { usePlayerStore } from '@/stores/playerStore.js';

export const useDialogStore = defineStore('dialog', () => {
  /** 対話 UI が開いているか。 */
  const isOpen = ref(false);

  /** 対話相手の NPC 識別子。 */
  const npcId = shallowRef('');

  /** 対話相手の表示名（内部値）。 */
  const npcName = shallowRef('');

  /** 相手が名乗ったか。false の間は「？？？」と表示する。 */
  const npcKnown = ref(false);

  /** UI 表示名。名乗るまで匿名。 */
  const displayName = computed(() => (npcKnown.value ? npcName.value : '？？？'));

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
   * 身振り用：直近のモーション名。motionSeq が変わるたびに
   * DialogView が VrmCanvas.triggerMotion へ流す。
   * @type {import('vue').Ref<import('@/types.js').MotionPreset | string>}
   */
  const motionName = ref('');
  const motionSeq = ref(0);

  /** このNPCとの最終対話時刻（router の RelationshipManager より）。 */
  const lastInteractionTime = ref(0);

  /**
   * 対話を開く（Phaser の dialog:open から呼ばれる）。
   * @param {import('@/types.js').DialogOpenPayload} payload
   * @returns {void}
   */
  function open(payload) {
    npcId.value = payload.npcId;
    npcName.value = payload.name;
    vrmModelUrl.value = payload.vrmModelUrl;
    npcKnown.value = useCompanionStore().isKnown(payload.npcId);
    messages.value = [
      {
        role: 'system',
        text: npcKnown.value
          ? `${payload.name} と遭遇した。`
          : '名も知らぬ少女と遭遇した。',
      },
    ];
    expression.value = 'neutral';
    isOpen.value = true;
    // 探索フェーズを停止
    eventBus.emit(GAME_EVENTS.GAME_PAUSE, true);
    // 最終対話時刻を router から取得して time-delta 文脈に使う
    void getPlayerUuid()
      .then((uuid) => getRelation(payload.npcId, uuid))
      .then((rel) => {
        lastInteractionTime.value = rel.lastInteractionTime ?? 0;
      })
      .catch(() => {
        lastInteractionTime.value = 0;
      });
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
    const companion = useCompanionStore();

    messages.value.push({ role: 'player', text: trimmed });
    /** @type {import('@/types.js').ChatMessage} */
    const reply = { role: 'npc', text: '', streaming: true };
    messages.value.push(reply);

    isStreaming.value = true;
    isThinking.value = true;

    const uuid = await getPlayerUuid();

    /** @type {import('@/types.js').DialogRequest} */
    const request = {
      message: trimmed,
      parameters: parameters.toArray(),
      environment: player.environment,
      npcId: npcId.value,
      npcName: npcName.value,
      playerUuid: uuid,
      lastInteractionTime: lastInteractionTime.value,
    };

    try {
      for await (const chunk of streamDialogChunks(request)) {
        isThinking.value = false;
        if (chunk.e) expression.value = chunk.e;
        // 身振り: 明示的な m があれば優先、なければ表情から既定を導出
        const motion = chunk.m ?? (chunk.e ? motionForExpression(chunk.e) : null);
        if (motion) {
          motionName.value = motion;
          motionSeq.value++;
        }
        if (chunk.u?.length) {
          parameters.applyDiffs(chunk.u);
          // このNPCへの信頼度(index 100)差分を個別に蓄積する
          const dTrust = chunk.u
            .filter((d) => d.index === 100)
            .reduce((a, d) => a + d.delta, 0);
          if (dTrust !== 0) companion.addTrust(npcId.value, dTrust);
        }
        // ツール呼出し（サーバで検証済みのみ届く）
        if (chunk.x === 'reveal_name') {
          companion.markKnown({ npcId: npcId.value, name: npcName.value });
          npcKnown.value = true;
        }
        if (chunk.x === 'join_companion') {
          companion.join({ npcId: npcId.value, name: npcName.value });
          npcKnown.value = true;
          messages.value.push({
            role: 'system',
            text: `${npcName.value} が仲間になった！`,
          });
        }
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
      // 関係性を記録（最終対話時刻 + 直近発話履歴）
      const npcText = reply.text;
      void touchRelation(npcId.value, uuid, trimmed, npcText)
        .then((r) => {
          lastInteractionTime.value = r.now ?? Date.now();
        })
        .catch(() => {});
    }
  }

  return {
    isOpen,
    npcId,
    npcName,
    npcKnown,
    displayName,
    vrmModelUrl,
    messages,
    isStreaming,
    isThinking,
    expression,
    speechText,
    speechSeq,
    motionName,
    motionSeq,
    open,
    close,
    send,
  };
});
