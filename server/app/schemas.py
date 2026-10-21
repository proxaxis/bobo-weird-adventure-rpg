"""API スキーマ定義。"""

from pydantic import BaseModel, Field

from .constants import PARAM_COUNT


class EnvironmentState(BaseModel):
    """クライアントから送られる周辺環境スナップショット。"""

    pollutionLevel: float = 0.0
    nearestThreatDistance: float = -1.0
    voidCount: int = 0


class DialogRequest(BaseModel):
    """POST /dialog/stream のリクエスト。parameters はクライアント側
    Float32Array(1000) のスナップショット。"""

    message: str
    parameters: list[float] = Field(min_length=PARAM_COUNT, max_length=PARAM_COUNT)
    environment: EnvironmentState = Field(default_factory=EnvironmentState)
    npcId: str = "default"
    npcName: str = "MOB"
    # 永続プレイヤーUUID（Deep Path の push 宛先）
    playerUuid: str = ""
    # router RelationshipManager が返す最終対話時刻（UNIXミリ秒、初対面は0）
    lastInteractionTime: float = 0.0
