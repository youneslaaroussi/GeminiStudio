#!/usr/bin/env bash
# Clear render queue, Pub/Sub backlog, and remind to restart LangGraph.
# Run from repo root: ./scripts/clear-queues.sh
# Optional: ./scripts/clear-queues.sh --obliterate  (removes all render jobs including completed/failed)

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OBLITERATE=""
if [[ "$1" == "--obliterate" ]]; then
  OBLITERATE="--obliterate"
  echo "Will obliterate render queue (all jobs)."
fi

echo "1/3 Draining render queue..."
if [[ -f renderer/.env ]]; then
  set -a
  source renderer/.env
  set +a
fi
(cd renderer && pnpm run drain-queue -- $OBLITERATE) || { echo "Render queue drain failed (Redis up? REDIS_URL set?). Continuing."; }

echo "2/3 Seeking Pub/Sub subscriptions (drop backlog)..."
PROJECT_ID="${GOOGLE_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "  Skip: set GOOGLE_PROJECT_ID or gcloud config project."
else
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for sub in gemini-render-events-sub gemini-pipeline-events-sub gemini-veo-events-sub; do
    if gcloud pubsub subscriptions describe "$sub" --project="$PROJECT_ID" &>/dev/null; then
      gcloud pubsub subscriptions seek "$sub" --time="$NOW" --project="$PROJECT_ID" && echo "  Seek $sub"
    else
      echo "  Skip $sub (not found)"
    fi
  done
fi

echo "3/3 Restart LangGraph to clear in-memory state (teleport tasks, dedup, pipeline subs)."
echo "   Local: stop and start your uvicorn process."
echo "   Deploy: docker compose -f deploy/docker-compose.yml restart langgraph-server"
echo "Done."
