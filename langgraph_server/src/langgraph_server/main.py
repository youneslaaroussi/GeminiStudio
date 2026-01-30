from __future__ import annotations

import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import get_settings
from .pipeline_events import PipelineEventSubscriber
from .render_events import RenderEventSubscriber
from .veo_events import VeoEventPoller

# Configure logging for the entire langgraph_server package
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# Set our package to INFO level
logging.getLogger("langgraph_server").setLevel(logging.INFO)

logger = logging.getLogger(__name__)

settings = get_settings()
render_event_subscriber = RenderEventSubscriber(settings)
veo_event_poller = VeoEventPoller(settings)
pipeline_event_subscriber = PipelineEventSubscriber(settings)


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
    await veo_event_poller.start()
    await pipeline_event_subscriber.start()


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("LangGraph Server shutting down")
    await render_event_subscriber.stop()
    await veo_event_poller.stop()
    await pipeline_event_subscriber.stop()
