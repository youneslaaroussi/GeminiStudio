from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the LangGraph server."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    google_project_id: str = Field(..., alias="GOOGLE_PROJECT_ID")
    # Single key (backward compat). Ignored when GEMINI_API_KEYS is set.
    google_api_key: str | None = Field(default=None, alias="GOOGLE_API_KEY")
    # Comma-separated list of Gemini API keys; rotated on 429 quota errors.
    gemini_api_keys: str | None = Field(default=None, alias="GEMINI_API_KEYS")
    gemini_model: str = Field(default="gemini-3-pro-preview", alias="GEMINI_MODEL")
    # Comma-separated model IDs (priority order); fallback to gemini_model when unset.
    gemini_chat_model_ids: str | None = Field(default=None, alias="GEMINI_CHAT_MODEL_IDS")
    # Smaller model for generating short status messages (Thinking…, Calling X…). Default gemini-2.5-flash; set empty to use static messages.
    gemini_status_model: str | None = Field(default="gemini-2.5-flash", alias="GEMINI_STATUS_MODEL")
    gemini_status_model_ids: str | None = Field(default=None, alias="GEMINI_STATUS_MODEL_IDS")
    # Smaller model for auto-generating project title from first message.
    gemini_title_model: str = Field(default="gemini-2.0-flash", alias="GEMINI_TITLE_MODEL")
    gemini_title_model_ids: str | None = Field(default=None, alias="GEMINI_TITLE_MODEL_IDS")

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

    # System prompt: if set (e.g. SYSTEM_PROMPT env), used as-is; otherwise built from prompts/*.txt
    system_prompt: str | None = Field(default=None, alias="SYSTEM_PROMPT")

    default_project_id: str | None = Field(default=None, alias="DEFAULT_PROJECT_ID")
    firebase_service_account_key: str | None = Field(
        default=None, alias="FIREBASE_SERVICE_ACCOUNT_KEY"
    )
    default_phone_region: str | None = Field(default="US", alias="DEFAULT_PHONE_REGION")

    # Realtime Database URL for branch sync (defaults to https://<GOOGLE_PROJECT_ID>-default-rtdb.firebaseio.com)
    firebase_database_url: str | None = Field(default=None, alias="FIREBASE_DATABASE_URL")

    telegram_bot_token: str | None = Field(default=None, alias="TELEGRAM_BOT_TOKEN")
    telegram_webhook_secret: str | None = Field(
        default=None, alias="TELEGRAM_WEBHOOK_SECRET"
    )
    telegram_api_base_url: str | None = Field(
        default=None, alias="TELEGRAM_API_BASE_URL"
    )

    # Public app URL for converting relative URLs to absolute (e.g., for Telegram media)
    public_app_url: str | None = Field(default=None, alias="PUBLIC_APP_URL")

    # Asset service
    asset_service_url: str | None = Field(
        default="http://localhost:8081", alias="ASSET_SERVICE_URL"
    )
    asset_service_shared_secret: str = Field(default="", alias="ASSET_SERVICE_SHARED_SECRET")

    # Video effects service (segmentation, etc.)
    video_effects_service_url: str | None = Field(
        default="http://localhost:8082", alias="VIDEO_EFFECTS_SERVICE_URL"
    )

    # Scene compiler (validates component TSX code)
    scene_compiler_url: str | None = Field(
        default="http://localhost:4001", alias="SCENE_COMPILER_URL"
    )
    scene_compiler_shared_secret: str = Field(default="", alias="SCENE_COMPILER_SHARED_SECRET")

    # Renderer integration
    renderer_base_url: str = Field(default="http://localhost:4000", alias="RENDERER_BASE_URL")
    renderer_shared_secret: str = Field(default="", alias="RENDERER_SHARED_SECRET")
    render_event_topic: str = Field(default="gemini-render-events", alias="RENDER_EVENT_TOPIC")
    render_event_subscription: str = Field(
        default="gemini-render-events-sub",
        alias="RENDER_EVENT_SUBSCRIPTION",
    )

    # Veo video generation
    veo_model: str = Field(default="veo-3.1-generate-preview", alias="VEO_MODEL")
    veo_event_topic: str = Field(default="gemini-veo-events", alias="VEO_EVENT_TOPIC")
    veo_event_subscription: str = Field(
        default="gemini-veo-events-sub",
        alias="VEO_EVENT_SUBSCRIPTION",
    )

    # Pipeline events (for asset processing completion notifications)
    pipeline_event_topic: str = Field(default="gemini-pipeline-events", alias="PIPELINE_EVENT_TOPIC")
    pipeline_event_subscription: str = Field(
        default="gemini-pipeline-events-sub",
        alias="PIPELINE_EVENT_SUBSCRIPTION",
    )

    # Banana image generation
    banana_model: str = Field(default="gemini-3-pro-image-preview", alias="BANANA_MODEL")
    gemini_banana_model_ids: str | None = Field(default=None, alias="GEMINI_BANANA_MODEL_IDS")

    # Lyria music generation (Vertex AI; model lyria-002, predict endpoint)
    # Vertex/Lyria use the GCP service account only (never Firebase). Resolved from GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.
    lyria_model: str = Field(default="lyria-002", alias="LYRIA_MODEL")
    lyria_location: str = Field(default="us-central1", alias="LYRIA_LOCATION")
    google_service_account_key: str | None = Field(default=None, alias="GOOGLE_SERVICE_ACCOUNT_KEY")
    google_application_credentials: str | None = Field(default=None, alias="GOOGLE_APPLICATION_CREDENTIALS")

    # TTS (Text-to-Speech)
    tts_model: str = Field(default="gemini-2.5-flash-preview-tts", alias="TTS_MODEL")

    transcode_enabled: bool = Field(default=True, alias="TRANSCODE_ENABLED")

    # Default model priority: only these three in this order. Anything below should fail (no other defaults).
    _DEFAULT_CHAT_MODEL_IDS = ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"]

    def _parse_model_ids(
        self, ids_env: str | None, single_fallback: str | None, default: str
    ) -> list[str]:
        if ids_env and ids_env.strip():
            out = [s.strip() for s in ids_env.split(",") if s.strip()]
            if out:
                return out
        if single_fallback and single_fallback.strip():
            return [single_fallback.strip()]
        return [default]

    @property
    def chat_model_ids(self) -> list[str]:
        """Chat/model priority: gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-pro. No other defaults."""
        if self.gemini_chat_model_ids and self.gemini_chat_model_ids.strip():
            out = [s.strip() for s in self.gemini_chat_model_ids.split(",") if s.strip()]
            if out:
                return out
        if self.gemini_model and self.gemini_model.strip():
            return [self.gemini_model.strip()]
        return list(self._DEFAULT_CHAT_MODEL_IDS)

    @property
    def title_model_ids(self) -> list[str]:
        return self._parse_model_ids(
            self.gemini_title_model_ids, self.gemini_title_model or None, "gemini-2.0-flash"
        )

    @property
    def status_model_ids(self) -> list[str]:
        if not self.gemini_status_model and not self.gemini_status_model_ids:
            return []
        return self._parse_model_ids(
            self.gemini_status_model_ids, self.gemini_status_model, "gemini-2.5-flash"
        )

    @property
    def banana_model_ids(self) -> list[str]:
        return self._parse_model_ids(
            self.gemini_banana_model_ids, self.banana_model, "gemini-3-pro-image-preview"
        )


@lru_cache
def get_settings() -> Settings:
    """Return memoized settings so multiple imports share a single instance."""

    return Settings()  # type: ignore[arg-type]
