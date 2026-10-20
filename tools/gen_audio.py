#!/usr/bin/env python3
"""プレースホルダ効果音・環境音を生成する（標準ライブラリのみ）。

出力: client/public/audio/*.wav
  wind.wav    - 環境音（風、6秒ループ）
  pickup.wav  - ボイド取得
  attack.wav  - 攻撃（スウィング）
  hit.wav     - 被弾
  dialog.wav  - 対話開始チャイム
  death.wav   - 死亡
"""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / "client" / "public" / "audio"


def write_wav(name: str, samples: list) -> None:
    w = wave.open(str(OUT / name), "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples
    )
    w.writeframes(frames)
    w.close()


def envelope(n: int, attack: float = 0.01, release: float = 0.3):
    a = max(1, int(n * attack))
    r = max(1, int(n * release))
    for i in range(n):
        if i < a:
            yield i / a
        elif i > n - r:
            yield (n - i) / r
        else:
            yield 1.0


def wind() -> None:
    """ブラウンノイズ + ゆるいLFOの風音。"""
    n = RATE * 6
    samples = []
    acc = 0.0
    rnd = random.Random(42)
    for i in range(n):
        acc += (rnd.random() * 2 - 1) * 0.02
        acc *= 0.998  # リークでドリフト防止
        lfo = 0.6 + 0.4 * math.sin(2 * math.pi * 0.13 * i / RATE)
        samples.append(acc * lfo * 2.2)
    write_wav("wind.wav", samples)


def pickup() -> None:
    """上昇する2音の取得音。"""
    n = int(RATE * 0.18)
    env = list(envelope(n, 0.02, 0.5))
    samples = []
    for i in range(n):
        f = 880 if i < n // 2 else 1320
        t = i / RATE
        samples.append(math.sin(2 * math.pi * f * t) * 0.5 * env[i])
    write_wav("pickup.wav", samples)


def attack() -> None:
    """ホワイトノイズの短いスウィング。"""
    n = int(RATE * 0.12)
    env = list(envelope(n, 0.05, 0.7))
    rnd = random.Random(7)
    samples = [ (rnd.random() * 2 - 1) * 0.4 * env[i] for i in range(n) ]
    write_wav("attack.wav", samples)


def hit() -> None:
    """低いドン。"""
    n = int(RATE * 0.2)
    env = list(envelope(n, 0.01, 0.6))
    samples = []
    for i in range(n):
        t = i / RATE
        f = 120 * math.exp(-4 * t)
        samples.append(math.sin(2 * math.pi * f * t) * 0.7 * env[i])
    write_wav("hit.wav", samples)


def dialog() -> None:
    """柔らかい2音チャイム。"""
    n = int(RATE * 0.35)
    env = list(envelope(n, 0.02, 0.5))
    samples = []
    for i in range(n):
        t = i / RATE
        f = 660 if i < n // 2 else 990
        s = math.sin(2 * math.pi * f * t) + 0.3 * math.sin(2 * math.pi * f * 2 * t)
        samples.append(s * 0.3 * env[i])
    write_wav("dialog.wav", samples)


def death() -> None:
    """下降トーン。"""
    n = int(RATE * 0.7)
    env = list(envelope(n, 0.01, 0.4))
    samples = []
    for i in range(n):
        t = i / RATE
        f = 440 * (1 - t * 0.8)
        samples.append(math.sin(2 * math.pi * max(80, f) * t) * 0.5 * env[i])
    write_wav("death.wav", samples)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    wind()
    pickup()
    attack()
    hit()
    dialog()
    death()
    print(f"wrote wav files to {OUT}")
