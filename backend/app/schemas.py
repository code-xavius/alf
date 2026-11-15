from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ActivityKind = Literal["wordcloud", "poll", "quiz", "video"]
QuestionKind = Literal["mcq", "poll"]
ActivityStatus = Literal["open", "closed"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AppConfigOut(BaseModel):
    app_name: str
    dev_mode: bool
    supabase_url: str | None
    supabase_anon_key: str | None
    realtime_url: str | None = None


class MeOut(BaseModel):
    user_id: str


class QuestionRead(ORMModel):
    id: str
    prompt: str
    kind: str
    options: list[str]
    correct_index: int | None
    time_limit: int | None
    video_ts: int | None
    position: int


class ActivityRead(ORMModel):
    id: str
    code: str
    kind: str
    title: str
    config: dict[str, Any]
    state: dict[str, Any]
    status: str
    created_at: datetime
    questions: list[QuestionRead] = []


class ActivitySummary(BaseModel):
    id: str
    code: str
    kind: str
    title: str
    status: str
    participant_count: int = 0
    created_at: datetime


class PublicQuestion(BaseModel):
    id: str
    prompt: str
    kind: str
    options: list[str]
    video_ts: int | None
    position: int
    correct_index: int | None = None


class PublicActivity(BaseModel):
    id: str
    code: str
    kind: str
    title: str
    config: dict[str, Any]
    state: dict[str, Any]
    status: str
    participant_count: int = 0
    questions: list[PublicQuestion] = []


class ActivityCreate(BaseModel):
    kind: ActivityKind
    title: str = Field(min_length=1, max_length=200)
    config: dict[str, Any] = Field(default_factory=dict)


class ActivityUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict[str, Any] | None = None
    state: dict[str, Any] | None = None
    status: ActivityStatus | None = None


class QuestionCreate(BaseModel):
    prompt: str = Field(min_length=1)
    kind: QuestionKind = "mcq"
    options: list[str] = Field(min_length=2, max_length=10)
    correct_index: int | None = None
    time_limit: int | None = Field(default=None, ge=5, le=600)
    video_ts: int | None = Field(default=None, ge=0)
    position: int | None = None

    @model_validator(mode="after")
    def validate_question(self) -> "QuestionCreate":
        cleaned = [option.strip() for option in self.options if option.strip()]
        if len(cleaned) < 2:
            raise ValueError("Au moins deux options sont nécessaires.")
        self.options = cleaned
        if self.kind == "mcq":
            if self.correct_index is None:
                raise ValueError("Une question QCM doit avoir une bonne réponse.")
            if not 0 <= self.correct_index < len(cleaned):
                raise ValueError("correct_index est hors des options.")
        else:
            self.correct_index = None
        return self


class QuestionUpdate(BaseModel):
    prompt: str | None = Field(default=None, min_length=1)
    kind: QuestionKind | None = None
    options: list[str] | None = Field(default=None, min_length=2, max_length=10)
    correct_index: int | None = None
    time_limit: int | None = Field(default=None, ge=5, le=600)
    video_ts: int | None = Field(default=None, ge=0)
    position: int | None = None


class JoinRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=60)
    device_id: str | None = Field(default=None, max_length=64)


class ParticipantRead(ORMModel):
    id: str
    nickname: str
    activity_id: str


class ParticipantAdmin(ORMModel):
    id: str
    nickname: str
    ip: str | None
    user_agent: str | None
    device_id: str | None
    banned_until: datetime | None
    banned: bool = False
    created_at: datetime


class ParticipantBan(BaseModel):
    minutes: int = Field(default=10, ge=0, le=10080)


class ParticipantBanOut(BaseModel):
    id: str
    banned_until: datetime | None


class WordCreate(BaseModel):
    text: str = Field(min_length=1, max_length=80)
    participant_id: str | None = None


class WordRead(ORMModel):
    id: str
    text: str
    participant_id: str | None
    created_at: datetime


class WordBatchItem(BaseModel):
    id: str | None = Field(default=None, max_length=36)
    text: str = Field(min_length=1, max_length=80)
    participant_id: str | None = Field(default=None, max_length=36)
    created_at: datetime | None = None


class WordBatchCreate(BaseModel):
    words: list[WordBatchItem] = Field(min_length=1, max_length=500)


class WordBatchResult(BaseModel):
    inserted: int
    skipped: int


class ResponseCreate(BaseModel):
    participant_id: str
    value: int = Field(ge=0)


class ResponseResult(BaseModel):
    recorded: bool
    updated: bool = False
    is_correct: bool | None = None


class QuestionResult(BaseModel):
    id: str
    prompt: str
    kind: str
    options: list[str]
    correct_index: int | None
    counts: list[int]
    total: int


class ActivityResults(BaseModel):
    activity_id: str
    kind: str
    questions: list[QuestionResult]
    words: list[dict[str, Any]]
