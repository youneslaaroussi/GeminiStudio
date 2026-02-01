"""FastAPI application setup."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..config import get_settings
from ..tasks import start_worker, stop_worker, close_task_queue
from ..tasks.worker import signal_shutdown
from .routes import assets, pipeline, search

logger = logging.getLogger(__name__)

# Maximum timestamp drift allowed (5 minutes)
MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000


class HMACAuthMiddleware(BaseHTTPMiddleware):
    """Middleware to verify HMAC signature on all API requests."""

    def __init__(self, app, shared_secret: str | None):
        super().__init__(app)
        self.shared_secret = shared_secret

    async def dispatch(self, request: Request, call_next):
        # Skip auth for health check
        if request.url.path == "/health":
            return await call_next(request)

        # Skip auth if shared secret not configured (dev mode)
        if not self.shared_secret:
            return await call_next(request)

        signature = request.headers.get("x-signature")
        timestamp_str = request.headers.get("x-timestamp")

        if not signature or not timestamp_str:
            return JSONResponse(
                status_code=401,
                content={"error": "Missing authentication headers"},
            )

        # Validate timestamp to prevent replay attacks
        try:
            timestamp = int(timestamp_str)
        except ValueError:
            return JSONResponse(
                status_code=401,
                content={"error": "Invalid timestamp"},
            )

        current_time_ms = int(time.time() * 1000)
        if abs(current_time_ms - timestamp) > MAX_TIMESTAMP_DRIFT_MS:
            return JSONResponse(
                status_code=401,
                content={"error": "Request expired"},
            )

        # For multipart/form-data (file uploads), we can't include the body in signature
        # because the multipart encoding includes dynamic boundaries. Instead, the client
        # computes a hash of the file bytes and signs that hash.
        content_type = request.headers.get("content-type", "")
        is_multipart = content_type.startswith("multipart/form-data")

        if is_multipart:
            # For file uploads, require X-Body-Hash header (hash of file bytes)
            # The signature covers this hash, ensuring file integrity
            body_hash = request.headers.get("x-body-hash")
            if not body_hash:
                return JSONResponse(
                    status_code=401,
                    content={"error": "Missing X-Body-Hash header for file upload"},
                )
            
            # Signature is computed over timestamp + file hash
            # The actual file will be verified against this hash in the route handler
            body_str = body_hash
            
            # Store the expected hash for verification by the route handler
            request.state.expected_file_hash = body_hash
        else:
            # Read request body for signature verification
            body = await request.body()
            try:
                body_str = body.decode("utf-8")
            except UnicodeDecodeError:
                # Fallback for binary content
                body_str = ""

        # Compute expected signature
        payload = f"{timestamp_str}.{body_str}"
        expected = hmac.new(
            self.shared_secret.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()

        # Use timing-safe comparison
        if not hmac.compare_digest(signature, expected):
            logger.warning("Invalid HMAC signature on request to %s", request.url.path)
            return JSONResponse(
                status_code=401,
                content={"error": "Invalid signature"},
            )

        return await call_next(request)


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

    # HMAC authentication middleware
    app.add_middleware(HMACAuthMiddleware, shared_secret=settings.shared_secret)

    # Include routers
    app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
    app.include_router(pipeline.router, prefix="/api/pipeline", tags=["pipeline"])
    app.include_router(search.router, prefix="/api/search", tags=["search"])

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy"}

    return app


app = create_app()
