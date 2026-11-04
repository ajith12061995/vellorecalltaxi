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
test('fare check: night charge only when it applied now and 15 min ago; never for rental / outstation / phone', () => {
  const c = { ...CFGF, night: { on: true, from: '22:00', to: '05:00', pct: 25 } };
  const n23 = Date.UTC(2026, 10, 4, 17, 30), n2205 = Date.UTC(2026, 10, 4, 16, 35);  // 23:00 and 22:05 IST
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 280 }), c, n23).fare, 350);         // 130 + 19 × 8 = 282 → ₹280; × 1.25 = ₹350
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 280 }), c, n2205), null, 'just after 22:00 the quote may be from 21:55');
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 10, tariff: { t: 'rent' } }), c, n23), null);
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 10, src: 'phone' }), c, n23), null);
  assert.equal(L.fareCheck(ride({ km: 9.5, fare: 10, kind: 'outstation' }), c, n23), null);
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
