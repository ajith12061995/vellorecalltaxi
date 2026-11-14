#!/usr/bin/env bash
# Vellore Taxi — deploy security rules and Cloud Functions from Google Cloud Shell (no computer needed).
# Open https://shell.cloud.google.com signed in as the Firebase project owner, then:
#   git clone https://github.com/ajith12061995/vellorecalltaxi.git && cd vellorecalltaxi && bash tools/cloudshell-deploy.sh
# Safe to run again. It never deletes data. Nothing changes in the apps until the owner turns on the switches
# in Office → Settings → Server & monitoring.
set -euo pipefail
trap 'echo; echo "STOPPED at line $LINENO. Nothing after this point ran. Send Claude a screenshot."' ERR
PROJECT="${1:-vellore-taxi23}"
say(){ printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
say "Project: $PROJECT"
gcloud config set project "$PROJECT" >/dev/null

say "1/6 Firestore database location"
LOC=$(gcloud firestore databases describe --database='(default)' --format='value(locationId)')
case "$LOC" in nam5) REGION=us-central1 ;; eur3) REGION=europe-west1 ;; *) REGION="$LOC" ;; esac
echo "database: $LOC  → functions region: $REGION"

say "2/6 Backup bucket (kept 30 days)"
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
BUCKET="${PROJECT}-backups"
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
  printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > /tmp/vct-life.json
  gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=/tmp/vct-life.json
fi
gcloud beta services identity create --service=firestore.googleapis.com --project="$PROJECT" >/dev/null 2>&1 || true
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:service-${NUM}@gcp-sa-firestore.iam.gserviceaccount.com" --role=roles/storage.admin >/dev/null
# Cloud Functions (2nd gen) run as the default compute service account; it appears once the Compute API is on
gcloud services enable cloudbilling.googleapis.com compute.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com
SA="${NUM}-compute@developer.gserviceaccount.com"
for i in $(seq 1 18); do gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 && break; echo "waiting for $SA ($i/18)…"; sleep 10; done
# new projects: Cloud Build runs as this account and needs the builder role, or every function build fails
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/cloudbuild.builds.builder --condition=None >/dev/null || true
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/datastore.importExportAdmin --condition=None >/dev/null \
  || echo "NOTE: backup permission not set yet — run this script again in 5 minutes (nothing else is affected)"
echo "bucket gs://$BUCKET ready"

say "3/6 Settings for the functions"
printf 'FN_REGION=%s\nBACKUP_BUCKET=%s\n' "$REGION" "$BUCKET" > "functions/.env.$PROJECT"
cat "functions/.env.$PROJECT"

say "4/6 Install + tests (deploy stops if any test fails)"
echo "node $(node --version)"
(cd functions && npm install --no-audit --no-fund --loglevel=error) || { echo "npm install FAILED — nothing deployed"; exit 1; }
if (cd functions && node --test --test-reporter=tap test/*.test.js > /tmp/vct-fn-test.log 2>&1); then
  echo "functions logic tests: $(grep -E '^# pass' /tmp/vct-fn-test.log) $(grep -E '^# fail' /tmp/vct-fn-test.log)"
else tail -30 /tmp/vct-fn-test.log; echo "TESTS FAILED — nothing deployed"; exit 1; fi
for f in tests/unit/*.test.js; do out=$(node "$f" 2>&1) || { echo "$out" | tail -15; echo "TESTS FAILED — nothing deployed"; exit 1; }; echo "$out" | tail -1; done

say "5/6 Sign in to Firebase (open the link, choose the owner account, paste the code back)"
npx --yes firebase-tools@13 login --no-localhost
npx --yes firebase-tools@13 use "$PROJECT"

say "6/6 Deploy security rules + functions"
echo "If it asks to DELETE anything → answer N.  If it asks about a cleanup policy for images → press Enter (default)."
# WhatsApp / Razorpay functions need their secrets in Secret Manager (tools/cloudshell-whatsapp.sh, tools/cloudshell-razorpay.sh);
# each group is deployed only when all its secrets exist, so a missing secret never breaks the rest of the deploy.
has() { for n in "$@"; do gcloud secrets describe "$n" >/dev/null 2>&1 || return 1; done; }
FNS="functions:onBookingDone,functions:housekeeping,functions:weatherTick,functions:onBookingCreated,functions:onBookingCust,functions:onEnquiry,functions:deleteMyAccount,functions:purgeDriver,functions:verifyPin,functions:dailyBackup"
if has WA_TOKEN WA_APP_SECRET WA_VERIFY_TOKEN; then FNS="$FNS,functions:waBooking,functions:waDriverWelcome,functions:waOwnerRequest,functions:waReply,functions:waWebhook"; else echo "(WhatsApp secrets not set yet — WhatsApp functions skipped)"; fi
if has RZP_KEY_ID RZP_KEY_SECRET RZP_WEBHOOK_SECRET; then FNS="$FNS,functions:rzpOrder,functions:rzpVerify,functions:rzpWebhook"; else echo "(Razorpay secrets not set yet — Razorpay functions skipped)"; fi
npx --yes firebase-tools@13 deploy --only "firestore:rules,$FNS" --project "$PROJECT"
say "DONE. Send Claude a screenshot of the last 15 lines. Do NOT turn on the switches yet."
