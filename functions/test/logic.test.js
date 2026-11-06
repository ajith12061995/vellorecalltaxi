const { test } = require('node:test'); const assert = require('node:assert');
const L = require('../lib/logic');
const T = ms => ({ toMillis: () => ms });
test('commission on trip only', () => { assert.deepEqual(L.commissionFor({ fare: 190, fareFinal: 274, fx: { trip: 204 } }, 10), { trip: 204, comm: 20 }); });
test('commission falls back to fareFinal then fare', () => {
  assert.equal(L.commissionFor({ fare: 190, fareFinal: 250 }, 10).comm, 25);
  assert.equal(L.commissionFor({ fare: 190 }, 10).comm, 19);
});
test('settle: server mode takes the full commission and ignores what the app claims', () => {
  const s = L.settle({ fare: 190, fx: { trip: 204 }, comm: 10, commLocal: true }, 10, true);
  assert.equal(s.comm, 20); assert.equal(s.walletDelta, -20); assert.equal(s.taken, 0);
  assert.equal(L.settle({ fare: 300, comm: 30, commLocal: true }, 10, true).walletDelta, -30);
});
test('settle: server mode takes all when the app took nothing', () => { assert.equal(L.settle({ fare: 300 }, 10, true).walletDelta, -30); });
test('settle: app mode only records and flags a mismatch', () => {
  const s = L.settle({ fare: 190, fx: { trip: 204 }, comm: 5, commLocal: true }, 10, false);
  assert.equal(s.walletDelta, 0); assert.equal(s.mismatch, true);
});
const now = Date.parse('2026-11-03T10:00:00Z');
test('scheduled ride goes out 30 min before pickup', () => {
  assert.equal(L.housekeeping({ status: 'scheduled', kind: 'schedule', when: now + 20 * 60e3 }, now).status, 'searching');
  assert.equal(L.housekeeping({ status: 'scheduled', kind: 'schedule', when: now + 50 * 60e3 }, now), null);
  assert.equal(L.housekeeping({ status: 'scheduled', kind: 'schedule', when: now + 20 * 60e3, driverPhone: '+91x' }, now), null);
  assert.equal(L.housekeeping({ status: 'scheduled', kind: 'outstation', when: now + 20 * 60e3 }, now), null);
});
test('stale local search closed after 15 min', () => {
  assert.equal(L.housekeeping({ status: 'searching', kind: 'ride', createdAt: T(now - 16 * 60e3) }, now).cancelReason, 'nodriver');
  assert.equal(L.housekeeping({ status: 'searching', kind: 'ride', createdAt: T(now - 5 * 60e3) }, now), null);
  assert.equal(L.housekeeping({ status: 'searching', kind: 'outstation', dispatch: {}, createdAt: T(now - 99 * 60e3) }, now), null);
});
test('tampered fare flagged', () => {
  const fares = { sedan: { base: 60, per: 15 } };
  assert.equal(L.fareLooksWrong({ src: 'app', kind: 'ride', veh: 'sedan', km: 10, fare: 20 }, fares), true);
  assert.equal(L.fareLooksWrong({ src: 'app', kind: 'ride', veh: 'sedan', km: 10, fare: 205 }, fares), false);
  assert.equal(L.fareLooksWrong({ src: 'phone', kind: 'ride', veh: 'sedan', km: 10, fare: 1 }, fares), false);
});
test('live position older than 10 min is stale', () => {
  assert.equal(L.liveStale({ online: true, updatedAt: T(now - 11 * 60e3) }, now), true);
  assert.equal(L.liveStale({ online: true, updatedAt: T(now - 2 * 60e3) }, now), false);
  assert.equal(L.liveStale({ online: false, updatedAt: T(0) }, now), false);
});

test('customer push: driver accepted / arrived / trip started / done, each once', () => {
  const base = { customerUid: 'u1', driverName: 'Ravi', plate: 'TN23 1234', fare: 190 };
  const a = L.custPush({ ...base, status: 'searching' }, { ...base, status: 'assigned' }, 'ta');
  assert.equal(a.kind, 'assigned'); assert.match(a.body, /Ravi · TN23 1234/);
  assert.equal(L.custPush({ ...base, status: 'assigned' }, { ...base, status: 'assigned', updatedAt: 1 }, 'ta'), null, 'no repeat on other updates');
  assert.equal(L.custPush({ ...base, status: 'assigned' }, { ...base, status: 'assigned', arrivedAt: 1 }, 'en').title, '📍 Driver has arrived');
  assert.equal(L.custPush({ ...base, status: 'assigned', arrivedAt: 1 }, { ...base, status: 'ontrip', arrivedAt: 1 }, 'ta').kind, 'ontrip');
  const d = L.custPush({ ...base, status: 'ontrip' }, { ...base, status: 'done', fareFinal: 274 }, 'en');
  assert.equal(d.kind, 'done'); assert.match(d.body, /₹274/);
  assert.equal(L.custPush({ ...base, status: 'done' }, { ...base, status: 'done', custRating: 5 }, 'ta'), null);
});
test('customer push: none for phone bookings or for the customer\'s own cancel; driver/office cancel is told', () => {
  assert.equal(L.custPush({ status: 'searching' }, { status: 'assigned', customerUid: null }, 'ta'), null);
  assert.equal(L.custPush({ customerUid: 'u', status: 'searching' }, { customerUid: 'u', status: 'cancelled', cancelReason: 'customer' }, 'ta'), null);
  assert.equal(L.custPush({ customerUid: 'u', status: 'assigned' }, { customerUid: 'u', status: 'cancelled', cancelReason: 'driver: car broke' }, 'ta').kind, 'cancelled');
});

// ---- server fare check
const CFGF = { fares: { sedan: { base: 130, per: 19 }, auto: { base: 40, per: 16 } } };
const A = { lat: 12.9165, lon: 79.1325 }, Bp = { lat: 12.9716, lon: 79.1588 };   // ~6.8 km apart in a straight line
const ride = o => ({ src: 'app', kind: 'ride', veh: 'sedan', from: A, to: Bp, tariff: { t: 'local' }, ...o });
const day = Date.UTC(2026, 10, 4, 6, 30);                                         // 12:00 IST
test('fare check: an honest fare is never changed (also when a little above the price)', () => {
  const km = 9.5, fare = Math.round((130 + 19 * (km - 1.5)) / 5) * 5;
  assert.equal(L.fareCheck(ride({ km, fare }), CFGF, day), null);
  assert.equal(L.fareCheck(ride({ km, fare: fare + 40 }), CFGF, day), null);
  assert.equal(L.fareCheck(ride({ km, fare: fare - 5 }), CFGF, day), null, '₹5 rounding allowed');
});
test('fare check: a lowered fare is corrected to the price list', () => {
  const r = L.fareCheck(ride({ km: 9.5, fare: 50 }), CFGF, day);
  assert.equal(r.fare, 280); assert.equal(r.was, 50); assert.equal(r.night, 0);
});
test('fare check: a faked short distance is replaced by the straight line × 1.2', () => {
  const r = L.fareCheck(ride({ km: 1.2, fare: 130 }), CFGF, day);
  const crow = L.crowKm(A, Bp); assert.ok(crow > 6 && crow < 7.5, crow);
  assert.ok(Math.abs(r.km - Math.round(crow * 12) / 10) < 0.11, r.km); assert.ok(r.fare > 230, r.fare);
});
test('fare check: night charge only when it applied now and 15 min ago; never for phone bookings', () => {
  const c = { ...CFGF, night: { on: true, from: '22:00', to: '05:00', pct: 25 } };
  const n23 = Date.UTC(2026, 10, 4, 17, 30), n2205 = Date.UTC(2026, 10, 4, 16, 35);  // 23:00 and 22:05 IST
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 280 }), c, n23).fare, 350);         // 130 + 19 × 8 = 282 → ₹280; × 1.25 = ₹350
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 280 }), c, n2205), null, 'just after 22:00 the quote may be from 21:55');
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 10, tariff: { t: 'rent' } }), c, n23), null, 'rental without a known package: left to the office');
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 10, src: 'phone' }), c, n23), null);
  const s = L.fareCheck(ride({ kind: 'schedule', when: n23, km: 9.5, fare: 280 }), c, day);
  assert.equal(s.night, 25, 'scheduled ride uses its pickup time');
});
test('limits: 3 open rides at once and 8 bookings an hour', () => {
  const now = Date.UTC(2026, 10, 4, 6, 10), hr = Math.floor(now / 3600e3) * 3600e3;
  assert.deepEqual(L.bookingLimit(null, [], now), { ok: true, hr, n: 1 });
  assert.equal(L.bookingLimit({ hr, n: 2 }, ['a', 'b'], now).ok, true);
  assert.deepEqual(L.bookingLimit({ hr, n: 3 }, ['a', 'b', 'c'], now), { ok: false, why: 'open' });
  assert.deepEqual(L.bookingLimit({ hr, n: 8 }, [], now), { ok: false, why: 'hour' });
  assert.equal(L.bookingLimit({ hr: hr - 3600e3, n: 8 }, [], now).n, 1, 'a new hour starts again');
});
test('commission never below the booked fare (a lowered final bill from a modified app)', () => {
  assert.equal(L.commissionFor({ fare: 300, fx: { trip: 100 } }, 10).comm, 30);
  assert.equal(L.commissionFor({ fare: 300, fx: { trip: 350 } }, 10).comm, 35);
  assert.equal(L.settle({ fare: 300, fareFinal: 120 }, 10, true).walletDelta, -30);
});

test('backup folder name uses the Indian date and time (02:30 IST is still today)', () => {
  assert.equal(L.istStamp(Date.UTC(2026, 10, 3, 21, 0)), '2026-11-04_0230');
  assert.equal(L.istStamp(Date.UTC(2026, 10, 4, 6, 15)), '2026-11-04_1145');
});

// ---- rental + outstation server check (same tables as the customer app)
const rent = o => ({ src: 'app', kind: 'rental', veh: 'sedan', from: A, to: { lat: null, lon: null }, ...o });
test('rental: honest package price untouched; lowered price / cheaper extra rates corrected; owner prices win', () => {
  const ok = { fare: 1149, km: 40, hrs: 4, tariff: { t: 'rent', h: 4, km: 40, price: 1149, xkm: 13, xhr: 170 } };
  assert.equal(L.fareCheck(rent(ok), {}, day), null);
  const r = L.fareCheck(rent({ ...ok, fare: 99, tariff: { ...ok.tariff, price: 99 } }), {}, day);
  assert.equal(r.fare, 1149); assert.equal(r.tariff.price, 1149); assert.equal(r.was, 99);
  const x = L.fareCheck(rent({ ...ok, tariff: { ...ok.tariff, xkm: 1, xhr: 1 } }), {}, day);
  assert.equal(x.fare, 1149, 'fare fine, not changed'); assert.equal(x.tariff.xkm, 13); assert.equal(x.tariff.xhr, 170);
  assert.equal(L.fareCheck(rent({ ...ok, tariff: { ...ok.tariff, km: 400 } }), {}, day).tariff.km, 40, 'package km cannot be raised');
  assert.equal(L.fareCheck(rent({ ...ok, fare: 1149 }), { rent: { price: { sedan: [400, 700, 1500, 2500, 3500] } } }, day).fare, 1500);
  assert.equal(L.fareCheck(rent({ fare: 10, tariff: { t: 'rent', h: 3, km: 30, price: 10 } }), {}, day).fare, 899, '3 hr between 2 and 4: 649→1149 → ₹899');
  assert.equal(L.rentPrice(L.tariffs({}).RENT, 'auto', 8), null, 'auto has no 8-hour package');
});
const VLR = { lat: 12.9165, lon: 79.1325 }, CHN = { lat: 13.0827, lon: 80.2707 };      // Vellore → Chennai ~125 km straight, ~140 km road
const out = o => ({ src: 'app', kind: 'outstation', veh: 'sedan', from: VLR, to: CHN, ...o });
test('outstation one way: honest quote untouched; lowered fare, short km or cheap rate corrected', () => {
  const tar = { t: 'out', otype: 'one', km: 140, days: 1, rate: 12, bata: 300, min1: 80, mind: 250, daykm: 400, longKm: 400, longPct: 0 };
  const fare = Math.round((140 * 12 + 300) / 10) * 10;                                  // ₹1980
  assert.equal(L.fareCheck(out({ fare, km: 140, otype: 'one', tariff: tar }), {}, day), null);
  const a = L.fareCheck(out({ fare: 500, km: 140, otype: 'one', tariff: tar }), {}, day);
  assert.equal(a.fare, 1980); assert.equal(a.was, 500);
  const b = L.fareCheck(out({ fare: 600, km: 20, otype: 'one', tariff: { ...tar, km: 20 } }), {}, day);
  const crow = L.crowKm(VLR, CHN); assert.ok(crow > 120 && crow < 135, crow);
  assert.equal(b.tariff.km, Math.round(crow * 1.1)); assert.ok(b.fare >= Math.round(crow * 1.1) * 12, b.fare);
  const c = L.fareCheck(out({ fare, km: 140, otype: 'one', tariff: { ...tar, rate: 1 } }), {}, day);
  assert.equal(c.tariff.rate, 12, 'extra-km rate restored'); assert.equal(c.fare, fare, 'fare itself was right');
  assert.equal(L.fareCheck(out({ fare: 1500, km: 140, otype: 'one', tariff: tar }), { out: { rate1: { sedan: 14 } } }, day).fare, Math.round((140 * 14 + 300) / 10) * 10);
});
test('outstation round trip: days from the Indian calendar dates; minimum km per day', () => {
  const leave = Date.UTC(2026, 10, 5, 2, 30), back = Date.UTC(2026, 10, 6, 12, 30);    // 5 Nov 08:00 → 6 Nov 18:00 IST = 2 days
  const tar = { t: 'out', otype: 'round', km: 140, days: 2, rate: 12, bata: 300, min1: 80, mind: 250, daykm: 400, longKm: 400, longPct: 0 };
  const fare = Math.round((Math.max(280, 500) * 12 + 600) / 10) * 10;                  // 500 km min × ₹12 + ₹600 = ₹6600
  assert.equal(L.fareCheck(out({ fare, km: 500, otype: 'round', when: leave, retAt: back, tariff: tar }), {}, day), null);
  const r = L.fareCheck(out({ fare: 2000, km: 280, otype: 'round', when: leave, retAt: back, tariff: { ...tar, days: 1 } }), {}, day);
  assert.equal(r.fare, 6600); assert.equal(r.tariff.days, 2); assert.equal(r.km, 500);
  assert.equal(L.fareCheck(out({ fare: 10, veh: 'auto', otype: 'one', tariff: { ...tar, otype: 'one' } }), {}, day), null, 'no outstation price for auto: office decides');
});
test('rental/outstation tables match the customer app (index.html)', () => {
  const fs = require('fs'), src = fs.readFileSync(require('path').join(__dirname, '../../index.html'), 'utf8');
  const grab = re => { const m = re.exec(src); assert.ok(m, re); return Function('return ' + m[1])(); };
  const T = L.tariffs({});
  assert.deepEqual(grab(/const RENT=(\{[^;]*\});/), T.RENT);
  assert.deepEqual(grab(/const XKM=(\{[^}]*\})/), T.XKM); assert.deepEqual(grab(/XHR=(\{[^}]*\});/), T.XHR);
  assert.deepEqual(grab(/const ORATE1=(\{[^}]*\})/), T.R1); assert.deepEqual(grab(/OBATA1=(\{[^}]*\});/), T.B1);
  assert.deepEqual(grab(/const ORATE=(\{[^}]*\})/), T.R); assert.deepEqual(grab(/,OBATA=(\{[^}]*\});/), T.B);
  assert.deepEqual(grab(/const RANCH=(\[[^\]]*\]);/), [1, 2, 4, 8, 12]);
  assert.deepEqual(grab(/const PKG=(\[[^\]]*\]);/).map(p => p.h), [1, 2, 3, 4, 5, 6, 8, 10, 12]);
  assert.match(src, /let OMIN1=80,OMIND=250,OLONGKM=400,OLONGPCT=0;/); assert.match(src, /let ODAYKM=400;/);
});

// ---- Auto: Tamil Nadu Government fare (G.O. Ms. No. 366, 27 Oct 2026) and the local area
test('auto fare check uses the Government fare, not the office price list', () => {
  const km = 9.5, gov = Math.round(50 + 25 * (km - 1.8));                                  // 243
  assert.equal(L.fareCheck(ride({ veh: 'auto', km, fare: gov }), CFGF, day), null);
  const old = Math.round((40 + 16 * (km - 1.5)) / 5) * 5;                                 // old office price 170
  const r = L.fareCheck(ride({ veh: 'auto', km, fare: old }), CFGF, day);
  assert.equal(r.fare, gov); assert.equal(r.was, old);
  assert.equal(L.fareCheck(ride({ veh: 'auto', km, fare: gov }), { fares: {} }, day), null, 'works without office prices');
});
test('auto night: 1.5× from 22:00 to 05:00 even when the office night switch is off', () => {
  const km = 9.5, gov = Math.round(50 + 25 * (km - 1.8)), at23 = Date.UTC(2026, 10, 4, 17, 30); // 23:00 IST
  const r = L.fareCheck(ride({ veh: 'auto', km, fare: gov }), CFGF, at23);
  assert.equal(r.fare, Math.round(gov * 1.5)); assert.equal(r.night, 50);
  assert.equal(L.fareCheck(ride({ veh: 'auto', km, fare: Math.round(gov * 1.5) }), CFGF, at23), null);
});
test('local area: rides outside 18 km (autos 25 km) are flagged, outstation never', () => {
  const katpadi = { lat: 12.9690, lon: 79.1440 }, arcot = { lat: 12.9063, lon: 79.3189 }, far = { lat: 12.79, lon: 79.37 };
  assert.equal(L.outsideArea(ride({ to: katpadi }), null), false);
  assert.equal(L.outsideArea(ride({ to: arcot }), null), true, 'sedan to Arcot (~20 km) is outside');
  assert.equal(L.outsideArea(ride({ veh: 'auto', to: arcot }), null), false, 'auto to Arcot is allowed (≤25 km)');
  assert.equal(L.outsideArea(ride({ veh: 'auto', to: far }), null), true);
  assert.equal(L.outsideArea(ride({ to: arcot, kind: 'outstation', tariff: { t: 'out' } }), null), false);
  assert.equal(L.outsideArea(ride({ to: arcot, src: 'phone' }), null), false);
  assert.equal(L.outsideArea(ride({ to: arcot }), { local: 30 }), false, 'owner can widen the area');
});
