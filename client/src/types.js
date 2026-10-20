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
 * 身振りプリセット。motions.js の MOTION_PRESETS と同期。
 * @typedef {'nod'|'shake'|'tilt'|'bow'|'startle'|'slump'|'bounce'} MotionPreset
 */

/**
 * AIサーバから届くストリーミングチャンク（JSON-Lines 1行分）。
 * @typedef {Object} StreamChunk
 * @property {string} t - 生成テキスト断片（フィラー含む）
 * @property {ExpressionPreset} [e] - 表情プリセット
 * @property {MotionPreset} [m] - 身振りプリセット
 * @property {ParameterDiff[]} [u] - パラメータ差分配列
 * @property {string} [x] - ツール呼出し（例: 'join_companion'。サーバ受理済みのみ届く）
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
 * @property {string} [npcId] - 対話相手の識別子（サーバ側メモリのキー）
 * @property {string} [npcName] - 対話相手の表示名
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
 * @property {number} [nearestThreatDistance] - 最寄り脅威（クリーチャー）までの距離px
 */

/**
 * 会話ログ1行。
 * @typedef {Object} ChatMessage
 * @property {'player'|'npc'|'system'} role - 発話者
 * @property {string} text - 表示テキスト
 * @property {boolean} [streaming] - ストリーミング中なら true
 */

/**
 * 自プレイヤーのフィールド位置（player:position）。
 * @typedef {Object} PlayerPosition
 * @property {number} x
 * @property {number} y
 */

/**
 * ピアの位置更新（peer:position）。
 * @typedef {Object} PeerPosition
 * @property {string} peerId
 * @property {number} x
 * @property {number} y
 */

/**
 * ピア接続状態の変化（peer:status）。
 * @typedef {Object} PeerStatus
 * @property {string} peerId
 * @property {'connected'|'left'|'error'} state
 */

/**
 * 仲間化イベントのペイロード（companion:join）。
 * @typedef {Object} CompanionJoinPayload
 * @property {string} npcId
 * @property {string} name
 */

/**
 * ピアがボイドを採取した通知（peer:void-take）。
 * @typedef {Object} PeerVoidTake
 * @property {string} peerId
 * @property {number} index - 採取されたノードのレイアウトインデックス
 */

/**
 * ピアの攻撃範囲通知（peer:attack）。
 * @typedef {Object} PeerAttack
 * @property {string} peerId
 * @property {number} x
 * @property {number} y
 * @property {number} r - 攻撃半径px
 */

/**
 * 略奪成功の返報（peer:stolen）。被攻撃者が奪われた量を攻撃者へ返す。
 * @typedef {Object} PeerStolen
 * @property {string} peerId - 略奪を受けた側（=返送先の攻撃者）
 * @property {number} amount
 */

/**
 * 死亡ペナルティ通知（player:death）。
 * @typedef {Object} PlayerDeath
 * @property {number} lostVoid - 失ったボイド数
 */

/**
 * mitt のイベント型マップ（Phaser ↔ Vue 疎結合プロトコル）。
 * ※コロンを含むキーは @property 記法で表せないためインライン型で定義する。
 * @typedef {{
 *   'dialog:open': DialogOpenPayload,
 *   'dialog:close': void,
 *   'game:pause': boolean,
 *   'player:vital_update': VitalUpdate,
 *   'player:position': PlayerPosition,
 *   'peer:position': PeerPosition,
 *   'peer:status': PeerStatus,
 *   'companion:join': CompanionJoinPayload,
 *   'companion:leave': void,
 *   'peer:void-take': PeerVoidTake,
 *   'peer:attack': PeerAttack,
 *   'peer:stolen': PeerStolen,
 *   'player:death': PlayerDeath,
 *   'player:spend-void': {amount: number},
 *   'npc:name-revealed': CompanionJoinPayload,
 * }} GameEventMap
 */

export {};
