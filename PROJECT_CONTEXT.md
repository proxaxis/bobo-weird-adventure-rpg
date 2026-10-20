# Role & Project Overview
あなたは、終末ポストアポカリプス世界を舞台にした自律AI育成型マルチプレイ俯瞰RPGの開発を担うシニアフルスタックエンジニアです。
クライアント（Vue 3 + Phaser 3 + Three.js/VRM + WebRTC）とセルフホストAIバックエンド（FastAPI + ローカルLLM + Agent/RAG）を組み合わせた高度なシステムを、疎結合かつ保守性の高いコードで段階的に実装します。

---

## 1. Core Tech Stack & Constraints
- **Language**: JavaScript (ESNext, Strict ESM) + **JSDoc による厳格な型注釈**（※TypeScriptは使用せず、jsconfig.json の checkJs を前提とする）
- **Client Architecture**:
  - **Framework / UI**: Vue 3 (Composition API / `<script setup>`), Vite, Pinia (状態管理)
  - **2D Field Game Engine**: Phaser 3 (Canvas, Tiled Map Loader, Arcade Physics)
  - **3D Conversation**: Three.js, `@pixiv/three-vrm` (VRM 1.0/0.0 アバター表示、表情、リップシンク)
  - **Audio**: Howler.js (BGM, SE, 環境音)
  - **Networking**: WebRTC DataChannel (P2P通信, PeerJS)
  - **Event Bus**: `mitt` (Phaser と Vue 間の疎結合通信)
- **AI Server Architecture**:
  - Python (FastAPI, Uvicorn, LangGraph / LangChain)
  - Engine: Ollama / vLLM / llama.cpp (セルフホストローカルLLM, Qwen2.5/Llama-3系)
  - Knowledge / Memory: Graph RAG (Neo4j / NetworkX), Vector DB (Chroma / Qdrant)
  - Tool Calling: 外部Web検索 (SearXNG / Tavily API)

---

## 2. World & Game Mechanics Design
- **世界観**: 汚染（ウイルス、放射能）、危険なクリーチャーが蔓延する終末世界。生存に必要な物質「ボイド」を巡りプレイヤー間で奪い合い・略奪が発生する。
- **コア体験**: 単独生存は困難なため、フィールド上の自律MOB（美少女型VRMモデル）と対話し、信頼関係を築いて相棒（コンパニオン）として育成・共闘する。
- **ゲームフェーズの切り替え**:
  - **探索・戦闘フェーズ (Phaser 3)**: 俯瞰2D。リアルタイム移動、ボイド収集、PvP/PvE判定、汚染度蓄積。
  - **対話・育成フェーズ (Vue 3 + Three.js)**: 3D美少女VRMモデルとの1対1対話。テキスト入力式、ストリーミング返答、自然な相槌・フィラー生成、表情・リップシンク同期。
- **1000パラメータシステム**:
  - AIの内面（生体情報、信頼度、戦闘思考、性格、趣味）を1000個の正規化浮動小数点数（0.000〜1.000）で管理。
  - フロント側は `Float32Array(1000)` で軽量保持し、バックエンドから差分（`{ index, delta }`）を受信してPiniaストアを更新する。

---

## 3. Communication Protocol & Data Schemas
### A. Phaser ↔ Vue (mitt Event Bus)
- `'dialog:open'`: `{ npcId: string, name: string, vrmModelUrl: string }`
- `'dialog:close'`: `void`
- `'game:pause'`: `boolean`
- `'player:vital_update'`: `{ pollution: number, hp: number, voidCount: number }`

### B. Client ↔ AI Server (SSE / WebSocket)
- **Request Payload**:
  ```json
  {
    "message": "一緒にボイドを集めに行こう",
    "parameters": [0.12, 0.45, ...],
    "environment": {
      "pollutionLevel": 0.35,
      "nearestThreatDistance": 4,
      "voidCount": 12
    }
  }
  ```
- **Streaming Response Format (JSON-Lines / SSE Chunk)**:
  ```json
  {"t": "……えっと、", "e": "relaxed", "u": []}
  {"t": "うん、わかった。でも無理はしないでね。", "e": "happy", "u": [{"index": 150, "delta": 0.02}]}
  ```
  - `t`: 生成テキスト断片（フィラー含む）
  - `e`: 表情プリセット (`neutral`, `happy`, `angry`, `sad`, `relaxed`, `surprised`)
  - `u`: 変動したパラメータ差分配列

---

## 4. Implementation Guidelines & Rules

1. **JavaScript + JSDoc の徹底**:
   - すべての関数、クラス、引数、戻り値に JSDoc（`@param`, `@returns`, `@typedef`, `@type`）を記述すること。
   - `any` や型注釈の省略を避け、`types.js` に共通定義をまとめること。

2. **描画レイヤーの明確な分離**:
   - Phaser の Canvas と Vue の DOM は分離し、Vue側コンテナには `pointer-events: none` を適用。操作が必要なUIモーダルのみ `pointer-events: auto` にすること。

3. **1000パラメータの効率的ハンドリング**:
   - オブジェクトで1000キーを持たず、インデックス参照（`P_INDEX` 定数）を用いて `Float32Array` を直接更新すること。

4. **P2P同期（WebRTC）の軽量化**:
   - プレイヤー位置同期とボイド収集イベントは非信頼型データチャネル（Unreliable UDP）を使用し、不要な通信オーバーヘッドを避けること。

5. **人間的レスポンスの演出**:
   - LLM出力に「えーと」「あのね」などのフィラーを自然に挟み、思考中アニメーション（視線逸らし・首かしげ）を挟んでから発話をストリーミングすること。

---

## 5. Development Roadmap (Phases)

エージェントはこの順序に従ってコード生成・リファクタリングを提案すること：

- **Phase 1: プロジェクト基盤と型定義** (`vite.config.js`, `jsconfig.json`, `types.js`, Piniaストア, mitt)
- **Phase 2: 2D俯瞰ゲームコア (Phaser 3)** (Tiledマップ読み込み、グリッド/自由移動、ボイドノード、汚染エリア)
- **Phase 3: 3D対話UI (Vue 3 + Three.js + VRM)** (VRM読み込み、表情制御、リップシンク、テキストストリーミング入力)
- **Phase 4: AIバックエンド連携** (FastAPI、Ollama連携、プロンプト設計、1000パラメータ差分返却エンジン)
- **Phase 5: WebRTC P2P同期** (PeerJSを用いた位置・ボイド奪い合いのマルチプレイ同期)
- **Phase 6: Agent・Graph RAG・Web検索統合** (長期記憶、会話履歴、話題提案)

指示されたフェーズのコードを生成する際は、省略記法を使わず、保守可能で動作する完全なコードを出力してください。

---

## 実装メモ（2026-10-20 時点の決定事項）

- **Phaser は v4.x を採用**（仕様書は v3 記載だが v4 がリリース済みのため最新を使用。Canvas レンダラは非推奨のため WebGL 前提）
- **ディレクトリ構成**: モノレポ `client/`（Vue+Vite）と `server/`（FastAPI、Phase 4 で実装）
- **1000パラメータのインデックス帯域**は `client/src/constants/parameters.js` に独自設計済み
- **開発環境**: ホストに Node なし → `docker compose up -d` で node:24.12.0 コンテナ起動、`docker exec -it bobo_rpg_client npm run dev`（ポート 8010）
- **VRMモデル**: `client/public/models/*.vrm` に配置（未配置時はフォールバックアバター表示）
- **AIサーバ未接続時**: `VITE_AI_BASE_URL` 未設定ならモックストリームで動作
