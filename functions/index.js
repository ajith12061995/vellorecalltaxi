/* Vellore Taxi — Cloud Functions (needs the Firebase Blaze plan). Region: asia-south1 (Mumbai).
   Every function is safe to deploy while the apps keep working the old way:
   - onBookingDone   : writes one ledger entry per finished trip (no commission while the driver's subscription runs).
   - loginCheck      : callable, before the OTP: 5 OTPs / number / device / hour; driver app only for office-added, not blocked numbers.
   - nativeLogin     : callable; Android instant phone verification → custom token for the page's session.
   - walletOp        : callable, owner only; recharge approval (one UTR credited once), daily bonus, manual + / −, each with a ledger line.
   - buySub          : callable; a driver buys a day / week / month subscription from the wallet (prices: config/app.subs). Takes / corrects the commission from the
                       driver wallet ONLY when config/app.serverComm is true (switch it on after deploying).
   - housekeeping    : every 2 minutes — sends scheduled local rides to drivers 30 min before pickup,
                       closes local searches nobody took for 15 min, marks drivers whose app went quiet as offline;
                       driver watch: 30 min silent → reminder push, 3 h silent → driver switched OFF (config/app.noWatch stops it).
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
const ST = require('./lib/staff');

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
  const doneMs = after.doneAt && after.doneAt.toMillis ? after.doneAt.toMillis() : Date.now();
  let s = null;
  await db.runTransaction(async tx => {
    const lref = db.doc(`ledger/${id}`);
    if ((await tx.get(lref)).exists) return;                  // already settled (function retried)
    const dsnap = await tx.get(db.doc(`drivers/${after.driverPhone}`)), sub = dsnap.exists ? dsnap.data().sub : null;
    const subOn = L.subActive(sub, doneMs);
    s = L.settle(after, pct, server, subOn);
    tx.set(lref, { bookingId: id, driverPhone: after.driverPhone, trip: s.trip, comm: s.comm, takenByApp: s.taken,
      walletDelta: s.walletDelta, pct, mode: server ? 'server' : 'app', mismatch: !!s.mismatch, ...(subOn ? { sub: sub.plan, subUntil: sub.until } : {}), at: FV.serverTimestamp() });
    if (s.walletDelta) tx.update(db.doc(`drivers/${after.driverPhone}`), { wallet: FV.increment(s.walletDelta), updatedAt: FV.serverTimestamp() });
    tx.update(ev.data.after.ref, { ledgerAt: FV.serverTimestamp(), ...(server ? { comm: s.comm } : {}) });
  });
  if (s && s.mismatch) logger.warn('commission mismatch', { id, driver: after.driverPhone, app: after.comm, expected: s.comm });
});

// Driver buys a subscription plan from the wallet (driver app → Wallet). All checks and the wallet change happen here,
// in one transaction, with a ledger entry; the driver's phone cannot write drivers/{phone}.sub (security rules).
exports.buySub = onCall({ enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('buySub', req);
  const me = req.auth && req.auth.token.phone_number;
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  const plan = String((req.data && req.data.plan) || '');
  const c = await cfg();
  const dref = db.doc(`drivers/${me}`);
  const r = await db.runTransaction(async tx => {
    const d = await tx.get(dref);
    const now = Date.now(), dec = L.buySubDecide(d.exists ? d.data() : null, c, plan, now);
    if (!dec.ok) return dec;
    const lref = db.collection('ledger').doc();
    tx.update(dref, { wallet: FV.increment(-dec.price), sub: { ...dec.sub, from: new Date(dec.sub.from), until: new Date(dec.sub.until), id: lref.id }, updatedAt: FV.serverTimestamp() });
    tx.set(lref, { type: 'sub', driverPhone: me, plan, veh: dec.sub.veh, price: dec.price, walletDelta: -dec.price,
      from: new Date(dec.sub.from), until: new Date(dec.sub.until), at: FV.serverTimestamp() });
    return { ok: true, plan, price: dec.price, until: dec.sub.until, id: lref.id };
  });
  if (!r.ok) logger.info('buySub refused', { driver: me, plan, why: r.why });
  else logger.info('buySub', { driver: me, plan, price: r.price });
  return r;
});

// Office (owner only) moves driver wallet money: approve a UPI recharge, pay the daily bonus, or a manual + / −.
// One transaction each: the wallet changes only together with a ledger line, a recharge is credited once, and one
// UTR can never be credited twice (utrs/{utr} lock). A repeated UTR rejects the request by itself.
exports.walletOp = onCall({ enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('walletOp', req);
  const me = req.auth && req.auth.token.phone_number;
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  const st = (await db.doc(`staff/${me}`).get()).data();
  if (!st || st.role !== 'owner') throw new HttpsError('permission-denied', 'owner only');
  const op = req.data || {}, kind = String(op.kind || '');
  const c = kind === 'bonus' ? await cfg() : {};
  const r = await db.runTransaction(async tx => {
    let rref = null, rch = null, phone = String(op.driverPhone || '');
    if (kind === 'recharge') {
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(op.rechargeId || ''))) return { ok: false, why: 'no-recharge' };
      rref = db.doc(`recharges/${op.rechargeId}`); const rs = await tx.get(rref);
      rch = rs.exists ? rs.data() : null; phone = rch ? String(rch.driverPhone || '') : '';
    }
    if (!/^\+91[6-9]\d{9}$/.test(phone)) return { ok: false, why: kind === 'recharge' && !rch ? 'no-recharge' : 'no-driver' };
    const dref = db.doc(`drivers/${phone}`), ds = await tx.get(dref);
    const uref = rch && L.UTR_RE.test(String(rch.utr || '')) ? db.doc(`utrs/${rch.utr}`) : null;
    const utrUsed = uref ? (await tx.get(uref)).exists : false;
    const now = Date.now(), dec = L.walletOpDecide(op, { drv: ds.exists ? ds.data() : null, rch, utrUsed, cfg: c, now });
    if (!dec.ok) {
      if (dec.reject && rref) tx.update(rref, { status: 'rejected', why: dec.why, approvedAt: FV.serverTimestamp(), approvedBy: me });
      return dec;
    }
    const lref = kind === 'recharge' ? db.doc(`ledger/rch_${op.rechargeId}`) : kind === 'bonus' ? db.doc(`ledger/bonus_${phone}_${dec.day}`) : db.collection('ledger').doc();
    if ((await tx.get(lref)).exists) return { ok: false, why: 'done' };
    tx.update(dref, { wallet: FV.increment(dec.delta), ...(kind === 'bonus' ? { bonusPaid: dec.day, bonusAt: FV.serverTimestamp() } : {}), updatedAt: FV.serverTimestamp() });
    tx.set(lref, { type: dec.type, driverPhone: phone, amt: dec.delta, walletDelta: dec.delta, by: me,
      ...(kind === 'recharge' ? { rechargeId: op.rechargeId, utr: dec.utr, method: 'upi' } : {}), ...(dec.day ? { day: dec.day } : {}),
      ...(dec.reason ? { reason: dec.reason } : {}), at: FV.serverTimestamp() });
    if (rref) { tx.update(rref, { status: 'approved', approvedAt: FV.serverTimestamp(), approvedBy: me, ledgerId: lref.id });
      tx.set(uref, { rechargeId: op.rechargeId, driverPhone: phone, amt: dec.delta, at: FV.serverTimestamp() }); }
    return { ok: true, kind, amt: dec.delta, driverPhone: phone, ledgerId: lref.id };
  });
  logger.info('walletOp', { by: me, kind, ok: r.ok, why: r.why || '', amt: r.amt || 0, driver: r.driverPhone || op.driverPhone || '' });
  return r;
});

// 2-tap login, step 1 (both apps, before the OTP is sent; no sign-in needed): rate limit per number and per device,
// and for the driver app only numbers the office added, never a blocked one. Answers why not, so the app can say it.
exports.loginCheck = onCall({ enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('loginCheck', req);
  const d = req.data || {}, p10 = String(d.phone || '').replace(/^\+?91/, ''), app = d.app === 'driver' ? 'driver' : 'customer';
  const dev = String(d.dev || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!/^[6-9]\d{9}$/.test(p10)) return { ok: false, why: 'invalid-phone' };
  const phone = '+91' + p10, now = Date.now();
  const pref = db.doc(`otpRate/${phone}`), dref = dev ? db.doc(`otpRate/dev_${dev}`) : null;
  const r = await db.runTransaction(async tx => {
    const [ps, ds, drv, apl] = await Promise.all([tx.get(pref), dref ? tx.get(dref) : null, app === 'driver' ? tx.get(db.doc(`drivers/${phone}`)) : null,
      app === 'driver' ? tx.get(db.doc(`driverApps/${phone}`)) : null]);
    const dec = L.loginDecide({ app, now, drv: drv && drv.exists ? drv.data() : null, appl: !!(apl && apl.exists), hits: ps.exists ? ps.data().t : [], devHits: ds && ds.exists ? ds.data().t : [] });
    if (dec.ok) { tx.set(pref, { t: dec.hits, at: FV.serverTimestamp() }); if (dref) tx.set(dref, { t: dec.devHits, at: FV.serverTimestamp() }); }
    return dec;
  });
  const out = { ok: r.ok, ...(r.why ? { why: r.why } : {}), ...(r.wait ? { wait: r.wait } : {}), ...(r.reason ? { reason: r.reason } : {}) };
  if (!r.ok && app === 'driver') { const c = await cfg(); out.office = String(c.driverHelp || c.office || '9344039933').replace(/\D/g, '').slice(-10); }
  logger.info('loginCheck', { app, phone: phone.slice(0, 5) + '…' + phone.slice(-2), ok: r.ok, why: r.why || '' });
  return out;
});

// 2-tap login, instant verification: Google verified the SIM without an SMS, so the app's native Firebase signed in.
// The page has its own Firebase session: swap the native ID token for a custom token of the same user.
exports.nativeLogin = onCall({ enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('nativeLogin', req);
  const t = String((req.data && req.data.idToken) || '');
  if (!t || t.length > 4000) throw new HttpsError('invalid-argument', 'token');
  let dec; try { dec = await admin.auth().verifyIdToken(t, true); } catch (e) { throw new HttpsError('unauthenticated', 'bad token'); }
  if (!dec.phone_number || (dec.firebase && dec.firebase.sign_in_provider !== 'phone')) throw new HttpsError('permission-denied', 'phone sign-in only');
  if (Date.now() / 1000 - (dec.auth_time || 0) > 600) throw new HttpsError('permission-denied', 'old sign-in');
  return { token: await admin.auth().createCustomToken(dec.uid) };
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
  let w = null;
  try { w = await watchDrivers(now); } catch (e) { logger.error('driver watch', { err: String(e) }); }
  try { if (w) w.moved = await reassignRides(now); } catch (e) { logger.error('reassign', { err: String(e) }); }
  try { await ownerAlerts(now, open.docs.map(d => ({ id: d.id, ...d.data() })), w); } catch (e) { logger.error('owner alerts', { err: String(e) }); }
  try { await demandRefresh(now); } catch (e) { logger.error('demand map', { err: String(e) }); }
});

// Driver watch: ON switch on, phone silent. 30 min → one reminder push; 3 h → OFF by the server (autoOff = updatedAt,
// so the driver app can tell it apart from an office OFF and goes back ON by itself when opened).
// Off switch: config/app.noWatch = true.
async function watchDrivers(now) {
  const c = await cfg(), res = { paused: [], ready: 0, on: 0 }; if (c.noWatch) return null;
  const ds = await db.collection('drivers').where('online', '==', true).get(); if (ds.empty) return res;
  const refs = ds.docs.map(d => [db.doc(`live/${d.id}`), db.doc(`watch/${d.id}`)]).flat();
  const got = await db.getAll(...refs), by = Object.fromEntries(got.map(g => [g.ref.path, g.exists ? g.data() : null]));
  let paused = 0, nudged = 0; const day = {};
  for (const d of ds.docs) {
    const drv = d.data(), lv = by[`live/${d.id}`];
    const smp = L.scoreSample(drv, lv, now, 2);
    if (smp) day[d.id] = { on: FV.increment(smp.on), act: FV.increment(smp.act), job: FV.increment(smp.job) };
    if (!drv.blocked) { res.on++; if (lv && lv.updatedAt && now - lv.updatedAt.toMillis() <= 3 * 60e3 && !lv.busy && !lv.bk) res.ready++; }
    const r = L.driverWatch(drv, lv, by[`watch/${d.id}`], now); if (!r) continue;
    if (r.pause) {
      await d.ref.update({ online: false, autoOff: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
      await db.doc(`watch/${d.id}`).set({ pausedAt: FV.serverTimestamp(), gapMin: Math.round(r.gap / 60e3) }, { merge: true });
      if (day[d.id]) day[d.id].off = FV.increment(1);
      paused++; if (!r.off) res.paused.push(drv.name || d.id); res.on--; if (r.push) await watchPush(d, drv, 'pause');
    } else if (r.nudge) {
      await db.doc(`watch/${d.id}`).set({ nudgeAt: FV.serverTimestamp(), gapMin: Math.round(r.gap / 60e3) }, { merge: true });
      nudged++; await watchPush(d, drv, 'nudge');
    }
  }
  if (Object.keys(day).length) await db.doc(`stats/${L.statDay(now)}`).set(day, { merge: true });
  if (paused || nudged) logger.info('driver watch', { paused, nudged });
  return res;
}

// Rides whose driver's phone went off / silent before pickup go back to "searching" for the other drivers (this driver is
// excluded); the customer and the owner are told. On a trip nothing is changed — the owner is told once.
async function reassignRides(now) {
  const c = await cfg(); if (c.noReassign) return [];
  const bs = await db.collection('bookings').where('status', 'in', ['assigned', 'ontrip']).get();
  const moved = [];
  for (const d of bs.docs) {
    const b = d.data(); if (!b.driverPhone) continue;
    const [ls, ds] = await Promise.all([db.doc(`live/${b.driverPhone}`).get(), db.doc(`drivers/${b.driverPhone}`).get()]);
    const r = L.reassignCheck(b, ls.exists ? ls.data() : null, ds.exists ? ds.data() : null, now); if (!r) continue;
    if (r.alert) {
      const ar = db.doc('alerts/owner'), a = (await ar.get()).data() || {};
      if (!a['trip_' + d.id]) { await ar.set({ ['trip_' + d.id]: now }, { merge: true }); moved.push({ id: d.id, b, alert: true }); }
      continue;
    }
    const ok = await db.runTransaction(async tx => {
      const fresh = await tx.get(d.ref), x = fresh.data();
      if (!x || x.status !== 'assigned' || x.arrivedAt || x.driverPhone !== b.driverPhone) return false;   // changed meanwhile
      tx.update(d.ref, { status: 'searching', driverPhone: null, driverName: null, plate: null, vehModel: null, assignedAt: null, arrivedAt: null, pinTry: null,
        exclude: [...new Set([...(x.exclude || []), b.driverPhone])], when: now, reopenedAt: now,
        reassigned: { why: r.why, from: b.driverPhone, at: now, gapMin: Math.round(r.gap / 60e3) }, updatedAt: FV.serverTimestamp() });
      if (r.why === 'phoneoff') tx.update(db.doc(`drivers/${b.driverPhone}`), { online: false, autoOff: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
      return true;
    });
    if (!ok) continue;
    moved.push({ id: d.id, b, why: r.why });
    logger.warn('ride reassigned', { id: d.id, driver: b.driverPhone, why: r.why, gapMin: Math.round(r.gap / 60e3) });
    try { if (c.push && c.push.vapid) await pushNewRide(d.id, { ...b, exclude: [...new Set([...(b.exclude || []), b.driverPhone])] }); } catch (e) { logger.warn('reassign push', { err: String(e) }); }
  }
  return moved;
}

// Demand map (config/demand, read by the driver app and the Office): rebuilt once an hour from the last 14 days.
async function demandRefresh(now) {
  const ref = db.doc('config/demand'), cur = (await ref.get()).data();
  if (cur && cur.at && now - cur.at.toMillis() < 60 * 60e3) return;
  const s = await db.collection('bookings').where('createdAt', '>=', new Date(now - 14 * 864e5)).get();
  const bands = L.demandMap(s.docs.map(d => d.data()), now, 14);
  await ref.set({ at: FV.serverTimestamp(), days: 14, total: s.size, bands });
  logger.info('demand map', { bookings: s.size });
}

// Owner alerts → push to every active owner who switched on "alerts on my phone" in the Office
// (token in staff/{phone}/private/push). Already-sent marks in alerts/owner (server only). Off: config/app.noOwnerPush.
async function ownerAlerts(now, open, w) {
  const c = await cfg(); if (c.noOwnerPush) return;
  const sref = db.doc('alerts/owner'), sent = (await sref.get()).data() || {};
  const { out, mark } = L.ownerAlerts({ open, ready: w ? w.ready : 1, on: w ? w.on : 0, paused: w ? w.paused : [], sent, now, moved: w ? w.moved : [] });
  if (!out.length) return;
  const os = await db.collection('staff').where('role', '==', 'owner').get();
  const toks = [];
  for (const o of os.docs) { if (o.data().active === false) continue; const p = (await db.doc(`staff/${o.id}/private/push`).get()).data(); if (p && p.fcm) toks.push([o.id, p.fcm]); }
  // keep the marks small: drop booking marks older than a day
  const keep = Object.fromEntries(Object.entries(sent).filter(([k, v]) => !k.startsWith('bk_') || now - (+v || 0) < 864e5));
  for (const k of Object.keys(mark)) keep[k] = k.startsWith('bk_') ? now : mark[k];
  await sref.set(keep);
  for (const a of out) for (const [ph, tok] of toks) {
    try {
      await admin.messaging().send({ token: tok,
        webpush: { notification: { title: a.title, body: a.body, tag: a.tag, icon: SITE + 'office/icon-192.png', requireInteraction: a.kind !== 'paused' }, fcmOptions: { link: SITE + 'office/' } },
        data: { kind: a.kind } });
    } catch (e) {
      if (/registration-token-not-registered|invalid-registration-token/.test(e.code || e.message || '')) await db.doc(`staff/${ph}/private/push`).delete().catch(() => {});
      logger.warn('owner push failed', { code: e.code || String(e) });
    }
  }
  logger.info('owner alerts', { sent: out.map(a => a.kind), owners: toks.length });
}
async function watchPush(d, drv, kind) {
  if (!drv.fcm) return;
  const m = L.watchMsg(kind, drv.lang === 'en' ? 'en' : 'ta'), tag = 'watch-' + kind;
  try {
    await admin.messaging().send({ token: drv.fcm,
      webpush: { notification: { title: m.title, body: m.body, tag, icon: SITE + 'icon-192.png' }, fcmOptions: { link: SITE + 'driver/' } },
      android: { priority: 'high', notification: { title: m.title, body: m.body, tag, sound: 'default' } },
      data: { kind: tag } });
  } catch (e) {
    if (/registration-token-not-registered|invalid-registration-token/.test(e.code || e.message || '')) await d.ref.update({ fcm: FV.delete() }).catch(() => {});
    logger.warn('watch push failed', { driver: d.id, code: e.code || String(e) });
  }
}

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

exports.onBookingCreated = onDocumentCreated({ document: 'bookings/{id}', timeoutSeconds: 150 }, async ev => {
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
  } else if (L.stFareOf(b, c) == null && L.fareLooksWrong(b, c.fares)) await ref.update({ fareFlag: 'below-price-list' });
  // 2b) a referral discount asked for: hold it from the customer's credit (none → no discount)
  if (b.coupon) { await holdCoupon(ref, b).catch(e => logger.error('coupon hold', { id, e: String(e) })); }
  else if (b.disc != null) { await holdDisc(ref, b).catch(e => logger.error('disc hold', { id, e: String(e) })); }
  // 3) a city ride outside the local area (should have been outstation): flag it for the office, don't block
  if (L.outsideArea(b, c.area)) { await ref.update({ areaFlag: 'outside-local' }); logger.warn('outside local area', { id, veh: b.veh }); }
  if (b.status !== 'searching' || !c.push || !c.push.vapid) return;
  await pushNewRide(id, b);
  // 4) while nobody has taken it, the ride is pushed again (like Rapido re-offering an order): a phone that slept
  // through the first push, or got it late, rings on the next one. Data message only (1.0.17+ apps), at most 4 times.
  if (c.noRepush) return;
  for (const wait of L.REPUSH) {
    await new Promise(r => setTimeout(r, wait * 1000));
    const s = await ref.get(); const nb = s.exists ? s.data() : null;
    if (!L.repushNow(nb)) break;
    await pushNewRide(id, nb, { dataOnly: true, round: wait }).catch(e => logger.warn('repush', { id, err: String(e) }));
  }
});

// New-ride push to the drivers of that vehicle who are ON (also used when a ride is given to another driver).
async function pushNewRide(id, b, o = {}) {
  const ex = new Set(b.exclude || []);
  const ds0 = await db.collection('drivers').where('veh', '==', b.veh).where('online', '==', true).get();
  const ds = { docs: ds0.docs.filter(d => !ex.has(d.id)) };
  // 1.0.17+ Android app: a high-priority DATA message (reaches the app in Doze / screen off; the app rings itself, over the
  // lock screen if locked). Older apps and the web page: the notification as before.
  const { data: tokData, note: tokens } = L.splitDriverTokens(ds.docs.map(d => d.data()));
  if (!tokens.length && !tokData.length) return;
  const from = (b.from && (b.from.ta || b.from.en)) || '';
  if (tokData.length) {
    const rd = await admin.messaging().sendEachForMulticast({ tokens: tokData, android: { priority: 'high', ttl: 60000 }, data: L.ridePushData(id, b) });
    logger.info('push data', { id, round: o.round || 0, sent: rd.successCount, failed: rd.failureCount });
  }
  if (!tokens.length || o.dataOnly) return;
  const r = await admin.messaging().sendEachForMulticast({ tokens,
    webpush: { notification: { title: '🚕 புது Ride / New ride', body: `${from} · ₹${b.fare}${b.tip ? ' + ₹' + b.tip : ''}`, requireInteraction: true, tag: id },
               fcmOptions: { link: SITE + 'driver/' } },
    android: { priority: 'high', ttl: 60000, notification: { title: '🚕 புது Ride / New ride', body: `${from} · ₹${b.fare}${b.tip ? ' + ₹' + b.tip : ''}`, channelId: 'rides', tag: id, sound: 'default', defaultVibrateTimings: true } },
    data: { bookingId: id } });
  logger.info('push', { sent: r.successCount, failed: r.failureCount });
}

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

// A waiting ride was taken (or cancelled): the ride screen ringing on the other drivers' phones closes at once.
// ---- referral discount (see lib/logic.js referDecide / discTake)
const authPhone = async uid => { try { return uid ? (await admin.auth().getUser(uid)).phoneNumber || '' : ''; } catch (e) { return ''; } };
async function holdDisc(ref, b) {
  const ph = await authPhone(b.customerUid);
  await db.runTransaction(async tx => {
    const bs = await tx.get(ref); if (!bs.exists) return; const cur = bs.data();
    if (cur.discHeld != null) return;                                    // already held (function retried)
    const cref = ph ? db.doc(`credits/${ph}`) : null, cs = cref ? await tx.get(cref) : null;
    const take = ['searching', 'scheduled'].includes(cur.status) ? L.discTake(cur.disc, cs && cs.exists ? cs.data().bal : 0, cur.fare) : 0;
    if (take > 0) tx.set(cref, { bal: FV.increment(-take), updatedAt: FV.serverTimestamp() }, { merge: true });
    tx.update(ref, { disc: take, discHeld: take > 0, updatedAt: FV.serverTimestamp() });
  });
}
// a coupon asked for: the server checks it (on, date, limit, one use per customer, first ride, minimum fare), takes
// one use and holds the discount on the booking — or tells the customer why not (couponWhy)
async function holdCoupon(ref, b) {
  const code = String(b.coupon || '').toUpperCase();
  if (!L.COUPON_RE.test(code)) { await ref.update({ disc: 0, discHeld: false, couponWhy: 'unknown' }); return; }
  const prev = await db.collection('bookings').where('customerUid', '==', b.customerUid).where('status', '==', 'done').limit(1).get();
  await db.runTransaction(async tx => {
    const bs = await tx.get(ref); if (!bs.exists) return; const cur = bs.data(); if (cur.discHeld != null) return;
    const cref = db.doc(`coupons/${code}`), uref = db.doc(`couponUses/${code}_${b.customerUid}`);
    const cs = await tx.get(cref), us = await tx.get(uref);
    const r = ['searching', 'scheduled'].includes(cur.status)
      ? L.couponDecide(cs.exists ? cs.data() : null, { fare: cur.fare, now: Date.now(), usedByMe: us.exists, firstRide: prev.empty }) : { disc: 0, why: 'state' };
    if (r.disc > 0) {
      tx.set(uref, { code, uid: b.customerUid, bookingId: ref.id, disc: r.disc, at: FV.serverTimestamp() });
      tx.update(cref, { used: FV.increment(1) });
      tx.update(ref, { disc: r.disc, discHeld: true, discSrc: 'coupon', coupon: code, updatedAt: FV.serverTimestamp() });
    } else tx.update(ref, { disc: 0, discHeld: false, couponWhy: r.why, updatedAt: FV.serverTimestamp() });
  });
}
exports.onBookingDisc = onDocumentUpdated('bookings/{id}', async ev => {
  const before = ev.data.before.data() || {}, after = ev.data.after.data(), ref = ev.data.after.ref, id = ev.params.id;
  if (!after) return;
  const done = after.status === 'done' && before.status !== 'done', cancelled = after.status === 'cancelled' && before.status !== 'cancelled';
  // 1) a held discount: back to the customer's credit if cancelled; to the driver's wallet when done (the company pays it)
  if (after.discHeld && (cancelled || (done && after.driverPhone))) {
    const ph = cancelled ? await authPhone(after.customerUid) : '';
    await db.runTransaction(async tx => {
      const bs = await tx.get(ref), cur = bs.data() || {}, amt = Math.round(+cur.disc || 0);
      if (!cur.discHeld || cur.discBack || cur.discPaid || !(amt > 0)) return;
      if (cancelled && cur.discSrc === 'coupon') {          // a cancelled ride gives the coupon use back
        const code = String(cur.coupon || '');
        tx.delete(db.doc(`couponUses/${code}_${cur.customerUid}`)); tx.update(db.doc(`coupons/${code}`), { used: FV.increment(-1) }); tx.update(ref, { discBack: true });
      } else if (cancelled) { if (!ph) return; tx.set(db.doc(`credits/${ph}`), { bal: FV.increment(amt), updatedAt: FV.serverTimestamp() }, { merge: true }); tx.update(ref, { discBack: true }); }
      else { tx.update(db.doc(`drivers/${cur.driverPhone}`), { wallet: FV.increment(amt), updatedAt: FV.serverTimestamp() }); tx.update(ref, { discPaid: true });
        tx.set(db.doc(`ledger/disc_${id}`), { bookingId: id, driverPhone: cur.driverPhone, disc: amt, kind: cur.discSrc === 'coupon' ? 'coupon-discount' : 'referral-discount', ...(cur.coupon ? { coupon: cur.coupon } : {}), at: FV.serverTimestamp() }); }
    });
  }
  // 2) the referred customer's first finished ride: both get the referral credit, once
  if (!done || after.src !== 'app' || !after.customerUid) return;
  const c = await cfg(); if (!L.refAmt(c)) return;
  const us = await db.doc(`users/${after.customerUid}`).get(), refBy = us.exists ? String(us.data().refBy || '') : '';
  if (!refBy) return;
  const phone = await authPhone(after.customerUid);
  let referrerExists = false; try { await admin.auth().getUserByPhoneNumber(refBy); referrerExists = true; } catch (e) { /* not a customer yet */ }
  const dq = await db.collection('bookings').where('customerUid', '==', after.customerUid).where('status', '==', 'done').limit(2).get();
  await db.runTransaction(async tx => {
    const rref = db.doc(`referrals/${after.customerUid}`), rs = await tx.get(rref);
    const amt = L.referDecide({ cfg: c, refBy, phone, already: rs.exists, referrerExists, doneCount: dq.size });
    if (!amt) return;
    tx.set(rref, { by: refBy, to: phone, amt, bookingId: id, at: FV.serverTimestamp() });
    tx.set(db.doc(`credits/${phone}`), { bal: FV.increment(amt), updatedAt: FV.serverTimestamp() }, { merge: true });
    tx.set(db.doc(`credits/${refBy}`), { bal: FV.increment(amt), updatedAt: FV.serverTimestamp() }, { merge: true });
  });
});

// ---- GPS meter check: when a city ride finishes, re-measure the route the driver's phone uploaded (same rules as the
// phone, functions/lib/meter.js = core/meter.js) and flag a mismatch for the office. The last chunks can arrive a few
// seconds after "done", so a chunk that arrives after "done" re-checks the ride (no waiting / sleeping here).
const METER = require('./lib/meter');
async function verifyMeter(ref, b) {
  if (!b || b.status !== 'done' || (b.kind && b.kind !== 'ride' && b.kind !== 'schedule')) return;
  const q = await ref.collection('track').get();
  const ch = q.docs.map(d => d.data()), srv = ch.length ? METER.summary(METER.replay(ch)) : null;
  const r = L.meterCheck(b, srv);
  await ref.update({ meterSrv: r.srv || { km: 0, pts: 0 }, meterFlag: r.flag || FV.delete() });
  if (r.flag) logger.warn('meter flag', { id: ref.id, flag: r.flag, billedKm: b.fx && b.fx.km, srvKm: r.srv && r.srv.km });
}
exports.onBookingMeter = onDocumentUpdated('bookings/{id}', async ev => {
  const before = ev.data.before.data() || {}, after = ev.data.after.data();
  if (!after || after.status !== 'done' || before.status === 'done') return;
  await verifyMeter(ev.data.after.ref, after);
});
exports.onTrackChunk = onDocumentCreated('bookings/{id}/track/{c}', async ev => {
  const ref = db.doc(`bookings/${ev.params.id}`), s = await ref.get();
  if (s.exists && s.data().status === 'done') await verifyMeter(ref, s.data());
});

exports.onRideTaken = onDocumentUpdated('bookings/{id}', async ev => {
  const t = L.takenNow(ev.data.before.data(), ev.data.after.data()); if (!t || !t.veh) return;
  const c = await cfg(); if (!c.push || !c.push.vapid || c.noTakenPush) return;
  const ds = (await db.collection('drivers').where('veh', '==', t.veh).where('online', '==', true).limit(500).get()).docs
    .filter(d => d.id !== t.except).map(d => d.data());
  const { data } = L.splitDriverTokens(ds); if (!data.length) return;
  const r = await admin.messaging().sendEachForMulticast({ tokens: data, android: { priority: 'high', ttl: 60000 },
    data: { type: 'taken', bookingId: ev.params.id, why: t.why } }).catch(e => { logger.warn('taken push', { err: String(e) }); return null; });
  if (r) logger.info('taken push', { id: ev.params.id, sent: r.successCount, failed: r.failureCount });
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
    const mo = { to, lang, office: c.office || '', now: Date.now() };
    let msg = W.waMessage(kind, after, id, mo), r = await waSend(w, msg);
    // vct_no_driver (the warm "no vehicle yet" apology) not approved yet → the plain cancelled message, so the customer still hears from us
    if (r.status === 'failed' && msg.template.name === W.TPL.nodriver && W.tplMissing(r.error)) {
      logger.info('no-driver template not ready, sending the plain cancelled one', { error: r.error });
      msg = W.waMessage(kind, after, id, { ...mo, v1: true }); r = await waSend(w, msg);
    }
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
  const o = { to, lang, help: c.driverHelp || c.office || '9344039933' };
  let msg = W.waDriverWelcome(d, o), r = await waSend(w, msg);
  // vct_driver_welcome3 (with the app link button) not approved yet → the older welcome, so the driver still hears from us
  if (r.status === 'failed' && W.tplMissing(r.error)) {
    logger.info('driver welcome: link template not ready, sending the older one', { error: r.error });
    msg = W.waDriverWelcome(d, { ...o, v1: true }); r = await waSend(w, msg);
  }
  await lref.update({ ...r, tpl: msg.template.name, lang, updatedAt: FV.serverTimestamp() });
  if (r.wamid) await db.doc(`waMsgs/${waKey(r.wamid)}`).set({ log: key, at: FV.serverTimestamp() });
  if (r.status === 'failed') logger.warn('whatsapp driver welcome failed', { to, error: r.error });
  else logger.info('whatsapp driver welcome sent', { to });
});

// A staff member asked the owner for approval (fare / bill / block…) → WhatsApp to every owner number, once per owner.
exports.waOwnerRequest = onDocumentCreated({ document: 'staffReq/{id}', secrets: [WA_TOKEN] }, async ev => {
  const r = ev.data && ev.data.data(); if (!r || r.status !== 'pending') return;
  const w = (await db.doc('waConfig/main').get()).data() || {};
  if (w.ownerReq === false) return;
  const owners = (await db.collection('staff').where('role', '==', 'owner').get()).docs.map(d => W.waPhone(d.id)).filter(Boolean);
  const p = ST.ownerReqParams(r, true);
  for (const to of owners) {
    if (!W.waAllowed({ ...w, kinds: undefined, testTo: [] }, 'ownerreq', to)) continue;
    const key = `req_${ev.params.id}_${to}`, lref = db.doc(`waLog/${key}`);
    try { await lref.create({ req: ev.params.id, kind: 'ownerreq', to, status: 'sending', at: FV.serverTimestamp() }); }
    catch (e) { if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || '')) continue; throw e; }
    const msg = W.waOwnerReq(p, { to, lang: 'ta' });
    const res = await waSend(w, msg);
    await lref.update({ ...res, tpl: msg.template.name, lang: 'ta', updatedAt: FV.serverTimestamp() });
    if (res.wamid) await db.doc(`waMsgs/${waKey(res.wamid)}`).set({ log: key, at: FV.serverTimestamp() });
    if (res.status === 'failed') logger.warn('whatsapp owner request failed', { to, error: res.error });
  }
});

// Office (owner or staff) replies to someone who messaged our WhatsApp number — a customer or a driver.
// Free text is allowed by WhatsApp only within 24 h of their last message; the server checks that, not the app.
// Each reply is logged in waLog (kind 'reply') so delivery receipts from the webhook update it.
exports.waReply = onCall({ secrets: [WA_TOKEN], enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('waReply', req);
  const me = req.auth && req.auth.token.phone_number, { to: to0, text: t0 } = req.data || {};
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  if (!ST.onDuty((await db.doc(`staff/${me}`).get()).data())) throw new HttpsError('permission-denied', 'office only (on duty)');
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
// ---- Razorpay: driver wallet recharge --------------------------------------------------------------------------
// Secrets (Cloud Shell, tools/cloudshell-razorpay.sh): RZP_KEY_ID, RZP_KEY_SECRET, RZP_WEBHOOK_SECRET.
// The driver app shows the Razorpay button only when Office → Settings switches config/app.rzp on.
const R = require('./lib/rzp');
const RZP_KEY_ID = defineSecret('RZP_KEY_ID'), RZP_KEY_SECRET = defineSecret('RZP_KEY_SECRET'), RZP_HOOK = defineSecret('RZP_WEBHOOK_SECRET');

// Credit one paid order to the driver's wallet — at most once, whichever proof (checkout or webhook) comes first.
async function rzpCredit(orderId, paymentId, via, paise) {
  const oref = db.doc(`rzpOrders/${orderId}`);
  return db.runTransaction(async tx => {
    const o = await tx.get(oref);
    if (!o.exists) return 'unknown';
    const d = o.data();
    if (d.status === 'paid') return 'already';
    if (paise != null && paise !== d.amt * 100) { tx.update(oref, { status: 'mismatch', paymentId, paise, updatedAt: FV.serverTimestamp() }); return 'mismatch'; }
    const dref = db.doc(`drivers/${d.driverPhone}`), drv = await tx.get(dref);
    if (!drv.exists) { tx.update(oref, { status: 'no-driver', paymentId, updatedAt: FV.serverTimestamp() }); return 'no-driver'; }
    tx.update(oref, { status: 'paid', paymentId, via, paidAt: FV.serverTimestamp() });
    tx.set(db.doc(`recharges/rzp_${orderId}`), { driverPhone: d.driverPhone, driverName: d.driverName || '', amt: d.amt, utr: paymentId,
      method: 'razorpay', orderId, status: 'approved', approvedBy: 'razorpay', date: Date.now(), createdAt: FV.serverTimestamp(), approvedAt: FV.serverTimestamp() });
    tx.update(dref, { wallet: FV.increment(d.amt), updatedAt: FV.serverTimestamp() });
    tx.set(db.doc(`ledger/rch_rzp_${orderId}`), { type: 'recharge', method: 'razorpay', driverPhone: d.driverPhone, amt: d.amt, walletDelta: d.amt, utr: paymentId, rechargeId: `rzp_${orderId}`, at: FV.serverTimestamp() });
    return 'credited';
  });
}

exports.rzpOrder = onCall({ secrets: [RZP_KEY_ID, RZP_KEY_SECRET], enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('rzpOrder', req);
  const me = req.auth && req.auth.token.phone_number;
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  const amt = +(req.data && req.data.amt);
  if (!R.amountOk(amt)) throw new HttpsError('invalid-argument', 'amount');
  const c = await cfg(); if (c.rzp !== true) throw new HttpsError('failed-precondition', 'razorpay off');
  const ds = await db.doc(`drivers/${me}`).get();
  if (!ds.exists) throw new HttpsError('permission-denied', 'drivers only');
  if (ds.data().blocked) throw new HttpsError('permission-denied', 'blocked');
  const key = RZP_KEY_ID.value(), sec = RZP_KEY_SECRET.value();
  if (!key || !sec) throw new HttpsError('failed-precondition', 'razorpay not set up');
  // TEST keys take fake money: only the drivers listed in config/app.rzpTesters may use them (no free wallet credit)
  if (key.startsWith('rzp_test_') && !(Array.isArray(c.rzpTesters) && c.rzpTesters.includes(me))) throw new HttpsError('permission-denied', 'test mode: testers only');
  let j;
  try {
    const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${sec}`).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify(R.orderBody(amt, me.replace('+91', ''), Date.now())), signal: AbortSignal.timeout(15000) });
    j = await r.json().catch(() => ({}));
    if (!r.ok || !/^order_\w+$/.test(j.id || '')) { logger.warn('razorpay order failed', { status: r.status, err: j && j.error && j.error.description }); throw new Error('order'); }
  } catch (e) { throw new HttpsError('unavailable', 'payment service busy, try again'); }
  await db.doc(`rzpOrders/${j.id}`).set({ driverPhone: me, driverName: ds.data().name || '', amt, status: 'created', createdAt: FV.serverTimestamp() });
  return { orderId: j.id, keyId: key, amount: amt * 100, currency: 'INR' };
});

exports.rzpVerify = onCall({ secrets: [RZP_KEY_SECRET], enforceAppCheck: AC_ENFORCE }, async req => {
  acLog('rzpVerify', req);
  const me = req.auth && req.auth.token.phone_number;
  if (!me) throw new HttpsError('unauthenticated', 'login first');
  const { orderId, paymentId, signature } = req.data || {};
  if (!R.checkoutSigOk(orderId, paymentId, signature, RZP_KEY_SECRET.value())) throw new HttpsError('permission-denied', 'bad signature');
  const o = await db.doc(`rzpOrders/${orderId}`).get();
  if (!o.exists || o.data().driverPhone !== me) throw new HttpsError('permission-denied', 'not your order');
  const r = await rzpCredit(orderId, paymentId, 'checkout');
  return { ok: r === 'credited' || r === 'already', result: r };
});

exports.rzpWebhook = onRequest({ secrets: [RZP_HOOK], maxInstances: 5 }, async (req, res) => {
  if (req.method !== 'POST') return res.sendStatus(405);
  if (!R.webhookSigOk(req.rawBody, req.get('x-razorpay-signature'), RZP_HOOK.value())) { logger.warn('razorpay webhook: bad signature'); return res.sendStatus(401); }
  const p = R.webhookPayment(req.body);
  if (p) { const r = await rzpCredit(p.orderId, p.paymentId, 'webhook', p.paise); if (r !== 'credited' && r !== 'already') logger.warn('razorpay webhook', { r, order: p.orderId }); }
  res.sendStatus(200);
});

exports.onEnquiry = onDocumentCreated('enquiries/{id}', async ev => {
  const e = ev.data.data(); if (!e) return;
  const hourAgo = new Date(Date.now() - 3600e3);
  const all = await db.collection('enquiries').where('createdAt', '>', hourAgo).get();
  const same = all.docs.filter(d => d.data().phone === e.phone).length;
  const why = L.enquiryFlood(same, all.size);
  if (why) { await ev.data.ref.update({ status: 'closed', note: why, handledBy: 'server', updatedAt: FV.serverTimestamp() }); logger.warn('enquiry flood', { why, same, all: all.size }); }
});
