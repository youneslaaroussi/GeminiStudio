# Asset Service Dockerfile
FROM python:3.12-slim

# Install ffmpeg (includes ffprobe)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install uv for dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files
COPY pyproject.toml .
COPY uv.lock* ./

# Install dependencies
RUN uv sync --frozen --no-cache

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8081/health')" || exit 1

# Run the application
CMD ["uv", "run", "python", "-m", "asset_service"]
