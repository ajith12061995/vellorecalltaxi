#!/usr/bin/env bash
# Store the Meta System User token (WhatsApp) in Secret Manager as WA_TOKEN. Hidden input; the token is never printed.
# Run in Cloud Shell:  bash tools/wa-token.sh   → paste the token (Ctrl+V) → Enter.
# Checks the shape (EAA… letters/digits only) so stray text pasted with it is refused. Older versions are disabled (not deleted).
set -euo pipefail
P=vellore-taxi23
read -rsp "Token (paste, then Enter): " v; echo
v="$(printf '%s' "$v" | tr -d '[:space:]')"
if ! [[ "$v" =~ ^EAA[A-Za-z0-9]{100,}$ ]]; then echo "That is not a Meta token (length ${#v}). Nothing saved."; unset v; exit 1; fi
# ask Meta whether it accepts the token BEFORE saving (only the HTTP status is shown, never the reply)
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $v" "https://graph.facebook.com/v21.0/29068467292795781?fields=name")
if [[ "$code" != "200" ]]; then echo "Meta did not accept this token (HTTP $code). Nothing saved. Copy it again from Meta and retry."; unset v; exit 1; fi
echo "Meta accepted the token."
if gcloud secrets describe WA_TOKEN --project "$P" >/dev/null 2>&1; then
  new=$(printf '%s' "$v" | gcloud secrets versions add WA_TOKEN --project "$P" --data-file=- --format='value(name)')
else
  new=$(printf '%s' "$v" | gcloud secrets create WA_TOKEN --project "$P" --replication-policy=automatic --data-file=- >/dev/null && echo 1)
fi
n=${#v}; unset v
nv=${new##*/}
for old in $(gcloud secrets versions list WA_TOKEN --project "$P" --filter='state=ENABLED' --format='value(name)'); do
  o=${old##*/}; [[ "$o" == "$nv" ]] || gcloud secrets versions disable "$o" --secret WA_TOKEN --project "$P" --quiet >/dev/null
done
echo "WA_TOKEN saved (version $nv, length $n). Older versions disabled."
