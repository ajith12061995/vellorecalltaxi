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
test('outstation category A: round trip only, up + down km, no per-day minimum, category allowance', () => {
  const kanchi = { lat: 12.8342, lon: 79.7036 }, A0 = { lat: 12.9165, lon: 79.1325 };
  const leave = Date.UTC(2026, 10, 10, 3, 30);
  const c = { out: { rate: { sedan: 12 }, bata: { sedan: 300 }, rate1: { sedan: 12 }, bata1: { sedan: 300 }, cat: { a: 100, b: 150 }, cb: { A: { sedan: 450 } } } };
  const ok = { src: 'app', kind: 'outstation', veh: 'sedan', from: A0, to: kanchi, when: leave, retAt: leave + 5 * 3600e3, km: 140,
    tariff: { t: 'out', otype: 'round', km: 70, days: 1, rate: 12, bata: 450, min1: 80, mind: 0, cat: 'A', daykm: 400, longKm: 400, longPct: 0, ph: 5, xh: 90, plan: 5, hx: 0 } };
  ok.fare = Math.round((140 * 12 + 450) / 10) * 10;                                  // 2130 (140 km up + down → 5 hours included)
  assert.equal(L.outCheck(ok, c), null, 'honest A round trip is not changed');
  const long = L.outCheck({ ...ok, retAt: leave + 8 * 3600e3 }, c);                  // back after 8 hours: 3 hours × ₹90 more
  assert.equal(long.fare, 2400); assert.equal(long.tariff.plan, 8); assert.equal(long.tariff.hx, 270);
  const oneWay = { ...ok, otype: 'one', fare: Math.round((80 * 12 + 300) / 10) * 10, tariff: { ...ok.tariff, otype: 'one', bata: 300, mind: 250 } };
  const r = L.outCheck(oneWay, c);
  assert.equal(r.tariff.otype, 'round'); assert.equal(r.tariff.mind, 0); assert.equal(r.tariff.bata, 450); assert.equal(r.fare, ok.fare);
  const B = L.outCheck({ ...ok, to: { lat: 13.6288, lon: 79.4192 }, otype: 'one', fare: 1, tariff: { t: 'out', otype: 'one', km: 115 } }, { out: { ...c.out, cb: { B: { sedan: 500 } } } });
  assert.equal(B.tariff.otype, 'one'); assert.equal(B.tariff.cat, 'B'); assert.equal(B.tariff.bata, 500);
});

test('enquiryFlood: more than 3 from one number or 40 in total per hour', () => {
  assert.strictEqual(L.enquiryFlood(1, 1), null);
  assert.strictEqual(L.enquiryFlood(3, 40), null);
  assert.match(L.enquiryFlood(4, 4), /more than 3/);
  assert.match(L.enquiryFlood(1, 41), /more than 40/);
});

test('driver watch: ready / nudge once / pause after 3 h / night / skips', () => {
  const day = Date.parse('2026-11-27T05:00:00Z'), night = Date.parse('2026-11-26T20:00:00Z'); // 10:30 and 01:30 IST
  const D = { online: true }, Lv = ago => ({ updatedAt: T(day - ago) });
  assert.equal(L.driverWatch(D, Lv(5 * 60e3), null, day), null);
  assert.deepEqual(L.driverWatch(D, Lv(31 * 60e3), null, day), { nudge: true, gap: 31 * 60e3 });
  assert.equal(L.driverWatch(D, Lv(40 * 60e3), { nudgeAt: T(day - 9 * 60e3) }, day), null, 'already reminded this spell');
  assert.equal(L.driverWatch(D, Lv(40 * 60e3), { nudgeAt: T(day - 50 * 60e3) }, day).nudge, true, 'new silent spell');
  const p = L.driverWatch(D, Lv(3 * 3600e3), null, day); assert.equal(p.pause, true); assert.equal(p.push, true);
  const nl = { updatedAt: T(night - 31 * 60e3) };
  assert.equal(L.driverWatch(D, nl, null, night), null, 'no reminder at night');
  assert.deepEqual(L.driverWatch(D, { updatedAt: T(night - 4 * 3600e3) }, null, night), { pause: true, push: false, gap: 4 * 3600e3 });
  assert.equal(L.driverWatch({ online: false }, Lv(5 * 3600e3), null, day), null);
  assert.equal(L.driverWatch({ online: true, blocked: true }, Lv(5 * 3600e3), null, day), null);
  assert.equal(L.driverWatch(D, { ...Lv(5 * 3600e3), busy: true }, null, day), null, 'on a job');
  assert.equal(L.driverWatch(D, { ...Lv(5 * 3600e3), bk: 'b1' }, null, day), null, 'on a job');
  assert.equal(L.driverWatch({ online: true, updatedAt: T(day - 60e3) }, Lv(5 * 3600e3), null, day), null, 'driver doc newer than live');
  assert.equal(L.driverWatch({ online: true, updatedAt: T(day - 4 * 3600e3) }, null, null, day).pause, true, 'no live doc');
  assert.equal(L.driverWatch(D, null, null, day), null, 'no time at all');
  assert.equal(L.istHour(day), 10); assert.equal(L.istHour(night), 1);
  assert.match(L.watchMsg('pause').body, /3 மணி/); assert.match(L.watchMsg('nudge', 'en').title, /open the app/);
});
test('owner alerts: waiting ride once, no-ready every 30 min in the day, paused names', () => {
  const now = Date.parse('2026-11-27T05:00:00Z'), b = (id, ago, x) => ({ id, status: 'searching', kind: 'ride', veh: 'mini', fare: 120, from: { ta: 'காட்பாடி' }, to: { ta: 'CMC' }, createdAt: T(now - ago), ...x });
  let r = L.ownerAlerts({ open: [b('a', 3 * 60e3), b('b', 60e3), b('c', 3 * 60e3, { driverPhone: '+91x' }), b('d', 3 * 60e3, { kind: 'outstation' }), b('e', 25 * 60e3)], ready: 2, on: 3, paused: [], sent: {}, now });
  assert.deepEqual(r.out.map(a => a.tag), ['wait-a']); assert.match(r.out[0].body, /காட்பாடி → CMC · mini · ₹120 · 3 நிமிஷம்/);
  r = L.ownerAlerts({ open: [b('a', 4 * 60e3)], ready: 2, on: 3, sent: { bk_a: true }, now }); assert.equal(r.out.length, 0, 'once per booking');
  r = L.ownerAlerts({ open: [], ready: 0, on: 4, sent: {}, now }); assert.equal(r.out[0].kind, 'noready'); assert.equal(r.mark.noready, now);
  assert.equal(L.ownerAlerts({ open: [], ready: 0, on: 4, sent: { noready: now - 10 * 60e3 }, now }).out.length, 0, 'not within 30 min');
  assert.equal(L.ownerAlerts({ open: [], ready: 0, on: 4, sent: { noready: now - 31 * 60e3 }, now }).out.length, 1);
  assert.equal(L.ownerAlerts({ open: [], ready: 0, on: 0, sent: {}, now }).out.length, 0, 'nobody ON: nothing to say');
  assert.equal(L.ownerAlerts({ open: [], ready: 0, on: 4, sent: {}, now: Date.parse('2026-11-26T20:00:00Z') }).out.length, 0, 'not at night');
  r = L.ownerAlerts({ open: [], ready: 1, on: 2, paused: ['Ravi', 'Siva'], sent: {}, now }); assert.match(r.out[0].body, /Ravi, Siva/);
});

test('scorecard helpers', () => {
  assert.equal(L.statDay(Date.parse('2026-11-27T18:29:00Z')), 'd20261127'); assert.equal(L.statDay(Date.parse('2026-11-27T18:31:00Z')), 'd20261128');
  const now = 1e12; assert.deepEqual(L.scoreSample({ online: true }, { updatedAt: T(now - 60e3) }, now, 2), { on: 2, act: 2, job: 0 });
  assert.equal(L.scoreSample({ online: false }, null, now, 2), null);
  assert.deepEqual(L.scoreSample({ online: true }, null, now, 2), { on: 2, act: 0, job: 0 });
});

test('demand map: cells per time of day, named by the usual pickup, last 14 days only', () => {
  const now = Date.parse('2026-11-27T12:00:00Z'), at = (dIST, h) => T(Date.parse(`2026-11-${dIST}T${String(h).padStart(2, '0')}:10:00+05:30`));
  const B = (lat, lon, ta, en, c, x) => ({ from: { lat, lon, ta, en }, createdAt: c, ...x });
  const bk = [B(12.9716, 79.1590, 'காட்பாடி ரயில் நிலையம்', 'Katpadi Junction', at(26, 7)), B(12.9717, 79.1591, 'காட்பாடி ரயில் நிலையம்', 'Katpadi Junction', at(25, 9)),
    B(12.9718, 79.1589, 'காட்பாடி', 'Katpadi', at(24, 8)), B(12.9246, 79.1353, 'CMC', 'CMC', at(26, 7)), B(12.9246, 79.1353, 'CMC', 'CMC', at(26, 18)),
    B(12.9246, 79.1353, 'CMC', 'CMC', at(26, 23)), B(12.9246, 79.1353, 'CMC', 'CMC', at(1, 7)), B(12.9, 79.1, 'x', 'x', at(26, 7), { cancelReason: 'limit' }), { from: {}, createdAt: at(26, 7) }];
  bk[6].createdAt = T(now - 20 * 864e5);
  const d = L.demandMap(bk, now, 14);
  assert.equal(d.m.length, 2); assert.equal(d.m[0].n, 3); assert.equal(d.m[0].ta, 'காட்பாடி ரயில் நிலையம்'); assert.equal(d.m[0].en, 'Katpadi Junction');
  assert.equal(d.m[1].ta, 'CMC'); assert.equal(d.m[1].n, 1, 'older than 14 days not counted');
  assert.equal(d.e.length, 1); assert.equal(d.n.length, 1); assert.equal(d.a.length, 0);
  assert.equal(L.bandOf(4), 'n'); assert.equal(L.bandOf(5), 'm'); assert.equal(L.bandOf(11), 'a'); assert.equal(L.bandOf(16), 'e'); assert.equal(L.bandOf(21), 'n');
});

test('demand map place names skip door numbers', () => {
  assert.equal(L.placeName('4, Gandhi Road, Katpadi'), 'Gandhi Road'); assert.equal(L.placeName('15/5'), ''); assert.equal(L.placeName('No. 12, CMC'), 'CMC');
  assert.equal(L.placeName('80B, Amman Koil St'), 'Amman Koil St'); assert.equal(L.placeName('Katpadi Junction'), 'Katpadi Junction');
  const now = Date.parse('2026-11-27T12:00:00Z'), c = T(now - 3600e3);
  const d = L.demandMap([{ from: { lat: 12.97, lon: 79.15, ta: '4', en: '4, Gandhi Nagar' }, createdAt: c }, { from: { lat: 12.97, lon: 79.15, ta: '80', en: '80' }, createdAt: c }], now, 14);
  const all = [...d.m, ...d.a, ...d.e, ...d.n]; assert.equal(all.length, 1); assert.equal(all[0].ta, 'Gandhi Nagar'); assert.equal(all[0].n, 2);
});

test('new-ride push: 1.0.17+ apps get the data message, others the notification', () => {
  const r = L.splitDriverTokens([{ fcm: 'a', dev: { app: '1.0.17+' } }, { fcm: 'b', dev: { app: '1.0.16+' } }, { fcm: 'c' }, { fcm: 'd', dev: { app: '1.0.15-' } },
    { fcm: 'e', dev: { app: '1.0.21+' } }, { dev: { app: '1.0.17+' } }, { fcm: 'f', dev: { app: 'old' } }, { fcm: 'g', dev: { app: '1.1.0+' } }]);
  assert.deepEqual(r.data, ['a', 'e', 'g']); assert.deepEqual(r.note, ['b', 'c', 'd', 'f']);
  const d = L.ridePushData('bk1', { veh: 'mini', fare: 150, from: { ta: 'காட்பாடி' }, to: { en: 'CMC' }, custName: 'Kala', custPhone: '+91999' });
  assert.deepEqual(d, { type: 'ride', bookingId: 'bk1', veh: 'mini', kind: 'ride', fare: '150', tip: '0', from: 'காட்பாடி', to: 'CMC', flat: '', flon: '', when: '', km: '' });
  const d2 = L.ridePushData('bk2', { veh: 'auto', fare: 60, tip: 10, when: 1795800000000, from: { en: 'Katpadi', lat: 12.9716, lon: 79.159 }, to: { ta: 'சிஎம்சி' } });
  assert.equal(d2.flat, '12.9716'); assert.equal(d2.flon, '79.159'); assert.equal(d2.when, '1795800000000'); assert.equal(d2.tip, '10');
  assert.ok(!('custPhone' in d2) && !('custName' in d) && !('custPhone' in d), 'no customer details in a push');
  assert.ok(Object.values(d).every(v => typeof v === 'string'));
});

test('subscription: price, decision, active window, no commission while it runs', () => {
  const cfg = { subs: { auto: { day: 49, week: 299, month: 0 }, mini: { day: 99, week: '599', month: 1999 } } };
  assert.equal(L.subPrice(cfg, 'mini', 'week'), 599); assert.equal(L.subPrice(cfg, 'auto', 'month'), 0); assert.equal(L.subPrice(cfg, 'suv', 'day'), 0); assert.equal(L.subPrice({}, 'mini', 'day'), 0);
  const now = Date.parse('2026-11-27T12:00:00Z'), D = (x) => ({ veh: 'mini', wallet: 500, ...x });
  assert.deepEqual(L.buySubDecide(D(), cfg, 'day', now), { ok: true, price: 99, walletAfter: 401, sub: { plan: 'day', veh: 'mini', price: 99, from: now, until: now + 864e5 } });
  assert.equal(L.buySubDecide(D(), cfg, 'month', now).why, 'wallet'); assert.equal(L.buySubDecide(D(), cfg, 'month', now).need, 1499);
  assert.equal(L.buySubDecide(D({ wallet: 1999 }), cfg, 'month', now).sub.until, now + 30 * 864e5);
  assert.equal(L.buySubDecide(D({ veh: 'auto' }), cfg, 'month', now).why, 'off', 'price 0 = not offered');
  assert.equal(L.buySubDecide(D(), cfg, 'year', now).why, 'plan');
  assert.equal(L.buySubDecide(D({ blocked: true }), cfg, 'day', now).why, 'blocked');
  assert.equal(L.buySubDecide(null, cfg, 'day', now).why, 'driver');
  assert.equal(L.buySubDecide(D({ sub: { from: T(now - 3600e3), until: T(now + 3600e3) } }), cfg, 'day', now).why, 'active');
  assert.equal(L.buySubDecide(D({ sub: { from: T(now - 2 * 864e5), until: T(now - 1) } }), cfg, 'day', now).ok, true, 'ended plan → can buy again');
  assert.equal(L.buySubDecide(D({ wallet: 99 }), cfg, 'day', now).walletAfter, 0, 'exactly enough');
  const sub = { from: T(now), until: T(now + 864e5) };
  assert.equal(L.subActive(sub, now), true); assert.equal(L.subActive(sub, now + 864e5), false); assert.equal(L.subActive(sub, now - 1), false); assert.equal(L.subActive(null, now), false);
  // server mode: no commission taken while subscribed; app mode: an app that still took commission is flagged
  assert.deepEqual(L.settle({ fare: 300 }, 10, true, true), { trip: 300, comm: 0, taken: 0, walletDelta: 0, mismatch: false });
  assert.equal(L.settle({ fare: 300 }, 10, true, false).walletDelta, -30);
  assert.equal(L.settle({ fare: 300, comm: 0, commLocal: true }, 10, false, true).mismatch, false);
  assert.equal(L.settle({ fare: 300, comm: 30, commLocal: true }, 10, false, true).mismatch, true);
});

test('reassign: phone off before pickup → other driver; new app silent 5 min → other driver; old app / trip / arrived → no', () => {
  const now = Date.parse('2026-11-27T12:00:00Z'), b = x => ({ status: 'assigned', kind: 'ride', driverPhone: '+91d', assignedAt: T(now - 6 * 60e3), when: now - 6 * 60e3, ...x });
  const lv = (ago, x) => ({ updatedAt: T(now - ago), ...x }), NEW = { dev: { app: '1.0.17+' } }, OLD = { dev: { app: '1.0.16+' } };
  assert.equal(L.reassignCheck(b(), lv(3 * 60e3, { pwr: 'off' }), OLD, now).why, 'phoneoff', 'switched off (said by the phone) 3 min ago');
  assert.equal(L.reassignCheck(b(), lv(60e3, { pwr: 'off' }), NEW, now), null, 'only 1 min: maybe a restart');
  assert.equal(L.reassignCheck(b(), lv(6 * 60e3, { pwr: 'on' }), NEW, now).why, 'nosignal');
  assert.equal(L.reassignCheck(b(), lv(6 * 60e3, { pwr: 'on' }), OLD, now), null, 'old app: silence alone not trusted');
  assert.equal(L.reassignCheck(b(), lv(4 * 60e3), NEW, now), null, 'under 5 min');
  assert.equal(L.reassignCheck(b({ arrivedAt: T(now - 60e3) }), lv(9 * 60e3, { pwr: 'off' }), NEW, now), null, 'at pickup already');
  assert.equal(L.reassignCheck(b({ kind: 'outstation' }), lv(9 * 60e3, { pwr: 'off' }), NEW, now), null);
  assert.equal(L.reassignCheck(b({ when: now + 2 * 3600e3 }), lv(9 * 60e3, { pwr: 'off' }), NEW, now), null, 'ride for later');
  assert.equal(L.reassignCheck(b({ assignedAt: T(now - 60e3) }), lv(9 * 60e3, { pwr: 'off' }), NEW, now), null, 'just assigned');
  assert.deepEqual(L.reassignCheck(b({ status: 'ontrip' }), lv(3 * 60e3, { pwr: 'off' }), NEW, now), { alert: 'ontrip-off', gap: 3 * 60e3 }, 'on a trip: alert only');
  assert.equal(L.reassignCheck(b({ status: 'ontrip' }), lv(30 * 60e3), NEW, now), null);
  assert.equal(L.reassignCheck(b(), null, NEW, now), null);
  const d = L.driverWatch({ online: true }, lv(3 * 60e3, { pwr: 'off' }), null, now);
  assert.equal(d.pause, true); assert.equal(d.off, true); assert.equal(d.push, false);
  const m = L.custPush({ status: 'assigned' }, { status: 'searching', customerUid: 'u', reassigned: { why: 'phoneoff' } }, 'ta');
  assert.equal(m.kind, 'reassigned'); assert.match(m.body, /switch off/);
  const a = L.ownerAlerts({ open: [], ready: 1, on: 1, sent: {}, now, moved: [{ id: 'b1', why: 'phoneoff', b: { driverName: 'Ravi', from: { ta: 'காட்பாடி' } } }, { id: 'b2', alert: true, b: { driverName: 'Siva', from: { ta: 'CMC' } } }] });
  assert.deepEqual(a.out.map(x => x.kind), ['moved', 'tripoff']); assert.match(a.out[0].body, /Ravi phone switch off · காட்பாடி/);
});

test('ride pushed again only while nobody has taken it (local rides)', () => {
  assert.ok(L.REPUSH.length >= 3 && L.REPUSH.reduce((a, b) => a + b, 0) <= 120, 'within the function time');
  assert.equal(L.repushNow({ status: 'searching' }), true);
  assert.equal(L.repushNow({ status: 'searching', kind: 'ride' }), true);
  assert.equal(L.repushNow({ status: 'assigned', driverPhone: '+91' }), false);
  assert.equal(L.repushNow({ status: 'searching', driverPhone: '+91' }), false);
  assert.equal(L.repushNow({ status: 'cancelled' }), false);
  assert.equal(L.repushNow({ status: 'searching', kind: 'outstation' }), false, 'outstation has its own dispatch rounds');
  assert.equal(L.repushNow({ status: 'searching', kind: 'rental' }), false);
  assert.equal(L.repushNow(null), false);
});
test('referral: off by default; amount only when ON and above 0, capped at ₹500', () => {
  assert.equal(L.refAmt({}), 0); assert.equal(L.refAmt({ grow: { ref: { on: false, amt: 30 } } }), 0); assert.equal(L.refAmt({ grow: { ref: { on: true, amt: 0 } } }), 0);
  assert.equal(L.refAmt({ grow: { ref: { on: true, amt: 30 } } }), 30); assert.equal(L.refAmt({ grow: { ref: { on: true, amt: 9000 } } }), 500);
});
test('referral: paid only on the first finished ride, to a real other customer, once', () => {
  const ok = { cfg: { grow: { ref: { on: true, amt: 30 } } }, refBy: '+919888888888', phone: '+919999900001', already: false, referrerExists: true, doneCount: 1 };
  assert.equal(L.referDecide(ok), 30);
  assert.equal(L.referDecide({ ...ok, doneCount: 2 }), 0, 'not the first ride');
  assert.equal(L.referDecide({ ...ok, already: true }), 0, 'paid already');
  assert.equal(L.referDecide({ ...ok, refBy: ok.phone }), 0, 'own number');
  assert.equal(L.referDecide({ ...ok, referrerExists: false }), 0, 'referrer never signed in');
  assert.equal(L.referDecide({ ...ok, refBy: '12345' }), 0, 'bad number');
  assert.equal(L.referDecide({ ...ok, cfg: {} }), 0, 'referral off');
});
test('referral discount: no more than asked, the credit, the fare or ₹500', () => {
  assert.equal(L.discTake(30, 60, 120), 30); assert.equal(L.discTake(30, 10, 120), 10); assert.equal(L.discTake(300, 900, 120), 120);
  assert.equal(L.discTake(900, 900, 2000), 500); assert.equal(L.discTake(30, 0, 120), 0); assert.equal(L.discTake('x', 60, 120), 0); assert.equal(L.discTake(-5, 60, 120), 0);
});
test('GPS meter check: flags only real problems', () => {
  const srv = { km: 6.0, gapKm: 0, waitMin: 2, gaps: 0, jumps: 0, pts: 120 };
  const b = o => ({ km: 6, tariff: { t: 'local', mode: 'meter' }, fx: { km: 6.1, gps: { km: 6.1, mock: 0, src: 'app' } }, ...o });
  assert.equal(L.meterCheck(b(), srv).flag, '');
  assert.equal(L.meterCheck(b({ fx: { km: 7.5, gps: { km: 7.5 } } }), srv).flag, 'high', 'billed 7.5 km, route 6.0');
  assert.equal(L.meterCheck(b({ fx: { km: 6.2, gps: { km: 6.2, mock: 3 } } }), srv).flag, 'mock');
  assert.equal(L.meterCheck(b(), null).flag, 'notrack', 'billed by GPS with no route uploaded');
  assert.equal(L.meterCheck(b({ tariff: { t: 'local' } }), null).flag, '', 'booked-fare ride without a route: nothing to check');
  assert.equal(L.meterCheck(b({ tariff: { t: 'local' }, km: 3 }), srv).flag, 'long', 'ran 6 km for a 3 km booking');
  assert.equal(L.meterCheck(b(), srv).srv.km, 6.0);
});
test('coupons: server decides — off, expired, used up, one per customer, first ride only, minimum fare, % with a cap', () => {
  const cp = o => ({ on: true, type: 'amt', val: 50, max: 0, min: 0, limit: 0, used: 0, until: 0, first: false, ...o }), x = o => ({ fare: 200, now: 1000, usedByMe: false, firstRide: true, ...o });
  assert.deepEqual(L.couponDecide(cp(), x()), { disc: 50, why: '' });
  assert.equal(L.couponDecide(null, x()).why, 'unknown'); assert.equal(L.couponDecide(cp({ on: false }), x()).why, 'off');
  assert.equal(L.couponDecide(cp({ until: 999 }), x()).why, 'expired'); assert.equal(L.couponDecide(cp({ limit: 10, used: 10 }), x()).why, 'used-up');
  assert.equal(L.couponDecide(cp(), x({ usedByMe: true })).why, 'used'); assert.equal(L.couponDecide(cp({ first: true }), x({ firstRide: false })).why, 'first-only');
  assert.equal(L.couponDecide(cp({ min: 250 }), x()).why, 'min');
  assert.equal(L.couponDecide(cp({ type: 'pct', val: 20, max: 30 }), x()).disc, 30, '20 % of 200 = 40, capped at 30');
  assert.equal(L.couponDecide(cp({ type: 'pct', val: 10 }), x()).disc, 20);
  assert.equal(L.couponDecide(cp({ val: 900 }), x()).disc, 200, 'never more than the fare');
  assert.ok(L.COUPON_RE.test('VELLORE50') && !L.COUPON_RE.test('ab') && !L.COUPON_RE.test('x y'));
});

test('walletOpDecide: recharge once, one UTR once, bonus from settings once a day, + / − with a reason', () => {
  const drv = { wallet: 100 }, now = Date.UTC(2026, 10, 28, 10), day = '2026-11-28';
  const R = x => ({ status: 'pending', amt: 500, utr: '401234567890', ...x });
  assert.deepEqual(L.walletOpDecide({ kind: 'recharge' }, { drv, rch: R(), now }), { ok: true, delta: 500, type: 'recharge', utr: '401234567890' });
  assert.equal(L.walletOpDecide({ kind: 'recharge' }, { drv, rch: null }).why, 'no-recharge');
  assert.equal(L.walletOpDecide({ kind: 'recharge' }, { drv, rch: R({ status: 'approved' }) }).why, 'done');
  assert.equal(L.walletOpDecide({ kind: 'recharge' }, { drv: null, rch: R() }).why, 'no-driver');
  assert.equal(L.walletOpDecide({ kind: 'recharge' }, { drv, rch: R({ amt: 0 }) }).why, 'bad-amount');
  assert.equal(L.walletOpDecide({ kind: 'recharge' }, { drv, rch: R({ amt: 100001 }) }).why, 'bad-amount');
  assert.equal(L.walletOpDecide({ kind: 'recharge' }, { drv, rch: R({ utr: '12345' }) }).why, 'bad-utr');
  const dup = L.walletOpDecide({ kind: 'recharge' }, { drv, rch: R(), utrUsed: true }); assert.equal(dup.why, 'dup-utr'); assert.equal(dup.reject, true);
  const cfg = { grow: { bonus: { on: true, amt: 40 } } };
  assert.deepEqual(L.walletOpDecide({ kind: 'bonus', amt: 9999 }, { drv, cfg, now }), { ok: true, delta: 40, type: 'bonus', day });
  assert.equal(L.walletOpDecide({ kind: 'bonus' }, { drv: { bonusPaid: day }, cfg, now }).why, 'paid-today');
  assert.equal(L.walletOpDecide({ kind: 'bonus' }, { drv, cfg: { grow: { bonus: { on: false, amt: 40 } } }, now }).why, 'bonus-off');
  assert.equal(L.walletOpDecide({ kind: 'bonus' }, { drv, cfg: {}, now }).why, 'bonus-off');
  assert.deepEqual(L.walletOpDecide({ kind: 'adjust', amt: -50, reason: ' Toll ' }, { drv }), { ok: true, delta: -50, type: 'adjust', reason: 'Toll' });
  assert.equal(L.walletOpDecide({ kind: 'adjust', amt: -50, reason: 'ab' }, { drv }).why, 'reason');
  for (const amt of [0, 1.5, 20001, -20001, '50', null]) assert.equal(L.walletOpDecide({ kind: 'adjust', amt, reason: 'Toll' }, { drv }).why, 'bad-amount', String(amt));
  assert.equal(L.walletOpDecide({ kind: 'adjust', amt: 5, reason: 'Toll' }, { drv: null }).why, 'no-driver');
  assert.equal(L.walletOpDecide({ kind: 'x' }, { drv }).why, 'bad-kind');
  assert.equal(L.istDate(Date.UTC(2026, 10, 28, 18, 31)), '2026-11-29', 'after 18:30 UTC it is the next IST day');
});

test('loginDecide: 5 OTPs per number and device per hour; driver app only office-added or applicants, never blocked', () => {
  const now = 1e10, H = 3600e3;
  assert.deepEqual(L.loginDecide({ app: 'customer', now, hits: [], devHits: [] }), { ok: true, hits: [now], devHits: [now] });
  const four = [now - 1, now - 2, now - 3, now - 4];
  assert.equal(L.loginDecide({ app: 'customer', now, hits: four, devHits: [] }).ok, true);
  const five = [now - 10e3, now - 20e3, now - 30e3, now - 40e3, now - 50e3];
  const r = L.loginDecide({ app: 'customer', now, hits: five, devHits: [] }); assert.equal(r.why, 'rate'); assert.equal(r.wait, 3550);
  assert.equal(L.loginDecide({ app: 'customer', now, hits: [], devHits: five }).why, 'rate', 'per device too');
  assert.equal(L.loginDecide({ app: 'customer', now, hits: five.map(t => t - H), devHits: [] }).ok, true, 'older than an hour do not count');
  assert.equal(L.loginDecide({ app: 'driver', now, drv: null, hits: [] }).why, 'unregistered');
  assert.equal(L.loginDecide({ app: 'driver', now, drv: null, appl: true, hits: [] }).ok, true);
  assert.deepEqual(L.loginDecide({ app: 'driver', now, drv: { blocked: true, blockWhy: 'Docs' }, hits: [] }), { ok: false, why: 'blocked', reason: 'Docs' });
  assert.equal(L.loginDecide({ app: 'driver', now, drv: { blocked: true }, hits: five }).why, 'blocked', 'the reason before the rate');
  assert.equal(L.loginDecide({ app: 'driver', now, drv: { name: 'x' }, hits: five }).why, 'rate');
});
