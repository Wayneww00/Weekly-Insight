#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-e231c77e-076f-46db-acb}"
REGION="${REGION:-asia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-weekly-insight}"
BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-weekly-insight-assets}"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com

if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi

gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --cors-file=config/gcs-cors.json

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "GCS_BUCKET=${BUCKET_NAME},PREVIEW_DPI=300,CONVERSION_TIMEOUT_MS=900000" \
  --memory 4Gi \
  --cpu 2 \
  --timeout 900 \
  --concurrency 1 \
  --max-instances 1 \
  --no-cpu-throttling
