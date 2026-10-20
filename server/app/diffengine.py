"""1000パラメータ差分（{"index","delta"}）エンジン。

責務:
- LLM が出力した u のサニタイズ（index 範囲・|delta| 上限・件数上限）
- LLM が差分を出さなくても最低限の心情変動を保証するキーワード規則
  （本来の学習/推論ループは Phase 6 以降で育てる想定の暫定ヒューリスティック）
"""

from .constants import PARAM_COUNT

MAX_DELTA = 0.2
MAX_DIFFS_PER_CHUNK = 8

# キーワード規則: (正規表現に入れる文字列群, [(index, delta), ...])
_RULES = [
    (("奪", "殺", "攻撃", "敵", "死ね"), [
        (100, -0.04),  # 信頼↓
        (103, 0.05),   # 恐怖↑
        (503, 0.06),   # 恐れ↑
        (501, 0.03),   # 怒り↑
    ]),
    (("ありがと", "助か", "感謝", "嬉し"), [
        (100, 0.03),
        (101, 0.02),   # 親しみ↑
        (500, 0.06),   # 喜び↑
    ]),
    (("一緒", "行こ", "手伝", "ついて"), [
        (100, 0.02),
        (102, 0.02),   # 依存心↑
        (500, 0.04),
    ]),
    (("ボイド", "集め", "探索"), [
        (404, 0.03),   # ボイド執着↑
        (302, 0.01),   # 好奇心↑
    ]),
    (("汚染", "ウイルス", "放射能"), [
        (503, 0.04),
        (201, 0.02),   # 慎重さ↑
    ]),
    (("ごはん", "食べ", "腹", "美味"), [
        (402, 0.03),
        (500, 0.02),
    ]),
]


def sanitize_diffs(raw: object) -> list[dict]:
    """LLM 出力の u を検証・丸める。不正要素は捨てる。"""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:MAX_DIFFS_PER_CHUNK]:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        delta = item.get("delta")
        if not isinstance(index, int) or not isinstance(delta, (int, float)):
            continue
        if not 0 <= index < PARAM_COUNT:
            continue
        out.append({"index": index, "delta": float(max(-MAX_DELTA, min(MAX_DELTA, delta)))})
    return out


def heuristic_diffs(message: str) -> list[dict]:
    """入力メッセージへの規則ベース差分。マッチした規則を全て適用。"""
    merged: dict[int, float] = {}
    for keywords, diffs in _RULES:
        if any(k in message for k in keywords):
            for index, delta in diffs:
                merged[index] = merged.get(index, 0.0) + delta
    return [{"index": i, "delta": d} for i, d in merged.items()]
