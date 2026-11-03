const { test } = require('node:test'); const assert = require('node:assert');
const L = require('../lib/logic');
const T = ms => ({ toMillis: () => ms });
test('commission on trip only', () => { assert.deepEqual(L.commissionFor({ fare: 190, fareFinal: 274, fx: { trip: 204 } }, 10), { trip: 204, comm: 20 }); });
test('commission falls back to fareFinal then fare', () => {
  assert.equal(L.commissionFor({ fare: 190, fareFinal: 250 }, 10).comm, 25);
  assert.equal(L.commissionFor({ fare: 190 }, 10).comm, 19);
});
test('settle: server mode corrects a too-small driver deduction', () => {
  const s = L.settle({ fare: 190, fx: { trip: 204 }, comm: 10, commLocal: true }, 10, true);
  assert.equal(s.comm, 20); assert.equal(s.walletDelta, -10);
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
