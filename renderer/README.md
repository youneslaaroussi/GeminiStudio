# Gemini Studio Renderer Service

Node-based rendering microservice that drives the Motion Canvas headless pipeline using Puppeteer, BullMQ, and FFmpeg. The service exposes an HTTP API for enqueueing renders, processes jobs asynchronously via Redis, and is designed to run inside Docker with Chrome dependencies pre-installed.

## Features

- BullMQ queue with Redis backing for render job orchestration
- Express HTTP API (`POST /renders`) returning job identifiers
- Structured logging with Pino
- Configurable concurrency and headless Chrome settings via environment variables
- Dockerfile targeting the official Puppeteer base image
- Headless Motion Canvas renderer driven by Puppeteer + FFmpeg bridge
- Segmented rendering with Puppeteer Cluster concurrency
- Basic timeline audio mix for video/audio layers
- Job status endpoint (`GET /jobs/:id`)

## Getting Started

### 1. Requirements

- Node.js 20+
- Redis instance accessible to the service
- PNPM 9 (`corepack enable pnpm`)
- Chrome/Chromium (handled automatically in Docker)

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Create a `.env` file in `renderer/` (optional) or supply environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port for the API |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection string |
| `RENDERER_CONCURRENCY` | `2` | Number of BullMQ workers that can run simultaneously |
| `RENDERER_HEADLESS_CONCURRENCY` | `2` | Max concurrent headless Chrome contexts (segment rendering) |
| `RENDERER_TMP_DIR` | `/tmp/gemini-renderer` | Working directory for intermediate files |
| `LOG_LEVEL` | `info` | Pino log level |
| `GOOGLE_PROJECT_ID` | — | GCP project ID (required for Pub/Sub) |
| `RENDERER_EVENT_TOPIC` | `gemini-render-events` | Pub/Sub topic for render completion/failure events |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to GCP service account JSON (required for Pub/Sub) |

#### Pub/Sub Event Publishing

The renderer publishes `render.completed` and `render.failed` events to Google Cloud Pub/Sub when jobs finish. This allows other services (like the LangGraph agent) to be notified of render status changes.

**Required GCP Permissions:**

The service account must have the `roles/pubsub.publisher` role:

```bash
# Get your service account email
SERVICE_ACCOUNT="your-service-account@your-project.iam.gserviceaccount.com"
PROJECT_ID="your-project-id"

# Grant Pub/Sub Publisher role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/pubsub.publisher"
```

**Create the Pub/Sub topic:**

```bash
gcloud pubsub topics create gemini-render-events
```

If Pub/Sub is not configured or permissions are missing, renders will still complete successfully but events won't be published (errors will be logged).

### 4. Run in development

```bash
cd renderer
pnpm dev
```

This starts the HTTP API with hot reload and an in-process worker. An example request:

```bash
curl -X POST http://localhost:4000/renders \
  -H 'Content-Type: application/json' \
  -d '{
    "project": {
      "name": "demo",
      "resolution": { "width": 1920, "height": 1080 },
      "fps": 30,
      "layers": [],
      "renderScale": 1,
      "background": "#000000"
    },
    "variables": {
      "duration": 5
    },
    "output": {
      "format": "mp4",
      "fps": 30,
      "size": { "width": 1920, "height": 1080 },
      "destination": "/tmp/demo.mp4",
      "range": [0, 5],
      "quality": "web",
      "includeAudio": true
    },
    "options": {
      "segmentDuration": 8
    }
  }'
```

Set `"includeAudio": false` in `output` to skip timeline audio mixing. Control segmentation with either `"segmentDuration"` (seconds) or `"segments"` in the `options` payload.

Check job status:

```bash
curl http://localhost:4000/jobs/<jobId>
```

### 5. Build

```bash
pnpm --filter @gemini-studio/types build
pnpm --filter @gemini-studio/scene run build
pnpm --filter @gemini-studio/renderer run build:headless
pnpm --filter @gemini-studio/renderer build
```

### 6. Docker

```bash
docker build -t gemini-renderer ./renderer
docker run --rm -p 4000:4000 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  gemini-renderer
```

Mount an output volume and configure credentials as required for asset fetching.

## Project Structure

```
renderer/
├── src/
│   ├── config.ts            # Environment + defaults
│   ├── index.ts             # Entry point (API + worker bootstrap)
│   ├── jobs/render-job.ts   # Zod schema for render job payloads
│   ├── logger.ts            # Pino logger
│   ├── queue.ts             # BullMQ queue/scheduler/worker wiring
│   ├── server.ts            # Express API
│   ├── services/
│   │   └── render-runner.ts # Orchestrates segmented rendering, Puppeteer, FFmpeg
│   └── worker.ts            # Worker bootstrap
├── headless/                # Headless Motion Canvas bundle
│   ├── index.html
│   └── src/
│       ├── ffmpeg-exporter-client.ts
│       ├── main.ts
│       └── socket.ts
├── Dockerfile
├── package.json
└── tsconfig*.json
```

### Headless Bundle

The headless renderer expects the Motion Canvas project output (`scene/dist/src/project.js`). Build both the scene and the headless bundle before starting workers:

```bash
pnpm --filter @gemini-studio/scene run build
pnpm --filter @gemini-studio/renderer run build:headless
```

## Next Steps

1. Enhance audio pipeline (per-clip fades, waveform overlays, advanced mixing options).
2. Add asset serving (local filesystem volumes, signed URL fetchers) and secure token exchange between Puppeteer and the node service.
3. Extend shared `@gemini-studio/types` to match the full editor schema, then update the Next.js app to consume the shared package.
4. Add automated tests (unit + integration) that render a small fixture timeline in CI.
5. Improve observability (structured metrics, tracing, richer logs).
