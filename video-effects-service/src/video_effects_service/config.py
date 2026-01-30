"""Runtime configuration for the video effects service."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the video effects service."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Replicate API
    replicate_api_token: str = Field(..., alias="REPLICATE_API_TOKEN")

    # Asset Service
    asset_service_url: str = Field(default="http://localhost:8081", alias="ASSET_SERVICE_URL")

    # Google Cloud / Firebase
    google_project_id: str = Field(..., alias="GOOGLE_PROJECT_ID")
    firebase_service_account_key: str | None = Field(default=None, alias="FIREBASE_SERVICE_ACCOUNT_KEY")

    # Redis
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    # FastAPI
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8082, alias="APP_PORT")
    debug: bool = Field(default=False, alias="DEBUG")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
