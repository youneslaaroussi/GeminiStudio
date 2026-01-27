from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="LangGraph Server",
        description="Gemini Studio LangGraph service",
        version="0.1.0",
        debug=settings.debug,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)
    return app


app = create_app()


@app.on_event("startup")
async def startup_event():
    logger.info("LangGraph Server starting up")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("LangGraph Server shutting down")
