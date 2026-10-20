"""環境変数まわりの設定を集約する。"""

import os

# Ollama（docker-compose からは host.docker.internal 経由でホストの11434を指す）
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")
# embedding モデル。未設定なら対話モデルを流用（失敗時はバイグラムにフォールバック）
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "90"))
# 生成温度のベース（性格パラメータで ±0.15 調整される）
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.8"))

# Web 検索（どちらも未設定なら話題提案は無効）
SEARXNG_URL = os.getenv("SEARXNG_URL", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# メモリ永続化先
DATA_DIR = os.getenv("DATA_DIR", "data")

# 会話履歴の保持ターン数
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "40"))
