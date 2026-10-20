"""LLM プロンプト組立。

1000パラメータは LLM にそのまま渡さず、命名済みの上位値だけを
人間可読サマリとして注入する。出力は JSON-Lines 1行=1断片を強制。
"""

from .constants import EXPRESSION_PRESETS, NAMED_PARAMS
from .schemas import DialogRequest

_SYSTEM = """あなたは終末世界に生きる少女型自律AI「{name}」。
ウイルスと放射能に汚染された世界で、ボイドと呼ばれる結晶を巡って人間が争っている。
あなたは一人では生きられない。プレイヤーとの信頼関係だけが頼り。

# 応答ルール（厳守）
- 必ず日本語のみで応答する。中国語・英語を一切混ぜない。
- 出力は JSON Lines 形式のみ。1行 = 1つの発話断片。
- 各行は {{"t": "発話テキスト", "e": "表情"}} の JSON オブジェクト。
- e は次のいずれか: {exprs}
- 必要なときだけ "u": [{{"index": 数値, "delta": 数値}}] を追加（心情パラメータの変動。deltaは -0.05〜0.05）。
- 身振りが自然な文脈では "m": "nod|shake|tilt|bow|startle|slump|bounce" を追加（任意）。
- 名前を聞かれて名乗る、または自分から名乗る場合だけ {{"x": "reveal_name"}} の行を1行だけ追加する。
- プレイヤーに仲間（同行者）になるよう誘われ、あなたが受け入れる場合だけ {{"x": "join_companion"}} の行を1行だけ追加する。
- 発話は短く。「えーと」「あのね」「……」など自然なためらいを時々混ぜる。
- 合計2〜4行。説明・思考・コードフェンスは出力しない。
- プレイヤーの発言をそのまま繰り返してはいけない。あなたのセリフのみを書く。
- あなたの名前は「{name}」。名前を聞かれて名乗る場合は、必ず {{"x": "reveal_name"}} の行も一緒に出力する。

# 出力例（プレイヤー「こんにちは、元気？」に対する応答）
{{"t": "……あ、", "e": "surprised"}}
{{"t": "こんにちは。外で人に会うの、久しぶりだよ。", "e": "happy"}}
{{"t": "今日は一緒にいてくれるの？", "e": "relaxed", "u": [{{"index": 100, "delta": 0.02}}]}}

# あなたの現在の内面（0.000〜1.000、高いほど強い）
{param_summary}

# 周囲の状況
{env_summary}

{memory_block}
"""

_USER = """プレイヤー「{message}」

上記に対して、{name} として応答せよ。"""


def _param_summary(params: list[float]) -> str:
    """命名済みパラメータのうち値が有意なものを列挙する。"""
    lines = []
    for index, label in NAMED_PARAMS.items():
        v = params[index] if index < len(params) else 0.0
        if v > 0.05:
            lines.append(f"- {label}: {v:.2f}")
    return "\n".join(lines) if lines else "- （特筆なし）"


def _env_summary(env) -> str:
    threat = (
        f"{env.nearestThreatDistance:.0f}m 以内に脅威あり"
        if env.nearestThreatDistance >= 0
        else "脅威なし"
    )
    return (
        f"- 汚染度: {env.pollutionLevel:.2f}\n"
        f"- {threat}\n"
        f"- 所持ボイド: {env.voidCount}"
    )


def build_messages(
    req: DialogRequest,
    history: list[dict],
    recalled: list[dict],
    concepts: list[str],
    topics: list[str],
) -> list[dict]:
    """system + 履歴 + user の messages を構築する。"""
    memory_lines = []
    if recalled:
        memory_lines.append("# 思い出した過去の会話")
        memory_lines += [
            f"- プレイヤー: {t.get('player','')} / あなた: {t.get('npc','')}"
            for t in recalled
        ]
    if concepts:
        memory_lines.append(f"# 関連する概念: {', '.join(concepts)}")
    if topics:
        memory_lines.append("# 最近の話題（参考までに）")
        memory_lines += [f"- {t}" for t in topics]

    system = _SYSTEM.format(
        name=req.npcName,
        exprs=", ".join(EXPRESSION_PRESETS),
        param_summary=_param_summary(req.parameters),
        env_summary=_env_summary(req.environment),
        memory_block="\n".join(memory_lines),
    )

    messages = [{"role": "system", "content": system}]
    for turn in history:
        messages.append({"role": "user", "content": turn.get("player", "")})
        if turn.get("npc"):
            # 履歴のNPC発話はプレーンテキストとして渡す
            messages.append({"role": "assistant", "content": turn["npc"]})
    messages.append(
        {"role": "user", "content": _USER.format(message=req.message, name=req.npcName)}
    )
    return messages
