/**
 * @fileoverview イベントバス → Pinia ストアの配線。
 * main.js で Pinia 初期化後に一度だけ呼ぶ。
 */

import { eventBus } from '@/core/eventBus.js';
import { GAME_EVENTS } from '@/core/events.js';
import { useDialogStore } from '@/stores/dialogStore.js';
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
}
