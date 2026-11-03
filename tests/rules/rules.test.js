// Firestore security rules tests (v2). Run: cd tests/rules && npm i && npm test   (needs Java for the emulator)
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, increment } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';

let env;
const OWNER = '+918220201462', STAFF = '+919000000009', DRV = '+919999900002', DRV2 = '+919999900003', CUST = 'u-cust', CPH = '+919999900001';
const as = {
  owner: () => env.authenticatedContext('u-owner', { phone_number: OWNER }).firestore(),
  staff: () => env.authenticatedContext('u-staff', { phone_number: STAFF }).firestore(),
  drv: () => env.authenticatedContext('u-drv', { phone_number: DRV }).firestore(),
  drv2: () => env.authenticatedContext('u-drv2', { phone_number: DRV2 }).firestore(),
  cust: () => env.authenticatedContext(CUST, { phone_number: CPH }).firestore(),
  other: () => env.authenticatedContext('u-other', { phone_number: '+919888888888' }).firestore(),
  google: () => env.authenticatedContext('u-google', {}).firestore(),
  anon: () => env.unauthenticatedContext().firestore(),
};
const booking = o => ({ customerUid: CUST, custName: 'Priya', custPhone: CPH, src: 'app', kind: 'ride', veh: 'sedan', fare: 190, tip: 0, pay: 'cash', status: 'searching', when: Date.now(), ...o });
async function seed(fn) { await env.withSecurityRulesDisabled(async c => fn(c.firestore())); }

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-vct', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async db => {
    await setDoc(doc(db, 'staff', OWNER), { role: 'owner' });
    await setDoc(doc(db, 'staff', STAFF), { role: 'staff' });
    await setDoc(doc(db, 'drivers', DRV), { name: 'Test', veh: 'sedan', wallet: 500, online: false });
    await setDoc(doc(db, 'drivers', DRV2), { name: 'Two', veh: 'sedan', wallet: 500, online: false, blocked: true });
    await setDoc(doc(db, 'config', 'app'), { comm: 10 });
    await setDoc(doc(db, 'bookings', 'b1'), booking());
    await setDoc(doc(db, 'bookings', 'b2'), booking({ status: 'assigned', driverPhone: DRV }));
    await setDoc(doc(db, 'bookings', 'b3'), booking({ status: 'ontrip', driverPhone: DRV }));
    await setDoc(doc(db, 'bookings', 'b4'), booking({ status: 'done', driverPhone: DRV }));
    await setDoc(doc(db, 'recharges', 'r1'), { driverPhone: DRV, amt: 300, status: 'pending' });
  });
});

// ---- customers
test('customer creates a valid booking', async () => { await assertSucceeds(addDoc(collection(as.cust(), 'bookings'), booking({ tariff: { t: 'local' }, pinSalt: 'x', pinHash: 'y' }))); });
test('customer cannot create a booking for someone else', async () => { await assertFails(addDoc(collection(as.cust(), 'bookings'), booking({ customerUid: 'u-x' }))); });
test('customer cannot create with fare 0 or huge tip', async () => {
  await assertFails(addDoc(collection(as.cust(), 'bookings'), booking({ fare: 0 })));
  await assertFails(addDoc(collection(as.cust(), 'bookings'), booking({ tip: 5000 })));
});
test('customer cannot create a booking already assigned / with final fare', async () => {
  await assertFails(addDoc(collection(as.cust(), 'bookings'), booking({ driverPhone: DRV })));
  await assertFails(addDoc(collection(as.cust(), 'bookings'), booking({ fareFinal: 1 })));
});
test('blocked customer cannot book; can read only own block entry', async () => {
  await seed(db => setDoc(doc(db, 'blocked', CPH), { by: OWNER }));
  await assertFails(addDoc(collection(as.cust(), 'bookings'), booking()));
  await assertSucceeds(getDoc(doc(as.cust(), 'blocked', CPH)));
  await assertFails(getDoc(doc(as.other(), 'blocked', CPH)));
});
test('google-login customer (no phone) can still book', async () => {
  await assertSucceeds(addDoc(collection(env.authenticatedContext('u-g', {}).firestore(), 'bookings'), booking({ customerUid: 'u-g' })));
});
test('customer can add tip up to 300, cancel before trip, not after it starts', async () => {
  await assertSucceeds(updateDoc(doc(as.cust(), 'bookings', 'b1'), { tip: 50 }));
  await assertFails(updateDoc(doc(as.cust(), 'bookings', 'b1'), { tip: 500 }));
  await assertSucceeds(updateDoc(doc(as.cust(), 'bookings', 'b2'), { status: 'cancelled', cancelReason: 'customer' }));
  await assertFails(updateDoc(doc(as.cust(), 'bookings', 'b3'), { status: 'cancelled' }));
});
test('customer cannot change fare or driver', async () => {
  await assertFails(updateDoc(doc(as.cust(), 'bookings', 'b1'), { fare: 1 }));
  await assertFails(updateDoc(doc(as.cust(), 'bookings', 'b1'), { driverPhone: DRV }));
});
test('customer cannot read another customer booking', async () => { await assertFails(getDoc(doc(as.other(), 'bookings', 'b2'))); });

// ---- drivers
test('driver accepts a searching ride', async () => {
  await assertSucceeds(updateDoc(doc(as.drv(), 'bookings', 'b1'), { status: 'assigned', driverPhone: DRV, driverName: 'Test', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test('blocked driver cannot accept', async () => {
  await assertFails(updateDoc(doc(as.drv2(), 'bookings', 'b1'), { status: 'assigned', driverPhone: DRV2, updatedAt: serverTimestamp() }));
});
test('driver who cancelled (exclude) cannot take it again', async () => {
  await seed(db => setDoc(doc(db, 'bookings', 'bx'), booking({ exclude: [DRV] })));
  await assertFails(updateDoc(doc(as.drv(), 'bookings', 'bx'), { status: 'assigned', driverPhone: DRV, updatedAt: serverTimestamp() }));
});
test('driver starts, finishes with final bill and commission', async () => {
  await assertSucceeds(updateDoc(doc(as.drv(), 'bookings', 'b2'), { status: 'ontrip', startedAt: serverTimestamp(), pinOk: true }));
  await assertSucceeds(updateDoc(doc(as.drv(), 'bookings', 'b3'), { status: 'done', fareFinal: 274, comm: 20, commLocal: true, fx: { trip: 204 }, doneAt: serverTimestamp() }));
});
test('driver cannot jump assigned → done, nor set an absurd bill or commission > bill', async () => {
  await assertFails(updateDoc(doc(as.drv(), 'bookings', 'b2'), { status: 'done' }));
  await assertFails(updateDoc(doc(as.drv(), 'bookings', 'b3'), { status: 'done', fareFinal: 999999 }));
  await assertFails(updateDoc(doc(as.drv(), 'bookings', 'b3'), { status: 'done', fareFinal: 200, comm: 500 }));
});
test('driver can rate the customer after done, nothing else', async () => {
  await assertSucceeds(updateDoc(doc(as.drv(), 'bookings', 'b4'), { custRating: 4 }));
  await assertFails(updateDoc(doc(as.drv(), 'bookings', 'b4'), { fareFinal: 10 }));
});
test('driver cannot touch another driver ride', async () => { await assertFails(updateDoc(doc(as.drv2(), 'bookings', 'b2'), { status: 'cancelled' })); });
test('driver wallet: may lower, never raise', async () => {
  await assertSucceeds(updateDoc(doc(as.drv(), 'drivers', DRV), { wallet: increment(-20) }));
  await assertFails(updateDoc(doc(as.drv(), 'drivers', DRV), { wallet: increment(50) }));
});
test('server commission mode: driver can no longer lower own wallet', async () => {
  await seed(db => setDoc(doc(db, 'config', 'app'), { comm: 10, serverComm: true }));
  await assertFails(updateDoc(doc(as.drv(), 'drivers', DRV), { wallet: 480 }));
  await assertSucceeds(updateDoc(doc(as.drv(), 'drivers', DRV), { online: true }));
});
test('blocked driver cannot go online', async () => { await assertFails(updateDoc(doc(as.drv2(), 'drivers', DRV2), { online: true })); });
test('driver live position: own doc, known fields only', async () => {
  await assertSucceeds(setDoc(doc(as.drv(), 'live', DRV), { lat: 12.9, lon: 79.1, gh: 'tf3k', online: true, busy: false, veh: 'sedan', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as.drv(), 'live', DRV2), { lat: 12.9, lon: 79.1 }));
  await assertFails(setDoc(doc(as.drv(), 'live', DRV), { lat: 12.9, lon: 79.1, wallet: 9999 }));
});
test('driver cannot read the PIN', async () => {
  await seed(db => setDoc(doc(db, 'bookings', 'b2', 'private', 'pin'), { pin: '1234' }));
  await assertFails(getDoc(doc(as.drv(), 'bookings', 'b2', 'private', 'pin')));
  await assertSucceeds(getDoc(doc(as.cust(), 'bookings', 'b2', 'private', 'pin')));
});

// ---- office
test('customer phone: hidden from drivers until they accept; only the accepting driver reads it', async () => {
  await seed(async db => {
    await setDoc(doc(db, 'bookings', 'b1', 'private', 'contact'), { custPhone: CPH, riderPhone: null });
    await setDoc(doc(db, 'bookings', 'b2', 'private', 'contact'), { custPhone: CPH, riderPhone: '9876543210' });
  });
  await assertFails(getDoc(doc(as.drv(), 'bookings', 'b1', 'private', 'contact')));   // waiting ride: nobody sees it
  await assertSucceeds(getDoc(doc(as.drv(), 'bookings', 'b2', 'private', 'contact'))); // my accepted ride
  await assertFails(getDoc(doc(as.drv2(), 'bookings', 'b2', 'private', 'contact')));  // another driver
  await assertFails(getDoc(doc(as.drv(), 'bookings', 'b2', 'private', 'pin')));       // the PIN stays hidden
  await assertFails(setDoc(doc(as.drv(), 'bookings', 'b2', 'private', 'contact'), { custPhone: '+910' }));
  await assertSucceeds(getDoc(doc(as.cust(), 'bookings', 'b2', 'private', 'contact')));
  await assertSucceeds(setDoc(doc(as.cust(), 'bookings', 'b1', 'private', 'contact'), { custPhone: CPH }));
  await assertSucceeds(getDoc(doc(as.staff(), 'bookings', 'b1', 'private', 'contact')));
  await assertFails(getDoc(doc(as.other(), 'bookings', 'b1', 'private', 'contact')));
});
test('staff can assign and edit bookings but not change a wallet', async () => {
  await assertSucceeds(updateDoc(doc(as.staff(), 'bookings', 'b1'), { status: 'assigned', driverPhone: DRV }));
  await assertFails(updateDoc(doc(as.staff(), 'drivers', DRV), { wallet: 9999 }));
  await assertSucceeds(updateDoc(doc(as.staff(), 'drivers', DRV), { notes: ['ok'] }));
});
test('owner approves a recharge once; second approval refused', async () => {
  await assertSucceeds(updateDoc(doc(as.owner(), 'recharges', 'r1'), { status: 'approved' }));
  await assertFails(updateDoc(doc(as.owner(), 'recharges', 'r1'), { status: 'approved' }));
});
test('staff cannot approve recharges or edit config', async () => {
  await assertFails(updateDoc(doc(as.staff(), 'recharges', 'r1'), { status: 'approved' }));
  await assertFails(setDoc(doc(as.staff(), 'config', 'app'), { comm: 1 }, { merge: true }));
});
test('blocked list is private', async () => {
  await assertSucceeds(setDoc(doc(as.owner(), 'blocked', '+919111111111'), { by: OWNER }));
  await assertFails(getDoc(doc(as.cust(), 'blocked', '+919111111111')));
});
test('ledger is server-only', async () => {
  await assertFails(setDoc(doc(as.owner(), 'ledger', 'x'), { amt: 1 }));
  await assertFails(setDoc(doc(as.drv(), 'ledger', 'x'), { amt: 1 }));
});
test('error reports: small, write-only for the public', async () => {
  await assertSucceeds(addDoc(collection(as.anon(), 'errors'), { app: 'c', msg: 'boom', at: 1 }));
  await assertFails(addDoc(collection(as.anon(), 'errors'), { app: 'c', msg: 'x'.repeat(2000) }));
  await assertFails(getDoc(doc(as.cust(), 'errors', 'x')));
});
test('signed-out users read nothing', async () => {
  await assertFails(getDoc(doc(as.anon(), 'config', 'app')));
  await assertFails(getDoc(doc(as.anon(), 'bookings', 'b1')));
});
