"""NPC ごとの対話メモリ（Phase 6 の入口）。

- 直近ターン履歴（リングバッファ、JSON 永続化）
- 文字バイグラム類似度による簡易リコール（Vector DB 導入前の暫定実装）
- NetworkX による共起グラフ（Graph RAG の素地）

永続化は data/ 以下の JSON。外部DB不要でセルフホスト完結。
"""

import json
import math
import re
import time
from collections import deque
from pathlib import Path

import httpx

from ..config import (
    HISTORY_LIMIT,
    OLLAMA_BASE_URL,
    OLLAMA_EMBED_MODEL,
    OLLAMA_MODEL,
)
from .graph_rag import GraphRAG


def _bigrams(text: str) -> set[str]:
    """日本語向けの簡易特徴: 正規化した文字バイグラム。"""
    t = re.sub(r"\s+", "", text)
    if len(t) < 2:
        return {t} if t else set()
    return {t[i : i + 2] for i in range(len(t) - 1)}


def _similarity(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / math.sqrt(len(a) * len(b))


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


async def _embed(text: str) -> list[float] | None:
    """Ollama の embedding API でベクトル化。失敗時は None。"""
    model = OLLAMA_EMBED_MODEL or OLLAMA_MODEL
    url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/embed"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, json={"model": model, "input": text})
            r.raise_for_status()
            embs = r.json().get("embeddings")
            if embs:
                return embs[0]
    except Exception:
        # 旧API(/api/embeddings)にフォールバック
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    f"{OLLAMA_BASE_URL.rstrip('/')}/api/embeddings",
                    json={"model": model, "prompt": text},
                )
                r.raise_for_status()
                return r.json().get("embedding")
        except Exception:
            return None
    return None


class MemoryStore:
    """NPC 単位の履歴・リコール・共起グラフを管理する。"""

    def __init__(self, data_dir: str) -> None:
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._hist: dict[str, deque] = {}
        self._graph = GraphRAG(data_dir)
        self._params: dict[str, list[float]] = {}

    # ---------- public ----------

    def recent(self, npc_id: str, n: int = 6) -> list[dict]:
        """直近 n ターンを新しい順で返す。"""
        hist = self._load_hist(npc_id)
        return list(hist)[-n:]

    async def recall(self, npc_id: str, query: str, k: int = 3) -> list[dict]:
        """クエリと類似した過去ターンを k 件返す。

        Ollama embedding が使えればコサイン類似度、
        使えなければ文字バイグラム類似度にフォールバックする。
        """
        qv = await _embed(query)
        qbg = _bigrams(query)
        scored = []
        for turn in self._load_hist(npc_id):
            text = f"{turn.get('player', '')} {turn.get('npc', '')}"
            score = 0.0
            if qv and isinstance(turn.get("v"), list):
                score = _cosine(qv, turn["v"])
            if score <= 0.05:
                # embedding未整備/類似なしのターンはバイグラムで拾う
                score = max(score, _similarity(qbg, _bigrams(text)) * 0.8)
            if score > 0.05:
                scored.append((score, turn))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [t for _, t in scored[:k]]

    def related_concepts(self, npc_id: str, query: str, k: int = 5) -> list[str]:
        """クエリ中の概念語にグラフ上で近接する語を返す。"""
        return self._graph.related(npc_id, query, k)

    async def record(self, npc_id: str, player_msg: str, npc_reply: str,
                     params: list[float] | None = None) -> None:
        """1ターンを履歴・グラフへ記録し永続化する。embeddingも保持。"""
        text = f"{player_msg} {npc_reply}"
        vec = await _embed(text)
        hist = self._load_hist(npc_id)
        turn = {"t": time.time(), "player": player_msg, "npc": npc_reply}
        if vec:
            turn["v"] = vec
        hist.append(turn)
        self._save_hist(npc_id)

        self._graph.update(npc_id, text)

        if params is not None:
            self._params[npc_id] = params
            self._save_params(npc_id)

    def last_params(self, npc_id: str) -> list[float] | None:
        if npc_id in self._params:
            return self._params[npc_id]
        path = self._dir / f"params_{npc_id}.json"
        if path.exists():
            try:
                self._params[npc_id] = json.loads(path.read_text())
            except Exception:
                return None
        return self._params.get(npc_id)

    # ---------- internals ----------

    def _path(self, name: str, npc_id: str) -> Path:
        safe = re.sub(r"[^\w\-]", "_", npc_id)
        return self._dir / f"{name}_{safe}.json"

    def _load_hist(self, npc_id: str) -> deque:
        if npc_id not in self._hist:
            path = self._path("hist", npc_id)
            items = []
            if path.exists():
                try:
                    items = json.loads(path.read_text())
                except Exception:
                    items = []
            self._hist[npc_id] = deque(items, maxlen=HISTORY_LIMIT)
        return self._hist[npc_id]

    def _save_hist(self, npc_id: str) -> None:
        self._path("hist", npc_id).write_text(
            json.dumps(list(self._hist[npc_id]), ensure_ascii=False)
        )

    def _save_params(self, npc_id: str) -> None:
        self._path("params", npc_id).write_text(
            json.dumps(self._params[npc_id])
        )
