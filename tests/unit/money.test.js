// node tests/unit/money.test.js — Office → Money totals (core/money.js)
const M = require('../../core/money.js'); const assert = require('assert');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
const at = ms => ({ toMillis: () => ms }), D1 = Date.UTC(2026, 10, 27, 6), D2 = Date.UTC(2026, 10, 28, 6);
const L = [
  { bookingId: 'b1', driverPhone: '+91a', trip: 300, comm: 30, walletDelta: -30, at: at(D1) },
  { bookingId: 'b2', driverPhone: '+91a', trip: 200, comm: 20, walletDelta: -20, at: at(D2) },
  { type: 'sub', driverPhone: '+91a', plan: 'day', price: 99, walletDelta: -99, at: at(D2) },
  { bookingId: 'b2', driverPhone: '+91a', disc: 30, kind: 'coupon-discount', coupon: 'VELLORE30', at: at(D2) },
  { bookingId: 'b3', driverPhone: '+91b', disc: 25, kind: 'referral-discount', at: at(D1) },
  { type: 'recharge', method: 'upi', driverPhone: '+91a', amt: 500, utr: '401234567890', at: at(D1) },
  { type: 'recharge', method: 'razorpay', driverPhone: '+91b', amt: 200, utr: 'pay_X', at: at(D2) },
  { type: 'bonus', driverPhone: '+91a', amt: 40, day: '2026-11-28', at: at(D2) },
  { type: 'adjust', driverPhone: '+91a', amt: -50, reason: 'Toll', at: at(D2) },
  { type: 'adjust', driverPhone: '+91b', amt: 20, reason: '=HYPERLINK("x")', at: at(D2) },
];
ok('totals: in, earned, paid out, net; adjustments kept apart', () => {
  const t = M.sum(L);
  assert.equal(t.cashIn, 700); assert.equal(t.rchN, 1); assert.equal(t.rzpN, 1);
  assert.equal(t.comm, 50); assert.equal(t.trips, 2); assert.equal(t.tripAmt, 500); assert.equal(t.sub, 99);
  assert.equal(t.earn, 149); assert.equal(t.coupon, 30); assert.equal(t.referral, 25); assert.equal(t.bonus, 40); assert.equal(t.cost, 95); assert.equal(t.net, 54);
  assert.equal(t.adjIn, 20); assert.equal(t.adjOut, 50); assert.equal(t.adjN, 2);
});
ok('empty / junk lines', () => { const t = M.sum([]); assert.equal(t.net, 0); assert.equal(M.sum([{ type: 'recharge', amt: 'x' }]).cashIn, 0); });
ok('by IST day, newest first', () => {
  const d = M.byDay(L); assert.deepEqual(d.map(x => x.day), ['2026-11-28', '2026-11-27']);
  assert.equal(d[0].earn, 119); assert.equal(d[1].cashIn, 500); assert.equal(d[1].referral, 25);
  assert.equal(M.istDay(Date.UTC(2026, 10, 28, 18, 30)), '2026-11-29');
});
ok('CSV: one row per line, oldest first, a formula-looking reason is defused', () => {
  const c = M.csv(L, ph => ph === '+91a' ? 'Ravi' : 'Kumar').split('\n');
  assert.equal(c.length, L.length + 1); assert.ok(c[0].startsWith('Date (IST),Time,Driver'));
  assert.ok(c.some(r => r.includes('Ravi,+91a,Wallet recharge,500,,,UTR 401234567890')), 'recharge row');
  assert.ok(c.some(r => r.includes('Ravi,+91a,Ride commission,30,-30,300,b1')), 'trip row');
  assert.ok(c.some(r => r.includes(`Office adjustment,20,,,"'=HYPERLINK(""x"")"`)), 'formula defused: ' + c.find(r => r.includes('HYPERLINK')));
  assert.ok(c.some(r => r.includes('Discount paid,30,30,,coupon-discount VELLORE30')));
});
console.log(`money: ${n} passed`);
