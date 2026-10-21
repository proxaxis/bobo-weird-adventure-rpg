"""FastAPI エントリポイント。

POST /dialog/stream        : Fast Path — JSON-Lines ストリーミング応答
GET  /health               : 疎通確認
GET  /npc/{id}/parameters  : 最後に受け取ったパラメータスナップショット

応答完了後は Deep Path（api/async_tasks.py）が非同期で
パラメータ差分・Graph RAG 更新・push 中継を行う。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .api.async_tasks import run_deep_path
from .api.fast_dialog import stream_fast_path
from .config import DATA_DIR, OLLAMA_MODEL
from .memory.memory_store import MemoryStore
from .schemas import DialogRequest

app = FastAPI(title="bobo-weird-adventure-rpg AI server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

memory = MemoryStore(DATA_DIR)

# 直近ターンを Deep Path へ渡すため、ストリーム完了時に本文を保持する
async def _stream_and_capture(req: DialogRequest):
    reply = ""
    async for line in stream_fast_path(req, memory):
        try:
            import json

            reply += json.loads(line).get("t", "")
        except Exception:
            pass
        yield line
    if reply:
        run_deep_path(req.npcId, req.playerUuid, req.message, reply)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": OLLAMA_MODEL}


@app.get("/npc/{npc_id}/parameters")
async def get_params(npc_id: str) -> dict:
    params = memory.last_params(npc_id)
    return {"npcId": npc_id, "parameters": params}


@app.post("/dialog/stream")
async def dialog_stream(req: DialogRequest) -> StreamingResponse:
    return StreamingResponse(
        _stream_and_capture(req), media_type="application/x-ndjson"
    )
