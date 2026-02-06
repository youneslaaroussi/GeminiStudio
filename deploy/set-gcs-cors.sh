#!/usr/bin/env bash
# Apply CORS configuration to the GCS bucket so the app can fetch preview/media
# URLs directly (e.g. LiveSession video frame extraction, playback).
# Run from repo root: ./deploy/set-gcs-cors.sh [bucket-name]

set -e
BUCKET="${1:-geminivideostudio-storage}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CORS_FILE="$SCRIPT_DIR/gcs-cors.json"

if [[ ! -f "$CORS_FILE" ]]; then
  echo "CORS config not found: $CORS_FILE"
  exit 1
fi

echo "Applying CORS from $CORS_FILE to gs://$BUCKET"
gsutil cors set "$CORS_FILE" "gs://$BUCKET"
echo "Done. Verify with: gsutil cors get gs://$BUCKET"
