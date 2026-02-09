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
    signed_url_ttl_seconds: int = Field(default=60 * 60, alias="ASSET_SIGNED_URL_TTL_SECONDS")  # 1 hour for security

    # Firebase
    firebase_service_account_key: str | None = Field(default=None, alias="FIREBASE_SERVICE_ACCOUNT_KEY")

    # Gemini AI
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    # Comma-separated list of Gemini API keys; rotated on 429 quota errors.
    gemini_api_keys: str | None = Field(default=None, alias="GEMINI_API_KEYS")
    gemini_model_id: str = Field(default="gemini-3-pro-preview", alias="GEMINI_MODEL_ID")
    gemini_analysis_model_ids: str | None = Field(default=None, alias="GEMINI_ANALYSIS_MODEL_IDS")
    gemini_description_model: str = Field(default="gemini-2.0-flash", alias="GEMINI_DESCRIPTION_MODEL")
    gemini_description_model_ids: str | None = Field(default=None, alias="GEMINI_DESCRIPTION_MODEL_IDS")

    # Speech-to-Text
    speech_project_id: str | None = Field(default=None, alias="SPEECH_PROJECT_ID")
    speech_location: str = Field(default="global", alias="SPEECH_LOCATION")
    speech_recognizer_id: str = Field(default="_", alias="SPEECH_RECOGNIZER_ID")
    speech_model: str = Field(default="chirp_3", alias="SPEECH_MODEL")
    speech_language_codes: str = Field(default="en-US", alias="SPEECH_LANGUAGE_CODES")
    speech_gcs_bucket: str | None = Field(default=None, alias="SPEECH_GCS_BUCKET")

    # Transcoder API (uses same GCP service account as GOOGLE_SERVICE_ACCOUNT_KEY)
    transcoder_project_id: str | None = Field(default=None, alias="TRANSCODER_PROJECT_ID")
    transcoder_location: str = Field(default="us-central1", alias="TRANSCODER_LOCATION")
    # Target height for transcoding - width auto-calculated to preserve aspect ratio
    # Common values: 720 (HD), 1080 (Full HD), 480 (SD). If None, preserves original dimensions.
    transcode_target_height: int | None = Field(default=None, alias="TRANSCODE_TARGET_HEIGHT")
    
    # CloudConvert API (for image/document conversion)
    cloudconvert_api_key: str | None = Field(default=None, alias="CLOUDCONVERT_API_KEY")
    cloudconvert_sandbox: bool = Field(default=False, alias="CLOUDCONVERT_SANDBOX")

    # Redis
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    # Worker: number of parallel pipeline jobs (default 4 for throughput)
    worker_concurrency: int = Field(default=4, alias="WORKER_CONCURRENCY", ge=1, le=32)

    # FastAPI
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8081, alias="APP_PORT")
    debug: bool = Field(default=False, alias="DEBUG")

    # Pub/Sub for pipeline events
    pipeline_event_topic: str = Field(default="gemini-pipeline-events", alias="PIPELINE_EVENT_TOPIC")

    # HMAC authentication (shared secret with Next.js app and LangGraph server)
    # If not set, HMAC verification is disabled (dev mode)
    shared_secret: str | None = Field(default=None, alias="SHARED_SECRET")

    # Face detection: skip for clips longer than this (seconds) to avoid timeouts
    face_detection_max_duration_seconds: int = Field(default=120, alias="FACE_DETECTION_MAX_DURATION_SECONDS")

    # Algolia Search
    algolia_app_id: str | None = Field(default=None, alias="ALGOLIA_APP_ID")
    algolia_admin_api_key: str | None = Field(default=None, alias="ALGOLIA_ADMIN_API_KEY")
    algolia_search_api_key: str | None = Field(default=None, alias="ALGOLIA_SEARCH_API_KEY")
    algolia_index_prefix: str = Field(default="gemini_assets", alias="ALGOLIA_INDEX_PREFIX")

    @property
    def algolia_enabled(self) -> bool:
        """Check if Algolia is configured."""
        return bool(self.algolia_app_id and self.algolia_admin_api_key)

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

    @staticmethod
    def _parse_model_ids(ids_env: str | None, single_fallback: str, default: str) -> list[str]:
        if ids_env and ids_env.strip():
            out = [s.strip() for s in ids_env.split(",") if s.strip()]
            if out:
                return out
        if single_fallback and single_fallback.strip():
            return [single_fallback.strip()]
        return [default]

    # Default model priority: only these three in this order.
    _DEFAULT_ANALYSIS_MODEL_IDS = ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"]

    @property
    def analysis_model_ids(self) -> list[str]:
        if self.gemini_analysis_model_ids and self.gemini_analysis_model_ids.strip():
            out = [s.strip() for s in self.gemini_analysis_model_ids.split(",") if s.strip()]
            if out:
                return out
        if self.gemini_model_id and self.gemini_model_id.strip():
            return [self.gemini_model_id.strip()]
        return list(self._DEFAULT_ANALYSIS_MODEL_IDS)

    @property
    def description_model_ids(self) -> list[str]:
        return self._parse_model_ids(
            self.gemini_description_model_ids, self.gemini_description_model, "gemini-2.0-flash"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
