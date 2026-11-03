# Vellore Taxi — daily operations, monitoring and backup

## Every day (owner, 5 minutes)
- Office → Today: ring bar empty? Red items = waiting bookings, SOS, driver cancels, "no driver — call the customer", scheduled pickups without a driver.
- Office → Approvals: recharges (check the UTR in your bank app before approving), new driver applications.
- Office → Settings → App errors → Load: a new error that repeats = tell Claude (copy the text).

## Every week
- Office → Reports → 7 days → CSV export (keep on Drive).
- Office → Drivers → filter ⚠️ (many cancels / low rating / documents expiring).
- After Cloud Functions are on: Firebase console → Firestore → `ledger` → filter `mismatch == true` should be empty.

## Backups
| What | How | Where |
|---|---|---|
| Automatic (after step 5 of DEPLOY.md) | `dailyBackup` function, 02:30 every night | Cloud Storage bucket `…-backups/firestore/<date>`, kept 30 days |
| Manual | Office → Settings → ⬇ Full backup (JSON) | your computer / Drive — do it before any big change |
| Code | GitHub history + branch `backup-pre-phase1-2026-11-03` | GitHub |

Restore (automatic backup): Cloud console → Firestore → Import/Export → Import → pick the date folder.
Import overwrites documents with the same id; it never deletes others. Test a restore on the staging project first.

## Monitoring
- App errors: `errors` collection (max 5 per phone visit) → Office → Settings.
- Cloud Functions logs: Firebase console → Functions → Logs (look for `commission mismatch`, `push`, `housekeeping`).
- Costs: Google Cloud Billing budget alert (₹2,000/month suggested).
- Fare tampering: bookings with `fareFlag: below-price-list` (set by the server) — check them in Bookings.

## When something goes wrong
| Problem | First check | Fix |
|---|---|---|
| Customer: "No vehicle nearby" but drivers are ON | Office → Today → fleet: are they "Free"? Driver phone shows red "location not available"? | Driver: allow location, keep app open; check vehicle type |
| Driver: no request sound | Phone silent? App opened once and screen tapped? | Turn on push (🔔 card) after step 6 |
| PIN not accepted | Customer reads the PIN from the app | Office → booking → ▶ Start trip (after calling the customer) |
| Wrong bill | Office → booking → ✏️ Correct the bill (owner) | Wallet commission is corrected in the same step |
| Wallet wrong | Office → Drivers → driver → wallet history | Owner: Adjust wallet with a note |
| Office shows "Permission denied (rules)" | Rules publish just happened? | Paste the previous rules back, tell Claude |
