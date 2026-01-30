"""Entry point for running the video effects service."""

import logging
import uvicorn

from .config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


def main():
    """Run the video effects service."""
    settings = get_settings()

    logger.info(f"Starting video effects service on {settings.app_host}:{settings.app_port}")

    uvicorn.run(
        "video_effects_service.api.app:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    main()
