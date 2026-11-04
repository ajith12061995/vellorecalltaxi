# Play Store — Vellore Taxi (customer) + Vellore Taxi Driver

Prepared 4 Nov 2026. Account: personal, "Vellore Taxi" (ID 9202924429127436392). Identity verification pending.

## Apps
| | Customer | Driver |
| --- | --- | --- |
| Package (permanent) | `app.velloretaxi` | `app.velloretaxi.driver` |
| Name | Vellore Taxi | Vellore Taxi Driver |
| Loads | https://velloretaxi.app/ | https://velloretaxi.app/driver/ |
| Code | `mobile/customer` (Capacitor 8) | `mobile/driver` |
| Build | GitHub Actions `android` workflow (push to `android-build` or run by hand): debug APK + release AAB | same |
| Category | Maps & Navigation (or Travel & Local) | Maps & Navigation |
| Countries | India only | India only |
| Price | Free, no ads, no in-app purchases | same |

Signing: Play App Signing. Upload key only in GitHub secrets `VCT_UPLOAD_KEYSTORE_B64`, `VCT_KEYSTORE_PASSWORD`, `VCT_KEY_ALIAS`, `VCT_KEY_PASSWORD` (owner adds them in GitHub → Settings → Secrets; Claude's proxy cannot). If the upload key is lost, Google can reset it.

## Store listing — customer
**Short (≤80):** Book auto & taxi rides in Vellore — fixed fares, live driver tracking.
**Short (Tamil):** வேலூரில் ஆட்டோ, கார் புக் செய்யுங்க — முன்கூட்டியே கட்டணம், live tracking.

**Full description (English):**
VCT – Vellore Taxi is the local call-taxi service of Vellore, Tamil Nadu.
• Book an auto or car in seconds — city rides, hourly rentals and outstation trips
• See the full fare before you book; night charge shown separately
• Track your driver live and share the trip with family
• Ride PIN for safety, SOS and a call-the-office button
• Pay the driver by cash or UPI
• Tamil and English
Login with your phone number (OTP). You can delete your account any time in Profile or at https://velloretaxi.app/privacy/#delete

**Full description (Tamil):**
VCT – வேலூர் டாக்ஸி, வேலூரின் உள்ளூர் call taxi சேவை.
• ஆட்டோ, கார் சில நொடியில் புக் — நகரப் பயணம், மணி நேர வாடகை, வெளியூர் பயணம்
• புக் செய்யும் முன்பே முழு கட்டணம்; இரவு கட்டணம் தனியாக காட்டப்படும்
• Driver எங்கே வருகிறார் என்று live-ஆ பாருங்க, குடும்பத்துடன் பகிருங்க
• பாதுகாப்புக்கு Ride PIN, SOS, office-ஐ அழைக்கும் வசதி
• Driver-க்கு cash அல்லது UPI
• தமிழ் / English
Phone OTP மூலம் login. Account-ஐ எப்போது வேண்டுமானாலும் Profile-ல் நீக்கலாம்.

## Store listing — driver
**Short:** For VCT – Vellore Taxi partner drivers: get rides, navigate, track earnings.
**Full:** The app for drivers attached to VCT – Vellore Taxi. Go online, receive nearby ride requests, start trips with the customer's PIN, navigate in the app, see the final bill and your wallet. New drivers join at https://velloretaxi.app/driver/join/ (documents and agreement are checked by the office). Only for approved VCT drivers.

## Data safety (both apps unless noted)
| Data | Collected | Why | Shared |
| --- | --- | --- | --- |
| Phone number | Yes (required) | Account, ride contact | No |
| Name | Yes | Account, shown to driver/customer of the ride | No |
| Precise location | Yes (while using the app; driver while online) | Pickup, matching nearby drivers, live tracking | No (Google Maps is a service provider) |
| Messages (in-ride chat) | Yes | Ride communication | No |
| Photos (driver app only) | Yes | Driver licence / RC / insurance documents for approval | No |
| Device or other IDs (push token) | Yes | Ride notifications | No |
| Crash logs (app error reports) | Yes | Fix problems | No |
| Payment info | **No** (cash/UPI paid outside the app) | — | — |
- Data encrypted in transit: **Yes** (HTTPS only).
- Users can request deletion: **Yes** — in the app (Profile → Delete account) and https://velloretaxi.app/privacy/#delete. Trip and money records are kept without name/number for accounts.
- No ads, no data sold, no third-party analytics.

## App content
- Privacy policy URL: https://velloretaxi.app/privacy/ · Terms: same page.
- Ads: No. Target audience: 18+. Content rating questionnaire: no violence/sexual content; user communication = in-ride chat between customer and driver (yes).
- Account deletion URL: https://velloretaxi.app/privacy/#delete
- Location permission: foreground only for now. Background location (driver app with screen off) needs a foreground service + Play "background location" declaration with a video → phase 2, only if needed.
- Government/financial/health app: No. News: No.
- Trader: declared (account level); confirm per app.

## Testing route (personal account rule)
1. Internal testing: owner + office phones (instant).
2. Closed testing: at least **12 testers for 14 days in a row** (Gmail addresses; pilot drivers, regular customers, family).
3. Then apply for production access → review (a few days).

## Still to do before the first upload
- Owner: identity approval (pending), phone verification, upload-key secrets in GitHub, register both Android apps in Firebase (package names above) for native push → `google-services.json` (public config file, fine to commit).
- Claude: native push (web push does not work inside Android apps), screenshots (phone 1080×1920), feature graphic 1024×500, run on a real phone via internal testing.
