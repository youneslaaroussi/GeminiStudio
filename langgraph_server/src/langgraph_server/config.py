from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the LangGraph server."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    google_project_id: str = Field(..., alias="GOOGLE_PROJECT_ID")
    google_api_key: str = Field(..., alias="GOOGLE_API_KEY")
    gemini_model: str = Field(default="gemini-2.5-pro", alias="GEMINI_MODEL")

    langsmith_api_key: str | None = Field(default=None, alias="LANGSMITH_API_KEY")
    langsmith_endpoint: str = Field(default="https://api.smith.langchain.com", alias="LANGSMITH_ENDPOINT")
    langsmith_tracing: bool = Field(default=True, alias="LANGSMITH_TRACING")

    google_cloud_storage_bucket: str = Field(..., alias="GOOGLE_CLOUD_STORAGE_BUCKET")

    # Optional fallback to Cloud SQL Postgres
    checkpointer_backend: Literal["gcs", "postgres", "memory"] = Field(
        default="gcs", alias="CHECKPOINTER_BACKEND"
    )
    database_url: str | None = Field(default=None, alias="DATABASE_URL")

    # FastAPI configuration
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8080, alias="APP_PORT")
    debug: bool = Field(default=False, alias="DEBUG")

    # Optional default system prompt
    system_prompt: str = Field(
        default=(
            "You are Gemini Studio's cloud assistant. You have access to tools and MUST use them when asked. "
            "CRITICAL: You MUST only call ONE tool at a time. NEVER make multiple tool calls in a single response. "
            "After each tool call, wait for the result before deciding what to do next. "
            "Always use your tools - don't just say you need information, go get it. "
            "The project context and user info are automatically provided to your tools."
        ),
        alias="SYSTEM_PROMPT",
    )

    default_project_id: str | None = Field(default=None, alias="DEFAULT_PROJECT_ID")
    firebase_service_account_key: str | None = Field(
        default=None, alias="FIREBASE_SERVICE_ACCOUNT_KEY"
    )
    default_phone_region: str | None = Field(default="US", alias="DEFAULT_PHONE_REGION")

    telegram_bot_token: str | None = Field(default=None, alias="TELEGRAM_BOT_TOKEN")
    telegram_webhook_secret: str | None = Field(
        default=None, alias="TELEGRAM_WEBHOOK_SECRET"
    )
    telegram_api_base_url: str | None = Field(
        default=None, alias="TELEGRAM_API_BASE_URL"
    )


@lru_cache
def get_settings() -> Settings:
    """Return memoized settings so multiple imports share a single instance."""

    return Settings()  # type: ignore[arg-type]
