#!/usr/bin/env bash
# Vellore Taxi — e-mail alerts when the server has a problem (Cloud Monitoring, free tier).
# Run in Google Cloud Shell signed in as the project owner:
#   cd ~/vellorecalltaxi && git pull && bash tools/cloudshell-alerts.sh
# What it sets up (safe to run again; it never deletes anything):
#   1. an e-mail notification channel to the signed-in Google account
#   2. "VCT server error": any Cloud Function error / crash, or "no backup made" → e-mail (at most one per 30 min)
#   3. a test entry, so an e-mail arrives within ~5 minutes and proves the alert works
set -euo pipefail
trap 'echo; echo "STOPPED at line $LINENO. Send Claude a screenshot."' ERR
PROJECT="${1:-vellore-taxi23}"
say(){ printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
gcloud config set project "$PROJECT" >/dev/null
EMAIL="$(gcloud config get-value account 2>/dev/null)"
[ -n "$EMAIL" ] || { echo "Not signed in"; exit 1; }
say "Project: $PROJECT · alerts go to: $EMAIL"

say "1/4 Turn on Monitoring + Logging"
gcloud services enable monitoring.googleapis.com logging.googleapis.com >/dev/null

say "2/4 E-mail channel"
CH="$(gcloud beta monitoring channels list --filter="type=\"email\" AND labels.email_address=\"$EMAIL\"" --format='value(name)' --quiet | head -1)"
if [ -z "$CH" ]; then
  CH="$(gcloud beta monitoring channels create --display-name="VCT owner e-mail" --type=email \
        --channel-labels=email_address="$EMAIL" --format='value(name)' --quiet)"
fi
echo "channel: $CH"

say "3/4 Alert policy: VCT server error"
FILTER="((resource.type=\"cloud_run_revision\" OR resource.type=\"cloud_function\") AND severity>=ERROR) OR jsonPayload.message:\"no backup made\" OR logName=\"projects/$PROJECT/logs/vct-alert-test\""
cat > /tmp/vct-alert.json <<JSON
{
  "displayName": "VCT server error",
  "documentation": { "content": "Vellore Taxi: a server function failed or the nightly backup did not run. Open Google Cloud → Logging → Logs Explorer (severity Error) to see what happened, or send Claude a screenshot.", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [ { "displayName": "Function error or backup problem",
                    "conditionMatchedLog": { "filter": $(printf '%s' "$FILTER" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))') } } ],
  "alertStrategy": { "notificationRateLimit": { "period": "1800s" }, "autoClose": "86400s" },
  "notificationChannels": [ "$CH" ],
  "enabled": true
}
JSON
OLD="$(gcloud alpha monitoring policies list --filter='displayName="VCT server error"' --format='value(name)' --quiet | head -1)"
if [ -n "$OLD" ]; then
  gcloud alpha monitoring policies update "$OLD" --policy-from-file=/tmp/vct-alert.json --quiet >/dev/null
  echo "updated: $OLD"
else
  gcloud alpha monitoring policies create --policy-from-file=/tmp/vct-alert.json --quiet >/dev/null
  echo "created"
fi

say "4/4 Test: writing one test error (an e-mail should arrive in about 5 minutes)"
sleep 20
gcloud logging write vct-alert-test "VCT alert test — if you got this e-mail, server alerts work." --severity=ERROR >/dev/null
printf '\n\033[1;32mALERTS DONE.\033[0m Check %s (also Spam) for a mail from Google Cloud Alerting in ~5 minutes.\n' "$EMAIL"
