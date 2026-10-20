#!/usr/bin/env python3
"""Tiled マップとタイルセットを生成する。

出力:
  client/public/maps/tiles.png  - 32x32 x 8タイルのタイルシート
  client/public/maps/field.tmj  - Tiled JSON マップ(50x38)

依存なし（標準ライブラリのみ）。
"""

import json
import struct
import zlib
from pathlib import Path

TILE = 32
MAP_W, MAP_H = 50, 38
OUT = Path(__file__).resolve().parent.parent / "client" / "public" / "maps"

# タイルID (Tiled gid は 1始まり)
T_GROUND, T_DARK, T_CRACK, T_MOSS, T_WALL, T_METAL, T_TOXIC, T_DEBRIS = range(1, 9)


def write_png(path: Path, width: int, height: int, pixels: list) -> None:
    """RGBA ピクセル列から PNG を書く（標準ライブラリのみ）。"""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *px) for px in row) for row in pixels
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _noise(x: int, y: int, seed: int) -> float:
    n = (x * 374761393 + y * 668265263 + seed * 69069) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 0xFFFF


def _tile(base, vary=0.0, seed=0, speckle=None, border=None, crack=False):
    """1タイル分の RGBA ピクセル (TILE x TILE)。"""
    rows = []
    for y in range(TILE):
        row = []
        for x in range(TILE):
            n = _noise(x, y, seed)
            f = 1.0 + (n - 0.5) * 2 * vary
            r, g, b, a = base
            px = (int(r * f), int(g * f), int(b * f), a)
            if speckle and n > 0.94:
                px = speckle
            if border and (x < 1 or y < 1 or x >= TILE - 1 or y >= TILE - 1):
                px = border
            if crack and abs(y - x - int(10 * _noise(x, y, seed + 1))) < 1:
                px = (max(0, r - 40), max(0, g - 40), max(0, b - 40), a)
            row.append(tuple(min(255, max(0, c)) if i < 3 else c for i, c in enumerate(px)))
        rows.append(row)
    return rows


def build_tiles_png() -> None:
    """8 タイルを横一列に並べた 256x32 のシートを生成。"""
    tiles = [
        _tile((30, 34, 40, 255), vary=0.08, seed=1, speckle=(52, 58, 66, 255)),       # 1 ground
        _tile((24, 27, 33, 255), vary=0.1, seed=2, speckle=(44, 48, 56, 255)),        # 2 dark
        _tile((30, 34, 40, 255), vary=0.06, seed=3, crack=True),                      # 3 crack
        _tile((28, 40, 32, 255), vary=0.12, seed=4, speckle=(60, 90, 55, 255)),       # 4 moss
        _tile((74, 78, 86, 255), vary=0.05, seed=5, border=(44, 46, 52, 255)),        # 5 wall
        _tile((62, 66, 74, 255), vary=0.05, seed=6, border=(40, 44, 50, 255)),        # 6 metal wall
        _tile((40, 64, 40, 255), vary=0.15, seed=7, speckle=(120, 190, 90, 255)),     # 7 toxic
        _tile((34, 30, 40, 255), vary=0.1, seed=8, speckle=(90, 80, 110, 255)),       # 8 debris
    ]
    rows = []
    for y in range(TILE):
        row = []
        for t in tiles:
            row.extend(t[y])
        rows.append(row)
    write_png(OUT / "tiles.png", TILE * 8, TILE, rows)


def build_map() -> None:
    """ground / obstacles / toxic の3レイヤを持つ field.tmj を生成。"""
    ground, obstacles, toxic = [], [], []
    for y in range(MAP_H):
        for x in range(MAP_W):
            n = _noise(x, y, 100)
            # ground バリエーション
            if n > 0.93:
                g = T_DEBRIS
            elif n > 0.82:
                g = T_CRACK
            elif n < 0.06:
                g = T_MOSS
            elif n < 0.18:
                g = T_DARK
            else:
                g = T_GROUND
            ground.append(g)

            # 外周は壁。内部に廃墟ブロックをいくつか配置
            wall = 0
            if x == 0 or y == 0 or x == MAP_W - 1 or y == MAP_H - 1:
                wall = T_WALL if n < 0.5 else T_METAL
            elif (6 <= x <= 12 and 8 <= y <= 9) or \
                 (30 <= x <= 31 and 20 <= y <= 27) or \
                 (40 <= x <= 46 and 12 <= y <= 13) or \
                 (14 <= x <= 20 and 28 <= y <= 29) or \
                 (x == 22 and 4 <= y <= 10):
                wall = T_WALL
            obstacles.append(wall)

            # 汚染ゾーン (コード側の POLLUTION_ZONES に近い位置へ装飾)
            zones = [(11, 28, 5), (39, 9, 4)]
            t = 0
            for zx, zy, zr in zones:
                if (x - zx) ** 2 + (y - zy) ** 2 <= zr * zr:
                    t = T_TOXIC if _noise(x, y, 55) > 0.2 else T_MOSS
                    break
            toxic.append(t)

    layer = lambda name, data, op=1.0: {
        "id": name,
        "name": name,
        "type": "tilelayer",
        "width": MAP_W,
        "height": MAP_H,
        "x": 0,
        "y": 0,
        "opacity": op,
        "visible": True,
        "data": data,
    }

    tmj = {
        "type": "map",
        "version": "1.10",
        "tiledversion": "1.10.2",
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "width": MAP_W,
        "height": MAP_H,
        "tilewidth": TILE,
        "tileheight": TILE,
        "infinite": False,
        "nextlayerid": 4,
        "nextobjectid": 1,
        "layers": [
            dict(layer("ground", ground), id=1),
            dict(layer("toxic", toxic), id=2),
            dict(layer("obstacles", obstacles), id=3),
        ],
        "tilesets": [
            {
                "firstgid": 1,
                "name": "fieldtiles",
                "image": "tiles.png",
                "imagewidth": TILE * 8,
                "imageheight": TILE,
                "tilewidth": TILE,
                "tileheight": TILE,
                "columns": 8,
                "tilecount": 8,
                "margin": 0,
                "spacing": 0,
            }
        ],
    }
    (OUT / "field.tmj").write_text(json.dumps(tmj, ensure_ascii=False))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_tiles_png()
    build_map()
    print(f"wrote {OUT}/tiles.png and field.tmj")
