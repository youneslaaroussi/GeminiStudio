"""Entry point for running the asset service."""

import logging
import uvicorn

from .config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


def main():
    """Run the asset service."""
    settings = get_settings()

    logger.info(f"Starting asset service on {settings.app_host}:{settings.app_port}")

    uvicorn.run(
        "asset_service.api.app:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    main()
