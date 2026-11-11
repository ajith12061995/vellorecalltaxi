#!/usr/bin/env bash
# Store the Meta System User token (WhatsApp) in Secret Manager as WA_TOKEN. Hidden input; the token is never printed.
# Run in Cloud Shell:  bash tools/wa-token.sh   → paste the token (Ctrl+V) → Enter.
# - Asks up to 3 times INSIDE the script, so a second paste never lands on the command line.
# - Checks the shape (EAA… letters/digits) and asks Meta whether the token works BEFORE saving.
#   Meta's reply is shown with any token masked.
# - Older versions are disabled (not deleted).
set -uo pipefail
P=vellore-taxi23
WABA=29068467292795781
mask(){ sed -E 's/EAA[A-Za-z0-9]{10,}/[token]/g'; }
for try in 1 2 3; do
  read -rsp "Token (paste with Ctrl+V, then Enter) [try $try/3]: " v; echo
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  if ! [[ "$v" =~ ^EAA[A-Za-z0-9]{100,}$ ]]; then echo "  Not a Meta token (length ${#v}). Paste again."; continue; fi
  me=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $v" "https://graph.facebook.com/v21.0/me?fields=id,name")
  if [[ "${me##*$'\n'}" != "200" ]]; then echo "  Meta refused this token:"; printf '%s\n' "${me%$'\n'*}" | mask; continue; fi
  echo "  Meta accepted the token ($(printf '%s' "${me%$'\n'*}" | mask))."
  wa=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $v" "https://graph.facebook.com/v21.0/$WABA/phone_numbers?fields=display_phone_number")
  if [[ "${wa##*$'\n'}" == "200" ]]; then echo "  WhatsApp account reachable: $(printf '%s' "${wa%$'\n'*}" | mask)"
  else echo "  WARNING: token works but cannot read WhatsApp account $WABA:"; printf '%s\n' "${wa%$'\n'*}" | mask; fi
  if gcloud secrets describe WA_TOKEN --project "$P" >/dev/null 2>&1; then
    nv=$(printf '%s' "$v" | gcloud secrets versions add WA_TOKEN --project "$P" --data-file=- --format='value(name)'); nv=${nv##*/}
  else
    printf '%s' "$v" | gcloud secrets create WA_TOKEN --project "$P" --replication-policy=automatic --data-file=- >/dev/null; nv=1
  fi
  n=${#v}; unset v
  for old in $(gcloud secrets versions list WA_TOKEN --project "$P" --filter='state=ENABLED' --format='value(name)'); do
    o=${old##*/}; [[ "$o" == "$nv" ]] || gcloud secrets versions disable "$o" --secret WA_TOKEN --project "$P" --quiet >/dev/null
  done
  echo "WA_TOKEN saved (version $nv, length $n). Older versions disabled."
  exit 0
done
unset v; echo "Nothing saved after 3 tries."; exit 1
