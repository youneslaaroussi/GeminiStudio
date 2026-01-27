# LangGraph Server

This package provides a LangGraph-powered agent service that can run locally via the LangGraph CLI or be deployed to Google Cloud Run. It is configured to use Google Gemini models and persist conversation state to Google Cloud resources.

## Features

- LangGraph chat agent backed by Gemini models (`langchain-google-genai`)
- FastAPI/uvicorn HTTP server with simple `/invoke` and `/threads` endpoints
- LangGraph CLI support via `langgraph.json`
- Checkpoint persistence using Google Cloud Storage buckets by default
- Optional fallback to Cloud SQL Postgres using the official LangGraph Postgres checkpointer
- Dockerfile optimized for Cloud Run deployment
- Modular LangChain tools (time, docs search, weather) with easy extension points

## Built-in tools

The agent binds three starter tools located in `src/langgraph_server/tools/`, each defined in its own module for clarity:

- `get_current_time_utc` – returns the current UTC timestamp so the model can reference exact time
- `search_product_docs` – fuzzy matches a curated LangGraph/GCP snippet set for quick context
- `lookup_weather_snapshot` – returns cached weather summaries for a handful of demo cities

Extend the toolset by adding new modules to the `tools` package and exposing them from `get_registered_tools()` in `tools/__init__.py`. The agent automatically binds every tool returned by that helper.

## Project layout

```
services/langgraph_server/
├── .env.example
├── Dockerfile
├── langgraph.json
├── pyproject.toml
├── README.md
└── src/langgraph_server
    ├── __init__.py
    ├── agent.py
    ├── api.py
    ├── checkpoint.py
    ├── config.py
    ├── main.py
    ├── schemas.py
    └── tools
        ├── __init__.py
        ├── docs_tool.py
        ├── time_tool.py
        └── weather_tool.py
```

## Local development

1. **Create a virtual environment**

   ```bash
   cd services/langgraph_server
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install poetry
   poetry install
   ```

2. **Configure environment variables**

   Copy `.env.example` to `.env` and set the values for your project. At a minimum you need:

   - `GOOGLE_API_KEY` for Gemini access
   - `GOOGLE_CLOUD_STORAGE_BUCKET` for checkpoint persistence (the bucket must exist)

3. **Run the LangGraph dev server**

   ```bash
   poetry run langgraph dev
   ```

   The CLI reads `langgraph.json` and will launch an Agent Server at `http://127.0.0.1:2024`. Open [LangSmith Studio](https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024) and click the **Revisit consent** button if prompted to allow Studio to connect to your local server.

4. **Run the FastAPI server directly (optional)**

   ```bash
   poetry run uvicorn langgraph_server.main:app --reload --port 8080
   ```

## Docker & Cloud Run

1. **Build the image**

   ```bash
   gcloud builds submit --tag gcr.io/$(gcloud config get-value project)/langgraph-server services/langgraph_server
   ```

2. **Deploy to Cloud Run**

   ```bash
   gcloud run deploy langgraph-server \
     --image gcr.io/$(gcloud config get-value project)/langgraph-server \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars GOOGLE_PROJECT_ID=$(gcloud config get-value project),GOOGLE_CLOUD_STORAGE_BUCKET=your-bucket,GEMINI_MODEL=models/gemini-1.5-flash
   ```

   If you prefer private access, remove `--allow-unauthenticated` and configure IAM as needed.

3. **Secrets & credentials**

   - Use [Secret Manager](https://cloud.google.com/secret-manager) to store `GOOGLE_API_KEY` and inject it via `--set-secrets`.
   - Grant the service account permission to access the Cloud Storage bucket (`roles/storage.objectAdmin` minimum).

## Persistence

By default the server stores LangGraph checkpoints in the bucket specified by `GOOGLE_CLOUD_STORAGE_BUCKET`. Each thread’s history is written as JSON and can be audited or purged via standard Cloud Storage tooling.

If you prefer a relational backend, set `CHECKPOINTER_BACKEND=postgres` and provide `DATABASE_URL` pointing at a Cloud SQL instance. The server will automatically switch to the official LangGraph Postgres checkpointer.

## Testing

```
poetry run pytest
```

The starter suite includes basic smoke tests for the API and checkpoint logic.

## LangSmith Studio integration

Set `LANGSMITH_API_KEY` in `.env` to enable Studio traces. Inside Studio you can click **Revisit consent** at any time to review or revoke the connection to your local Agent Server.

## Troubleshooting

- **Gemini errors**: ensure `GOOGLE_API_KEY` has access to the requested model and that the [Generative AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) is enabled.
- **Storage permissions**: the runtime service account needs `storage.objects.{create,get}` on the bucket.
- **LangGraph CLI**: if `langgraph dev` cannot find the graph, confirm the path in `langgraph.json` and that dependencies are installed in the virtual environment.
