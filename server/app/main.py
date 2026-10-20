"""FastAPI エントリポイント。

POST /dialog/stream : JSON-Lines ストリーミング応答 {"t","e","u"}
GET  /health        : 疎通確認
GET  /npc/{id}/parameters : 最後に受け取ったパラメータスナップショット
"""

import json
import re
from collections.abc import AsyncGenerator

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import DATA_DIR, OLLAMA_MODEL
from .constants import EXPRESSION_PRESETS, PARAM_COUNT
from .diffengine import heuristic_diffs, sanitize_diffs
from .llm import stream_chat
from .memory import MemoryStore
from .prompt import build_messages
from .schemas import DialogRequest
from .search import search_topics

app = FastAPI(title="bobo-weird-adventure-rpg AI server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

memory = MemoryStore(DATA_DIR)

_FILLER_RE = re.compile(r"^(…|あの|えっと|えーと|うーん|その)")


def _line(chunk: dict) -> str:
    return json.dumps(chunk, ensure_ascii=False) + "\n"


def _parse_line(line: str) -> dict | None:
    """LLM 出力の1行を StreamChunk として解釈する。

    JSON であれば t/e/u を検証し、非JSONなら素通しテキストとして扱う。
    空行・コードフェンス等は None で捨てる。
    """
    s = line.strip()
    if not s or s.startswith("```"):
        return None

    # 行中の最初の JSON オブジェクトを探す（前後のゴミを許容）
    chunk = None
    start = s.find("{")
    if start >= 0:
        try:
            obj = json.loads(s[start:])
            if isinstance(obj, dict) and isinstance(obj.get("t"), str):
                chunk = obj
        except json.JSONDecodeError:
            pass

    if chunk is None:
        # JSON でない行はそのまま発話テキストとして使う（頑健性優先）
        if len(s) > 80 or all(ord(c) < 0x20 for c in s):
            return None
        chunk = {"t": s}

    e = chunk.get("e")
    if e not in EXPRESSION_PRESETS:
        e = "neutral"
    return {
        "t": str(chunk.get("t", "")),
        "e": e,
        "u": sanitize_diffs(chunk.get("u")),
    }


async def _fallback_reply(req: DialogRequest, heur: list[dict]) -> AsyncGenerator[str, None]:
    """Ollama 未到達時のサーバ内フォールバック応答。"""
    yield _line({"t": "……えっと、", "e": "relaxed", "u": heur})
    yield _line({"t": "今、少し考えがまとまらないの。", "e": "sad", "u": []})
    yield _line({"t": "でも、一緒にいることはできるよ。", "e": "happy", "u": []})


async def _stream(req: DialogRequest) -> AsyncGenerator[str, None]:
    """応答チャンクを JSON-Lines として逐次出力する。"""
    heur = heuristic_diffs(req.message)

    topics: list[str] = []
    if any(k in req.message for k in ("話題", "ニュース", "最近", "流行")):
        topics = await search_topics(req.message)

    messages = build_messages(
        req,
        history=memory.recent(req.npcId),
        recalled=memory.recall(req.npcId, req.message),
        concepts=memory.related_concepts(req.npcId, req.message),
        topics=topics,
    )

    reply_text = ""
    first_chunk = True
    sent_filler = False
    buffer = ""

    def emit_ready(chunk: dict) -> tuple[str, str]:
        """チャンクを送出用に整える。戻り値は (送出テキスト, 発話テキスト)。"""
        nonlocal first_chunk, sent_filler
        out = ""
        # 人間的演出: 先頭がフィラーでなければサーバ側で前置きする
        if not sent_filler:
            if not _FILLER_RE.match(chunk["t"]):
                out += _line({"t": "……えっと、", "e": "relaxed", "u": []})
            sent_filler = True
        if first_chunk:
            chunk["u"] = chunk["u"] + heur
            first_chunk = False
        out += _line(chunk)
        return out, chunk["t"]

    try:
        async for token in stream_chat(messages):
            buffer += token
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                chunk = _parse_line(line)
                if chunk is None:
                    continue
                out, text = emit_ready(chunk)
                reply_text += text
                yield out
        tail = _parse_line(buffer)
        if tail is not None:
            out, text = emit_ready(tail)
            reply_text += text
            yield out
    except httpx.HTTPError:
        async for c in _fallback_reply(req, heur):
            # フォールバックでもテキストを回収して記憶する
            obj = json.loads(c)
            reply_text += obj.get("t", "")
            yield c
    finally:
        if reply_text:
            memory.record(req.npcId, req.message, reply_text, req.parameters)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": OLLAMA_MODEL}


@app.get("/npc/{npc_id}/parameters")
async def get_params(npc_id: str) -> dict:
    params = memory.last_params(npc_id)
    return {"npcId": npc_id, "parameters": params}


@app.post("/dialog/stream")
async def dialog_stream(req: DialogRequest) -> StreamingResponse:
    return StreamingResponse(_stream(req), media_type="application/x-ndjson")
