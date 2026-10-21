# 終末サバイバルAI育成RPG (仮)

> **「奪い合うか、絆を紡ぐか。」**  
> ウイルスと放射能に汚染された荒廃世界で、自律思考する少女型AI（MOB）と心を通わせ、共に生き抜くマルチプレイ俯瞰RPG。

---

## 1. ゲーム概要

### プロローグ
文明が崩壊した世界。  
シェルターの外には、致死性のウイルス、極限の放射能、そして変異クリーチャーが徘徊している。  
生き残るために必要なのは、各地に点在する未知のエネルギー結晶**「ボイド」**のみ。

人々はボイドを求めて彷徨い、奪い合い、殺し合う。  
孤独に生きることも可能だが、過酷な汚染環境下での単独生存には限界がある。  
生き延びる唯一の鍵は――外の世界で出会う**自律AIたちと対話し、信頼を獲得して「仲間」になってもらうこと**。

### ゲームループ
1. **探索 & サバイバル（2D俯瞰フィールド）**  
   汚染度やクリーチャーを警戒しながら、荒廃した大地を探索しボイドを収集。
2. **対話 & 育成（3D VRM 会話フェーズ）**  
   フィールド上のMOBと1対1で対話。テキスト入力で語りかけ、信頼関係を構築して仲間にスカウト。
3. **P2Pマルチプレイ & 奪い合い**  
   オンライン上の他プレイヤーとリアルタイムで遭遇。協力してボイドを分け合うか、力で略奪するかはプレイヤー次第。

---

## 2. 主な特徴

- **心を持つコンパニオンAI（完全セルフホスト・ローカルLLM）**  
  固定の選択肢はありません。プレイヤーの自由入力テキストに対し、ローカルLLMが文脈・関係性・感情を汲み取って応答します。「えーと…」「あのね」といった人間的なためらいや相槌、Web検索によるトレンドの話題提供も備えています。
- **1,000個のマイクロパラメータ・システム**  
  生体情報（ウイルス感染度・放射能蓄積）、プレイヤーへの信頼度、戦闘思考、倫理観、好みに至るまで、AIの心と身体を1,000個の浮動小数点パラメータ（`0.000`〜`1.000`）でリアルタイムにシミュレート。プレイヤーの接し方によって唯一無二の相棒へ育ちます。
- **2Dフィールド × 3D VRM のハイブリッド表現**  
  フィールド探索はレトロかつ軽快な2D俯瞰ドット絵（Phaser 3）。会話が始まると、美少女3Dモデル（VRM）が表情豊かに語りかけてくるシームレスなUI遷移を採用。
- **サーバーレスなP2Pマルチプレイ**  
  WebRTC（DataChannel）を活用したプレイヤー間P2P同期により、他プレイヤーとの遭遇やボイドの奪い合いを低遅延で実現。

---

## 3. システムアーキテクチャ

```text
┌────────────────────────────────────────────────────────┐
│                   AI Server (Self-Hosted)              │
│  - Local LLM: Ollama / vLLM / llama.cpp                │
│  - Agent & Memory: LangGraph, Vector DB, Graph RAG     │
│  - Web Search: SearXNG / Tavily API                    │
└───────────────────────────▲────────────────────────────┘
                            │ SSE / WebSocket (JSON-Lines)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Client Browser (Vue 3 + Vite)            │
│                                                        │
│  [Vue 3 + Pinia]               [Phaser 3 Canvas]       │
│  ・3D VRM会話 (@pixiv/three-vrm) ・2D見下ろしマップ(Tiled)│
│  ・1000パラメータ管理          ・リアルタイム移動/戦闘  │
│  ・HUD / インベントリ          ・汚染度 / ボイド収集   │
│                                                        │
│                [WebRTC DataChannel (P2P)]              │
│                 - 他プレイヤーとの位置・収集同期       │
└────────────────────────────────────────────────────────┘
```

---

## 4. 実装チェックリスト

### 世界観・ゲームループ
- [x] 終末フィールド / 汚染ゾーン（蓄積→HP減少）
- [x] ボイド結晶の収集・リスポーン
- [x] MOB（自律AI少女）との対話トリガ
- [x] クリーチャー（徘徊・追跡・接触ダメージ・討伐ドロップ）
- [x] 仲間化システム（信頼度閾値でスカウト→追従・収集・援護）
- [x] 攻撃アクション（SPACE 近接攻撃）・死亡ペナルティ
- [x] PvP 奪い合い（攻撃ヒット→ボイド略奪）

### 技術基盤
- [x] Vue 3 + Vite + Pinia + mitt（Phaser↔Vue 疎結合）
- [x] Phaser 4 フィールド（※仕様書は3記載だが4.xを採用）
- [x] Tiled マップ読み込み（生成スクリプト `tools/gen_map.py`）
- [x] JSDoc + jsconfig checkJs（strict）
- [x] Float32Array(1000) パラメータシステム + 差分適用
- [x] Three.js + @pixiv/three-vrm（表情・瞬き・リップシンク）
- [x] Howler.js 音響（環境風・SE、生成スクリプト `tools/gen_audio.py`）
- [x] PeerJS P2P 同期（位置・ボイド取得・攻撃・略奪）

### AI / バックエンド
- [x] FastAPI + Ollama（完全セルフホスト、JSON-Lines ストリーム）
- [x] フィラー前置き・表情プリセット・パラメータ差分サニタイズ
- [x] NPC別メモリ（履歴・想起リコール・NetworkX 共起グラフ）
- [x] Ollama embedding によるベクトルリコール（失敗時はバイグラム）
- [x] 嗜好パラメータ駆動の話題選択 + SearXNG/Tavily 検索
- [x] 温度パラメータの性格連動調整

### 未実装 / 今後
- [x] VRM 実モデル配置（`client/public/models/yui.vrm` 等）
- [ ] 仲間の戦闘・採取行動の高度化（AI指示、戦術）
- [ ] 真の unreliable DataChannel（PeerJS は信頼型のみ）
- [ ] マルチセッション/ルーム管理
- [ ] サーバ権威の位置/攻撃/採取検証（現在はクライアント信頼）
- [ ] Chroma/Qdrant 等の本格 Vector DB
- [ ] TTS 音声合成・音声リップシンク

---

## 5. 技術スタック

### クライアントサイド (Frontend)

* **Framework**: Vue 3 (Composition API / `<script setup>`) + Vite
* **Language**: JavaScript (ESNext) + **JSDoc による厳格な型推論**
* **2D Game Engine**: Phaser 4 (Arcade Physics, Tiled Map Loader)
* **3D / Avatar**: Three.js, `@pixiv/three-vrm`
* **State Management**: Pinia (`Float32Array` を用いた1000パラメータ軽量保持)
* **Event Bus**: `mitt` (Phaser と Vue の疎結合連携)
* **P2P Networking**: WebRTC (PeerJS)
* **Audio**: Howler.js

### AIバックエンド (Self-Hosted Backend)

* **Framework**: Python 3.12+, FastAPI, Uvicorn
* **LLM Engine**: Ollama (Qwen2.5 / Llama-3 系)
* **Agent / Context**: ターン履歴 + embeddingリコール + Graph RAG (NetworkX)
* **Tool / Search**: SearXNG / Tavily API

---

## 6. プロジェクト構造

```text
.
├── client/                       # Vue 3 + Vite フロントエンド
│   ├── public/
│   │   ├── maps/                 # tiles.png, field.tmj (tools/gen_map.py 生成)
│   │   ├── audio/                # 効果音/環境音 wav (tools/gen_audio.py 生成)
│   │   └── models/               # VRMモデルファイル (.vrm) をここに配置
│   └── src/
│       ├── types.js              # JSDoc @typedef 型定義集約
│       ├── constants/parameters.js  # PARAM_COUNT=1000, P_INDEX 帯域設計
│       ├── core/                 # eventBus(mitt) / イベント名 / 配線
│       ├── stores/               # parameter / player / dialog / peer / companion
│       ├── game/                 # Phaser 4 領域（FieldScene, entities, worldSeed）
│       ├── dialog/               # VrmCanvas, DialogView, lipSync, expressions
│       ├── components/           # HUD, P2pPanel, GameCanvas
│       ├── net/                  # aiClient, mockAiStream, p2pSync
│       └── audio/                # audioManager (Howler)
├── server/                       # FastAPI AI バックエンド
│   └── app/
│       ├── main.py               # /dialog/stream (JSON-Lines NDJSON)
│       ├── llm.py                # Ollama ストリーミング
│       ├── prompt.py             # プロンプト組立（パラメータ/記憶/話題注入）
│       ├── diffengine.py         # 差分サニタイズ + 規則ヒューリスティック
│       ├── memory.py             # 履歴・embeddingリコール・共起グラフ
│       └── search.py             # SearXNG / Tavily
├── tools/                        # gen_map.py / gen_audio.py (アセット生成)
├── docker-compose.yml            # client(node) :8010 + server(fastapi) :8787
└── PROJECT_CONTEXT.md            # 設計仕様書
```

---

## 7. セットアップ手順

### 前提条件

* Docker / Docker Compose
* ホスト上の [Ollama](https://ollama.com/)（`ollama pull qwen2.5:7b-instruct`）

### 起動

```bash
# 両サービス起動（初回は server イメージのビルドを含む）
docker compose up -d --build

# クライアント dev サーバ (http://localhost:8010)
docker exec -d bobo_rpg_client npm install
docker exec -d bobo_rpg_client npm run dev

# AIサーバは :8787 で自動起動済み（/health, /dialog/stream）
# client の VITE_AI_BASE_URL 未設定時は vite プロキシ /ai 経由で接続される
```

### アセット再生成

```bash
python3 tools/gen_map.py    # client/public/maps/ へ tiles.png + field.tmj
python3 tools/gen_audio.py  # client/public/audio/ へ wav 一式
```

---

## 8. 開発ロードマップ

* [x] **Phase 1**: プロジェクト設計、ディレクトリ構造、JSDoc型定義、1000パラメータ構造の策定
* [x] **Phase 2**: 2D見下ろしフィールド（Tiledマップ、汚染ゾーン、ボイド、クリーチャー、攻撃・死亡）
* [x] **Phase 3**: 3D VRM 会話コンポーネント（表情同期、テキストストリーミング、リップシンク）
* [x] **Phase 4**: FastAPI + Ollama による自律対話・パラメータ差分返却エンジン
* [x] **Phase 5**: PeerJS による P2P 同期（位置・ボイド取得・攻撃・略奪）
* [x] **Phase 6**: メモリ・embeddingリコール・Graph RAG素地・話題検索の統合
* [x] **Phase 7**: Master Spec 準拠の全面再編
  - router: Python→Hono.js 書換、WS座標集約、チャンクリース(TTL5s)、DeltaMap、関係性管理、AI push中継
  - client: FloatingOrigin(2048pxセクタ)で int32 全域を安全描画、BigInt空間ハッシュ、IndexedDB永続UUID、NetworkWorker分離
  - vrm: プロシージャルモーション分離（呼吸位相差・素数比揺らぎ・サッカード視線・非対称まばたき・思考演出）
  - server: Fast Path(構造化出力拘束)+Deep Path(非同期解析→push)二重経路、時間差文脈注入、api/memory/tools構成
  - world: 拠点整地スタンプ、決定論的NPC ID(npc_{cx}_{cy}_{i})
