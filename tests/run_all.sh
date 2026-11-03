#!/usr/bin/env bash
# Runs every local test. Needs python3 + playwright (chromium) and node. Usage: bash tests/run_all.sh
cd "$(dirname "$0")/.." || exit 1
set -o pipefail; fail=0
for f in tests/unit/*.test.js; do node "$f" | tail -1 || fail=1; done
(cd functions && node --test test/*.test.js 2>&1 | grep -E "^# (pass|fail)") || fail=1
python3 tests/e2e/build.py >/dev/null
python3 -m http.server 8765 >/dev/null 2>&1 & SRV=$!; sleep 1
for t in runsmoke runxss runfare runpin runoldrules runops runnet runclock runerr runav runche runtip runrb runo runtp runoff2 runfl runact rundrw runmust runchat runj runround runphone runspin runagree; do
  out=$(cd tests/e2e && timeout 400 python3 $t.py 2>&1 | grep -vi proxy)
  last=$(echo "$out" | grep -E "^RESULT|^ERR" | tail -1)
  if echo "$out" | grep -q "Traceback\|RESULT FAIL"; then echo "FAIL $t: $(echo "$out" | tail -2 | tr '\n' ' ' | cut -c1-200)"; fail=1; else echo "ok   $t  $last"; fi
done
kill $SRV; exit $fail
