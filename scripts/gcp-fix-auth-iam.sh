#!/usr/bin/env bash
# Fix production login: PERMISSION_DENIED on /api/auth/bootstrap
#
# Run once as GCP Project Owner (Cloud Shell):
#   export GCP_PROJECT_ID=forex-market-ai
#   export GCP_RUN_SERVICE_ACCOUNT=sentinel-run@forex-market-ai.iam.gserviceaccount.com
#   bash scripts/gcp-fix-auth-iam.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
RUN_SA="${GCP_RUN_SERVICE_ACCOUNT:?Set GCP_RUN_SERVICE_ACCOUNT}"

gcloud config set project "$PROJECT_ID"

gcloud services enable firestore.googleapis.com identitytoolkit.googleapis.com --quiet

for role in roles/datastore.user roles/firebaseauth.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${RUN_SA}" \
    --role="$role" \
    --quiet
  echo "OK: ${RUN_SA} → ${role}"
done

echo ""
echo "Done. Retry Google sign-in on production."
