// Runs the real housekeeping function (driver watch part) against an in-memory database and a fake FCM.
const test = require('node:test'), assert = require('node:assert'), Module = require('module');
const store = new Map(); let NOW = Date.parse('2026-11-27T05:00:00Z'); // 10:30 IST
const T = ms => ({ toMillis: () => ms, __ms: ms });
const TS = () => ({ __ts: true });
const fix = v => (v && v.__ts ? T(NOW) : v);
const apply = (cur, d) => { const o = { ...(cur || {}) }; for (const [k, v] of Object.entries(d)) { if (v === null) delete o[k]; else o[k] = fix(v); } return o; };
const snap = path => ({ exists: store.has(path), data: () => (store.has(path) ? { ...store.get(path) } : undefined), ref: docRef(path), id: path.split('/').pop() });
function docRef(path) {
  return { path, id: path.split('/').pop(), get: async () => snap(path),
    set: async (d, o) => { store.set(path, apply(o && o.merge ? store.get(path) : {}, d)); },
    delete: async () => { store.delete(path); },
    update: async d => { if (!store.has(path)) throw new Error('NOT_FOUND ' + path); store.set(path, apply(store.get(path), d)); } };
}
const coll = name => {
  const q = (filters) => ({ where: (f, op, v) => q([...filters, [f, op, v]]), limit: () => q(filters),
    get: async () => { const docs = [...store.keys()].filter(k => k.startsWith(name + '/') && k.split('/').length === 2).map(snap)
      .filter(s => filters.every(([f, op, v]) => { const x = s.data()[f]; return op === '==' ? x === v : op === 'in' ? v.includes(x) : op === '<' ? false : true; }));
      return { docs, empty: !docs.length, forEach: fn => docs.forEach(fn) }; } });
  return q([]);
};
const db = { doc: docRef, collection: coll, getAll: async (...r) => r.map(x => snap(x.path)), recursiveDelete: async () => {},
  batch: () => { const ops = []; return { update: (r, d) => ops.push([r, d]), commit: async () => { for (const [r, d] of ops) await r.update(d); } }; } };
let sent = [], failToken = '';
const mocks = {
  'firebase-admin': { initializeApp() {}, firestore: () => db, messaging: () => ({ send: async m => { if (m.token === failToken) { const e = new Error('x'); e.code = 'messaging/registration-token-not-registered'; throw e; } sent.push(m); } }), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: TS, increment: n => n, delete: () => null } },
  'firebase-functions/v2/firestore': { onDocumentUpdated: (o, h) => h, onDocumentCreated: (o, h) => h, onDocumentWritten: (o, h) => h },
  'firebase-functions/v2/scheduler': { onSchedule: (o, h) => h },
  'firebase-functions/v2/https': { onCall: (o, h) => h, onRequest: (o, h) => h, HttpsError: Error },
  'firebase-functions/v2': { setGlobalOptions() {}, logger: { info() {}, warn() {}, error: (...a) => { throw new Error('logger.error ' + JSON.stringify(a)); } } },
  'firebase-functions/params': { defineString: () => ({ value: () => '' }), defineSecret: () => ({ value: () => '' }) }
};
const load0 = Module._load; Module._load = function (req, ...rest) { return mocks[req] || load0.call(this, req, ...rest); };
const F = require('../index.js'); Module._load = load0;
const realNow = Date.now; const run = async () => { Date.now = () => NOW; try { await F.housekeeping(); } finally { Date.now = realNow; } };
const drv = (ph, ago, extra) => { store.set('drivers/' + ph, { name: ph, veh: 'mini', online: true, fcm: 'tok' + ph, updatedAt: T(NOW - 99 * 3600e3), ...extra }); store.set('live/' + ph, { online: ago < 10 * 60e3, updatedAt: T(NOW - ago) }); };
const reset = () => { store.clear(); sent = []; failToken = ''; store.set('config/app', {}); };

test('ready driver untouched; 30 min silent → one reminder; not again in the same spell', async () => {
  reset(); drv('A', 2 * 60e3); drv('B', 35 * 60e3);
  await run();
  assert.equal(sent.length, 1); assert.equal(sent[0].token, 'tokB'); assert.match(sent[0].android.notification.body, /signal வரல/);
  assert.equal(store.get('drivers/B').online, true, 'reminder does not switch off');
  assert.equal(store.get('drivers/A').online, true); assert.equal(store.get('watch/A'), undefined);
  NOW += 10 * 60e3; sent = []; await run(); assert.equal(sent.length, 0, 'no repeat');
  store.set('live/B', { online: true, updatedAt: T(NOW) }); NOW += 40 * 60e3; store.set('live/A', { online: true, updatedAt: T(NOW - 60e3) }); await run(); assert.deepEqual(sent.map(m => m.token), ['tokB'], 'new silent spell → reminder again');
});
test('3 h silent → switched OFF with autoOff == updatedAt, push says why', async () => {
  reset(); drv('C', 3 * 3600e3 + 60e3);
  await run();
  const c = store.get('drivers/C'); assert.equal(c.online, false); assert.equal(c.autoOff.toMillis(), NOW); assert.equal(c.updatedAt.toMillis(), NOW);
  assert.equal(sent.length, 1); assert.match(sent[0].android.notification.title, /OFF/);
  assert.equal(store.get('watch/C').gapMin, 181);
  sent = []; NOW += 2 * 60e3; await run(); assert.equal(sent.length, 0, 'already off: nothing more');
});
test('night: paused without a push, no reminders; on a job / blocked / office switch skipped', async () => {
  reset(); NOW = Date.parse('2026-11-26T20:00:00Z'); // 01:30 IST
  drv('N1', 40 * 60e3); drv('N2', 4 * 3600e3); drv('J', 5 * 3600e3); store.set('live/J', { busy: true, bk: 'b1', updatedAt: T(NOW - 5 * 3600e3) }); drv('X', 5 * 3600e3, { blocked: true });
  await run();
  assert.equal(sent.length, 0); assert.equal(store.get('drivers/N1').online, true); assert.equal(store.get('drivers/N2').online, false);
  assert.equal(store.get('drivers/J').online, true); assert.equal(store.get('drivers/X').online, true);
  reset(); NOW = Date.parse('2026-11-27T05:00:00Z'); store.set('config/app', { noWatch: true }); drv('Q', 5 * 3600e3); await run();
  assert.equal(store.get('drivers/Q').online, true, 'noWatch switch stops it');
});
test('a dead push token is removed, the pause still happens', async () => {
  reset(); drv('D', 4 * 3600e3); failToken = 'tokD'; await run();
  assert.equal(store.get('drivers/D').online, false); assert.equal(store.get('drivers/D').fcm, undefined);
});

test('owner alerts reach the owner phone: waiting ride once, paused drivers, no ready driver; dead token removed', async () => {
  reset(); NOW = Date.parse('2026-11-27T05:00:00Z');
  store.set('staff/+918220201462', { role: 'owner', active: true }); store.set('staff/+918220201462/private/push', { fcm: 'OWN' });
  store.set('staff/+917000000001', { role: 'staff', active: true }); store.set('staff/+917000000001/private/push', { fcm: 'STAFF' });
  store.set('bookings/b1', { status: 'searching', kind: 'ride', veh: 'mini', fare: 150, from: { ta: 'காட்பாடி' }, to: { ta: 'CMC' }, createdAt: T(NOW - 3 * 60e3) });
  drv('P', 4 * 3600e3); drv('W', 12 * 60e3);
  await run();
  const own = sent.filter(m => m.token === 'OWN');
  assert.deepEqual(own.map(m => m.data.kind).sort(), ['noready', 'paused', 'wait']);
  assert.equal(sent.filter(m => m.token === 'STAFF').length, 0, 'staff do not get owner alerts');
  assert.equal(own.find(m => m.data.kind === 'wait').webpush.fcmOptions.link.endsWith('/office/'), true);
  sent = []; NOW += 2 * 60e3; await run();
  assert.equal(sent.filter(m => m.token === 'OWN').length, 0, 'nothing repeated 2 min later');
  store.set('staff/+918220201462/private/push', { fcm: 'DEAD' }); failToken = 'DEAD'; NOW += 31 * 60e3; drv('Q', 40 * 60e3); await run();
  assert.equal(store.get('staff/+918220201462/private/push'), undefined, 'dead owner token removed');
});
