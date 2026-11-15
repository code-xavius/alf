from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, read from environment variables or a .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "alf"
    api_prefix: str = "/api"
    database_url: str = "sqlite+aiosqlite:///./alf.db"
    frontend_dir: str | None = None
    cors_origins: str = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000"

    # Authentication. In production set DEV_MODE=false and configure Supabase.
    dev_mode: bool = True
    dev_user_id: str = "dev-user"
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_jwt_secret: str | None = None

    # Cloudflare Worker / Durable Object realtime hub. Leave empty for the
    # legacy in-memory WebSocket fallback.
    realtime_url: str | None = None
    internal_token: str | None = None

    activity_code_length: int = 6

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
