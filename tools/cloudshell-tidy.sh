#!/usr/bin/env bash
# Vellore Taxi — publish the latest security rules and keep the Cloud Functions build images small.
# Cloud Shell: cd ~/vellorecalltaxi && git pull && bash tools/cloudshell-tidy.sh      (never deletes data)
set -uo pipefail
PROJECT="${1:-vellore-taxi23}"; REGION="${2:-asia-south1}"
echo "== 1/2 Security rules"
npx --yes firebase-tools@13 deploy --only firestore:rules --project "$PROJECT" || { echo "RULES DEPLOY FAILED — send Claude a screenshot"; exit 1; }
echo "== 2/2 Build images: keep the newest, delete older than 1 day (only container images, not your data)"
printf '[{"name":"keep-newest","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":1}},{"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"86400s"}}]' > /tmp/vct-cleanup.json
if gcloud artifacts repositories describe gcf-artifacts --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories set-cleanup-policies gcf-artifacts --project="$PROJECT" --location="$REGION" --policy=/tmp/vct-cleanup.json --no-dry-run \
    && echo "cleanup policy set" || echo "NOTE: cleanup policy not set (not urgent) — send Claude a screenshot"
else echo "NOTE: no gcf-artifacts repository in $REGION (nothing to clean)"; fi
echo "DONE"
