#!/usr/bin/env bash
# Vellore Taxi — store the WhatsApp (Meta Cloud API) secrets and deploy the two WhatsApp functions.
# Run in Google Cloud Shell (https://shell.cloud.google.com, signed in as the Firebase project owner):
#   cd ~/vellorecalltaxi && git pull && bash tools/cloudshell-whatsapp.sh
# The token and app secret are typed/pasted ONLY here (hidden input) — never in a chat, never in the code.
# Safe to run again: it only replaces the stored secret values you choose to replace. It never deletes data.
# Nothing is sent to customers until Office → Settings → WhatsApp is switched ON.
set -euo pipefail
trap 'echo; echo "STOPPED at line $LINENO. Nothing after this point ran. Send Claude a screenshot."' ERR
PROJECT="${1:-vellore-taxi23}"
say(){ printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
gcloud config set project "$PROJECT" >/dev/null
gcloud services enable secretmanager.googleapis.com >/dev/null

put(){ # put NAME "explanation" — asks for the value with hidden input and stores a new version
  local name="$1" v
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    read -r -p "$name is already stored. Replace it? (y/N) " a; [[ "$a" =~ ^[Yy]$ ]] || { echo "kept"; return; }
  fi
  echo "$2"
  read -r -s -p "Paste $name and press Enter (nothing will show): " v; echo
  [[ ${#v} -ge 20 ]] || { echo "That looks too short — not saved."; exit 1; }
  if gcloud secrets describe "$name" >/dev/null 2>&1; then printf '%s' "$v" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else printf '%s' "$v" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null; fi
  unset v; echo "$name saved."
}

say "1/4 Meta access token (System User, permanent)"
put WA_TOKEN "Business settings → Users → System users → Vellore Taxi API → Generate token (whatsapp_business_messaging + whatsapp_business_management)."
say "2/4 Meta app secret"
put WA_APP_SECRET "developers.facebook.com → Vellore Taxi Messaging → App settings → Basic → App secret → Show."

say "3/4 Webhook verify token (made here at random)"
if ! gcloud secrets describe WA_VERIFY_TOKEN >/dev/null 2>&1; then
  openssl rand -hex 24 | tr -d '\n' | gcloud secrets create WA_VERIFY_TOKEN --replication-policy=automatic --data-file=- >/dev/null
fi

say "4/4 Tests + deploy (stops if any test fails)"
(cd functions && npm install --no-audit --no-fund --loglevel=error)
(cd functions && node --test test/*.test.js > /tmp/vct-wa-test.log 2>&1) || { tail -30 /tmp/vct-wa-test.log; echo "TESTS FAILED — nothing deployed"; exit 1; }
grep -E '^# (pass|fail)' /tmp/vct-wa-test.log
npx --yes firebase-tools@13 login --no-localhost
npx --yes firebase-tools@13 use "$PROJECT"
echo "If it asks to DELETE anything → answer N."
npx --yes firebase-tools@13 deploy --only firestore:rules,functions:waBooking,functions:waWebhook --project "$PROJECT"

REGION=$(grep -E '^FN_REGION=' "functions/.env.$PROJECT" 2>/dev/null | cut -d= -f2); REGION="${REGION:-asia-south1}"
URL=$(gcloud functions describe waWebhook --region="$REGION" --gen2 --format='value(serviceConfig.uri)' 2>/dev/null || true)
say "DONE. In Meta → WhatsApp → Configuration → Webhook, copy these two (do not send them in chat):"
echo "Callback URL : ${URL:-(see Firebase console → Functions → waWebhook)}"
echo "Verify token : $(gcloud secrets versions access latest --secret=WA_VERIFY_TOKEN)"
echo "Then tick the 'messages' webhook field. Send Claude a screenshot of the Meta page (not of this screen)."
