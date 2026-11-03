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
  logger.info('housekeeping', { changed: n });
});

exports.onBookingCreated = onDocumentCreated('bookings/{id}', async ev => {
  const b = ev.data.data(); if (!b) return;
  const c = await cfg();
  if (L.fareLooksWrong(b, c.fares)) await ev.data.ref.update({ fareFlag: 'below-price-list' });
  if (b.status !== 'searching' || !c.push || !c.push.vapid) return;
  const ds = await db.collection('drivers').where('veh', '==', b.veh).where('online', '==', true).get();
  const tokens = ds.docs.map(d => d.data().fcm).filter(Boolean).slice(0, 500);
  if (!tokens.length) return;
  const from = (b.from && (b.from.ta || b.from.en)) || '';
  const r = await admin.messaging().sendEachForMulticast({ tokens,
    webpush: { notification: { title: '🚕 புது Ride / New ride', body: `${from} · ₹${b.fare}${b.tip ? ' + ₹' + b.tip : ''}`, requireInteraction: true, tag: ev.params.id },
               fcmOptions: { link: 'https://ajith12061995.github.io/vellorecalltaxi/driver/' } },
    data: { bookingId: ev.params.id } });
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
      webpush: { notification: { title: msg.title, body: msg.body, tag: `${ev.params.id}-${msg.kind}`, icon: 'https://ajith12061995.github.io/vellorecalltaxi/icon-192.png' },
                 fcmOptions: { link: 'https://ajith12061995.github.io/vellorecalltaxi/' } },
      data: { bookingId: ev.params.id, kind: msg.kind } });
    logger.info('cust push', { id: ev.params.id, kind: msg.kind });
  } catch (e) {
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(e.code || e.message || '')) await uref.update({ fcm: FV.delete() }).catch(() => {});
    logger.warn('cust push failed', { id: ev.params.id, code: e.code || String(e) });
  }
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
  const day = new Date().toISOString().slice(0, 10);
  const [op] = await client.exportDocuments({ name: client.databasePath(project, '(default)'), outputUriPrefix: `gs://${bucket}/firestore/${day}`, collectionIds: [] });
  logger.info('backup started', { op: op.name, to: `gs://${bucket}/firestore/${day}` });
});
