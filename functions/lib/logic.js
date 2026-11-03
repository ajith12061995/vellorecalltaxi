// Pure decision logic for the Cloud Functions (no Firebase imports), unit-tested in test/logic.test.js.
const n = v => { const x = +v; return isFinite(x) && x > 0 ? x : 0; };
const MIN = 60e3;

// Commission for a finished booking: on the trip amount only (tip, toll, parking, permit are not charged)
// The trip amount is never taken below the booked fare: the apps' final bill can only add to the booked fare
// (waiting, extra km / hours), so a lower one means a modified driver app.
function commissionFor(b, pct) {
  const told = b && b.fx && b.fx.trip != null ? n(b.fx.trip) : (b && b.fareFinal != null ? n(b.fareFinal) : n(b && b.fare));
  const trip = Math.max(told, n(b && b.fare));
  return { trip, comm: Math.round(trip * n(pct) / 100) };
}

// Ledger entry + how much the wallet still has to move (if the driver app already took some commission)
// Server mode: the server takes the whole commission. What the booking says the app took is NOT trusted
// (a modified app could claim it took commission without doing so); in server mode the security rules stop
// drivers from changing their own wallet, so nothing was taken on the phone.
function settle(b, pct, serverComm) {
  const { trip, comm } = commissionFor(b, pct);
  const claimed = b.commLocal ? n(b.comm) : 0;          // what the driver app says it took (app mode only)
  const walletDelta = serverComm ? -comm : 0;
  return { trip, comm, taken: serverComm ? 0 : claimed, walletDelta, mismatch: !serverComm && !!b.commLocal && n(b.comm) !== comm };
}

// Housekeeping decisions for one booking at time `now`
function housekeeping(b, now) {
  if (!b) return null;
  const when = n(b.when), created = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : when;
  if (b.status === 'scheduled' && !b.driverPhone && (b.kind === 'schedule' || b.kind === 'ride') && when - now <= 30 * MIN)
    return { status: 'searching', dispatchedBy: 'server' };
  if (b.status === 'searching' && !b.dispatch &&
      ((b.kind === 'ride' && now - created > 15 * MIN) || (b.kind === 'schedule' && now - when > 15 * MIN)))
    return { status: 'cancelled', cancelReason: 'nodriver', cancelledBy: 'server' };
  return null;
}

// Expected local fare from office prices; flag bookings that look tampered (far below the price list)
function fareLooksWrong(b, fares) {
  if (!b || b.src !== 'app' || (b.kind && b.kind !== 'ride' && b.kind !== 'schedule')) return false;
  const f = fares && fares[b.veh]; if (!f) return false;
  const expected = n(f.base) + n(f.per) * Math.max(0, n(b.km) - (f.incl != null ? n(f.incl) : 1.5));
  return expected > 0 && n(b.fare) < expected * 0.6;
}

// A live position older than 10 minutes means the app is closed or offline: mark the driver not available
const liveStale = (l, now) => !!l && l.online === true && (!l.updatedAt || now - l.updatedAt.toMillis() > 10 * MIN);

// Customer push: which message (if any) a booking change deserves. Phone bookings (no customerUid) get none.
function custPush(before, after, lang) {
  if (!after || !after.customerUid) return null;
  const b = before || {}, ta = lang !== 'en', who = [after.driverName, after.plate].filter(Boolean).join(' · ');
  const m = (t, e, bt, be) => ({ title: ta ? t : e, body: ta ? bt : be, kind: '' });
  let r = null;
  if (after.status === 'assigned' && b.status !== 'assigned') r = { ...m('🚕 Driver கிடைச்சாச்சு', '🚕 Driver found', `${who} உங்க ride-ஐ ஏற்றுக்கிட்டார்`, `${who} accepted your ride`), kind: 'assigned' };
  else if (after.arrivedAt && !b.arrivedAt && after.status === 'assigned') r = { ...m('📍 Driver வந்துட்டார்', '📍 Driver has arrived', `${who} pickup இடத்துல காத்திருக்கார். PIN-ஐ driver-கிட்ட சொல்லுங்க`, `${who} is waiting at the pickup. Tell the driver your PIN`), kind: 'arrived' };
  else if (after.status === 'ontrip' && b.status !== 'ontrip') r = { ...m('▶️ Trip ஆரம்பம்', '▶️ Trip started', 'பாதுகாப்பான பயணம்! Live-ஆ app-ல பார்க்கலாம்', 'Have a safe ride! Follow it live in the app'), kind: 'ontrip' };
  else if (after.status === 'done' && b.status !== 'done') { const f = after.fareFinal || after.fare; r = { ...m('✅ Trip முடிஞ்சது', '✅ Trip completed', `மொத்தம் ₹${f}. நன்றி! Driver-க்கு rating கொடுங்க`, `Total ₹${f}. Thank you! Please rate your driver`), kind: 'done' }; }
  else if (after.status === 'cancelled' && b.status !== 'cancelled' && !/^(customer|nodriver)$/.test(after.cancelReason || '')) r = { ...m('❌ Booking cancel ஆச்சு', '❌ Booking cancelled', 'மன்னிக்கவும். App-ல மறுபடி book பண்ணலாம்', 'Sorry. You can book again in the app'), kind: 'cancelled' };
  return r;
}

// ---- server fare check for app city rides (the customer app makes the quote; the server makes sure it is not too low)
// Same night rule as core/fare.js (kept in step by tests/unit/fare.test.js).
const hm = x => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(x || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
function nightPct(cfg, at) {
  if (!cfg || !cfg.on) return 0;
  const pct = Math.min(100, n(cfg.pct)), f = hm(cfg.from), t = hm(cfg.to); if (!pct || f == null || t == null || f === t) return 0;
  const m = ((Math.floor((+at + 19800000) / 60000) % 1440) + 1440) % 1440;
  return (f < t ? m >= f && m < t : m >= f || m < t) ? pct : 0;
}
const r5 = x => Math.round(x / 5) * 5;
const withNight = (f, pct) => pct ? r5(n(f) * (1 + pct / 100)) : n(f);
const crowKm = (a, b) => { if (!a || !b || !isFinite(a.lat) || !isFinite(a.lon) || !isFinite(b.lat) || !isFinite(b.lon)) return 0;
  const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
// Returns null when the fare is fine, else the corrected booking fields.
//  - km can't be shorter than the straight line × 1.2 (the app's road km is always ≥ straight line × 1.25)
//  - the night charge counts only when it applies now AND 15 minutes ago (a quote can be a few minutes old)
//  - ₹5 is allowed for rounding; a fare at or above the price is never changed (never over-charges)
function fareCheck(b, c, now) {
  if (!b || b.src !== 'app' || (b.kind && b.kind !== 'ride' && b.kind !== 'schedule')) return null;
  if (b.tariff && b.tariff.t && b.tariff.t !== 'local') return null;
  const f = c && c.fares && c.fares[b.veh]; if (!f || !(n(f.base) > 0)) return null;
  const minKm = crowKm(b.from, b.to) * 1.2, km = Math.max(n(b.km), minKm);
  const base = r5(n(f.base) + n(f.per) * Math.max(0, km - 1.5));
  const at = b.kind === 'schedule' && n(b.when) ? n(b.when) : now;
  const np = Math.min(nightPct(c.night, at), nightPct(c.night, at - 15 * MIN));
  const want = withNight(base, np);
  if (n(b.fare) >= want - 5) return null;
  return { fare: want, km: Math.round(km * 10) / 10, was: n(b.fare), wasKm: n(b.km), night: np, nightAmt: want - base };
}

// ---- booking limits per app customer: at most 3 open rides at once and 8 new bookings an hour
const LIMIT_OPEN = 3, LIMIT_HOUR = 8;
// lim = limits/{uid} doc {open:[ids], hr:hour start ms, n}; openNow = ids of those still searching/assigned/ontrip
function bookingLimit(lim, openNow, now) {
  lim = lim || {}; const hr = Math.floor(now / 3600e3) * 3600e3, cnt = lim.hr === hr ? n(lim.n) : 0;
  if (openNow.length >= LIMIT_OPEN) return { ok: false, why: 'open' };
  if (cnt >= LIMIT_HOUR) return { ok: false, why: 'hour' };
  return { ok: true, hr, n: cnt + 1 };
}

module.exports = { commissionFor, settle, housekeeping, fareLooksWrong, liveStale, custPush, fareCheck, bookingLimit, nightPct, withNight, crowKm, LIMIT_OPEN, LIMIT_HOUR };
