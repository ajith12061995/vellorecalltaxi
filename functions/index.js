/* Vellore Taxi — Cloud Functions (needs the Firebase Blaze plan). Region: asia-south1 (Mumbai).
   Every function is safe to deploy while the apps keep working the old way:
   - onBookingDone   : writes one ledger entry per finished trip. Takes / corrects the commission from the
                       driver wallet ONLY when config/app.serverComm is true (switch it on after deploying).
   - housekeeping    : every 2 minutes — sends scheduled local rides to drivers 30 min before pickup,
                       closes local searches nobody took for 15 min, marks drivers whose app went quiet as offline.
                       Set config/app.serverOps = true so office screens stop doing the same.
   - onBookingCreated: corrects app fares below the price list (city rides, rentals, outstation); push to nearby drivers
                       (only drivers who allowed notifications; needs config/app.push.vapid).
   - verifyPin       : callable; checks the ride PIN on the server (strongest check).
   - purgeDriver     : callable, owner only; removes a driver completely (backup copy kept 30 days).
   - dailyBackup     : 02:30 IST export of the whole database to the bucket in BACKUP_BUCKET.
   - waBooking / waWebhook: WhatsApp booking messages (Meta Cloud API). Deployed only after the owner has stored the
                       secrets WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN (tools/cloudshell-whatsapp.sh); sends nothing
                       until Office → Settings → WhatsApp is switched on (waConfig/main.on). */
const { onDocumentUpdated, onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { defineString, defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const L = require('./lib/logic');
const WX = require('./lib/weather');
const W = require('./lib/wa');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue: FV } = require('firebase-admin/firestore'); // (admin.firestore.FieldValue is undefined in firebase-admin 12)
// Firestore triggers must run in the database's region; tools/cloudshell-deploy.sh writes FN_REGION into functions/.env.<project>
const REGION = process.env.FN_REGION || 'asia-south1';
// Public address of the apps (notification taps open it). Deploy functions only after the domain is live.
const SITE = (process.env.APP_URL || 'https://velloretaxi.app/').replace(/\/?$/, '/');
setGlobalOptions({ region: REGION, maxInstances: 10 });
const BACKUP_BUCKET = defineString('BACKUP_BUCKET', { default: '' });
// App Check for the callable functions: OFF until the owner has watched the App Check metrics for 2–3 days and
// set APPCHECK_ENFORCE=true in functions/.env.<project>. Until then calls without a token are only counted (log).
const AC_ENFORCE = process.env.APPCHECK_ENFORCE === 'true';
const acLog = (fn, req) => { if (!req.app) logger.info('appcheck missing', { fn }); };

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
  const cars = await db.collection('cars').where('online', '==', true).get();
  cars.forEach(d => { if (L.liveStale(d.data(), now)) { batch.update(d.ref, { online: false }); n++; } });
  if (n) await batch.commit();
  // driver-removal backup copies are kept 30 days
  const old = await db.collection('purgeBackups').where('at', '<', new Date(now - 30 * 864e5)).limit(5).get();
  for (const r of old.docs) { await db.recursiveDelete(r.ref); n++; }
  logger.info('housekeeping', { changed: n });
});

// Weather line in the apps: every 30 minutes read MET Norway's forecast for Vellore and keep a tiny summary in
// config/weather (signed-in users can read config/*; only this function writes it). A failure changes nothing:
// the apps hide the line when the summary is older than 100 minutes.
exports.weatherTick = onSchedule({ schedule: '7,37 * * * *', timeZone: 'Asia/Kolkata', timeoutSeconds: 30, retryCount: 0 }, async () => {
  const ref = db.doc('config/weather'), keep = db.doc('serverState/weather');   // serverState/*: no client access (no rule)
  try {
    const old = (await keep.get()).data() || {};
    const r = await WX.get(fetch, typeof old.lastMod === 'string' ? old.lastMod : '');
    const now = Date.now();
    let fc = null;
    if (r.status === 304) { try { fc = JSON.parse(old.raw); } catch (e) { fc = null; } }   // unchanged: use the kept hours
    else if (r.status === 200) {
      // keep the next 12 hours so an "unchanged" answer can still move on to the new hour
      const ts = ((r.data && r.data.properties && r.data.properties.timeseries) || []).filter(x => { const t = Date.parse(x && x.time); return t > now - 2 * 3600e3 && t < now + 12 * 3600e3; });
      fc = { properties: { timeseries: ts } };
      await keep.set({ lastMod: r.lastMod, raw: JSON.stringify(fc), at: now });
    } else { logger.warn('weather http', { status: r.status }); return; }
    const s = WX.summary(fc, now);
    if (!s) { logger.warn('weather: no usable forecast', { status: r.status }); return; }
    await ref.set({ ...s, at: now, src: 'MET Norway (CC BY 4.0)' });
  } catch (e) { logger.warn('weather failed', { message: String(e && e.message || e) }); }
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
    const tariff = fx.tariff || { ...(b.tariff || { t: 'local' }) };
    if (!fx.tariff) { if (fx.night) { tariff.night = fx.night; tariff.nightAmt = fx.nightAmt; } else { delete tariff.night; delete tariff.nightAmt; } }
    if (fx.fare !== fx.was) await ref.update({ fare: fx.fare, km: fx.km, tariff, fareFlag: 'corrected', fareWas: fx.was, kmWas: fx.wasKm, updatedAt: FV.serverTimestamp() });
    else await ref.update({ tariff, tariffFixed: true, updatedAt: FV.serverTimestamp() });   // fare fine, extra-km/hour prices were too low
    b.fare = fx.fare;
    logger.warn('fare corrected', { id, was: fx.was, now: fx.fare, km: fx.km, wasKm: fx.wasKm });
  } else if (L.fareLooksWrong(b, c.fares)) await ref.update({ fareFlag: 'below-price-list' });
  // 3) a city ride outside the local area (should have been outstation): flag it for the office, don't block
  if (L.outsideArea(b, c.area)) { await ref.update({ areaFlag: 'outside-local' }); logger.warn('outside local area', { id, veh: b.veh }); }
  if (b.status !== 'searching' || !c.push || !c.push.vapid) return;
  const ds = await db.collection('drivers').where('veh', '==', b.veh).where('online', '==', true).get();
  const tokens = ds.docs.map(d => d.data().fcm).filter(Boolean).slice(0, 500);
  if (!tokens.length) return;
  const from = (b.from && (b.from.ta || b.from.en)) || '';
  const r = await admin.messaging().sendEachForMulticast({ tokens,
    webpush: { notification: { title: '🚕 புது Ride / New ride', body: `${from} · ₹${b.fare}${b.tip ? ' + ₹' + b.tip : ''}`, requireInteraction: true, tag: id },
               fcmOptions: { link: SITE + 'driver/' } },
    android: { priority: 'high', ttl: 60000, notification: { title: '🚕 புது Ride / New ride', body: `${from} · ₹${b.fare}${b.tip ? ' + ₹' + b.tip : ''}`, channelId: 'rides', tag: id, sound: 'default', defaultVibrateTimings: true } },
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
      android: { priority: 'high', notification: { title: msg.title, body: msg.body, channelId: 'rides', tag: `${ev.params.id}-${msg.kind}`, sound: 'default' } },
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
exports.deleteMyAccount = onCall({ enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('deleteMyAccount', req);
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
exports.purgeDriver = onCall({ timeoutSeconds: 300, enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('purgeDriver', req);
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
  if (uid) refs.push(db.doc(`cars/${uid}`));
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

exports.verifyPin = onCall({ enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('verifyPin', req);
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

// ---- WhatsApp (Meta Cloud API) ----------------------------------------------------------------------------------
// Settings live in waConfig/main (owner only — not in config/app, which every signed-in user can read):
//   { on, phoneId, testTo: ['9944xxxxxx'], kinds: ['confirmed','assigned','ontrip','done','cancelled'], ver }
// Every message is logged in waLog/{booking}_{kind} (created first, so a retried trigger never sends twice);
// delivery receipts from the webhook update that log; customer replies are kept in waInbox for the office.
const WA_TOKEN = defineSecret('WA_TOKEN'), WA_APP_SECRET = defineSecret('WA_APP_SECRET'), WA_VERIFY = defineSecret('WA_VERIFY_TOKEN');
const waKey = wamid => require('crypto').createHash('sha256').update(String(wamid)).digest('hex').slice(0, 40); // wamids may contain "/"

async function waSend(w, msg) {
  const ver = /^v\d{2}\.0$/.test(w.ver || '') ? w.ver : 'v23.0';
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/${encodeURIComponent(w.phoneId)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN.value()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    const wamid = j && j.messages && j.messages[0] && j.messages[0].id;
    if (r.ok && wamid) return { status: 'accepted', wamid: String(wamid) };
    const e = (j && j.error) || {};
    return { status: 'failed', error: W.clean(`${e.code || r.status} ${e.error_user_msg || e.message || ''}`, 300) };
  } catch (e) { return { status: 'failed', error: W.clean(`network ${e.name || ''} ${e.message || ''}`, 300) }; }
}

exports.waBooking = onDocumentWritten({ document: 'bookings/{id}', secrets: [WA_TOKEN] }, async ev => {
  const before = ev.data.before.exists ? ev.data.before.data() : null, after = ev.data.after.exists ? ev.data.after.data() : null;
  const kinds = W.waEvents(before, after); if (!kinds.length) return;
  const w = (await db.doc('waConfig/main').get()).data() || {}; if (w.on !== true || !w.phoneId) return;
  const id = ev.params.id, ref = ev.data.after.ref;
  const ct = (await ref.collection('private').doc('contact').get().catch(() => null));
  const to = W.waPhone((ct && ct.exists && ct.data().custPhone) || after.custPhone);
  if (!to) return;
  const c = await cfg();
  let lang = 'ta';
  if (after.customerUid) { const u = (await db.doc(`users/${after.customerUid}`).get()).data(); if (u && u.lang === 'en') lang = 'en'; }
  for (const kind of kinds) {
    if (!W.waAllowed(w, kind, to)) continue;
    const key = kind === 'assigned' ? `${id}_assigned_${String(after.driverPhone).slice(-4)}` : `${id}_${kind}`;
    const lref = db.doc(`waLog/${key}`);
    try { await lref.create({ bookingId: id, kind, to, status: 'sending', at: FV.serverTimestamp() }); }
    catch (e) { if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || '')) continue; throw e; }
    const msg = W.waMessage(kind, after, id, { to, lang, office: c.office || '', now: Date.now() });
    const r = await waSend(w, msg);
    await lref.update({ ...r, tpl: msg.template.name, lang, updatedAt: FV.serverTimestamp() });
    if (r.wamid) await db.doc(`waMsgs/${waKey(r.wamid)}`).set({ log: key, at: FV.serverTimestamp() });
    if (r.status === 'failed') logger.warn('whatsapp failed', { id, kind, error: r.error });
    else logger.info('whatsapp sent', { id, kind });
  }
});

// A driver who joined through the app and was just approved by the office gets a WhatsApp welcome.
// Same switch and test-number list as booking messages (waConfig/main); waConfig/main.drvWelcome === false turns only this off.
// Booking message types (w.kinds) do not apply here.
exports.waDriverWelcome = onDocumentCreated({ document: 'drivers/{ph}', secrets: [WA_TOKEN] }, async ev => {
  const d = ev.data && ev.data.data(); if (!d || d.fromApp !== true) return;
  const w = (await db.doc('waConfig/main').get()).data() || {};
  if (w.drvWelcome === false) return;
  const to = W.waPhone(ev.params.ph);
  if (!W.waAllowed({ ...w, kinds: undefined }, 'drvwelcome', to)) return;
  const key = `drv_${to}_welcome`, lref = db.doc(`waLog/${key}`);
  try { await lref.create({ driver: ev.params.ph, kind: 'drvwelcome', to, status: 'sending', at: FV.serverTimestamp() }); }
  catch (e) { if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || '')) return; throw e; }
  const c = await cfg();
  const lang = d.consent && d.consent.lang === 'en' ? 'en' : 'ta';
  const msg = W.waDriverWelcome(d, { to, lang, help: c.driverHelp || c.office || '9344039933' });
  const r = await waSend(w, msg);
  await lref.update({ ...r, tpl: msg.template.name, lang, updatedAt: FV.serverTimestamp() });
  if (r.wamid) await db.doc(`waMsgs/${waKey(r.wamid)}`).set({ log: key, at: FV.serverTimestamp() });
  if (r.status === 'failed') logger.warn('whatsapp driver welcome failed', { to, error: r.error });
  else logger.info('whatsapp driver welcome sent', { to });
});

// Office (owner or staff) replies to someone who messaged our WhatsApp number — a customer or a driver.
// Free text is allowed by WhatsApp only within 24 h of their last message; the server checks that, not the app.
// Each reply is logged in waLog (kind 'reply') so delivery receipts from the webhook update it.
exports.waReply = onCall({ secrets: [WA_TOKEN], enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('waReply', req);
  const me = req.auth && req.auth.token.phone_number, { to: to0, text: t0 } = req.data || {};
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  if (!(await db.doc(`staff/${me}`).get()).exists) throw new HttpsError('permission-denied', 'office only');
  const to = W.waPhone(to0), text = W.replyText(t0);
  if (!to || !text) throw new HttpsError('invalid-argument', 'bad request');
  const w = (await db.doc('waConfig/main').get()).data() || {};
  if (!w.phoneId) throw new HttpsError('failed-precondition', 'whatsapp not set up');
  const q = await db.collection('waInbox').where('from', '==', to).get();
  const lastIn = q.docs.reduce((m, d) => { const a = d.data().at; const ms = a && a.toMillis ? a.toMillis() : +new Date(a || 0); return Math.max(m, ms || 0); }, 0);
  if (!W.replyOpen(lastIn, Date.now())) throw new HttpsError('failed-precondition', 'reply window closed');
  const key = `reply_${to}_${Date.now()}`, lref = db.doc(`waLog/${key}`);
  await lref.create({ kind: 'reply', to, text, by: me, status: 'sending', at: FV.serverTimestamp() });
  const r = await waSend(w, W.waText(to, text));
  await lref.update({ ...r, updatedAt: FV.serverTimestamp() });
  if (r.wamid) await db.doc(`waMsgs/${waKey(r.wamid)}`).set({ log: key, at: FV.serverTimestamp() });
  if (r.status === 'failed') { logger.warn('whatsapp reply failed', { error: r.error }); return { ok: false, error: r.error }; }
  return { ok: true };
});

exports.waWebhook = onRequest({ secrets: [WA_APP_SECRET, WA_VERIFY], maxInstances: 5 }, async (req, res) => {
  if (req.method === 'GET') {   // Meta checks the address once when the webhook is saved
    const q = req.query || {}, tok = WA_VERIFY.value();
    if (q['hub.mode'] === 'subscribe' && tok && q['hub.verify_token'] === tok) return res.type('text/plain').status(200).send(String(q['hub.challenge'] || '').slice(0, 200));
    return res.sendStatus(403);
  }
  if (req.method !== 'POST') return res.sendStatus(405);
  if (!W.sigOk(req.rawBody, req.get('x-hub-signature-256'), WA_APP_SECRET.value())) { logger.warn('whatsapp webhook: bad signature'); return res.sendStatus(401); }
  const { statuses, messages } = W.waParse(req.body);
  for (const s of statuses) {
    const m = await db.doc(`waMsgs/${waKey(s.wamid)}`).get(); if (!m.exists) continue;
    const lref = db.doc(`waLog/${m.data().log}`);
    await db.runTransaction(async tx => {
      const cur = (await tx.get(lref)).data();
      if (cur && W.newer(cur.status, s.status)) tx.update(lref, { status: s.status, ...(s.error ? { error: s.error } : {}), updatedAt: FV.serverTimestamp() });
    });
  }
  for (const m of messages) await db.doc(`waInbox/${waKey(m.wamid)}`).set({ ...m, at: m.at ? new Date(m.at) : FV.serverTimestamp(), seen: false });
  res.sendStatus(200);
});

// Website contact form (enquiries): the same number sending more than 3 in an hour, or more than 40 from everyone in
// an hour, is closed automatically as "too many" so the office list stays usable. Nothing is deleted.
exports.onEnquiry = onDocumentCreated('enquiries/{id}', async ev => {
  const e = ev.data.data(); if (!e) return;
  const hourAgo = new Date(Date.now() - 3600e3);
  const all = await db.collection('enquiries').where('createdAt', '>', hourAgo).get();
  const same = all.docs.filter(d => d.data().phone === e.phone).length;
  const why = L.enquiryFlood(same, all.size);
  if (why) { await ev.data.ref.update({ status: 'closed', note: why, handledBy: 'server', updatedAt: FV.serverTimestamp() }); logger.warn('enquiry flood', { why, same, all: all.size }); }
});
