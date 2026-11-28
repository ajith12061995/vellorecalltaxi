// Load test (28 Nov): 30 drivers around Katpadi, 150 bookings in 60 seconds, drivers racing to accept at the same
// moment — all through the REAL security rules in the Firestore emulator, with the same transactions the apps use:
//   customer app  makeBooking(): UUID booking id made on the phone, setDoc (double taps / retries write the same doc)
//   driver app    acceptCloud() + takeSlot(): booking → assigned and the ride into drivers/{me}.act|nxt in ONE transaction
// Some drivers also cheat (accept without the slot, change the fare, take a second ride) — the rules must refuse.
// Prints a report; "bookings with 2 drivers", "drivers with 2 rides not started" and "duplicate bookings" must be 0.
// Run: cd tests/rules && npm i && npm run load      (also part of npm test in CI)
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, serverTimestamp, runTransaction } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const N_DRV = 30, N_BK = 150, SPAN_MS = 60000, VEH = ['auto', 'mini', 'sedan'];
const KAT = { lat: 12.9716, lon: 79.1376 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
let env;
const drivers = Array.from({ length: N_DRV }, (_, i) => ({ ph: '+9197000' + String(10000 + i).slice(-5), veh: VEH[i % 3] }));
const dbOf = new Map();
const drvDb = d => { if (!dbOf.has(d.ph)) dbOf.set(d.ph, env.authenticatedContext('u-d' + d.ph.slice(-5), { phone_number: d.ph }).firestore()); return dbOf.get(d.ph); };
const custDb = i => env.authenticatedContext('u-c' + i, { phone_number: '+9196000' + String(10000 + i).slice(-5) }).firestore();

const stats = { created: 0, createTries: 0, dupTaps: 0, accepts: 0, lost: 0, busy: 0, aborted: 0, started: 0, finished: 0,
  cheatAllowed: 0, cheatTried: 0, wins: new Map(), samples: [] };

// = driver app takeSlot()
async function takeSlot(tx, db, ph, id, b) {
  if (b && typeof b.when === 'number' && b.when > Date.now() + 60 * 60e3) return null;
  const dref = doc(db, 'drivers', ph), ds = await tx.get(dref), dd = ds.exists() ? ds.data() : {};
  const st = async k => { const x = String(dd[k] || ''); if (!x || x === id) return 'free'; const s = await tx.get(doc(db, 'bookings', x)); if (!s.exists()) return 'free'; const o = s.data();
    if (o.driverPhone !== ph || !['assigned', 'arrived', 'ontrip'].includes(o.status) || (typeof o.when === 'number' && o.when > Date.now() + 45 * 60e3)) return 'free'; return o.status === 'ontrip' ? 'trip' : 'busy'; };
  const a = await st('act'), n = await st('nxt');
  const k = a === 'free' && n !== 'busy' ? 'act' : n === 'free' && a !== 'busy' ? 'nxt' : null;
  if (!k) throw new Error('busy');
  return () => tx.update(dref, { [k]: id, actAt: serverTimestamp() });
}
// = driver app acceptCloud()
async function accept(d, id) {
  const db = drvDb(d);
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, 'bookings', id), s = await tx.get(ref);
      if (!s.exists() || s.data().status !== 'searching') throw new Error('taken');
      const put = await takeSlot(tx, db, d.ph, id, s.data()); if (put) put();
      tx.update(ref, { status: 'assigned', driverPhone: d.ph, driverName: 'D', plate: 'TN 23', vehModel: 'x', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    stats.accepts++; stats.wins.set(id, [...(stats.wins.get(id) || []), d.ph]);
    drive(d, id);                                   // the winner drives it: start after a bit, finish later
    return true;
  } catch (e) {
    const m = String(e && e.message || e);
    if (m === 'taken') stats.lost++; else if (m === 'busy') stats.busy++; else stats.aborted++;
    return false;
  }
}
const chain = new Map();   // like the app: a driver starts the next ride only after finishing the current one
function drive(d, id) { const p = (chain.get(d.ph) || Promise.resolve()).then(() => driveOne(d, id)); chain.set(d.ph, p); return p; }
async function driveOne(d, id) {
  const db = drvDb(d);
  await sleep(rnd(1500, 5000));
  try { await updateDoc(doc(db, 'bookings', id), { status: 'ontrip', startedAt: serverTimestamp() }); stats.started++; } catch (e) { return; }
  await sleep(rnd(4000, 12000));
  try { await updateDoc(doc(db, 'bookings', id), { status: 'done', doneAt: serverTimestamp(), fareFinal: 150 }); stats.finished++; } catch (e) { /* ignore */ }
}
// cheaters: what a modified driver app might try — every one must be refused by the rules
async function cheat(d, id) {
  const db = drvDb(d); stats.cheatTried += 3;
  try { await updateDoc(doc(db, 'bookings', id), { status: 'assigned', driverPhone: d.ph, updatedAt: serverTimestamp() }); stats.cheatAllowed++; } catch (e) { /* refused: no slot */ }
  try { await updateDoc(doc(db, 'bookings', id), { fare: 1 }); stats.cheatAllowed++; } catch (e) { /* refused: fare */ }
  try { await updateDoc(doc(db, 'bookings', id), { driverPhone: d.ph }); stats.cheatAllowed++; } catch (e) { /* refused: driverId */ }
}
// = customer app makeBooking(): same id on a double tap / retry
async function book(i) {
  const db = custDb(i), id = randomUUID(), uid = 'u-c' + i;
  const p = { lat: KAT.lat + rnd(-0.02, 0.02), lon: KAT.lon + rnd(-0.02, 0.02) };
  const data = { customerUid: uid, custName: 'C' + i, src: 'app', kind: 'ride', veh: VEH[i % 3], fare: 150, tip: 0, pay: 'cash', status: 'searching',
    from: { ...p, ta: 'x', en: 'x' }, to: { lat: 12.9246, lon: 79.1356, ta: 'CMC', en: 'CMC' }, km: 6, when: Date.now(), tariff: { t: 'local' },
    createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const once = async () => { stats.createTries++; try { await setDoc(doc(db, 'bookings', id), data); } catch (e) {
    for (let k = 0; k < 3; k++) { const s = await getDoc(doc(db, 'bookings', id)).catch(() => null); if (s && s.exists()) return; await sleep(400); } throw e; } };
  const taps = Math.random() < 0.3 ? 2 : 1; if (taps === 2) stats.dupTaps++;
  await Promise.all(Array.from({ length: taps }, once));
  if (Math.random() < 0.15) await once();          // a retry after a "lost" answer
  stats.created++;
  // the request reaches drivers of that vehicle; 1–5 of them press Accept at the same moment
  await sleep(rnd(200, 2500));
  const same = drivers.filter(d => d.veh === data.veh).sort(() => Math.random() - 0.5);
  const racers = same.slice(0, Math.ceil(rnd(1, 5)));
  const jobs = racers.map(d => accept(d, id));
  if (Math.random() < 0.1) jobs.push(cheat(same[same.length - 1], id));
  await Promise.all(jobs);
  return id;
}
async function snapshotCheck() {        // live check while the test runs: never 2 rides not started for one driver
  const all = await env.withSecurityRulesDisabled(async c => (await getDocs(collection(c.firestore(), 'bookings'))).docs.map(d => d.data()));
  const per = {};
  for (const b of all) if (b.driverPhone && b.status === 'assigned') per[b.driverPhone] = (per[b.driverPhone] || 0) + 1;
  stats.samples.push(Object.values(per).filter(n => n > 1).length);
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-vct-load', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => { const db = c.firestore();
    await setDoc(doc(db, 'config', 'app'), { comm: 10 });
    for (const d of drivers) await setDoc(doc(db, 'drivers', d.ph), { name: 'D', veh: d.veh, wallet: 500, online: true }); });
});
after(async () => { await env.cleanup(); });

test(`load: ${N_DRV} drivers, ${N_BK} bookings in ${SPAN_MS / 1000} s, racing accepts`, { timeout: 240000 }, async () => {
  const t0 = Date.now(), ids = [], running = [];
  const mon = setInterval(() => { snapshotCheck().catch(() => {}); }, 2000);
  for (let i = 0; i < N_BK; i++) {
    running.push(book(i).then(id => ids.push(id)));
    await sleep(SPAN_MS / N_BK);
  }
  await Promise.all(running);
  await sleep(20000);                               // let the last rides start / finish
  await Promise.all([...chain.values()]);
  clearInterval(mon); await snapshotCheck();
  const all = await env.withSecurityRulesDisabled(async c => (await getDocs(collection(c.firestore(), 'bookings'))).docs.map(d => ({ id: d.id, ...d.data() })));
  const byId = new Set(all.map(b => b.id));
  const two = [...stats.wins.values()].filter(w => w.length > 1).length;
  const mism = all.filter(b => b.driverPhone && stats.wins.get(b.id) && stats.wins.get(b.id)[0] !== b.driverPhone).length;
  const perDrv = {}; for (const b of all) if (b.driverPhone && b.status === 'assigned') perDrv[b.driverPhone] = (perDrv[b.driverPhone] || 0) + 1;
  const onTrip = {}; for (const b of all) if (b.driverPhone && b.status === 'ontrip') onTrip[b.driverPhone] = (onTrip[b.driverPhone] || 0) + 1;
  const drv2 = Object.values(perDrv).filter(n => n > 1).length + Object.values(onTrip).filter(n => n > 1).length + Math.max(0, ...stats.samples);
  const dup = all.length - ids.length + ids.filter(id => !byId.has(id)).length;
  const assigned = all.filter(b => b.driverPhone).length, noDriver = all.filter(b => b.status === 'searching').length;
  const r = {
    'total bookings': all.length, 'booking tries (incl. double taps and retries)': stats.createTries, 'double taps': stats.dupTaps,
    assigned, 'no driver (still searching → NO_DRIVER)': noDriver, 'started': stats.started, 'finished': stats.finished,
    'accept attempts lost ("already taken")': stats.lost, 'refused: driver already has a ride not started': stats.busy, 'transaction gave up (contention)': stats.aborted,
    'cheat attempts refused': stats.cheatTried - stats.cheatAllowed + '/' + stats.cheatTried,
    'BOOKINGS WITH 2 DRIVERS': two + mism, 'DRIVERS WITH 2 RIDES NOT STARTED (or 2 on trip)': drv2, 'DUPLICATE BOOKINGS': dup,
    'seconds': Math.round((Date.now() - t0) / 1000),
  };
  console.log('\n==== LOAD TEST REPORT ====');
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(58), v);
  console.log('==========================\n');
  assert.equal(all.length, N_BK, 'every booking exists once');
  assert.equal(two + mism, 0, 'no booking with 2 drivers');
  assert.equal(drv2, 0, 'no driver with 2 rides not started');
  assert.equal(dup, 0, 'no duplicate bookings');
  assert.equal(stats.cheatAllowed, 0, 'every cheat refused');
  assert.ok(assigned > N_BK * 0.5, 'most bookings found a driver');
});
