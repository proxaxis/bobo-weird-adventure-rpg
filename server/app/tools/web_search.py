"""外部 Web 検索による話題提案ツール（Phase 6）。

SEARXNG_URL または TAVILY_API_KEY が設定されている場合のみ有効。
いずれも未設定なら空配列を返し、プロンプトには影響しない。
"""

import httpx

from ..config import SEARXNG_URL, TAVILY_API_KEY


async def search_topics(query: str, limit: int = 3) -> list[str]:
    """クエリで検索し、話題用のタイトル/スニペットを返す。"""
    if SEARXNG_URL:
        return await _searxng(query, limit)
    if TAVILY_API_KEY:
        return await _tavily(query, limit)
    return []


async def _searxng(query: str, limit: int) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{SEARXNG_URL.rstrip('/')}/search",
                params={"q": query, "format": "json"},
            )
            r.raise_for_status()
            results = r.json().get("results", [])
            return [
                f"{x.get('title', '')} — {x.get('content', '')[:80]}"
                for x in results[:limit]
            ]
    except Exception:
        return []


async def _tavily(query: str, limit: int) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "max_results": limit,
                },
            )
            r.raise_for_status()
            return [
                f"{x.get('title', '')} — {x.get('content', '')[:80]}"
                for x in r.json().get("results", [])[:limit]
            ]
    except Exception:
        return []
