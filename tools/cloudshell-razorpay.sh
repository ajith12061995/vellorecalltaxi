#!/usr/bin/env bash
# Razorpay driver-wallet recharge: store the keys in Secret Manager and deploy the 3 Razorpay functions.
# Run in Cloud Shell from the repo folder:  bash tools/cloudshell-razorpay.sh
# - Key Id and Key Secret: paste from the file Razorpay gave you (Ctrl+V). Input is hidden; nothing is printed.
# - Checks the pair with Razorpay (GET /v1/orders?count=1) BEFORE saving.
# - Webhook secret: made here at random and shown ONCE on this screen, to paste into
#   Razorpay Dashboard → Account & Settings → Webhooks → Add (URL printed at the end). Never in chat.
# - Older secret versions are disabled (not deleted). Test keys (rzp_test_) and live keys (rzp_live_) both work.
set -uo pipefail
P=vellore-taxi23
REGION=asia-south1
save(){ # name value
  if gcloud secrets describe "$1" --project "$P" >/dev/null 2>&1; then
    nv=$(printf '%s' "$2" | gcloud secrets versions add "$1" --project "$P" --data-file=- --format='value(name)'); nv=${nv##*/}
  else printf '%s' "$2" | gcloud secrets create "$1" --project "$P" --replication-policy=automatic --data-file=- >/dev/null; nv=1; fi
  for old in $(gcloud secrets versions list "$1" --project "$P" --filter='state=ENABLED' --format='value(name)'); do
    o=${old##*/}; [[ "$o" == "$nv" ]] || gcloud secrets versions disable "$o" --secret "$1" --project "$P" --quiet >/dev/null
  done
  echo "  $1 saved (version $nv)."
}
ok=0
for try in 1 2 3; do
  echo "Paste the Key Id (or the whole line from the Razorpay file — Key Id and Secret together is fine). Typing is hidden."
  read -rsp "Razorpay Key Id [try $try/3]: " in1; echo
  # tolerate quotes, commas, labels, tabs and a pasted pair "rzp_test_…,secret"
  kid=$(printf '%s' "$in1" | grep -oE 'rzp_(test|live)_[A-Za-z0-9]+' | head -1)
  rest=$(printf '%s' "$in1" | sed -E 's/rzp_(test|live)_[A-Za-z0-9]+//' | grep -oE '[A-Za-z0-9]{16,}' | head -1)
  if [[ -z "$kid" ]]; then
    n=${#in1}; echo "  No Razorpay Key Id found in what was pasted (length $n$([[ $n == 0 ]] && echo ' — nothing arrived; use right-click → Paste')). Try again."; continue; fi
  if [[ -n "$rest" ]]; then ksec="$rest"; echo "  Key Secret found in the same line."
  else read -rsp "Razorpay Key Secret: " in2; echo; ksec=$(printf '%s' "$in2" | grep -oE '[A-Za-z0-9]{16,}' | head -1); fi
  unset in1 in2 rest
  if [[ -z "$ksec" ]]; then echo "  No Key Secret found in what was pasted. Try again."; continue; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "$kid:$ksec" "https://api.razorpay.com/v1/orders?count=1")
  if [[ "$code" != "200" ]]; then echo "  Razorpay refused this Key Id + Secret (HTTP $code). Try again."; continue; fi
  echo "  Razorpay accepted the keys (mode: $([[ $kid == rzp_live_* ]] && echo LIVE || echo TEST))."
  save RZP_KEY_ID "$kid"; save RZP_KEY_SECRET "$ksec"; ok=1; break
done
unset ksec
[[ $ok == 1 ]] || { echo "Nothing saved after 3 tries."; exit 1; }
if gcloud secrets describe RZP_WEBHOOK_SECRET --project "$P" >/dev/null 2>&1 && [[ "${NEW_HOOK:-}" != "1" ]]; then
  echo "  RZP_WEBHOOK_SECRET already exists — kept (run with NEW_HOOK=1 to make a new one)."
else
  hs=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
  save RZP_WEBHOOK_SECRET "$hs"
  echo; echo "==== COPY THIS WEBHOOK SECRET into Razorpay (shown only now) ===="; echo "  $hs"; echo "================================================================="
  unset hs
fi
echo; echo "Deploying the Razorpay functions only…"
for i in 1 2 3; do
  npx --yes firebase-tools@13 deploy --only functions:rzpOrder,functions:rzpVerify,functions:rzpWebhook --project "$P" && break
  echo "Deploy failed (attempt $i). Retrying in 20 s…"; sleep 20
done
echo; echo "Razorpay webhook URL:  https://$REGION-$P.cloudfunctions.net/rzpWebhook"
echo "Active events to tick:  payment.captured  and  order.paid"
