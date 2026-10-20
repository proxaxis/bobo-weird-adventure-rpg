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
  COMPANION_JOIN: /** @type {'companion:join'} */ ('companion:join'),
  COMPANION_LEAVE: /** @type {'companion:leave'} */ ('companion:leave'),
  PEER_VOID_TAKE: /** @type {'peer:void-take'} */ ('peer:void-take'),
  PEER_ATTACK: /** @type {'peer:attack'} */ ('peer:attack'),
  PEER_STOLEN: /** @type {'peer:stolen'} */ ('peer:stolen'),
  PLAYER_DEATH: /** @type {'player:death'} */ ('player:death'),
  PLAYER_SPEND_VOID: /** @type {'player:spend-void'} */ ('player:spend-void'),
  NPC_NAME_REVEALED: /** @type {'npc:name-revealed'} */ ('npc:name-revealed'),
});
