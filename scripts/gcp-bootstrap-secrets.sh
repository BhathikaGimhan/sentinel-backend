#!/usr/bin/env bash
# One-time GCP Secret Manager setup for Cloud Run deploy.
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
gcloud config set project "$PROJECT_ID"

create_or_update() {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=-
  fi
  echo "Secret OK: $name"
}

create_or_update GEMINI_API_KEY "${GEMINI_API_KEY:?}"
create_or_update CRYPTOCOMPARE_API_KEY "${CRYPTOCOMPARE_API_KEY:?}"
create_or_update BINANCE_API_KEY "${BINANCE_API_KEY:-}"
create_or_update BINANCE_API_SECRET "${BINANCE_API_SECRET:-}"
create_or_update CRON_SECRET "${CRON_SECRET:?}"

SA="${GCP_RUN_SERVICE_ACCOUNT:?Set GCP_RUN_SERVICE_ACCOUNT email}"
for secret in GEMINI_API_KEY CRYPTOCOMPARE_API_KEY BINANCE_API_KEY BINANCE_API_SECRET CRON_SECRET; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" \
  --role="roles/datastore.user" \
  --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" \
  --role="roles/firebaseauth.admin" \
  --quiet

echo "Done."
