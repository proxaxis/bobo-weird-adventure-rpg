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

## 4. 技術スタック

### クライアントサイド (Frontend)

* **Framework**: Vue 3 (Composition API / `<script setup>`) + Vite
* **Language**: JavaScript (ESNext) + **JSDoc による厳格な型推論**
* **2D Game Engine**: Phaser 3 (Arcade Physics, Tiled Map Loader)
* **3D / Avatar**: Three.js, `@pixiv/three-vrm`
* **State Management**: Pinia (`Float32Array` を用いた1000パラメータ軽量保持)
* **Event Bus**: `mitt` (Phaser と Vue の疎結合連携)
* **P2P Networking**: WebRTC (PeerJS)
* **Audio**: Howler.js

### AIバックエンド (Self-Hosted Backend)

* **Framework**: Python 3.11+, FastAPI, Uvicorn
* **LLM Engine**: Ollama (Qwen2.5 / Llama-3.1 系推奨)
* **Agent / Context**: LangGraph, Graph RAG (Neo4j / NetworkX), Vector DB (Chroma)
* **Tool / Search**: SearXNG / Tavily API

---

## 5. プロジェクト構造

```text
.
├── public/
│   ├── assets/              # 2Dスプライト, Tiledマップ, BGM/SE
│   └── models/              # VRMモデルファイル (.vrm)
├── src/
│   ├── types.js             # JSDoc @typedef 型定義集約ファイル
│   ├── main.js              # エントリポイント
│   ├── App.vue              # CanvasレイヤーとUIレイヤーの結合
│   ├── game/                # Phaser 3 領域（探索・移動・当たり判定）
│   ├── components/          # Vue 3 領域（VRM会話画面、HUD、メニュー）
│   ├── stores/              # Pinia（1000パラメータ、状態管理）
│   ├── network/             # WebRTC P2P 通信モジュール
│   └── ai/                  # AIサーバとの通信・ストリーミング処理
├── server/                  # セルフホスト AI バックエンド (FastAPI)
├── jsconfig.json            # VS Code 型チェック設定
└── vite.config.js

```

---

## 6. セットアップ手順

### 前提条件

* Node.js 18+
* Python 3.11+
* [Ollama](https://ollama.com/)（または同等のローカルLLM実行環境）

### クライアント起動

```bash
# リポジトリのクローン
git clone <repository-url>
cd <repository-folder>

# 依存パッケージのインストール
npm install

# 開発サーバーの起動 (Vite)
npm run dev

```

### AIサーバー起動

```bash
cd server

# 仮想環境の作成と有効化
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 依存ライブラリのインストール
pip install -r requirements.txt

# ローカルLLMモデルの準備 (別ターミナルで実行)
ollama run qwen2.5:7b

# APIサーバー起動
uvicorn main:app --reload --port 8000

```

---

## 7. 開発ロードマップ

* [x] **Phase 1**: プロジェクト設計、ディレクトリ構造、JSDoc型定義、1000パラメータ構造の策定
* [ ] **Phase 2**: 2D見下ろしフィールドの実装（マップ表示、汚染ゾーン、ボイドノード）
* [ ] **Phase 3**: 3D VRM 会話コンポーネントの実装（表情同期、テキストストリーミング）
* [ ] **Phase 4**: FastAPI + Ollama による自律対話・パラメータ差分返却エンジンの接続
* [ ] **Phase 5**: WebRTC によるプレイヤー間P2P同期（位置同期、ボイドの奪い合い）
* [ ] **Phase 6**: Graph RAG・外部Web検索ツールの統合による長期記憶と話題生成
