"""Deep Path — 非同期バックグラウンド処理。

Fast Path の応答完了後に起動し、会話内容から意図・感情を評価して
1000パラメータの差分を算出、Graph RAG へエピソードを追加し、
結果を router 経由でクライアントへ push する。
"""

import asyncio
import json

import httpx

from ..config import OLLAMA_BASE_URL, OLLAMA_MODEL, ROUTER_URL
from ..diffengine import heuristic_diffs, sanitize_diffs

_ANALYZE_SYSTEM = """あなたは会話ログから心情変化を推定する解析器。
出力はJSONのみ: {"u": [{"index": int, "delta": float}], "topics": [str]}
- index は 0-999, delta は -0.1〜0.1。意味のある変動のみ最大8件。
- 帯域: 100-199信頼/200-299戦闘/300-399性格/400-499嗜好/500-599感情
- topics は会話から抽出した関心話題（最大3件、なければ空）。
説明やコードフェンスは出力しない。"""

_DEEP_SCHEMA = {
    "type": "object",
    "properties": {
        "u": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "delta": {"type": "number"},
                },
                "required": ["index", "delta"],
            },
        },
        "topics": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["u"],
}


async def _analyze(player_msg: str, npc_reply: str) -> dict | None:
    """会話ターンを解析し {"u": diffs, "topics": [...]} を返す。"""
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": _ANALYZE_SYSTEM},
            {
                "role": "user",
                "content": f"プレイヤー「{player_msg}」\nNPC「{npc_reply}」",
            },
        ],
        "stream": False,
        "format": _DEEP_SCHEMA,
        "options": {"temperature": 0.3, "num_ctx": 2048},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat", json=payload
            )
            r.raise_for_status()
            return json.loads(r.json().get("message", {}).get("content", "{}"))
    except Exception:
        return None


async def push_diffs(uuid: str, npc_id: str, diffs: list[dict]) -> bool:
    """router /push 経由でパラメータ差分をクライアントへ中継する。"""
    if not uuid or not diffs:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{ROUTER_URL.rstrip('/')}/push",
                json={
                    "uuid": uuid,
                    "payload": {
                        "type": "param-diff",
                        "npcId": npc_id,
                        "diffs": diffs,
                    },
                },
            )
            return r.status_code == 200 and r.json().get("delivered", False)
    except Exception:
        return False


def run_deep_path(
    npc_id: str,
    player_uuid: str,
    player_msg: str,
    npc_reply: str,
) -> asyncio.Task:
    """Deep Path をバックグラウンドタスクとして起動する。"""

    async def _run() -> None:
        result = await _analyze(player_msg, npc_reply)
        if result is None:
            diffs = heuristic_diffs(player_msg)
        else:
            diffs = sanitize_diffs(result.get("u"))
            if not diffs:
                diffs = heuristic_diffs(player_msg)
        await push_diffs(player_uuid, npc_id, diffs)

    return asyncio.create_task(_run())
