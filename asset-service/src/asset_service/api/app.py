"""FastAPI application setup."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..config import get_settings
from ..tasks import start_worker, stop_worker, close_task_queue
from .routes import assets, pipeline

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Import pipeline steps to register them
    from ..pipeline import steps  # noqa: F401

    logger.info("Asset service starting...")

    # Start background worker
    try:
        await start_worker()
        logger.info("Pipeline worker started")
    except Exception as e:
        logger.warning(f"Failed to start pipeline worker (Redis may not be available): {e}")

    yield

    # Stop worker and close connections
    logger.info("Asset service shutting down...")
    try:
        await stop_worker()
        await close_task_queue()
    except Exception as e:
        logger.warning(f"Error during shutdown: {e}")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Asset Service",
        description="Asset processing and pipeline service for GeminiStudio",
        version="1.0.0",
        lifespan=lifespan,
        debug=settings.debug,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
    app.include_router(pipeline.router, prefix="/api/pipeline", tags=["pipeline"])

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy"}

    return app


app = create_app()
