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
            "You are Gemini Studio's assistant. Provide concise, factual answers and note when you need "
            "additional context or user confirmation."
        ),
        alias="SYSTEM_PROMPT",
    )


@lru_cache
def get_settings() -> Settings:
    """Return memoized settings so multiple imports share a single instance."""

    return Settings()  # type: ignore[arg-type]
