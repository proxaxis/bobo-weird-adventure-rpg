#!/usr/bin/env python3
"""フィールドキャラクターのドット絵スプライトを生成する。

32x32 の論理ピクセルで描き、x4 ニアレスト拡大して 128x128 PNG を出力。
出力: client/public/sprites/*.png

依存なし（標準ライブラリのみ）。
"""

import struct
import zlib
from pathlib import Path

GRID = 32
SCALE = 4  # 32*4 = 128
OUT = Path(__file__).resolve().parent.parent / "client" / "public" / "sprites"


def write_png(path: Path, width: int, height: int, pixels: list) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *px) for px in row) for row in pixels
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    )


class Canvas:
    """論理ピクセルキャンバス（色は (r,g,b,a) タプル、None=透明）。"""

    def __init__(self) -> None:
        self.px = [[None] * GRID for _ in range(GRID)]

    def rect(self, x: int, y: int, w: int, h: int, c) -> None:
        for yy in range(y, min(y + h, GRID)):
            for xx in range(x, min(x + w, GRID)):
                if xx >= 0 and yy >= 0:
                    self.px[yy][xx] = c

    def set(self, x: int, y: int, c) -> None:
        if 0 <= x < GRID and 0 <= y < GRID:
            self.px[y][x] = c

    def rows(self):
        """128x128 RGBA 行配列を返す。"""
        out = []
        for row in self.px:
            expanded = []
            for c in row:
                expanded.extend([c or (0, 0, 0, 0)] * SCALE)
            for _ in range(SCALE):
                out.append(expanded)
        return out


def draw_girl(hair, hair_d, skin, outfit, outfit_d, eye, accent) -> Canvas:
    """正面ちびキャラ（女の子型）。パレット差し替えで派生。"""
    c = Canvas()
    # 後ろ髪
    c.rect(9, 3, 14, 9, hair)
    c.rect(8, 8, 2, 12, hair)   # サイド
    c.rect(22, 8, 2, 12, hair)
    c.rect(9, 11, 1, 6, hair_d)
    c.rect(22, 11, 1, 6, hair_d)
    # 前髪
    c.rect(10, 6, 12, 3, hair)
    c.rect(12, 8, 3, 1, hair_d)
    c.rect(18, 8, 3, 1, hair_d)
    # 顔
    c.rect(11, 9, 10, 6, skin)
    # 目
    c.rect(12, 10, 2, 2, eye)
    c.rect(18, 10, 2, 2, eye)
    c.set(12, 10, (255, 255, 255, 255))
    c.set(18, 10, (255, 255, 255, 255))
    # 口
    c.rect(15, 13, 2, 1, (200, 110, 110, 255))
    # チーク
    c.set(11, 12, (240, 160, 160, 255))
    c.set(20, 12, (240, 160, 160, 255))
    # ワンピース/服
    c.rect(11, 15, 10, 6, outfit)
    c.rect(10, 16, 1, 5, outfit_d)  # 袖
    c.rect(21, 16, 1, 5, outfit_d)
    c.rect(10, 20, 1, 2, skin)      # 腕
    c.rect(21, 20, 1, 2, skin)
    # スカート（裾を広げる）
    c.rect(9, 21, 14, 3, outfit)
    c.rect(8, 23, 16, 1, outfit)
    c.rect(9, 22, 1, 1, outfit_d)
    c.rect(22, 22, 1, 1, outfit_d)
    # 襟・アクセント
    c.rect(13, 15, 6, 1, accent)
    c.set(15, 17, accent)
    # 脚・靴
    c.rect(13, 24, 2, 4, skin)
    c.rect(17, 24, 2, 4, skin)
    c.rect(12, 28, 3, 1, outfit_d)
    c.rect(17, 28, 3, 1, outfit_d)
    # リボン
    c.rect(10, 3, 3, 2, accent)
    c.rect(19, 3, 3, 2, accent)
    return c


def draw_creature(body, dark, eye) -> Canvas:
    """変異クリーチャー（棘付きのブロブ）。"""
    c = Canvas()
    # 本体
    c.rect(9, 14, 14, 10, body)
    c.rect(10, 12, 12, 2, body)
    c.rect(8, 17, 16, 4, body)
    # 棘
    spikes = [(10, 11), (15, 10), (20, 11), (7, 15), (24, 15), (12, 8)]
    for sx, sy in spikes:
        c.rect(sx, sy, 2, 3, dark)
        c.set(sx, sy - 1, dark)
    # 目
    c.rect(12, 16, 3, 3, eye)
    c.rect(18, 16, 3, 3, eye)
    c.set(13, 17, (0, 0, 0, 255))
    c.set(19, 17, (0, 0, 0, 255))
    # 口（ギザギザ）
    for i, mx in enumerate(range(12, 20)):
        c.set(mx, 21 + (i % 2), dark)
    # 足
    c.rect(11, 24, 4, 3, dark)
    c.rect(18, 24, 4, 3, dark)
    return c


def gen() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    skin = (243, 214, 201, 255)

    variants = {
        "player": dict(
            hair=(42, 62, 92, 255), hair_d=(28, 42, 66, 255),
            outfit=(62, 124, 154, 255), outfit_d=(36, 74, 96, 255),
            eye=(70, 140, 200, 255), accent=(159, 230, 255, 255),
        ),
        "peer": dict(
            hair=(110, 74, 44, 255), hair_d=(80, 52, 30, 255),
            outfit=(196, 122, 52, 255), outfit_d=(130, 78, 32, 255),
            eye=(120, 80, 40, 255), accent=(255, 210, 159, 255),
        ),
        "npc-yui": dict(
            hair=(247, 168, 200, 255), hair_d=(210, 122, 160, 255),
            outfit=(240, 240, 248, 255), outfit_d=(180, 180, 200, 255),
            eye=(110, 160, 220, 255), accent=(255, 183, 213, 255),
        ),
        "npc-nagi": dict(
            hair=(154, 123, 208, 255), hair_d=(110, 84, 160, 255),
            outfit=(86, 84, 110, 255), outfit_d=(56, 55, 76, 255),
            eye=(220, 180, 90, 255), accent=(200, 170, 240, 255),
        ),
    }
    for name, p in variants.items():
        c = draw_girl(p["hair"], p["hair_d"], skin, p["outfit"], p["outfit_d"], p["eye"], p["accent"])
        write_png(OUT / f"{name}.png", GRID * SCALE, GRID * SCALE, c.rows())

    c = draw_creature((106, 43, 58, 255), (58, 18, 28, 255), (255, 224, 138, 255))
    write_png(OUT / "creature.png", GRID * SCALE, GRID * SCALE, c.rows())
    print(f"wrote sprites to {OUT}")


if __name__ == "__main__":
    gen()
