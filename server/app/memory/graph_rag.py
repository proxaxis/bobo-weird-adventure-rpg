"""Graph RAG — NetworkX による概念共起グラフ。

会話文中のシード概念語の共起をエッジとして蓄積し、
クエリ語に近接する概念をプロンプトへ供給する。
永続化は data/graph_{npc}.json（外部DB不要）。
"""

import json
import re
from pathlib import Path

import networkx as nx

# 共起グラフで拾う概念語（世界観ベースのシード辞書）
SEED_CONCEPTS = (
    "ボイド", "汚染", "ウイルス", "放射能", "クリーチャー", "シェルター",
    "プレイヤー", "仲間", "信頼", "戦闘", "探索", "食料", "水", "薬",
    "旧世界", "記憶", "家族", "死", "怖い", "助け",
)


class GraphRAG:
    """NPC 単位の概念共起グラフを管理する。"""

    def __init__(self, data_dir: str) -> None:
        self._dir = Path(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._graphs: dict[str, nx.Graph] = {}

    def _path(self, npc_id: str) -> Path:
        safe = re.sub(r"[^\w\-]", "_", npc_id)
        return self._dir / f"graph_{safe}.json"

    def load(self, npc_id: str) -> nx.Graph:
        if npc_id not in self._graphs:
            g = nx.Graph()
            path = self._path(npc_id)
            if path.exists():
                try:
                    data = json.loads(path.read_text())
                    for u, v, w in data.get("edges", []):
                        g.add_edge(u, v, w=w)
                except Exception:
                    pass
            self._graphs[npc_id] = g
        return self._graphs[npc_id]

    def update(self, npc_id: str, text: str) -> None:
        """文中の概念語同士の共起エッジを強化し永続化する。"""
        g = self.load(npc_id)
        hits = [c for c in SEED_CONCEPTS if c in text]
        for i, a in enumerate(hits):
            for b in hits[i + 1:]:
                w = g.get_edge_data(a, b, {}).get("w", 0) + 1
                g.add_edge(a, b, w=w)
        if hits:
            data = {"edges": [[u, v, d.get("w", 1)] for u, v, d in g.edges(data=True)]}
            self._path(npc_id).write_text(json.dumps(data, ensure_ascii=False))

    def related(self, npc_id: str, query: str, k: int = 5) -> list[str]:
        """クエリ中の概念語にグラフ上で近接する語を返す。"""
        g = self.load(npc_id)
        hits = [c for c in SEED_CONCEPTS if c in query]
        out: set[str] = set()
        for h in hits:
            if h in g:
                neighbors = sorted(
                    g[h].items(), key=lambda kv: kv[1].get("w", 0), reverse=True
                )
                out.update(n for n, _ in neighbors[:k])
        return sorted(out)[:k]
