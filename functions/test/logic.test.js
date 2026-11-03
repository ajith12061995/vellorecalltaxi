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
