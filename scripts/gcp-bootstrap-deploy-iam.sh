#!/usr/bin/env bash
# One-time IAM + Artifact Registry setup for GitHub Actions Cloud Run deploy.
#
# Run as GCP project Owner (Cloud Shell or local gcloud):
#   export GCP_PROJECT_ID=forex-market-ai
#   export GCP_REGION=asia-south1
#   export GITHUB_ACTIONS_SA=github-actions-deployer@forex-market-ai.iam.gserviceaccount.com
#   export GCP_RUN_SERVICE_ACCOUNT=sentinel-run@forex-market-ai.iam.gserviceaccount.com
#   bash scripts/gcp-bootstrap-deploy-iam.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-asia-south1}"
DEPLOYER_SA="${GITHUB_ACTIONS_SA:?Set GITHUB_ACTIONS SA email (github-actions-deployer@...)}"
RUN_SA="${GCP_RUN_SERVICE_ACCOUNT:?Set GCP_RUN_SERVICE_ACCOUNT email}"
AR_REPO="${AR_REPO:-sentinel-backend}"

gcloud config set project "$PROJECT_ID"

echo "=== 1. Enable APIs ==="
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  --project="$PROJECT_ID"

echo "=== 2. Grant GitHub Actions deployer project roles ==="
for role in \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER_SA}" \
    --role="$role" \
    --quiet
  echo "  OK: $role"
done

echo "=== 3. Allow deployer to run as Cloud Run runtime SA ==="
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

echo "=== 4. Create Artifact Registry repo ==="
if gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "  Repo exists: $AR_REPO"
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Sentinel backend containers" \
    --quiet
  echo "  Created: $AR_REPO"
fi

echo "=== 5. Allow public browser access to Cloud Run ==="
BACKEND_SERVICE="${BACKEND_SERVICE:-sentinel-backend-relay}"
if gcloud run services describe "$BACKEND_SERVICE" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud run services add-iam-policy-binding "$BACKEND_SERVICE" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --member="allUsers" \
    --role="roles/run.invoker" \
    --quiet
  echo "  Public invoker OK: $BACKEND_SERVICE"
else
  echo "  Skip (service not deployed yet): $BACKEND_SERVICE — deploy workflow will set this"
fi

echo ""
echo "=== Done ==="
echo "Re-run GitHub Actions backend deploy."
echo "Deployer: ${DEPLOYER_SA}"
echo "Runtime SA: ${RUN_SA}"
echo "Image repo: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
