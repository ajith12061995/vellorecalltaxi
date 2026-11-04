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

test('server fare check: a lowered app fare is corrected to the price list; a right one is left alone', async () => {
  await db.doc('bookings/f1').set(base({ status: 'searching', km: 10, fare: 20 }));
  await db.doc('bookings/f2').set(base({ status: 'searching', km: 10, fare: 205 }));
  assert.equal(await waitFor(async () => (await db.doc('bookings/f1').get()).data().fareFlag), 'corrected');
  const f1 = (await db.doc('bookings/f1').get()).data();
  assert.equal(f1.fare, 190); assert.equal(f1.fareWas, 20);           // 60 + 15 × 8.5 = 187.5 → ₹190
  await sleep(1500);
  const f2 = (await db.doc('bookings/f2').get()).data();
  assert.equal(f2.fareFlag, undefined); assert.equal(f2.fare, 205);
  // a faked 1 km for a 7 km trip: the straight line counts
  await db.doc('bookings/f3').set(base({ customerUid: 'u-f3', status: 'searching', km: 1, fare: 60, from: { lat: 12.9165, lon: 79.1325 }, to: { lat: 12.9716, lon: 79.1588 } }));
  const f3 = await waitFor(async () => { const d = (await db.doc('bookings/f3').get()).data(); return d.fareFlag ? d : null; });
  assert.equal(f3.fareFlag, 'corrected'); assert.ok(f3.km > 7.5 && f3.fare > 150, JSON.stringify([f3.km, f3.fare]));
});

test('booking limits: a 4th open booking from the same customer is cancelled by the server', async () => {
  for (const id of ['l1', 'l2', 'l3']) await db.doc(`bookings/${id}`).set(base({ customerUid: 'u-spam', status: 'searching', km: 3, fare: 100 }));
  assert.ok(await waitFor(async () => ((await db.doc('limits/u-spam').get()).data() || { open: [] }).open.length === 3), 'three counted');
  await db.doc('bookings/l4').set(base({ customerUid: 'u-spam', status: 'searching', km: 3, fare: 100 }));
  const l4 = await waitFor(async () => { const d = (await db.doc('bookings/l4').get()).data(); return d.status === 'cancelled' ? d : null; });
  assert.ok(l4, 'l4 cancelled'); assert.equal(l4.cancelReason, 'limit'); assert.equal(l4.limitWhy, 'open');
  for (const id of ['l1', 'l2', 'l3']) assert.equal((await db.doc(`bookings/${id}`).get()).data().status, 'searching');
  // after one finishes, a new one is allowed
  await db.doc('bookings/l1').update({ status: 'cancelled', cancelReason: 'customer' });
  await db.doc('bookings/l5').set(base({ customerUid: 'u-spam', status: 'searching', km: 3, fare: 100 }));
  await sleep(3000);
  assert.equal((await db.doc('bookings/l5').get()).data().status, 'searching');
});

test('commission is never taken below the booked fare', async () => {
  await db.doc('config/app').set({ serverComm: true }, { merge: true });
  await db.doc(`drivers/${DRV2}`).set({ name: 'T2', veh: 'sedan', wallet: 500 });
  const ref = db.doc('bookings/c1');
  await ref.set(base({ status: 'ontrip', driverPhone: DRV2, fare: 300 }));
  await ref.update({ status: 'done', fareFinal: 120, fx: { trip: 100 } });   // a modified app reports a lower bill
  const l = await waitFor(async () => (await db.doc('ledger/c1').get()).data());
  assert.equal(l.comm, 30); assert.equal(l.trip, 300);
  await db.doc('config/app').set({ serverComm: false }, { merge: true });
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

test('deleteMyAccount: customer data removed, trips kept without name/number; refused with an active ride; driver → office request', async () => {
  const CP = '+919999900011', tok = await phoneToken(CP);
  const uid = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).user_id;
  await db.doc(`users/${uid}`).set({ name: 'Ravi', phone: CP });
  await db.doc('bookings/d1').set(base({ customerUid: uid, custName: 'Ravi', custPhone: CP, status: 'searching' }));
  await db.doc('bookings/d1/chat/m1').set({ from: 'c', text: 'hi' });
  await db.doc('bookings/d1/private/contact').set({ custPhone: CP });
  assert.equal((await call('deleteMyAccount', {}, tok)).result.why, 'active');
  assert.ok((await db.doc(`users/${uid}`).get()).exists, 'nothing deleted while active');
  await db.doc('bookings/d1').update({ status: 'done' });
  const r = (await call('deleteMyAccount', {}, tok)).result;
  assert.equal(r.ok, true); assert.equal(r.bookings, 1);
  const b = (await db.doc('bookings/d1').get()).data();
  assert.equal(b.custName, 'Deleted user'); assert.equal(b.custPhone, undefined); assert.equal(b.fare, 190);
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
  assert.equal((await db.doc('bookings/d1/chat/m1').get()).exists, false);
  assert.equal((await db.doc('bookings/d1/private/contact').get()).exists, false);
  await assert.rejects(admin.auth().getUser(uid));
  const dt = await phoneToken(DRV);
  assert.equal((await call('deleteMyAccount', {}, dt)).result.queued, true);
  assert.equal((await db.doc(`deletionRequests/${DRV}`).get()).data().status, 'pending');
});

test('purgeDriver: owner only; refused on a ride / with wallet money; backup copy first; everything of that driver removed, others kept', async () => {
  const OWN = '+919999900050', STF = '+919999900051', PD = '+919999900060', OTHER = '+919999900061';
  await db.doc(`staff/${OWN}`).set({ name: 'Owner', role: 'owner' });
  await db.doc(`staff/${STF}`).set({ name: 'Staff', role: 'staff' });
  const dTok = await phoneToken(PD), dUid = JSON.parse(Buffer.from(dTok.split('.')[1], 'base64url').toString()).user_id;
  await db.doc(`drivers/${PD}`).set({ name: 'Subbu', veh: 'auto', wallet: 0, consent: { v: '1', name: 'Subbu' } });
  await db.doc(`live/${PD}`).set({ online: false });
  await db.doc(`driverApps/${PD}`).set({ status: 'approved', files: ['dl'] });
  await db.doc(`driverApps/${PD}/files/dl`).set({ data: 'data:image/jpeg;base64,xx' });
  await db.doc('bookings/pd1').set(base({ driverPhone: PD, status: 'assigned' }));
  await db.doc('bookings/pd1/chat/m1').set({ from: 'd', text: 'coming' });
  await db.doc('bookings/pd2').set(base({ driverPhone: PD, status: 'done' }));
  await db.doc('bookings/pd3').set(base({ driverPhone: OTHER, status: 'done' }));
  await db.doc('ledger/pd2').set({ driverPhone: PD, comm: 19 });
  await db.doc('ledger/pd3').set({ driverPhone: OTHER, comm: 19 });
  await db.doc('recharges/r1').set({ driverPhone: PD, amt: 100, status: 'approved' });
  await db.doc('tickets/t1').set({ uid: dUid, type: 'sos' });
  await db.doc('tickets/t2').set({ uid: 'someone-else', type: 'complaint' });
  const own = await phoneToken(OWN), stf = await phoneToken(STF);
  assert.ok((await call('purgeDriver', { phone: PD, confirm: PD.slice(-4) }, stf)).error, 'staff cannot');
  assert.ok((await call('purgeDriver', { phone: PD, confirm: '0000' }, own)).error, 'wrong confirm digits');
  assert.equal((await call('purgeDriver', { phone: PD, confirm: PD.slice(-4) }, own)).result.why, 'active');
  await db.doc('bookings/pd1').update({ status: 'cancelled' });
  await db.doc(`drivers/${PD}`).update({ wallet: -40 });
  const w = (await call('purgeDriver', { phone: PD, confirm: PD.slice(-4) }, own)).result;
  assert.equal(w.why, 'wallet'); assert.equal(w.wallet, -40);
  assert.ok((await db.doc(`drivers/${PD}`).get()).exists, 'nothing deleted when refused');
  const r = (await call('purgeDriver', { phone: PD, confirm: PD.slice(-4), force: true }, own)).result;
  assert.equal(r.ok, true); assert.equal(r.trips, 2); assert.equal(r.ledger, 1); assert.equal(r.recharges, 1); assert.equal(r.tickets, 1); assert.equal(r.docs, 1);
  for (const p of [`drivers/${PD}`, `live/${PD}`, `driverApps/${PD}`, `driverApps/${PD}/files/dl`, 'bookings/pd1', 'bookings/pd1/chat/m1', 'bookings/pd2', 'ledger/pd2', 'recharges/r1', 'tickets/t1'])
    assert.equal((await db.doc(p).get()).exists, false, p + ' removed');
  for (const p of ['bookings/pd3', 'ledger/pd3', 'tickets/t2', `drivers/${DRV}`]) assert.ok((await db.doc(p).get()).exists, p + ' kept');
  await assert.rejects(admin.auth().getUser(dUid));
  const bk = await db.collection(`purgeBackups/${r.backup}/items`).get();
  assert.equal(bk.size, r.total); assert.ok(bk.docs.some(d => d.data().path === `drivers/${PD}` && d.data().data.name === 'Subbu'), 'backup holds the driver');
  assert.equal((await call('purgeDriver', { phone: PD, confirm: PD.slice(-4) }, own)).result.why, 'none');
});
