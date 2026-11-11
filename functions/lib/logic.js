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
  const f = b.veh === 'auto' ? AUTO_GOVT : fares && fares[b.veh]; if (!f) return false;
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
// Auto-rickshaw: Tamil Nadu Government fare (G.O. Ms. No. 366, 27 Oct 2026) — same numbers as core/fare.js AUTO_GOVT.
const AUTO_GOVT = { base: 50, incl: 1.8, per: 25, wait: 1, night: { on: true, from: '22:00', to: '05:00', pct: 50 } };
// Local area: Vellore town centre + 18 km (autos 25 km) — same as core/fare.js AREA; config/app.area can override.
const AREA = { lat: 12.9165, lon: 79.1325, local: 18, auto: 25 };
const autoFare = km => Math.round(AUTO_GOVT.base + AUTO_GOVT.per * Math.max(0, n(km) - AUTO_GOVT.incl));
// Is a city ride outside the local area? (pickup or drop further from the centre than allowed for this vehicle; 0.5 km slack)
function outsideArea(b, area) {
  if (!b || b.src !== 'app' || (b.kind && b.kind !== 'ride' && b.kind !== 'schedule')) return false;
  if (b.tariff && b.tariff.t && b.tariff.t !== 'local') return false;
  const a = area && +area.lat && +area.lon ? area : AREA, c = { lat: +a.lat, lon: +a.lon };
  const lim = b.veh === 'auto' ? (+(area && area.auto) > 0 ? +area.auto : AREA.auto) : (+(area && area.local) > 0 ? +area.local : AREA.local);
  const d = p => p && p.lat != null && p.lon != null ? crowKm(c, { lat: +p.lat, lon: +p.lon }) : 0;
  return Math.max(d(b.from), d(b.to)) > lim + 0.5;
}
// Returns null when the fare is fine, else the corrected booking fields.
//  - km can't be shorter than the straight line × 1.2 (the app's road km is always ≥ straight line × 1.25)
//  - the night charge counts only when it applies now AND 15 minutes ago (a quote can be a few minutes old)
//  - ₹5 is allowed for rounding; a fare at or above the price is never changed (never over-charges)
function fareCheck(b, c, now) {
  if (!b || b.src !== 'app') return null;
  if (b.kind === 'rental' || (b.tariff && b.tariff.t === 'rent')) return rentCheck(b, c);
  if (b.kind === 'outstation' || (b.tariff && b.tariff.t === 'out')) return outCheck(b, c);
  if (b.kind && b.kind !== 'ride' && b.kind !== 'schedule') return null;
  if (b.tariff && b.tariff.t && b.tariff.t !== 'local') return null;
  const isAuto = b.veh === 'auto';
  const f = c && c.fares && c.fares[b.veh]; if (!isAuto && (!f || !(n(f.base) > 0))) return null;
  const minKm = crowKm(b.from, b.to) * 1.2, km = Math.max(n(b.km), minKm);
  const base = isAuto ? autoFare(km) : r5(n(f.base) + n(f.per) * Math.max(0, km - 1.5));
  const at = b.kind === 'schedule' && n(b.when) ? n(b.when) : now, nc = isAuto ? AUTO_GOVT.night : c && c.night;
  const np = Math.min(nightPct(nc, at), nightPct(nc, at - 15 * MIN));
  const want = isAuto ? (np ? Math.round(base * (1 + np / 100)) : base) : withNight(base, np);
  if (n(b.fare) >= want - 5) return null;
  return { fare: want, km: Math.round(km * 10) / 10, was: n(b.fare), wasKm: n(b.km), night: np, nightAmt: want - base };
}

// ---- server check for app RENTAL and OUTSTATION bookings. Same price tables and rules as the customer app
// (index.html RENT/XKM/XHR/ORATE…/rentPrice/oDays/oQuote + applyTariff; tests/unit/fare.test.js keeps them in step).
// The owner's prices in config/app.rent / config/app.out win over these defaults, exactly like the app.
const RANCH = [1, 2, 4, 8, 12], PKG_H = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const RENT0 = { auto: [199, 379, null, null, null], mini: [299, 549, 999, 1799, 2599], sedan: [349, 649, 1149, 2099, 2999], suv: [499, 899, 1599, 2799, 3999], psuv: [699, 1199, 2099, 3599, 4999], trav: [null, null, 2499, 3999, 5499] };
const XKM0 = { auto: 14, mini: 12, sedan: 13, suv: 17, psuv: 21, trav: 24 }, XHR0 = { auto: 120, mini: 150, sedan: 170, suv: 230, psuv: 290, trav: 350 };
const ORATE0 = { mini: 11, sedan: 12, suv: 16, psuv: 20, trav: 22 }, OBATA0 = { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 };
const OUT0 = { min1: 80, mind: 250, daykm: 400, longKm: 400, longPct: 0 };
// Outstation categories (= core/fare.js OUTCAT/outCat/catBata): A up to cat.a km = round trip only, billed up + down km
// with no per-day minimum; B up to cat.b km; C beyond. cb[cat][veh] = allowance per day for that category (0 = normal).
const OUTCAT = { a: 100, b: 150 };
const outCat = (km, cat) => { const c = cat || {}, a = +c.a > 0 ? +c.a : OUTCAT.a, b = Math.max(+c.b > 0 ? +c.b : OUTCAT.b, a); return n(km) <= a ? 'A' : n(km) <= b ? 'B' : 'C'; };
const catBata = (cb, cat, id, dflt) => { const x = cb && cb[cat] && +cb[cat][id]; return x > 0 ? x : n(dflt); };
function tariffs(c) {            // = applyTariff() in the customer app
  const RENT = JSON.parse(JSON.stringify(RENT0)), XKM = { ...XKM0 }, XHR = { ...XHR0 };
  const R1 = { ...ORATE0 }, B1 = { ...OBATA0 }, R = { ...ORATE0 }, B = { ...OBATA0 }, O = { ...OUT0 };
  const o = c && c.out;
  if (o) {
    Object.keys(R).forEach(id => {
      R1[id] = +((o.rate1 && o.rate1[id] > 0) ? o.rate1[id] : (o.rate && o.rate[id] > 0 ? o.rate[id] : R1[id]));
      B1[id] = +((o.bata1 && o.bata1[id] != null) ? o.bata1[id] : (o.bata && o.bata[id] != null ? o.bata[id] : B1[id]));
      if (o.rate && o.rate[id] > 0) R[id] = +o.rate[id];
      if (o.bata && o.bata[id] != null) B[id] = +o.bata[id];
    });
    if (o.min1 != null) O.min1 = +o.min1; if (o.mind != null) O.mind = +o.mind; if (o.daykm >= 100) O.daykm = +o.daykm;
    if (o.longKm != null) O.longKm = +o.longKm; if (o.longPct != null) O.longPct = +o.longPct;
  }
  const r = c && c.rent;
  if (r) Object.keys(RENT).forEach(id => {
    if (r.price && Array.isArray(r.price[id])) RENT[id] = r.price[id].map(x => +x > 0 ? +x : null);
    if (r.xkm && r.xkm[id] != null) XKM[id] = +r.xkm[id];
    if (r.xhr && r.xhr[id] != null) XHR[id] = +r.xhr[id];
  });
  return { RENT, XKM, XHR, R1, B1, R, B, O };
}
function rentPrice(RENT, id, h) {  // = rentPrice() in the customer app
  const row = RENT[id]; if (!row) return null;
  const pts = RANCH.map((x, i) => [x, row[i]]).filter(x => x[1] != null);
  if (!pts.length || h < pts[0][0] || h > pts[pts.length - 1][0]) return null;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][0] === h) return pts[i][1];
    if (pts[i][0] > h) { const [a, pa] = pts[i - 1], [b, pb] = pts[i]; return Math.round((pa + (pb - pa) * (h - a) / (b - a)) / 50) * 50 - 1; }
  }
  return null;
}
const istDay = ms => Math.floor((+ms + 19800000) / 864e5);    // Indian calendar day number
// Returns null when fine, else {fare, km, was, wasKm, tariff} (the corrected booking fields).
function rentCheck(b, c) {
  const t = b.tariff || {}, T = tariffs(c), id = b.veh, h = n(t.h);
  if (!PKG_H.includes(h)) return null;                         // unknown package: the office sees it anyway
  const want = rentPrice(T.RENT, id, h); if (!want) return null;
  const xkm = Math.max(n(t.xkm), n(T.XKM[id])), xhr = Math.max(n(t.xhr), n(T.XHR[id]));
  const low = n(b.fare) < want - 5, tlow = n(t.km) !== h * 10 || n(t.xkm) < n(T.XKM[id]) || n(t.xhr) < n(T.XHR[id]) || n(t.price) < want - 5;
  if (!low && !tlow) return null;
  const fare = low ? want : n(b.fare);
  return { fare, km: h * 10, was: n(b.fare), wasKm: n(b.km), tariff: { ...t, t: 'rent', h, km: h * 10, price: Math.max(n(t.price), want), xkm, xhr } };
}
function outCheck(b, c) {
  const t = b.tariff || {}, T = tariffs(c), id = b.veh, o = (c && c.out) || {};
  const O = T.O, crow = crowKm(b.from, b.to);
  const km = Math.round(Math.max(n(t.km), crow * 1.1));        // one-way road km; highways run only ~1.12 × the straight line
  if (!km) return null;
  const cat = outCat(km, o.cat), A = cat === 'A';
  const one = !A && (t.otype || b.otype) !== 'round';          // category A: round trip only, whatever the app sent
  const rate = (one ? T.R1 : T.R)[id], bata0 = (one ? T.B1 : T.B)[id];
  if (!(rate > 0) || bata0 == null) return null;
  const bata = catBata(o.cb, cat, id, bata0), mind = A ? 0 : O.mind;
  let days;
  if (one) days = Math.max(1, Math.ceil(km / O.daykm));
  else {
    const leave = n(b.when), back = n(b.retAt) || leave;
    days = Math.max((leave ? istDay(back) - istDay(leave) + 1 : 1), Math.ceil(2 * km / O.daykm), 1);
  }
  const billed = one ? Math.max(km, O.min1) : Math.max(km * 2, mind * days);
  const extra = one && O.longPct > 0 && km > O.longKm ? Math.round((km - O.longKm) * rate * O.longPct / 100) : 0;
  const want = Math.round((billed * rate + bata * days + extra) / 10) * 10;
  const tar = { ...t, t: 'out', otype: one ? 'one' : 'round', km, days, rate, bata, min1: O.min1, mind, cat, daykm: O.daykm, longKm: O.longKm, longPct: O.longPct };
  const low = n(b.fare) < want - 10;
  const tlow = n(t.km) < km || n(t.days) < days || n(t.rate) < rate || n(t.bata) < bata || n(t.min1) < O.min1 || n(t.mind) < mind
    || (A && t.otype !== 'round')
    || (t.daykm != null && n(t.daykm) > O.daykm) || n(t.longPct) < O.longPct;
  if (!low && !tlow) return null;
  return { fare: low ? want : n(b.fare), km: low ? billed : n(b.km), was: n(b.fare), wasKm: n(b.km), tariff: tar };
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

// '2026-11-04_0230' — Indian date and time, for backup folder names
// website enquiries in the last hour (including this one): same = from this phone, all = from everyone
const enquiryFlood = (same, all) => same > 3 ? 'auto: more than 3 from this number in an hour' : all > 40 ? 'auto: more than 40 in an hour' : null;
const istStamp = ms => new Date(ms + 19800000).toISOString().slice(0, 16).replace('T', '_').replace(':', '');

module.exports = { enquiryFlood, OUTCAT, outCat, catBata, AUTO_GOVT, AREA, autoFare, outsideArea, rentCheck, outCheck, tariffs, rentPrice, istStamp, commissionFor, settle, housekeeping, fareLooksWrong, liveStale, custPush, fareCheck, bookingLimit, nightPct, withNight, crowKm, LIMIT_OPEN, LIMIT_HOUR };
