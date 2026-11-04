/* Vellore Taxi — Cloud Functions (needs the Firebase Blaze plan). Region: asia-south1 (Mumbai).
   Every function is safe to deploy while the apps keep working the old way:
   - onBookingDone   : writes one ledger entry per finished trip. Takes / corrects the commission from the
                       driver wallet ONLY when config/app.serverComm is true (switch it on after deploying).
   - housekeeping    : every 2 minutes — sends scheduled local rides to drivers 30 min before pickup,
                       closes local searches nobody took for 15 min, marks drivers whose app went quiet as offline.
                       Set config/app.serverOps = true so office screens stop doing the same.
   - onBookingCreated: flags app bookings whose fare is far below the office price list; push to nearby drivers
                       (only drivers who allowed notifications; needs config/app.push.vapid).
   - verifyPin       : callable; checks the ride PIN on the server (strongest check).
   - purgeDriver     : callable, owner only; removes a driver completely (backup copy kept 30 days).
   - dailyBackup     : 02:30 IST export of the whole database to the bucket in BACKUP_BUCKET. */
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const L = require('./lib/logic');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue: FV } = require('firebase-admin/firestore'); // (admin.firestore.FieldValue is undefined in firebase-admin 12)
// Firestore triggers must run in the database's region; tools/cloudshell-deploy.sh writes FN_REGION into functions/.env.<project>
const REGION = process.env.FN_REGION || 'asia-south1';
// Public address of the apps (notification taps open it). Deploy functions only after the domain is live.
const SITE = (process.env.APP_URL || 'https://velloretaxi.app/').replace(/\/?$/, '/');
setGlobalOptions({ region: REGION, maxInstances: 10 });
const BACKUP_BUCKET = defineString('BACKUP_BUCKET', { default: '' });

const cfg = async () => (await db.doc('config/app').get()).data() || {};

exports.onBookingDone = onDocumentUpdated('bookings/{id}', async ev => {
  const before = ev.data.before.data(), after = ev.data.after.data(), id = ev.params.id;
  if (!after || after.status !== 'done' || (before && before.status === 'done') || !after.driverPhone) return;
  const c = await cfg(), pct = c.comm != null ? +c.comm : 10, server = !!c.serverComm;
  const s = L.settle(after, pct, server);
  await db.runTransaction(async tx => {
    const lref = db.doc(`ledger/${id}`);
    if ((await tx.get(lref)).exists) return;                  // already settled (function retried)
    tx.set(lref, { bookingId: id, driverPhone: after.driverPhone, trip: s.trip, comm: s.comm, takenByApp: s.taken,
      walletDelta: s.walletDelta, pct, mode: server ? 'server' : 'app', mismatch: !!s.mismatch, at: FV.serverTimestamp() });
    if (s.walletDelta) tx.update(db.doc(`drivers/${after.driverPhone}`), { wallet: FV.increment(s.walletDelta), updatedAt: FV.serverTimestamp() });
    tx.update(ev.data.after.ref, { ledgerAt: FV.serverTimestamp(), ...(server ? { comm: s.comm } : {}) });
  });
  if (s.mismatch) logger.warn('commission mismatch', { id, driver: after.driverPhone, app: after.comm, expected: s.comm });
});

exports.housekeeping = onSchedule({ schedule: 'every 2 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const now = Date.now(), batch = db.batch(); let n = 0;
  const open = await db.collection('bookings').where('status', 'in', ['scheduled', 'searching']).get();
  open.forEach(d => { const ch = L.housekeeping(d.data(), now); if (ch) { batch.update(d.ref, { ...ch, updatedAt: FV.serverTimestamp() }); n++; } });
  const live = await db.collection('live').where('online', '==', true).get();
  live.forEach(d => { if (L.liveStale(d.data(), now)) { batch.update(d.ref, { online: false }); n++; } });
  if (n) await batch.commit();
  // driver-removal backup copies are kept 30 days
  const old = await db.collection('purgeBackups').where('at', '<', new Date(now - 30 * 864e5)).limit(5).get();
  for (const r of old.docs) { await db.recursiveDelete(r.ref); n++; }
  logger.info('housekeeping', { changed: n });
});

exports.onBookingCreated = onDocumentCreated('bookings/{id}', async ev => {
  const b = ev.data.data(); if (!b) return;
  const c = await cfg(), id = ev.params.id, ref = ev.data.ref;
  const now = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Date.now();
  // 1) booking limits for app customers (stops fake / spam bookings)
  if (b.customerUid && b.src === 'app' && (b.status === 'searching' || b.status === 'scheduled')) {
    const lref = db.doc(`limits/${b.customerUid}`);
    const res = await db.runTransaction(async tx => {
      const ls = await tx.get(lref), lim = ls.exists ? ls.data() : {};
      const ids = (lim.open || []).filter(x => x !== id).slice(-10);
      const docs = ids.length ? await tx.getAll(...ids.map(x => db.doc(`bookings/${x}`))) : [];
      const openNow = docs.filter(d => d.exists && ['searching', 'assigned', 'ontrip'].includes(d.data().status)).map(d => d.id);
      const r = L.bookingLimit(lim, openNow, now);
      if (r.ok) tx.set(lref, { open: [...openNow, id], hr: r.hr, n: r.n, at: FV.serverTimestamp() });
      else tx.update(ref, { status: 'cancelled', cancelReason: 'limit', cancelledBy: 'server', limitWhy: r.why, updatedAt: FV.serverTimestamp() });
      return r;
    });
    if (!res.ok) { logger.warn('booking limit', { id, uid: b.customerUid, why: res.why }); return; }
  }
  // 2) server fare check: a fare below the price list is corrected (never raised above it)
  const fx = L.fareCheck(b, c, now);
  if (fx) {
    const tariff = { ...(b.tariff || { t: 'local' }) };
    if (fx.night) { tariff.night = fx.night; tariff.nightAmt = fx.nightAmt; } else { delete tariff.night; delete tariff.nightAmt; }
    await ref.update({ fare: fx.fare, km: fx.km, tariff, fareFlag: 'corrected', fareWas: fx.was, kmWas: fx.wasKm, updatedAt: FV.serverTimestamp() });
    b.fare = fx.fare;
    logger.warn('fare corrected', { id, was: fx.was, now: fx.fare, km: fx.km, wasKm: fx.wasKm });
  } else if (L.fareLooksWrong(b, c.fares)) await ref.update({ fareFlag: 'below-price-list' });
  if (b.status !== 'searching' || !c.push || !c.push.vapid) return;
  const ds = await db.collection('drivers').where('veh', '==', b.veh).where('online', '==', true).get();
  const tokens = ds.docs.map(d => d.data().fcm).filter(Boolean).slice(0, 500);
  if (!tokens.length) return;
  const from = (b.from && (b.from.ta || b.from.en)) || '';
  const r = await admin.messaging().sendEachForMulticast({ tokens,
    webpush: { notification: { title: '🚕 புது Ride / New ride', body: `${from} · ₹${b.fare}${b.tip ? ' + ₹' + b.tip : ''}`, requireInteraction: true, tag: id },
               fcmOptions: { link: SITE + 'driver/' } },
    data: { bookingId: id } });
  logger.info('push', { sent: r.successCount, failed: r.failureCount });
});

// Customer push: driver found / arrived / trip started / completed / cancelled by driver or office.
// Token on users/{uid}.fcm (saved by the customer app after the customer allows notifications). Same switch as
// the driver alerts: config/app.push.vapid. A dead token is removed so it is not tried again.
exports.onBookingCust = onDocumentUpdated('bookings/{id}', async ev => {
  const before = ev.data.before.data(), after = ev.data.after.data();
  if (!after || !after.customerUid) return;
  const quick = L.custPush(before, after, 'ta'); if (!quick) return;
  const c = await cfg(); if (!c.push || !c.push.vapid) return;
  const uref = db.doc(`users/${after.customerUid}`), u = (await uref.get()).data() || {};
  if (!u.fcm) return;
  const msg = L.custPush(before, after, u.lang === 'en' ? 'en' : 'ta');
  try {
    await admin.messaging().send({ token: u.fcm,
      webpush: { notification: { title: msg.title, body: msg.body, tag: `${ev.params.id}-${msg.kind}`, icon: SITE + 'icon-192.png' },
                 fcmOptions: { link: SITE } },
      data: { bookingId: ev.params.id, kind: msg.kind } });
    logger.info('cust push', { id: ev.params.id, kind: msg.kind });
  } catch (e) {
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(e.code || e.message || '')) await uref.update({ fcm: FV.delete() }).catch(() => {});
    logger.warn('cust push failed', { id: ev.params.id, code: e.code || String(e) });
  }
});

// Account deletion (Play Store / App Store rule). Customers: deleted at once — profile, login, contact details
// and chats go; trip and money records stay for accounts/tax but without the name or phone number.
// Drivers: a request for the office (wallet money and documents need a person to settle first).
exports.deleteMyAccount = onCall(async req => {
  const uid = req.auth && req.auth.uid, ph = req.auth && req.auth.token.phone_number;
  if (!uid) throw new HttpsError('unauthenticated', 'login first');
  if (ph && (await db.doc(`drivers/${ph}`).get()).exists) {
    await db.doc(`deletionRequests/${ph}`).set({ kind: 'driver', phone: ph, uid, status: 'pending', at: FV.serverTimestamp() }, { merge: true });
    return { queued: true };
  }
  const bs = await db.collection('bookings').where('customerUid', '==', uid).get();
  if (bs.docs.some(d => ['searching', 'assigned', 'ontrip', 'scheduled'].includes(d.data().status))) return { ok: false, why: 'active' };
  let n = 0;
  for (const d of bs.docs) {
    const chats = await d.ref.collection('chat').get(), priv = await d.ref.collection('private').get();
    const batch = db.batch();
    batch.update(d.ref, { custName: 'Deleted user', custPhone: FV.delete(), rider: null, custDeleted: true });
    chats.docs.forEach(c => batch.delete(c.ref));
    priv.docs.filter(x => x.id === 'contact').forEach(x => batch.delete(x.ref));
    await batch.commit(); n++;
  }
  await db.doc(`users/${uid}`).delete().catch(() => {});
  await db.doc(`limits/${uid}`).delete().catch(() => {});
  await db.collection('deletions').add({ kind: 'customer', bookings: n, at: FV.serverTimestamp() });   // audit: no name or number
  await admin.auth().deleteUser(uid).catch(e => logger.warn('auth delete', { code: e.code }));
  logger.info('customer account deleted', { bookings: n });
  return { ok: true, bookings: n };
});

// Owner only: remove a driver completely so they can join again from zero (profile, documents, agreement,
// application, live position, trips they drove with chats, ledger, recharges, their own tickets, login).
// Before anything is deleted every document is copied to purgeBackups/{run}/items (no app can read it; the
// housekeeping job removes copies older than 30 days). Refused while the driver is on a ride; wallet money must be confirmed (force) first.
exports.purgeDriver = onCall({ timeoutSeconds: 300 }, async req => {
  const me = req.auth && req.auth.token.phone_number, { phone, confirm, force } = req.data || {};
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  const st = (await db.doc(`staff/${me}`).get()).data();
  if (!st || st.role !== 'owner') throw new HttpsError('permission-denied', 'owner only');
  if (!/^\+91[6-9]\d{9}$/.test(String(phone || '')) || String(confirm) !== String(phone).slice(-4)) throw new HttpsError('invalid-argument', 'bad request');
  const dref = db.doc(`drivers/${phone}`), drv = await dref.get(), app = await db.doc(`driverApps/${phone}`).get();
  if (!drv.exists && !app.exists) return { ok: false, why: 'none' };
  if (drv.exists && (+drv.data().wallet || 0) !== 0 && force !== true) return { ok: false, why: 'wallet', wallet: +drv.data().wallet };
  const bks = await db.collection('bookings').where('driverPhone', '==', phone).get();
  if (bks.docs.some(d => ['assigned', 'arrived', 'ontrip'].includes(d.data().status))) return { ok: false, why: 'active' };
  let uid = null; try { uid = (await admin.auth().getUserByPhoneNumber(phone)).uid; } catch (e) { /* never logged in */ }
  const refs = [dref, db.doc(`live/${phone}`), db.doc(`driverApps/${phone}`), db.doc(`deletionRequests/${phone}`)];
  refs.push(...(await db.collection(`driverApps/${phone}/files`).get()).docs.map(d => d.ref));
  for (const b of bks.docs) {
    refs.push(b.ref);
    for (const sub of ['chat', 'private']) refs.push(...(await b.ref.collection(sub).get()).docs.map(d => d.ref));
  }
  for (const [col, f, v] of [['ledger', 'driverPhone', phone], ['recharges', 'driverPhone', phone], ['tickets', 'uid', uid]])
    if (v) refs.push(...(await db.collection(col).where(f, '==', v).get()).docs.map(d => d.ref));
  // 1) backup copy first — nothing is deleted unless every copy was written
  const run = db.collection('purgeBackups').doc(), snaps = (await db.getAll(...refs)).filter(s => s.exists);
  await run.set({ phone, uid, by: me, count: snaps.length, at: FV.serverTimestamp() });
  for (let i = 0; i < snaps.length; i += 20) {
    const batch = db.batch();
    snaps.slice(i, i + 20).forEach((s, j) => batch.set(run.collection('items').doc(String(i + j)), { path: s.ref.path, data: s.data() }));
    await batch.commit();
  }
  // 2) delete (children before parents)
  const order = snaps.map(s => s.ref).sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  for (let i = 0; i < order.length; i += 400) { const batch = db.batch(); order.slice(i, i + 400).forEach(r => batch.delete(r)); await batch.commit(); }
  if (uid) await admin.auth().deleteUser(uid).catch(e => logger.warn('auth delete', { code: e.code }));
  const count = k => snaps.filter(s => s.ref.parent.id === k && s.ref.path.split('/').length === 2).length;
  const out = { ok: true, trips: count('bookings'), ledger: count('ledger'), recharges: count('recharges'), tickets: count('tickets'), docs: snaps.filter(s => s.ref.parent.id === 'files').length, total: snaps.length, backup: run.id };
  await db.collection('deletions').add({ kind: 'driver-purge', last4: phone.slice(-4), by: me, ...out, at: FV.serverTimestamp() });
  logger.info('driver purged', out);
  return out;
});

exports.verifyPin = onCall(async req => {
  const ph = req.auth && req.auth.token.phone_number, { bookingId, pin } = req.data || {};
  if (!ph || !bookingId || !/^\d{4}$/.test(String(pin))) throw new HttpsError('invalid-argument', 'bad request');
  const ref = db.doc(`bookings/${bookingId}`);
  return db.runTransaction(async tx => {
    const b = (await tx.get(ref)).data();
    if (!b || b.driverPhone !== ph) throw new HttpsError('permission-denied', 'not your ride');
    if (b.status !== 'assigned') return { ok: b.status === 'ontrip' };
    const tries = (b.pinFails || 0);
    if (tries >= 5) throw new HttpsError('resource-exhausted', 'too many wrong PINs, call the office');
    const p = (await tx.get(db.doc(`bookings/${bookingId}/private/pin`))).data();
    if (!p || String(p.pin) !== String(pin)) { tx.update(ref, { pinFails: tries + 1 }); return { ok: false }; }
    tx.update(ref, { status: 'ontrip', startedAt: FV.serverTimestamp(), pinOk: true, updatedAt: FV.serverTimestamp() });
    return { ok: true };
  });
});

exports.dailyBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'Asia/Kolkata' }, async () => {
  const bucket = BACKUP_BUCKET.value();
  if (!bucket) { logger.warn('BACKUP_BUCKET not set — no backup made'); return; }
  const { v1 } = require('@google-cloud/firestore');
  const client = new v1.FirestoreAdminClient();
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  // folder named by the Indian date and time (UTC would put the 02:30 IST run under yesterday's date)
  const day = L.istStamp(Date.now());
  const [op] = await client.exportDocuments({ name: client.databasePath(project, '(default)'), outputUriPrefix: `gs://${bucket}/firestore/${day}`, collectionIds: [] });
  logger.info('backup started', { op: op.name, to: `gs://${bucket}/firestore/${day}` });
});
