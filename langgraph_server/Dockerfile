# syntax=docker/dockerfile:1.7

ARG PYTHON_VERSION=3.11

FROM python:${PYTHON_VERSION}-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.8.3 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install --no-install-recommends -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Rust (required for automerge package)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

RUN pip install "poetry==$POETRY_VERSION"

# Copy to match dev structure: /app/langgraph_server/src/... and /app/shared/...
COPY langgraph_server/pyproject.toml langgraph_server/poetry.lock* langgraph_server/README.md ./langgraph_server/
COPY langgraph_server/src ./langgraph_server/src
COPY shared ./shared

WORKDIR /app/langgraph_server

RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi --only main

ENV PYTHONPATH=/app/langgraph_server/src:$PYTHONPATH

EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "langgraph_server.main:app", "--host", "0.0.0.0", "--port", "8080"]
