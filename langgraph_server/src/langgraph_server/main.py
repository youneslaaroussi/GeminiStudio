from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings
from .render_events import RenderEventSubscriber

logger = logging.getLogger(__name__)

settings = get_settings()
render_event_subscriber = RenderEventSubscriber(settings)


def create_app() -> FastAPI:
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
    await render_event_subscriber.start()


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("LangGraph Server shutting down")
    await render_event_subscriber.stop()
