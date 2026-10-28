// Fare + distance helpers (pure functions, no browser needed)

export const VEHICLES = {
  bike: { emoji: "🏍️", speedKmh: 28 },
  auto: { emoji: "🛺", speedKmh: 22 },
  car:  { emoji: "🚗", speedKmh: 26 },
};

// Owner can override these from Firestore doc settings/fares later.
export const DEFAULT_FARES = {
  bike: { base: 20, perKm: 7,  min: 30 },
  auto: { base: 30, perKm: 12, min: 45 },
  car:  { base: 60, perKm: 15, min: 100 },
};

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function estimateFare(type, km, fares = DEFAULT_FARES) {
  const f = fares[type] || DEFAULT_FARES[type];
  const raw = f.base + f.perKm * Math.max(0, km);
  return Math.max(f.min, Math.round(raw));
}

export function estimateMinutes(type, km) {
  const v = VEHICLES[type];
  return Math.max(3, Math.round((km / v.speedKmh) * 60));
}

// Commission split used later by Driver/Owner apps (kept here so all apps share one rule).
export function splitFare(fare, commissionPercent) {
  const commission = Math.round((fare * commissionPercent) / 100);
  return { commission, driverShare: fare - commission };
}

export function upiLink({ upiId, name, amount, note }) {
  const p = new URLSearchParams({ pa: upiId, pn: name, am: String(amount), cu: "INR", tn: note || "Taxi fare" });
  return "upi://pay?" + p.toString();
}
