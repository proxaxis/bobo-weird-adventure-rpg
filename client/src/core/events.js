/**
 * @fileoverview Phaser ↔ Vue 間のイベント名定数。
 * ペイロード型は types.js の GameEventMap を参照。
 * 値はリテラル型に固定し、mitt のイベントキーとして型が効くようにする。
 */

export const GAME_EVENTS = Object.freeze({
  DIALOG_OPEN: /** @type {'dialog:open'} */ ('dialog:open'),
  DIALOG_CLOSE: /** @type {'dialog:close'} */ ('dialog:close'),
  GAME_PAUSE: /** @type {'game:pause'} */ ('game:pause'),
  VITAL_UPDATE: /** @type {'player:vital_update'} */ ('player:vital_update'),
  PLAYER_POSITION: /** @type {'player:position'} */ ('player:position'),
  PEER_POSITION: /** @type {'peer:position'} */ ('peer:position'),
  PEER_STATUS: /** @type {'peer:status'} */ ('peer:status'),
});
