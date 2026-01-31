from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the asset service."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Google Cloud
    google_project_id: str = Field(..., alias="GOOGLE_PROJECT_ID")
    google_service_account_key: str | None = Field(default=None, alias="GOOGLE_SERVICE_ACCOUNT_KEY")

    # GCS Storage
    asset_gcs_bucket: str = Field(..., alias="ASSET_GCS_BUCKET")
    signed_url_ttl_seconds: int = Field(default=60 * 60 * 24 * 7, alias="ASSET_SIGNED_URL_TTL_SECONDS")

    # Firebase
    firebase_service_account_key: str | None = Field(default=None, alias="FIREBASE_SERVICE_ACCOUNT_KEY")

    # Gemini AI
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model_id: str = Field(default="gemini-3-pro-preview", alias="GEMINI_MODEL_ID")

    # Speech-to-Text
    speech_project_id: str | None = Field(default=None, alias="SPEECH_PROJECT_ID")
    speech_location: str = Field(default="global", alias="SPEECH_LOCATION")
    speech_recognizer_id: str = Field(default="_", alias="SPEECH_RECOGNIZER_ID")
    speech_model: str = Field(default="chirp_3", alias="SPEECH_MODEL")
    speech_language_codes: str = Field(default="en-US", alias="SPEECH_LANGUAGE_CODES")
    speech_gcs_bucket: str | None = Field(default=None, alias="SPEECH_GCS_BUCKET")
    speech_service_account_key: str | None = Field(default=None, alias="SPEECH_SERVICE_ACCOUNT_KEY")

    # Transcoder API
    transcoder_project_id: str | None = Field(default=None, alias="TRANSCODER_PROJECT_ID")
    transcoder_location: str = Field(default="us-central1", alias="TRANSCODER_LOCATION")
    transcoder_service_account_key: str | None = Field(default=None, alias="TRANSCODER_SERVICE_ACCOUNT_KEY")
    
    # Default transcode preset (used when transcode is enabled without specific options)
    default_transcode_preset: str = Field(default="preset/web-hd", alias="DEFAULT_TRANSCODE_PRESET")

    # CloudConvert API (for image/document conversion)
    cloudconvert_api_key: str | None = Field(default=None, alias="CLOUDCONVERT_API_KEY")
    cloudconvert_sandbox: bool = Field(default=False, alias="CLOUDCONVERT_SANDBOX")

    # Redis
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    # FastAPI
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8081, alias="APP_PORT")
    debug: bool = Field(default=False, alias="DEBUG")

    # Pub/Sub for pipeline events
    pipeline_event_topic: str = Field(default="gemini-pipeline-events", alias="PIPELINE_EVENT_TOPIC")

    # HMAC authentication (shared secret with Next.js app and LangGraph server)
    # If not set, HMAC verification is disabled (dev mode)
    shared_secret: str | None = Field(default=None, alias="SHARED_SECRET")

    @property
    def speech_language_codes_list(self) -> list[str]:
        return [code.strip() for code in self.speech_language_codes.split(",") if code.strip()]

    @property
    def effective_speech_project_id(self) -> str:
        return self.speech_project_id or self.google_project_id

    @property
    def effective_speech_bucket(self) -> str:
        return self.speech_gcs_bucket or self.asset_gcs_bucket

    @property
    def effective_transcoder_project_id(self) -> str:
        return self.transcoder_project_id or self.google_project_id


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
