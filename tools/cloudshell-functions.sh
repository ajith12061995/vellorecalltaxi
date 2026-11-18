#!/usr/bin/env bash
# Vellore Taxi — deploy waDriverWelcome (approved driver gets the app link) and submit the
# vct_driver_welcome3 WhatsApp template, from Google Cloud Shell. ONE command:
#   cd ~/vellorecalltaxi && git fetch origin && git checkout -f main && git reset --hard origin/main && bash tools/cloudshell-functions.sh
#
# Why a separate script: `firebase deploy` kept stopping with "There was an error retrieving the Firestore
# database" (see tools/fbt-patch.js). This uses a private, pinned copy of firebase-tools with that one lookup
# replaced by the location gcloud reports. It deploys ONLY the functions named below, never deletes anything
# (--non-interactive: a delete question stops the deploy instead of being answered), touches no rules and no data.
# Safe to run again.   bash tools/cloudshell-functions.sh [project] [functions:a,functions:b]
set -uo pipefail
PROJECT="${1:-vellore-taxi23}"
ONLY="${2:-functions:waDriverWelcome}"
FBT_VERSION=13.35.1
FBT_DIR="$HOME/.vct-fbt"
LOG=/tmp/vct-fn-deploy.log
say(){ printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
stop(){ printf '\n\033[1;31mSTOPPED: %s\033[0m\nNothing after this point ran. Send Claude a screenshot of this screen.\n' "$*"; exit 1; }
cd "$(dirname "$0")/.." || stop "repo folder not found"

say "1/6 Code is the live version"
git fetch -q origin main || stop "git fetch failed (internet?)"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || stop "this folder is not on the live code. Run the full one-line command from the top of tools/cloudshell-functions.sh"
[ -z "$(git status --porcelain -- functions firebase.json tools ':!functions/package-lock.json')" ] || stop "local changes in functions/ or tools/ — run the full one-line command (it resets them)"
echo "commit $(git log --oneline -1 | cut -c1-70)"

say "2/6 Project + database location"
gcloud config set project "$PROJECT" >/dev/null 2>&1 || stop "gcloud cannot select $PROJECT"
LOC=""
for i in 1 2 3; do LOC=$(gcloud firestore databases describe --database='(default)' --format='value(locationId)' 2>/tmp/vct-loc.err) && [ -n "$LOC" ] && break; sleep 5; done
[ -n "$LOC" ] || { cat /tmp/vct-loc.err; stop "gcloud could not read the Firestore database location"; }
case "$LOC" in nam5) REGION=us-central1 ;; eur3) REGION=europe-west1 ;; *) REGION="$LOC" ;; esac
ENVF="functions/.env.$PROJECT"
if [ -f "$ENVF" ]; then
  HAVE=$(grep -E '^FN_REGION=' "$ENVF" | cut -d= -f2)
  [ "$HAVE" = "$REGION" ] || stop "$ENVF says FN_REGION=$HAVE but the database is in $LOC ($REGION). Not deploying (it would move the functions)."
else
  printf 'FN_REGION=%s\nBACKUP_BUCKET=%s\n' "$REGION" "${PROJECT}-backups" > "$ENVF"   # same as tools/cloudshell-deploy.sh
fi
echo "database: $LOC   functions region: $REGION"
# every function we are about to deploy must already live in this region, or be new
for f in $(echo "$ONLY" | tr ',' ' '); do n=${f#functions:}
  R=$(gcloud functions list --format='value(name)' 2>/dev/null | grep -E "/functions/${n}\$" | grep -oE 'locations/[^/]+' | cut -d/ -f2 | sort -u | tr '\n' ' ')
  case "$R" in "") echo "  $n: new (or region not listed)" ;; "$REGION ") echo "  $n: $REGION" ;; *) stop "$n exists in region(s) $R, not $REGION" ;; esac
done

say "3/6 WhatsApp template vct_driver_welcome3 (existing templates are skipped)"
if python3 tools/wa-templates.py --send > /tmp/vct-tpl.log 2>&1; then grep -E '^(OK|SKIP|FAIL) +vct_driver_welcome3|^DONE' /tmp/vct-tpl.log; if grep -qE '^FAIL +vct_driver_welcome3' /tmp/vct-tpl.log; then TPL=failed; else TPL=ok; fi
else tail -5 /tmp/vct-tpl.log; TPL=failed; echo "(template step failed — the deploy below still runs; it does not depend on it)"; fi

say "4/6 Install + tests (deploy stops if any test fails)"
echo "node $(node --version)"
(cd functions && { npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error; }) || stop "npm install failed — nothing deployed"
if (cd functions && node --test --test-reporter=tap test/*.test.js > /tmp/vct-fn-test.log 2>&1); then
  echo "functions tests: $(grep -E '^# pass' /tmp/vct-fn-test.log) $(grep -E '^# fail' /tmp/vct-fn-test.log)"
else tail -30 /tmp/vct-fn-test.log; stop "tests failed — nothing deployed"; fi

say "5/6 Deploy tool (private copy of firebase-tools $FBT_VERSION)"
if [ "$(node -p "try{require('$FBT_DIR/node_modules/firebase-tools/package.json').version}catch(e){''}" 2>/dev/null)" != "$FBT_VERSION" ]; then
  mkdir -p "$FBT_DIR" && npm install --prefix "$FBT_DIR" "firebase-tools@$FBT_VERSION" --no-audit --no-fund --loglevel=error || stop "could not install firebase-tools — nothing deployed"
fi
node tools/fbt-patch.js "$FBT_DIR" || stop "deploy tool check failed — nothing deployed"
FB="$FBT_DIR/node_modules/.bin/firebase"
# No `firebase login`: in Cloud Shell firebase-tools signs in by itself with the Cloud Shell account (requireAuth → autoAuth).
echo "signing in as the Cloud Shell account: $(gcloud config get-value account 2>/dev/null)"

say "6/6 Deploy: $ONLY"
rm -f firebase-debug.log
VCT_FIRESTORE_LOCATION="$LOC" VCT_FIRESTORE_PROJECT="$PROJECT" "$FB" deploy --only "$ONLY" --project "$PROJECT" --non-interactive 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
if [ "$RC" != 0 ]; then
  echo; echo "---- what the server answered (no secrets) ----"
  grep -E '\[apiv2\]\[(status|body)\]' firebase-debug.log 2>/dev/null | grep -Ev ' 20[0-9]$' | grep -Ei 'status\] .* [45][0-9][0-9]|"error"' | tail -6 | cut -c1-400
  grep -qiE "Failed to authenticate|firebase login" "$LOG" && echo "Sign-in problem: this Cloud Shell account cannot deploy to $PROJECT."
  stop "deploy failed (exit $RC). The functions that were live before are unchanged."
fi

say "Check"
BAD=0
for f in $(echo "$ONLY" | tr ',' ' '); do n=${f#functions:}
  ST=$(gcloud functions describe "$n" --region="$REGION" --gen2 --format='value(state,updateTime)' 2>/dev/null | tr '\t' ' ')
  echo "  $n: ${ST:-NOT FOUND}"
  case "$ST" in ACTIVE*) ;; *) BAD=1 ;; esac
done
[ "$BAD" = 0 ] || stop "a function is not ACTIVE"
say "DONE — functions live. Template step: $TPL. Send Claude a screenshot of this screen."
