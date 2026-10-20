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

import networkx as nx

from .config import HISTORY_LIMIT

# 共起グラフで拾う概念語（世界観ベースのシード辞書）
_SEED_CONCEPTS = (
    "ボイド", "汚染", "ウイルス", "放射能", "クリーチャー", "シェルター",
    "プレイヤー", "仲間", "信頼", "戦闘", "探索", "食料", "水", "薬",
    "旧世界", "記憶", "家族", "死", "怖い", "助け",
)


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


class MemoryStore:
    """NPC 単位の履歴・リコール・共起グラフを管理する。"""

    def __init__(self, data_dir: str) -> None:
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._hist: dict[str, deque] = {}
        self._graphs: dict[str, nx.Graph] = {}
        self._params: dict[str, list[float]] = {}

    # ---------- public ----------

    def recent(self, npc_id: str, n: int = 6) -> list[dict]:
        """直近 n ターンを新しい順で返す。"""
        hist = self._load_hist(npc_id)
        return list(hist)[-n:]

    def recall(self, npc_id: str, query: str, k: int = 3) -> list[dict]:
        """クエリと類似した過去ターンを k 件返す。"""
        q = _bigrams(query)
        scored = []
        for turn in self._load_hist(npc_id):
            text = f"{turn.get('player', '')} {turn.get('npc', '')}"
            score = _similarity(q, _bigrams(text))
            if score > 0.05:
                scored.append((score, turn))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [t for _, t in scored[:k]]

    def related_concepts(self, npc_id: str, query: str, k: int = 5) -> list[str]:
        """クエリ中の概念語にグラフ上で近接する語を返す。"""
        g = self._load_graph(npc_id)
        hits = [c for c in _SEED_CONCEPTS if c in query]
        out: set[str] = set()
        for h in hits:
            if h in g:
                neighbors = sorted(
                    g[h].items(), key=lambda kv: kv[1].get("w", 0), reverse=True
                )
                out.update(n for n, _ in neighbors[:k])
        return sorted(out)[:k]

    def record(self, npc_id: str, player_msg: str, npc_reply: str,
               params: list[float] | None = None) -> None:
        """1ターンを履歴・グラフへ記録し永続化する。"""
        hist = self._load_hist(npc_id)
        hist.append(
            {"t": time.time(), "player": player_msg, "npc": npc_reply}
        )
        self._save_hist(npc_id)

        text = f"{player_msg} {npc_reply}"
        self._update_graph(npc_id, text)

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

    def _load_graph(self, npc_id: str) -> nx.Graph:
        if npc_id not in self._graphs:
            g = nx.Graph()
            path = self._path("graph", npc_id)
            if path.exists():
                try:
                    data = json.loads(path.read_text())
                    for u, v, w in data.get("edges", []):
                        g.add_edge(u, v, w=w)
                except Exception:
                    pass
            self._graphs[npc_id] = g
        return self._graphs[npc_id]

    def _update_graph(self, npc_id: str, text: str) -> None:
        g = self._load_graph(npc_id)
        hits = [c for c in _SEED_CONCEPTS if c in text]
        for i, a in enumerate(hits):
            for b in hits[i + 1 :]:
                w = g.get_edge_data(a, b, {}).get("w", 0) + 1
                g.add_edge(a, b, w=w)
        if hits:
            data = {"edges": [[u, v, d.get("w", 1)] for u, v, d in g.edges(data=True)]}
            self._path("graph", npc_id).write_text(
                json.dumps(data, ensure_ascii=False)
            )

    def _save_params(self, npc_id: str) -> None:
        self._path("params", npc_id).write_text(
            json.dumps(self._params[npc_id])
        )
