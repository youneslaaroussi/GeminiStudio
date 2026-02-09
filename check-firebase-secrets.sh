#!/bin/bash
# Script to verify all required Firebase secrets exist in GCP Secret Manager

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-geminivideostudio}"

echo "Checking Firebase secrets in project: $PROJECT_ID"
echo "=================================================="
echo ""

REQUIRED_SECRETS=(
  "firebase-api-key"
  "firebase-auth-domain"
  "firebase-project-id"
  "firebase-storage-bucket"
  "firebase-messaging-sender-id"
  "firebase-app-id"
  "firebase-database-url"
)

MISSING_SECRETS=()
EXISTING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "✓ $secret - EXISTS"
    EXISTING_SECRETS+=("$secret")
  else
    echo "✗ $secret - MISSING"
    MISSING_SECRETS+=("$secret")
  fi
done

echo ""
echo "=================================================="
echo "Summary:"
echo "  Found: ${#EXISTING_SECRETS[@]}/${#REQUIRED_SECRETS[@]} secrets"
echo ""

if [ ${#MISSING_SECRETS[@]} -eq 0 ]; then
  echo "✓ All required Firebase secrets are present!"
  exit 0
else
  echo "✗ Missing secrets:"
  for secret in "${MISSING_SECRETS[@]}"; do
    echo "  - $secret"
  done
  echo ""
  echo "To create missing secrets, run:"
  echo "  gcloud secrets create <secret-name> --project=$PROJECT_ID --data-file=-"
  exit 1
fi
