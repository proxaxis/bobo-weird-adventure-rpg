/**
 * @fileoverview フィールド上の自律MOB定義。
 * vrmModelUrl は client/public/models/ 配下を指す。
 * ファイル未配置でも対話UIはフォールバックアバターで動作する。
 */

/**
 * MOB定義。
 * @typedef {Object} NpcDef
 * @property {string} id - 識別子
 * @property {string} name - 表示名
 * @property {string} vrmModelUrl - 対話フェーズ用VRMのURL
 * @property {string} texture - フィールド用ドット絵のテクスチャキー
 * @property {number} x - ワールドX座標
 * @property {number} y - ワールドY座標
 */

/** @type {NpcDef[]} */
export const NPC_DEFS = [
  {
    id: 'mob-yui',
    name: 'ユイ',
    vrmModelUrl: '/models/yui.vrm',
    texture: 'spr-npc-yui',
    x: 620,
    y: 380,
  },
  {
    id: 'mob-nagi',
    name: 'ナギ',
    vrmModelUrl: '/models/nagi.vrm',
    texture: 'spr-npc-nagi',
    x: 1040,
    y: 780,
  },
];
