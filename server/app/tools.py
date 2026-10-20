"""LLM ツール呼出しレジストリ（MCP相当の内部実装）。

LLM が出力行に {"x": "<tool_name>"} を含めた場合、ツール呼出しとして扱う。
サーバはパラメータ等のコンテキストで受理可否を検証し、
受理した呼出しのみ制御チャンクとしてクライアントへ転送する。

将来的に MCP stdio サーバへ差し替える場合も、ここのレジストリを
呼び出し口として残す設計。
"""

# 仲間化に必要な信頼度（P_INDEX.TRUST_PLAYER）
COMPANION_TRUST_THRESHOLD = 0.6
TRUST_PLAYER_INDEX = 100

# ツール名 → 説明（プロンプトやログ用）
TOOLS = {
    "join_companion": "プレイヤーの仲間（同行者）としてフィールドに加わる",
    "reveal_name": "自分の名前を名乗る（NPC名表示の開示）",
}

# ツールごとの受理条件
def validate(name: str, params: list[float]) -> bool:
    """ツール呼出しを受理するかをコンテキストで検証する。"""
    if name == "reveal_name":
        return True
    if name == "join_companion":
        trust = params[TRUST_PLAYER_INDEX] if TRUST_PLAYER_INDEX < len(params) else 0.0
        return trust >= COMPANION_TRUST_THRESHOLD
    return False
