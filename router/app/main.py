"""Router サーバ: presence 集約・近接Peer選出・チャンク生成レジストリ。

Redis をコネクションプール経由で使用し、全クライアントの
座標を集約して近接者リストを返す。マップチャンクは
「最初に生成した者が seed を登録」方式で多重生成を防ぐ。
"""

import os
import time

import redis.asyncio as aioredis
from fastapi import FastAPI
from pydantic import BaseModel

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
# Peer接続対象とする距離（クライアント描画範囲 ±1024 の外側マージン込みで ±2048）
CONNECT_RADIUS = float(os.getenv("CONNECT_RADIUS", "2048"))
PRESENCE_TTL = 30.0
CHUNK_TTL = 7 * 86400

app = FastAPI(title="bobo-weird-adventure-rpg router")

# コネクションプール（負荷分散・再利用）
_pool = aioredis.ConnectionPool.from_url(
    REDIS_URL, decode_responses=True, max_connections=50
)


def _r() -> aioredis.Redis:
    return aioredis.Redis(connection_pool=_pool)


class Presence(BaseModel):
    peerId: str
    x: float
    y: float


@app.post("/presence")
async def presence(p: Presence) -> dict:
    """座標を申告し、CONNECT_RADIUS 内の他クライアント一覧を返す。"""
    r = _r()
    now = time.time()
    await r.hset("presence", p.peerId, f"{p.x},{p.y},{now}")
    items = await r.hgetall("presence")
    peers = []
    stale = []
    for pid, v in items.items():
        px, py, ts = v.split(",")
        if now - float(ts) > PRESENCE_TTL:
            stale.append(pid)
            continue
        if pid == p.peerId:
            continue
        dx, dy = float(px) - p.x, float(py) - p.y
        if dx * dx + dy * dy <= CONNECT_RADIUS ** 2:
            peers.append({"peerId": pid, "x": float(px), "y": float(py)})
    if stale:
        await r.hdel("presence", *stale)
    return {"peers": peers}


class ChunkReg(BaseModel):
    key: str  # "cx,cy"
    seed: int
    owner: str  # peerId


@app.post("/chunk/register")
async def register_chunk(c: ChunkReg) -> dict:
    """チャンク seed を登録。既登録なら既存の seed/owner を返す（重複生成防止）。"""
    r = _r()
    created = await r.hsetnx("chunks", c.key, f"{c.seed},{c.owner}")
    if created:
        await r.expire("chunks", CHUNK_TTL)
        return {"owner": c.owner, "seed": c.seed, "created": True}
    v = await r.hget("chunks", c.key)
    seed, owner = (v or "0,").split(",", 1)
    return {"owner": owner, "seed": int(seed), "created": False}


@app.get("/chunk/{cx}/{cy}")
async def get_chunk(cx: str, cy: str) -> dict:
    """チャンクが生成済みか問い合わせる。"""
    v = await _r().hget("chunks", f"{cx},{cy}")
    if not v:
        return {"exists": False}
    seed, owner = v.split(",", 1)
    return {"exists": True, "seed": int(seed), "owner": owner}


@app.get("/health")
async def health() -> dict:
    try:
        await _r().ping()
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
