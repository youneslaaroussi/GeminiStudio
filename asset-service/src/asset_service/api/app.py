"""FastAPI application setup."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..config import get_settings
from ..tasks import start_worker, stop_worker, close_task_queue
from ..tasks.worker import signal_shutdown
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
    signal_shutdown()  # Signal all threads to stop
    
    try:
        # Use timeout to prevent hanging during shutdown
        await asyncio.wait_for(stop_worker(), timeout=3.0)
    except asyncio.TimeoutError:
        logger.warning("Worker stop timed out")
    except Exception as e:
        logger.warning(f"Error stopping worker: {e}")
    
    try:
        await asyncio.wait_for(close_task_queue(), timeout=2.0)
    except asyncio.TimeoutError:
        logger.warning("Task queue close timed out")
    except Exception as e:
        logger.warning(f"Error closing task queue: {e}")
    
    logger.info("Asset service shutdown complete")


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
