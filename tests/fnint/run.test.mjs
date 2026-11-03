// Cloud Functions integration tests: the REAL functions/index.js running in the Firebase emulators
// (Firestore + Functions + Auth). Run: cd tests/fnint && npm i && npm test   (needs Java). Runs in GitHub Actions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const P = 'demo-vct', DRV = '+919999900002', DRV2 = '+919999900003';
admin.initializeApp({ projectId: P });
const db = admin.firestore();
const AUTH = 'http://127.0.0.1:9099', FN = `http://127.0.0.1:5001/${P}/asia-south1`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {        // triggers run asynchronously: poll until the effect shows
  const end = Date.now() + ms; let v;
  while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(250); }
  return v;
}
async function phoneToken(phone) {              // a real ID token from the Auth emulator for a phone login
  const k = '?key=fake';
  const s = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: phone, recaptchaToken: 'x' }) })).json();
  const codes = (await (await fetch(`${AUTH}/emulator/v1/projects/${P}/verificationCodes`)).json()).verificationCodes;
  const code = codes.filter(c => c.sessionInfo === s.sessionInfo)[0].code;
  const r = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionInfo: s.sessionInfo, code }) })).json();
  return r.idToken;
}
async function call(name, data, token) {
  const r = await fetch(`${FN}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ data }) });
  return r.json();
}
const base = o => ({ customerUid: 'u-c', custName: 'Priya', src: 'app', kind: 'ride', veh: 'sedan', fare: 190, tip: 0, pay: 'cash', when: Date.now(), ...o });

before(async () => {
  await db.doc('config/app').set({ comm: 10, fares: { sedan: { base: 60, per: 15 } } });
  await db.doc(`drivers/${DRV}`).set({ name: 'Test', veh: 'sedan', wallet: 500 });
});

after(async () => { await admin.app().delete(); });  // close connections so the run ends

test('app mode: ledger entry written, wallet not touched by the server', async () => {
  const ref = db.doc('bookings/a1');
  await ref.set(base({ status: 'ontrip', driverPhone: DRV }));
  await ref.update({ status: 'done', fareFinal: 220, fx: { trip: 200 }, comm: 20, commLocal: true });
  const l = await waitFor(async () => (await db.doc('ledger/a1').get()).data());
  assert.ok(l, 'ledger entry created');
  assert.equal(l.comm, 20); assert.equal(l.walletDelta, 0); assert.equal(l.mode, 'app'); assert.equal(l.mismatch, false);
  assert.equal((await db.doc(`drivers/${DRV}`).get()).data().wallet, 500);
});

test('server mode: full commission taken on the trip amount, app claim ignored, retry-safe', async () => {
  await db.doc('config/app').set({ serverComm: true }, { merge: true });
  const ref = db.doc('bookings/s1');
  await ref.set(base({ status: 'ontrip', driverPhone: DRV, fare: 290 }));
  // a modified app claims it already took the commission (it did not)
  await ref.update({ status: 'done', fareFinal: 340, fx: { trip: 300 }, comm: 30, commLocal: true });
  const l = await waitFor(async () => (await db.doc('ledger/s1').get()).data());
  assert.ok(l, 'ledger entry created');
  assert.equal(l.comm, 30); assert.equal(l.walletDelta, -30); assert.equal(l.mode, 'server');
  assert.equal(await waitFor(async () => { const w = (await db.doc(`drivers/${DRV}`).get()).data().wallet; return w === 470 ? w : 0; }), 470);
  // a later edit of the finished booking (rating) must not charge again
  await ref.update({ custRating: 5 });
  await sleep(3000);
  assert.equal((await db.doc(`drivers/${DRV}`).get()).data().wallet, 470);
  assert.equal((await ref.get()).data().comm, 30);
  await db.doc('config/app').set({ serverComm: false }, { merge: true });
});

test('fare far below the price list is flagged', async () => {
  await db.doc('bookings/f1').set(base({ status: 'searching', km: 10, fare: 20 }));
  await db.doc('bookings/f2').set(base({ status: 'searching', km: 10, fare: 205 }));
  assert.equal(await waitFor(async () => (await db.doc('bookings/f1').get()).data().fareFlag), 'below-price-list');
  await sleep(1500);
  assert.equal((await db.doc('bookings/f2').get()).data().fareFlag, undefined);
});

test('verifyPin: right driver + right PIN starts the trip; wrong PIN counted; other driver refused; 5 wrong locks', async () => {
  const ref = db.doc('bookings/p1');
  await ref.set(base({ status: 'assigned', driverPhone: DRV }));
  await db.doc('bookings/p1/private/pin').set({ pin: '4321' });
  const t1 = await phoneToken(DRV), t2 = await phoneToken(DRV2);
  assert.equal((await call('verifyPin', { bookingId: 'p1', pin: '1111' }, t1)).result.ok, false);
  assert.equal((await ref.get()).data().pinFails, 1);
  assert.equal((await call('verifyPin', { bookingId: 'p1', pin: '4321' }, t2)).error.status, 'PERMISSION_DENIED');
  assert.equal((await call('verifyPin', { bookingId: 'p1', pin: '4321' })).error.status, 'INVALID_ARGUMENT');
  assert.equal((await call('verifyPin', { bookingId: 'p1', pin: '4321' }, t1)).result.ok, true);
  assert.equal((await ref.get()).data().status, 'ontrip');
  // lock after 5 wrong tries
  const r2 = db.doc('bookings/p2');
  await r2.set(base({ status: 'assigned', driverPhone: DRV }));
  await db.doc('bookings/p2/private/pin').set({ pin: '9999' });
  for (let i = 0; i < 5; i++) await call('verifyPin', { bookingId: 'p2', pin: '0000' }, t1);
  assert.equal((await call('verifyPin', { bookingId: 'p2', pin: '9999' }, t1)).error.status, 'RESOURCE_EXHAUSTED');
  assert.equal((await r2.get()).data().status, 'assigned');
});
