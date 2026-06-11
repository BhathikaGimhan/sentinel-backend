#!/usr/bin/env bash
# One-time IAM + Artifact Registry setup for GitHub Actions Cloud Run deploy.
#
# Run as GCP project Owner (your personal account):
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

gcloud config set project "$PROJECT_ID"

echo "Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"

echo "Granting GitHub Actions deployer roles to ${DEPLOYER_SA}..."
for role in \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/cloudbuild.builds.editor \
  roles/iam.serviceAccountUser \
  roles/serviceusage.serviceUsageAdmin \
  roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER_SA}" \
    --role="$role" \
    --quiet
  echo "  OK: $role"
done

echo "Creating Artifact Registry repo (if missing)..."
if gcloud artifacts repositories describe cloud-run-source-deploy --location="$REGION" >/dev/null 2>&1; then
  echo "  Repo already exists: cloud-run-source-deploy"
else
  gcloud artifacts repositories create cloud-run-source-deploy \
    --repository-format=docker \
    --location="$REGION" \
    --description="Cloud Run source deploy containers" \
    --quiet
  echo "  Created: cloud-run-source-deploy"
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

echo "Granting Cloud Build service account permissions (${CB_SA})..."
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${CB_SA}" \
    --role="$role" \
    --quiet
  echo "  OK: $role → Cloud Build"
done

echo "Allowing Cloud Build to act as Cloud Run runtime SA (${RUN_SA})..."
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

echo ""
echo "Done. Re-run the GitHub Actions backend deploy workflow."
