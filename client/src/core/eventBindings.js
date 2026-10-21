/**
 * @fileoverview イベントバス → Pinia ストアの配線。
 * main.js で Pinia 初期化後に一度だけ呼ぶ。
 */

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { useCompanionStore } from '@/stores/companionStore.js';
import { useDialogStore } from '@/stores/dialogStore.js';
import { useParameterStore } from '@/stores/parameterStore.js';
import { usePlayerStore } from '@/stores/playerStore.js';

/**
 * イベントバスの購読を張る。
 * @returns {void}
 */
export function bindEventBus() {
  const player = usePlayerStore();
  const dialog = useDialogStore();

  eventBus.on(GAME_EVENTS.VITAL_UPDATE, (vital) => {
    player.applyVitalUpdate(vital);
  });

  eventBus.on(GAME_EVENTS.DIALOG_OPEN, (payload) => {
    dialog.open(payload);
  });

  eventBus.on(GAME_EVENTS.DIALOG_CLOSE, () => {
    dialog.close();
  });

  // AI サーバ Deep Path: 非同期に計算されたパラメータ差分を適用する
  eventBus.on(GAME_EVENTS.ROUTER_PUSH, ({ payload }) => {
    if (!payload || payload.type !== 'param-diff') return;
    const diffs = payload.diffs ?? [];
    if (diffs.length === 0) return;
    const parameters = useParameterStore();
    const npcId = payload.npcId ?? '';
    // 現在対象としているNPCのパラメータにのみ直接適用し、
    // 信頼度差分は NPC 個別に蓄積する
    if (npcId && npcId === parameters.npcId) {
      parameters.applyDiffs(diffs);
    }
    const dTrust = diffs
      .filter((d) => d.index === 100)
      .reduce((a, d) => a + d.delta, 0);
    if (npcId && dTrust !== 0) {
      useCompanionStore().addTrust(npcId, dTrust);
    }
  });
}
