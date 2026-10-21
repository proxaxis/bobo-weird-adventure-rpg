"""Fast Path — リアルタイム発話パイプライン。

Ollama の構造化出力（format: JSON Schema）で応答を
「発話断片の配列」に物理拘束し、ストリーム中に完成した
オブジェクトを逐次 JSON-Lines としてクライアントへ送出する。
ラテン断片の混入や構文エラーは構造レベルで遮断される。
"""

import json
import re
import time
from collections.abc import AsyncGenerator

import httpx

from ..constants import EXPRESSION_PRESETS, MOTION_PRESETS
from ..diffengine import heuristic_diffs, sanitize_diffs
from ..llm import stream_chat
from ..memory.memory_store import MemoryStore
from ..prompt import build_messages
from ..schemas import DialogRequest
from ..tools.registry import TOOLS, validate
from ..tools.web_search import search_topics
from ..config import LLM_TEMPERATURE

_FILLER_RE = re.compile(r"^(…|あの|えっと|えーと|うーん|その)")

# 中国語混入の検出（簡体字のみ。日本語常用漢字は対象外）
_CN_CERTAIN = re.compile(r"[吗呢吧哪这]")
_CN_SUSPECT = re.compile(r"[个们说会请汉谢对为关现应识读问让还觉边过动谁么你她在吗呢吧哪这]")


def _is_chinese_line(text: str) -> bool:
    return bool(_CN_CERTAIN.search(text)) or len(_CN_SUSPECT.findall(text)) >= 2


_LATIN_RUN = re.compile(r"[a-zA-Z]{3,}")
_NAME_ASK_RE = re.compile(r"(名前|なまえ|名は|名乗|呼んで|呼ば|なんて|何て)")


def _sanitize_text(text: str) -> str:
    """3文字以上のラテン断片除去 + 全角句読点の日本語正規化。"""
    t = _LATIN_RUN.sub("", text)
    t = t.replace("，", "、").replace("．", "。")
    return t.strip()


# 構造化出力スキーマ: 発話断片オブジェクトの配列。
# {"t": 発話, "e": 表情, "m"?: 身振り, "u"?: 差分, "x"?: ツール}
CHUNK_ARRAY_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "t": {"type": "string"},
            "e": {"type": "string", "enum": list(EXPRESSION_PRESETS)},
            "m": {"type": "string", "enum": list(MOTION_PRESETS)},
            "x": {"type": "string", "enum": list(TOOLS)},
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
        },
        "required": ["t", "e"],
    },
}

_PREF_TOPIC_QUERIES = {
    400: "自然 癒し 話題",
    401: "テクノロジー ニュース",
    402: "料理 レシピ 美味しい",
    403: "レトロ 旧世界 文化 懐かしい",
}
_PER_OPENNESS_INDEX = 300


def _pick_topic_query(params: list[float], message: str) -> str | None:
    best_idx, best_val = -1, 0.3
    for idx in _PREF_TOPIC_QUERIES:
        v = params[idx] if idx < len(params) else 0.0
        if v > best_val:
            best_idx, best_val = idx, v
    if best_idx >= 0:
        return _PREF_TOPIC_QUERIES[best_idx]
    if any(k in message for k in ("話題", "ニュース", "最近", "流行")):
        return message[:24]
    return None


def _temperature(params: list[float]) -> float:
    openness = params[_PER_OPENNESS_INDEX] if _PER_OPENNESS_INDEX < len(params) else 0.5
    t = LLM_TEMPERATURE + (openness - 0.5) * 0.3
    return max(0.3, min(1.1, t))


def _line(chunk: dict) -> str:
    return json.dumps(chunk, ensure_ascii=False) + "\n"


def format_time_delta(last_time: float, current_time: float) -> str:
    """最終対話からの経過時間を文脈テキストへ変換する。"""
    diff = current_time - last_time
    if last_time <= 0:
        return "初対面。相手を警戒している。"
    if diff < 180:
        return "直前（数分前）に会話したばかり。会話は継続中。"
    if diff < 7200:
        return f"約{int(diff/60)}分ぶりの再会。同日の短い別行動後。"
    if diff < 86400:
        return f"約{int(diff/3600)}時間ぶりの再会。同日の別行動後。"
    days = int(diff / 86400)
    return f"{days}日以上ぶりの再会！過酷な終末世界で生きて再会できたことへの安堵・驚き。"


def _normalize_chunk(obj: dict) -> dict | None:
    """スキーマ準拠の1要素を StreamChunk へ正規化する。"""
    if not isinstance(obj, dict) or not isinstance(obj.get("t"), str):
        return None
    e = obj.get("e")
    if e not in EXPRESSION_PRESETS:
        e = "neutral"
    out = {"t": obj["t"], "e": e, "u": sanitize_diffs(obj.get("u"))}
    m = obj.get("m")
    if m in MOTION_PRESETS:
        out["m"] = m
    if obj.get("x") in TOOLS:
        out["x"] = obj["x"]
    return out


def _iter_complete_objects(text: str, start: int) -> tuple[list[dict], int]:
    """JSON配列ストリーム中の完成したトップレベル要素を抽出する。

    文字列/エスケープを考慮したブレース深さ走査で、閉じた {...} を
    見つけるごとにパースを試みる。
    """
    objs = []
    i = start
    depth = 0
    in_str = False
    esc = False
    obj_start = -1
    consumed = start
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                if depth == 0:
                    obj_start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and obj_start >= 0:
                    try:
                        objs.append(json.loads(text[obj_start : i + 1]))
                        consumed = i + 1
                    except json.JSONDecodeError:
                        pass
                    obj_start = -1
        i += 1
    return objs, consumed


async def _fallback_reply(req: DialogRequest, heur: list[dict]) -> AsyncGenerator[str, None]:
    yield _line({"t": "……えっと、", "e": "relaxed", "u": heur})
    yield _line({"t": "今、少し考えがまとまらないの。", "e": "sad", "u": []})
    yield _line({"t": "でも、一緒にいることはできるよ。", "e": "happy", "u": []})


async def stream_fast_path(
    req: DialogRequest,
    memory: MemoryStore,
) -> AsyncGenerator[str, None]:
    """Fast Path: 構造化出力で応答を生成し JSON-Lines で逐次送出する。

    Yields:
        JSON-Lines 文字列（{"t","e","u","m"?,"x"?}）
    """
    heur = heuristic_diffs(req.message)

    # LLM 初回トークンまでの空白を埋めるため、フィラーを最速で送出する
    yield _line({"t": "……えっと、", "e": "relaxed", "u": []})
    sent_filler = True

    topics: list[str] = []
    topic_query = _pick_topic_query(req.parameters, req.message)
    if topic_query:
        topics = await search_topics(topic_query)

    time_delta = format_time_delta(req.lastInteractionTime / 1000, time.time())

    messages = build_messages(
        req,
        history=memory.recent(req.npcId),
        recalled=await memory.recall(req.npcId, req.message),
        concepts=memory.related_concepts(req.npcId, req.message),
        topics=topics,
        time_delta=time_delta,
    )
    temperature = _temperature(req.parameters)

    reply_text = ""
    first_chunk = True
    buffer = ""
    pos = 0

    def emit_ready(chunk: dict) -> tuple[str, str]:
        nonlocal first_chunk
        out = ""
        if first_chunk:
            chunk["u"] = chunk["u"] + heur
            first_chunk = False
        chunk["t"] = _sanitize_text(chunk["t"])
        if not chunk["t"]:
            return "", ""
        out += _line(chunk)
        if "x" in chunk and validate(chunk["x"], req.parameters):
            out += _line({"x": chunk["x"], "t": "", "e": "neutral", "u": []})
        return out, chunk["t"]

    try:
        async for token in stream_chat(
            messages, temperature=temperature, format_schema=CHUNK_ARRAY_SCHEMA
        ):
            buffer += token
            objs, pos = _iter_complete_objects(buffer, pos)
            for obj in objs:
                chunk = _normalize_chunk(obj)
                if chunk is None or _is_chinese_line(chunk["t"]):
                    continue
                out, text = emit_ready(chunk)
                reply_text += text
                if out:
                    yield out
        if not reply_text:
            yield _line({"t": "……（ぼそぼそ、と何か言っている）", "e": "neutral", "u": []})
        if _NAME_ASK_RE.search(req.message):
            yield _line({"x": "reveal_name", "t": "", "e": "neutral", "u": []})
    except httpx.HTTPError:
        async for c in _fallback_reply(req, heur):
            obj = json.loads(c)
            reply_text += obj.get("t", "")
            yield c
    finally:
        if reply_text:
            await memory.record(req.npcId, req.message, reply_text, req.parameters)
