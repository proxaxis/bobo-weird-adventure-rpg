/**
 * @fileoverview Phaser と Vue を疎結合に繋ぐ mitt イベントバス。
 * イベント名は core/events.js の GAME_EVENTS、ペイロード型は types.js を参照。
 */

import mitt from 'mitt';

/**
 * アプリ共有のイベントバス。
 * @type {import('mitt').Emitter<import('@/types.js').GameEventMap>}
 */
export const eventBus = mitt();
