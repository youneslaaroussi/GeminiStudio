# Video Effects Service

Video effects processing microservice for Gemini Studio. Handles AI-powered video effects using external providers (e.g., Replicate).

## Features

- **SAM-2 Video Segmentation**: Interactive object segmentation using Meta's Segment Anything v2
- Background job processing with Redis queue
- Firestore persistence for job state
- Integration with asset-service for file storage

## Setup

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) package manager
- Redis (for background job processing)
- Access to asset-service
- Replicate API token

### Local Development

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials

3. Install dependencies:
   ```bash
   uv sync
   ```

4. Run the service:
   ```bash
   uv run python -m video_effects_service
   ```

### Docker

```bash
docker-compose up --build
```

## API Endpoints

### Jobs

- `POST /api/jobs` - Start a new video effect job
- `GET /api/jobs/{jobId}` - Get job status
- `GET /api/jobs?assetId={assetId}` - List jobs for an asset

### Effects

- `GET /api/effects` - List available video effects

### Health

- `GET /health` - Health check

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌───────────────┐
│   Next.js App   │────▶│ video-effects-svc   │────▶│ asset-service │
└─────────────────┘     └─────────────────────┘     └───────────────┘
                               │     │
                               │     │
                        ┌──────┘     └──────┐
                        ▼                   ▼
                  ┌──────────┐        ┌───────────┐
                  │  Redis   │        │ Replicate │
                  │  Queue   │        │    API    │
                  └──────────┘        └───────────┘
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REPLICATE_API_TOKEN` | Replicate API token | Required |
| `ASSET_SERVICE_URL` | Asset service base URL | `http://localhost:8081` |
| `GOOGLE_PROJECT_ID` | Google Cloud project ID | Required |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Path to service account JSON | Optional |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379/0` |
| `APP_HOST` | Server host | `0.0.0.0` |
| `APP_PORT` | Server port | `8082` |
| `DEBUG` | Debug mode | `false` |
