# Vellore Taxi — production deployment checklist

Do the steps **in this order**. Every step can be undone; nothing here deletes data.
The apps already on the website work with both the old and the new security rules, so there is no "big bang" moment.

Legend: 🧑 = the owner does it in a browser · ⏱ = rough time

## 0. Before you start (🧑 15 min)

1. Firebase console → **Firestore → Import/Export** is only on Blaze, so first take the manual backup:
   Office app → Settings → **⬇ Full backup (JSON)**. Keep the file on your computer and Google Drive.
2. Write down the current Firestore rules: Firebase console → Firestore → Rules → copy everything into a text file.
   (The same text is in the repo as `firestore.rules.v1-backup`.)

## 1. Remove the public test logins (🧑 5 min) — launch blocker

The test numbers with OTP 123456 were shared on WhatsApp. Anyone can use them.

1. Firebase console → Authentication → Sign-in method → Phone → **Phone numbers for testing** → delete every 99999 0000x number.
2. Office app → Drivers → `test driver`, `tset driver2`, `tset driver3` → **தடை செய் / Block** (do not delete; their trips stay in reports).
3. Keep testing on the **staging** project instead (step 2).

## 2. Create the staging (test) project (🧑 20 min)

1. Firebase console → Add project → name `vellore-taxi-staging` → Firestore (asia-south1) → Authentication → Phone.
2. Add your test phone numbers + OTP **only in this staging project**.
3. Project settings → Your apps → Web app → copy the config object.
4. Paste it into `firebase-config.js` as `STAGING = { ... }` (send it to Claude, or edit on GitHub).
5. Publish the staging site: create a second GitHub repository `vellorecalltaxi-staging`, upload the same files, turn on Pages.
   Any address containing "staging" (and localhost) uses the staging project automatically; production data is never touched.
6. Paste `firestore.rules` into the staging project's Rules and publish. Do every test there first.

## 3. Switch to the Blaze plan with a budget alert (🧑 10 min)

Needed for: real SMS OTP volume, Cloud Functions, automatic backups, push notifications.

1. Firebase console → ⚙ → Usage and billing → Modify plan → **Blaze** (add the card yourself; never share card/OTP in chat).
2. Google Cloud console → Billing → Budgets & alerts → budget ₹2,000/month with alerts at 50%, 90%, 100%.
3. Authentication → Settings → **SMS region policy** → Allow only India (+91). This stops SMS-pumping fraud.

## 4. Publish security rules v2 + index (🧑 10 min)

1. Firebase console → Firestore → Rules → replace with the content of `firestore.rules` → **Publish**.
2. Firestore → Indexes → Composite → Add: collection `bookings`, fields `driverPhone` Ascending, `createdAt` Descending.
   (Or `firebase deploy --only firestore` from a computer, which publishes both.)
3. Check right away (5 min): Office opens and shows bookings; a test booking on staging goes searching → assigned → done.
   If anything is refused: paste back the old rules from step 0.2 (rollback takes 1 minute).

After v2 is live the office moves the old public "blocked numbers" list into the private list by itself (owner login).

## 5. Deploy Cloud Functions (computer, 20 min — Claude can guide)

```
npm install -g firebase-tools
firebase login
cd vellorecalltaxi
firebase use vellore-taxi23
cd functions && npm install && npm test && cd ..
firebase deploy --only functions
```
On the first deploy it asks for `BACKUP_BUCKET`: create a bucket first (Cloud Storage → Create → name `vellore-taxi23-backups`,
region asia-south1, lifecycle rule "delete after 30 days") and give the Firestore service agent "Storage Admin" on it
(Cloud console → the bucket → Permissions → Grant access → `service-<project-number>@gcp-sa-firestore.iam.gserviceaccount.com`),
and give the functions' service account (`<project-number>-compute@developer.gserviceaccount.com`) the role **Cloud Datastore Import Export Admin** (IAM page).

Then in Office → Settings → **Server & monitoring** (owner only):
- turn ON "Server takes the commission" → the driver phone stops deducting; the server writes `ledger/` and corrects wallets.
- turn ON "Server handles scheduled and stale bookings".
Check the next 5 finished trips in Firestore → `ledger` (one entry each, `mismatch: false`).

## 6. Push notifications for drivers (🧑 10 min, after step 5)

1. Firebase console → Project settings → Cloud Messaging → Web Push certificates → **Generate key pair** → copy the public key.
2. Office → Settings → Server & monitoring → paste into "Push notification web key (VAPID)" → Save.
3. Each driver: open the driver app → tap the 🔔 card → Allow. iPhone: only after "Add to Home Screen" (iOS 16.4+).

## 7. Lock the keys (🧑 10 min)

The Firebase web config and the Maps browser key are public by design (every web app ships them). Protect them by restriction:
1. Google Cloud console → APIs & Services → Credentials → Maps key → Application restrictions: HTTP referrers
   `https://ajith12061995.github.io/*` (+ the staging address) → API restrictions: Maps JavaScript, Places (New), Routes.
2. Same page → the "Browser key (auto created by Firebase)": **do not edit** (it is used by login).
3. Firebase console → App Check → register the web app with reCAPTCHA Enterprise → start in "monitor" mode for a week, then enforce for Firestore.

## 8. Go-live test (🧑 + 2 drivers, 1 hour) — on production after steps 1–4

| # | Check | Expected |
|---|---|---|
| 1 | Customer books Auto/Sedan local | driver phone rings; office shows it |
| 2 | Driver accepts, arrives, enters PIN with the customer's app closed | trip starts |
| 3 | Driver ends trip, adds ₹50 toll | customer bill shows toll; wallet minus commission on fare only |
| 4 | Nobody accepts for 3 minutes | customer gets the apology + "Search again"; office rings "call the customer" |
| 5 | Rental 1 hr booking, drive 15 km / 70 min | bill shows extra km and extra time |
| 6 | Outstation one-way | office review ring; after approval the top driver gets it first |
| 7 | Driver recharge ₹200 → owner approves twice quickly | wallet goes up once |
| 8 | Office blocks a test customer number | that number cannot book |
| 9 | Office → Settings → App errors | list loads (empty is fine) |

## Rollback

- Website: GitHub → Code → branch `backup-pre-phase1-2026-11-03` holds the version before these changes.
  To go back: Settings → Pages → choose that branch (2 minutes), or ask Claude to revert.
- Rules: paste `firestore.rules.v1-backup`.
- Functions: Office switches OFF (apps go back to deducting commission on the phone); `firebase functions:delete <name>` if needed.
