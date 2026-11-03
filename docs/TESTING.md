# Vellore Taxi — tests

| Suite | What it covers | How to run |
|---|---|---|
| `tests/unit/fare.test.js` | final bill: local, waiting, toll/parking, rental extra km/time, outstation one-way/round, commission | `node tests/unit/fare.test.js` |
| `tests/unit/geo.test.js` | geohash cells for "drivers near the pickup" | `node tests/unit/geo.test.js` |
| `tests/rules/rules.test.js` | 27 security-rule cases on the real Firestore emulator | GitHub Actions (branch `ci-tests`) or `cd tests/rules && npm i && npm test` (needs Java) |
| `functions/test/logic.test.js` | commission/ledger, housekeeping, fare flag, stale live | `cd functions && npm i && npm test` |
| `tests/e2e/run*.py` | the three real apps side by side with an in-memory Firebase (mockfb.js) | `python3 tests/e2e/build.py`, serve the repo root on :8765, then `python3 tests/e2e/<test>.py` |

Main end-to-end tests: `runxss` (security), `runfare` (bill + wallet), `runpin` (PIN with customer app closed, old-rules mode),
`runops` (scheduled/stale/recharge/blocked), `runnet` (slow network, offline, app closed/reopened), `runround` (3 dispatch rounds),
`runclock` (wrong phone clock), `runoldrules` (new app on old rules), `runerr` (error reports), `runsmoke` (real pages load, no horizontal scroll).

Limits: the e2e mock does not enforce security rules (the rules suite does that separately) and does not reach real Firebase,
Google Maps, SMS or push. Those are covered by the go-live checklist in DEPLOY.md, on the staging project first.
