# Asset Service

A standalone service for asset upload, processing, and pipeline management for Gemini Studio.

## Features

- **Asset Upload**: Upload files with automatic metadata extraction using ffprobe
- **GCS Storage**: Store assets in Google Cloud Storage with signed URLs
- **Firestore Metadata**: Track asset metadata in Firestore
- **Modular Pipeline**: Registry-based pipeline with pluggable steps
- **Video Intelligence**: Shot detection, label detection, person detection, face detection
- **Transcription**: Google Cloud Speech-to-Text integration
- **Full-Text Search**: Algolia-powered search across filenames, descriptions, transcripts, and AI analysis

## Pipeline Steps

| Step | ID | Description | Auto-Start | Supported Types |
|------|-----|-------------|------------|-----------------|
| Metadata | `metadata` | Extract file metadata using ffprobe | Yes | All |
| Upload | `cloud-upload` | Upload to GCS and generate signed URL | Yes | All |
| Shot Detection | `shot-detection` | Detect shot changes in video | Yes | Video |
| Label Detection | `label-detection` | Identify objects, activities, etc. | Yes | Video |
| Person Detection | `person-detection` | Detect people with landmarks | Yes | Video |
| Face Detection | `face-detection` | Detect and track faces | Yes | Video |
| Transcription | `transcription` | Speech-to-text transcription | No | Audio, Video |

## Setup

### Prerequisites

#### GCP Resources

The following GCP resources must be created before running the service:

1. **GCS Bucket** for asset storage:
```bash
gcloud storage buckets create gs://YOUR_BUCKET_NAME --project=YOUR_PROJECT_ID
```

2. **Pub/Sub Topic** for pipeline completion events (used by langgraph_server):
```bash
gcloud pubsub topics create gemini-pipeline-events --project=YOUR_PROJECT_ID
gcloud pubsub subscriptions create gemini-pipeline-events-sub \
  --topic=gemini-pipeline-events \
  --project=YOUR_PROJECT_ID
```

3. **Service Account** with the following roles:
   - `roles/storage.objectAdmin` (GCS)
   - `roles/datastore.user` (Firestore)
   - `roles/pubsub.publisher` (Pub/Sub)
   - `roles/speech.client` (Speech-to-Text, if using transcription)

### Local Development

1. Install dependencies:
```bash
cd asset-service
uv sync
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Configure environment variables (see `.env.example`)

4. Run the service:
```bash
uv run python -m asset_service
```

### Docker

```bash
docker build -t asset-service .
docker run -p 8081:8081 --env-file .env asset-service
```

### Docker Compose

```bash
docker-compose up
```

## API Endpoints

### Assets

- `POST /api/assets/{userId}/{projectId}/upload` - Upload a new asset
- `GET /api/assets/{userId}/{projectId}` - List project assets
- `GET /api/assets/{userId}/{projectId}/{assetId}` - Get asset by ID
- `PATCH /api/assets/{userId}/{projectId}/{assetId}` - Update asset
- `DELETE /api/assets/{userId}/{projectId}/{assetId}` - Delete asset

### Pipeline

- `GET /api/pipeline/steps` - List available pipeline steps
- `GET /api/pipeline/{userId}/{projectId}/{assetId}` - Get pipeline state
- `POST /api/pipeline/{userId}/{projectId}/{assetId}/{stepId}` - Run a step
- `POST /api/pipeline/{userId}/{projectId}/{assetId}/auto` - Run auto-start steps

### Search

- `POST /api/search/search` - Search all assets (admin)
- `POST /api/search/{userId}/search` - Search user's assets
- `POST /api/search/{userId}/{projectId}/search` - Search project assets
- `GET /api/search/{userId}/{projectId}/search?q=...` - Search (GET convenience)
- `POST /api/search/{userId}/{projectId}/reindex` - Rebuild search index for project
- `POST /api/search/configure-index` - Configure Algolia index settings (one-time)

### Health

- `GET /health` - Health check

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_PROJECT_ID` | GCP project ID | Yes |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Path to service account JSON | No* |
| `ASSET_GCS_BUCKET` | GCS bucket for assets | Yes |
| `ASSET_SIGNED_URL_TTL_SECONDS` | Signed URL expiration (default: 7 days) | No |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase service account | No* |
| `PIPELINE_EVENT_TOPIC` | Pub/Sub topic for pipeline events (default: gemini-pipeline-events) | No |
| `SPEECH_PROJECT_ID` | Speech-to-Text project ID | No |
| `SPEECH_LOCATION` | Speech-to-Text location (default: global) | No |
| `SPEECH_MODEL` | Speech model (default: chirp_3) | No |
| `SPEECH_LANGUAGE_CODES` | Comma-separated language codes | No |
| `REDIS_URL` | Redis URL for task queue (default: redis://localhost:6379/0) | No |
| `APP_HOST` | Server host (default: 0.0.0.0) | No |
| `APP_PORT` | Server port (default: 8081) | No |
| `DEBUG` | Enable debug mode | No |
| `ALGOLIA_APP_ID` | Algolia Application ID | No** |
| `ALGOLIA_ADMIN_API_KEY` | Algolia Admin API Key | No** |
| `ALGOLIA_SEARCH_API_KEY` | Algolia Search-Only API Key | No** |
| `ALGOLIA_INDEX_PREFIX` | Index name prefix (default: gemini_assets) | No |

*One of `GOOGLE_SERVICE_ACCOUNT_KEY` or `FIREBASE_SERVICE_ACCOUNT_KEY` is required.

**Algolia variables are required only if you want to enable asset search functionality.

## Algolia Search Setup

The asset service supports full-text search across asset metadata using Algolia. The service automatically indexes assets with rich content from the pipeline.

### What Gets Indexed

| Field | Source | Description |
|-------|--------|-------------|
| `name`, `fileName` | Asset document | Original filename |
| `type`, `mimeType` | Asset document | Asset type filters |
| `description` | Asset document | AI-generated short description |
| `geminiAnalysis` | Pipeline state | Full Gemini analysis text |
| `transcript` | Pipeline state | Speech-to-text transcription |
| `labels` | Pipeline state | Detected objects/activities |
| `searchableText` | Combined | All text for full-text search |

### Step 1: Create Algolia Account

1. Sign up at [Algolia](https://www.algolia.com/) (free tier available)
2. Create a new application or use an existing one
3. Go to **Settings → API Keys** and note:
   - **Application ID**
   - **Admin API Key** (keep secret!)
   - **Search-Only API Key** (safe for client-side)

### Step 2: Configure Environment

Add to your `.env` file:

```bash
# Algolia Search
ALGOLIA_APP_ID=your-algolia-app-id
ALGOLIA_ADMIN_API_KEY=your-algolia-admin-api-key
ALGOLIA_SEARCH_API_KEY=your-algolia-search-api-key
ALGOLIA_INDEX_PREFIX=gemini_assets
```

### Step 3: Configure Index (One-Time)

After starting the service, configure the Algolia index settings:

```bash
curl -X POST http://localhost:8081/api/search/configure-index \
  -H "Content-Type: application/json"
```

This sets up:
- Searchable attributes (name, description, transcript, analysis, labels)
- Filterable attributes (userId, projectId, type) for multi-tenant security
- Custom ranking by upload date

### Step 4: Reindex Existing Assets (Optional)

If you have existing assets, reindex them to populate the search index:

```bash
curl -X POST http://localhost:8081/api/search/{userId}/{projectId}/reindex \
  -H "Content-Type: application/json"
```

### Automatic Sync

Once configured, the service automatically:
- Indexes new assets on upload (basic metadata)
- Re-indexes after pipeline completion (with rich content)
- Removes assets from index on deletion

### Using Search

#### Search API

```bash
# Search within a project
curl -X POST http://localhost:8081/api/search/{userId}/{projectId}/search \
  -H "Content-Type: application/json" \
  -d '{"query": "sunset beach", "type": "video", "limit": 10}'

# GET convenience endpoint
curl "http://localhost:8081/api/search/{userId}/{projectId}/search?q=sunset+beach&type=video"
```

#### Response Format

```json
{
  "hits": [
    {
      "id": "asset-123",
      "name": "beach_sunset.mp4",
      "type": "video",
      "description": "A beautiful sunset over the ocean",
      "labels": ["sunset", "beach", "ocean", "sky"],
      "highlights": {
        "description": "A beautiful <mark>sunset</mark> over the ocean"
      }
    }
  ],
  "total": 15,
  "query": "sunset beach",
  "processingTimeMs": 12
}
```

#### LangGraph Agent Tool

The `searchAssets` tool is available to the LangGraph agent:

```
User: "Find me videos with people talking"
Agent: [calls searchAssets with query="people talking" type="video"]
```

## Integration

### Telegram (via langgraph_server)

The langgraph_server is configured to forward file uploads to this service. Set `ASSET_SERVICE_URL` in the langgraph_server environment.

### Next.js App

The Next.js app has two options:

1. **Local Development**: Use the existing `/api/assets` route with local storage
2. **Production**: Use `/api/v2/assets` route which forwards to this service

Set `ASSET_SERVICE_URL` in the Next.js environment to enable the v2 route.

## Migration from Next.js Pipeline

When fully migrating to the asset service, the following can be removed from the Next.js app:

### Files to Remove

```
app/lib/server/pipeline/           # Entire pipeline directory
  ├── types.ts
  ├── registry.ts
  ├── runner.ts
  ├── store.ts
  └── steps/
      ├── metadata.ts
      ├── upload.ts
      ├── shot-detection.ts
      ├── label-detection.ts
      ├── person-detection.ts
      ├── face-detection.ts
      └── transcription.ts

app/lib/server/transcriptions-store.ts
app/lib/server/google-speech.ts
app/lib/server/google-cloud.ts      # If only used by pipeline
app/lib/server/gcs-signed-url.ts    # If only used by pipeline

app/api/assets/[assetId]/pipeline/  # Pipeline API routes
app/api/assets/pipeline/
```

### Dependencies to Remove from package.json

```json
{
  "dependencies": {
    "@google-cloud/video-intelligence": "...",  // If not used elsewhere
    "music-metadata": "..."                      // Replaced by ffprobe
  }
}
```

### Keep These Files

- `app/api/assets/route.ts` - Keep for local development or update to use service
- `app/lib/server/asset-storage.ts` - Keep for local development

## Adding New Pipeline Steps

1. Create a new file in `src/asset_service/pipeline/steps/`
2. Use the `@register_step` decorator:

```python
from ..registry import register_step
from ..types import AssetType, PipelineContext, PipelineResult, StepStatus

@register_step(
    id="my-step",
    label="My Step",
    description="Description of what this step does",
    auto_start=False,
    supported_types=[AssetType.VIDEO],
)
async def my_step(context: PipelineContext) -> PipelineResult:
    # Your step logic here
    return PipelineResult(
        status=StepStatus.SUCCEEDED,
        metadata={"key": "value"},
    )
```

3. Import the module in `pipeline/steps/__init__.py`

## Architecture

```
asset-service/
├── src/asset_service/
│   ├── api/                 # FastAPI application
│   │   ├── app.py
│   │   └── routes/
│   │       ├── assets.py
│   │       ├── pipeline.py
│   │       └── search.py    # Algolia search endpoints
│   ├── config.py           # Settings
│   ├── metadata/
│   │   └── ffprobe.py      # ffprobe metadata extraction
│   ├── pipeline/
│   │   ├── types.py        # Type definitions
│   │   ├── registry.py     # Step registry and runner
│   │   ├── store.py        # Firestore pipeline state
│   │   └── steps/          # Individual pipeline steps
│   ├── search/              # Algolia search integration
│   │   ├── __init__.py
│   │   └── algolia.py      # Indexing and search operations
│   ├── storage/
│   │   ├── gcs.py          # GCS operations
│   │   └── firestore.py    # Firestore operations
│   └── transcription/
│       ├── speech.py       # Speech-to-Text config
│       └── store.py        # Transcription job storage
├── Dockerfile
├── docker-compose.yml
└── pyproject.toml
```
