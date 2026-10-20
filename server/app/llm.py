"""Ollama へのストリーミング chat 呼び出し。"""

from collections.abc import AsyncGenerator

import httpx

from .config import LLM_TIMEOUT, OLLAMA_BASE_URL, OLLAMA_MODEL


async def stream_chat(
    messages: list[dict],
    temperature: float = 0.8,
) -> AsyncGenerator[str, None]:
    """Ollama /api/chat を stream=True で呼び、生成トークンを逐次 yield する。

    Raises:
        httpx.HTTPError: 接続・レスポンス失敗時。
    """
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": temperature,
            "num_ctx": 4096,
        },
    }
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        async with client.stream(
            "POST", f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat", json=payload
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line:
                    continue
                import json

                obj = json.loads(line)
                token = obj.get("message", {}).get("content", "")
                if token:
                    yield token
                if obj.get("done"):
                    break
