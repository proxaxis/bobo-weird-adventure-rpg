/**
 * @fileoverview 共通型定義（JSDoc typedef 集約ファイル）。
 * 実行時エクスポートは持たず、各所で `import('@/types.js').Xxx` の型参照に使う。
 */

/**
 * 1000パラメータの差分単位。value 適用後は 0.000〜1.000 にクランプされる。
 * @typedef {Object} ParameterDiff
 * @property {number} index - パラメータインデックス（0 〜 PARAM_COUNT-1）
 * @property {number} delta - 変動量（正負）
 */

/**
 * 表情プリセット。仕様書で定義された6種に限定される。
 * @typedef {'neutral'|'happy'|'angry'|'sad'|'relaxed'|'surprised'} ExpressionPreset
 */

/**
 * AIサーバから届くストリーミングチャンク（JSON-Lines 1行分）。
 * @typedef {Object} StreamChunk
 * @property {string} t - 生成テキスト断片（フィラー含む）
 * @property {ExpressionPreset} [e] - 表情プリセット
 * @property {ParameterDiff[]} [u] - パラメータ差分配列
 */

/**
 * 対話リクエストに同梱する周辺環境スナップショット。
 * @typedef {Object} EnvironmentState
 * @property {number} pollutionLevel - 現在汚染度（0〜1）
 * @property {number} nearestThreatDistance - 最寄り脅威までの距離（不明時は負値）
 * @property {number} voidCount - 所持ボイド数
 */

/**
 * AIサーバへの対話リクエストペイロード。
 * @typedef {Object} DialogRequest
 * @property {string} message - プレイヤー入力テキスト
 * @property {number[]} parameters - 1000要素のパラメータスナップショット
 * @property {EnvironmentState} environment - 環境スナップショット
 */

/**
 * dialog:open イベントのペイロード。
 * @typedef {Object} DialogOpenPayload
 * @property {string} npcId - MOB識別子
 * @property {string} name - 表示名
 * @property {string} vrmModelUrl - 対話フェーズで読み込む VRM のURL
 */

/**
 * player:vital_update イベントのペイロード。
 * @typedef {Object} VitalUpdate
 * @property {number} pollution - 汚染度（0〜1）
 * @property {number} hp - 体力（0〜1）
 * @property {number} voidCount - 所持ボイド数
 */

/**
 * 会話ログ1行。
 * @typedef {Object} ChatMessage
 * @property {'player'|'npc'|'system'} role - 発話者
 * @property {string} text - 表示テキスト
 * @property {boolean} [streaming] - ストリーミング中なら true
 */

/**
 * mitt のイベント型マップ（Phaser ↔ Vue 疎結合プロトコル）。
 * ※コロンを含むキーは @property 記法で表せないためインライン型で定義する。
 * @typedef {{
 *   'dialog:open': DialogOpenPayload,
 *   'dialog:close': void,
 *   'game:pause': boolean,
 *   'player:vital_update': VitalUpdate,
 * }} GameEventMap
 */

export {};
