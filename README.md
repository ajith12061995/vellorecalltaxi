# Vellore Taxi

Three web apps for a call-taxi business in Vellore, sharing one Firebase project (`vellore-taxi23`).

| App | Address | Who uses it |
|---|---|---|
| Customer | `/` (index.html) | Riders: book Bike, Auto, Mini, Sedan, SUV, Traveller, Mini Bus; track the driver; pay; rate |
| Driver | `/driver/` | Drivers added by the owner: go online, accept rides, PIN check, collect fare, wallet recharge |
| Office | `/office/` | Owner and staff: live fleet map, phone bookings, assign drivers, approvals, support, reports, settings |

Live site: https://ajith12061995.github.io/vellorecalltaxi/

## How it fits together

- `vct-cloud.js` loads Firebase (Auth + Firestore) from the official CDN and hands it to whichever app is open.
- `firebase-config.js` holds the public web config.
- If Firebase can't load, the apps fall back to a self-contained demo (used for previews).
- Login is by phone number + SMS OTP. The phone number decides the role:
  - `staff/{+91…}` with `role: "owner"` or `"staff"` → office panel
  - `drivers/{+91…}` → driver app (the owner adds drivers from the office panel)
  - anyone else → customer app
- `firestore.rules` is the security rules file. Paste it into Firebase console → Firestore → Rules after any change.

## Firestore collections

| Collection | What's in it |
|---|---|
| `bookings` | Every ride. Status: `searching` → `assigned` → `ontrip` → `done` (or `cancelled`, `scheduled`). Subdoc `private/pin` holds the ride PIN, visible only to the customer and office. |
| `drivers` | Driver profile, vehicle, wallet, blocked flag, document expiry dates |
| `live` | Each online driver's latest position |
| `recharges` | Driver wallet top-ups (UPI + UTR), approved by the owner |
| `tickets` | Call-me-back requests, complaints, lost items, SOS |
| `users` | Customer name and emergency contacts |
| `staff` | Office logins |
| `config/app` | Fares per vehicle, commission %, minimum wallet, owner UPI ID, office phone |

## Maps

On the live site the apps use real maps (Leaflet + OpenStreetMap tiles), Photon for place search, Nominatim for the address under a pinned point, and the OSRM demo server for road distance. All are free and can be withdrawn without notice, so for heavier use switch to a paid provider by changing the URLs in `MAPCFG` (inside each page's map section). When Leaflet can't load, the apps fall back to the drawn Vellore map.

## Testing without spending SMS

Firebase console → Authentication → Phone → test numbers (code `123456`):
`+91 99999 00001` (customer), `+91 99999 00002` (driver, after adding it in the office panel), `+91 99999 00003` (staff).

The previous version of this repo is kept on the `old-version` branch.
