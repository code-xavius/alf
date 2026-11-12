from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ActivityKind = Literal["wordcloud", "poll", "quiz", "video"]
QuestionKind = Literal["mcq", "poll"]
SessionStatus = Literal["draft", "live", "closed"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AppConfigOut(BaseModel):
    app_name: str
    dev_mode: bool
    supabase_url: str | None
    supabase_anon_key: str | None


class MeOut(BaseModel):
    user_id: str


class SessionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: SessionStatus | None = None
    current_activity_id: str | None = None


class SessionSummary(ORMModel):
    id: str
    code: str
    title: str
    status: str
    current_activity_id: str | None
    created_at: datetime


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
    kind: str
    title: str
    config: dict[str, Any]
    state: dict[str, Any]
    position: int
    questions: list[QuestionRead] = []


class SessionDetail(SessionSummary):
    activities: list[ActivityRead] = []


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
    kind: str
    title: str
    config: dict[str, Any]
    state: dict[str, Any]
    position: int
    questions: list[PublicQuestion] = []


class PublicSession(BaseModel):
    id: str
    code: str
    title: str
    status: str
    current_activity_id: str | None
    participant_count: int = 0
    activities: list[PublicActivity] = []


class ActivityCreate(BaseModel):
    kind: ActivityKind
    title: str = Field(min_length=1, max_length=200)
    config: dict[str, Any] = Field(default_factory=dict)
    position: int | None = None


class ActivityUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict[str, Any] | None = None
    state: dict[str, Any] | None = None
    position: int | None = None


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


class ParticipantRead(ORMModel):
    id: str
    nickname: str
    session_id: str


class WordCreate(BaseModel):
    text: str = Field(min_length=1, max_length=80)
    participant_id: str | None = None


class WordRead(ORMModel):
    id: str
    text: str
    participant_id: str | None
    created_at: datetime


class ResponseCreate(BaseModel):
    participant_id: str
    value: int = Field(ge=0)


class ResponseResult(BaseModel):
    recorded: bool
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
