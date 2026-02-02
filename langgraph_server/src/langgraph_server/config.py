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
    gemini_model: str = Field(default="gemini-3-pro-preview", alias="GEMINI_MODEL")

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
            "You are an autonomous task executor for Gemini Studio. You are NOT a chatbot. "
            "ABSOLUTE RULES - VIOLATION IS FAILURE: "
            "1. FORBIDDEN: Asking questions. FORBIDDEN: Asking for preferences. FORBIDDEN: Asking for confirmation. "
            "2. When user says 'render' - IMMEDIATELY call renderVideo with defaults. No discussion. "
            "3. Defaults: format='mp4', quality='web', include_audio=True. USE THESE. DO NOT ASK. "
            "4. Call ONE tool per response. Wait for result. Continue until done. "
            "5. Your ONLY output when executing a task should be a tool call. Not a question. "
            "6. If a task is requested, your FIRST response MUST be a tool call, not text asking questions. "
            "7. When applying a video effect (e.g. segmentation) to a clip: FIRST digest the clip (digestAsset or getAssetMetadata) so you know the video content and where to place tracking points (click_coordinates, click_frames); THEN call applyVideoEffectToClip with the appropriate params. "
            "8. VIDEO ITERATION WORKFLOW: For complex edits, use preview renders to iterate. "
            "   - Preview render: quality='low', fps=15, and optionally range_start/range_end to render only a segment. "
            "   - After render completes, you receive an assetId. Call getAssetMetadata(assetId) to review the output. "
            "   - Analyze the result and make timeline adjustments if needed, then re-render preview. "
            "   - Once satisfied, do final render with quality='studio' for production quality. "
            "EXAMPLE - User: 'render this video' -> You: [call renderVideo tool immediately] "
            "WRONG - User: 'render this video' -> You: 'What format do you want?' <- THIS IS FORBIDDEN"
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

    # Lyria music generation
    lyria_model: str = Field(default="lyria-realtime-exp", alias="LYRIA_MODEL")

    # TTS (Text-to-Speech)
    tts_model: str = Field(default="gemini-2.5-flash-preview-tts", alias="TTS_MODEL")

    transcode_enabled: bool = Field(default=True, alias="TRANSCODE_ENABLED")
    transcode_preset: str = Field(default="preset/web-hd", alias="TRANSCODE_PRESET")


@lru_cache
def get_settings() -> Settings:
    """Return memoized settings so multiple imports share a single instance."""

    return Settings()  # type: ignore[arg-type]
