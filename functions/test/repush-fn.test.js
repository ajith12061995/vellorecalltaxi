// Runs the real onBookingCreated: a ride nobody takes is pushed again (data message) until a driver takes it.
const test = require('node:test'), assert = require('node:assert'), Module = require('module');
const store = new Map(); let NOW = Date.parse('2026-11-27T05:00:00Z'); // 10:30 IST
const T = ms => ({ toMillis: () => ms, __ms: ms });
const TS = () => ({ __ts: true });
const fix = v => (v && v.__ts ? T(NOW) : v);
const apply = (cur, d) => { const o = { ...(cur || {}) }; for (const [k, v] of Object.entries(d)) { if (v === null) delete o[k]; else if (v && v.__inc != null) o[k] = (+o[k] || 0) + v.__inc; else if (v && typeof v === 'object' && !v.__ts && !v.toMillis && !Array.isArray(v)) o[k] = apply(o[k], v); else o[k] = fix(v); } return o; };
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
      return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) }; } });
  return q([]);
};
const db = { doc: docRef, collection: coll,
  runTransaction: async fn => { const q = []; const r = await fn({ get: x => x.get(), update: (x, d) => q.push(() => x.update(d)), set: (x, d) => q.push(() => x.set(d)) }); for (const f of q) await f(); return r; },
  getAll: async (...r) => r.map(x => snap(x.path)), recursiveDelete: async () => {},
  batch: () => { const ops = []; return { update: (r, d) => ops.push([r, d]), commit: async () => { for (const [r, d] of ops) await r.update(d); } }; } };
let sent = [], failToken = '', multi = [];
const mocks = {
  'firebase-admin': { initializeApp() {}, firestore: () => db, messaging: () => ({ sendEachForMulticast: async m => { multi.push(m); return { successCount: m.tokens.length, failureCount: 0 }; }, send: async m => { if (m.token === failToken) { const e = new Error('x'); e.code = 'messaging/registration-token-not-registered'; throw e; } sent.push(m); } }), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: TS, increment: n => ({ __inc: n }), delete: () => null } },
  'firebase-functions/v2/firestore': { onDocumentUpdated: (o, h) => h, onDocumentCreated: (o, h) => h, onDocumentWritten: (o, h) => h },
  'firebase-functions/v2/scheduler': { onSchedule: (o, h) => h },
  'firebase-functions/v2/https': { onCall: (o, h) => h, onRequest: (o, h) => h, HttpsError: Error },
  'firebase-functions/v2': { setGlobalOptions() {}, logger: { info() {}, warn() {}, error: (...a) => { throw new Error('logger.error ' + JSON.stringify(a)); } } },
  'firebase-functions/params': { defineString: () => ({ value: () => '' }), defineSecret: () => ({ value: () => '' }) }
};
const load0 = Module._load; Module._load = function (req, ...rest) { return mocks[req] || load0.call(this, req, ...rest); };
const F = require('../index.js'); Module._load = load0;

const waits = []; const realST = global.setTimeout;
let onWait = () => {};
const run = async (id, b) => {
  global.setTimeout = (fn, ms) => { waits.push(ms); onWait(waits.length); return realST(fn, 0); };
  try { await F.onBookingCreated({ data: { data: () => b, ref: docRef('bookings/' + id) }, params: { id } }); } finally { global.setTimeout = realST; }
};
const setup = () => { store.clear(); multi = []; waits.length = 0; onWait = () => {};
  store.set('config/app', { push: { vapid: 'v' } });
  store.set('drivers/+911', { veh: 'mini', online: true, fcm: 't1', dev: { app: '1.0.17+' } });
  store.set('drivers/+912', { veh: 'mini', online: true, fcm: 't2', dev: { app: '1.0.16+' } });
  store.set('drivers/+913', { veh: 'auto', online: true, fcm: 't3', dev: { app: '1.0.17+' } }); };
const ride = (x) => ({ status: 'searching', veh: 'mini', kind: 'ride', fare: 60, from: { en: 'Katpadi', lat: 12.97, lon: 79.16 }, to: { en: 'CMC' }, ...x });

test('nobody takes it: pushed again 4 times, data message only, to the same vehicle drivers', async () => {
  setup(); const b = ride(); store.set('bookings/r1', b);
  await run('r1', b);
  const data = multi.filter(m => m.data && m.data.type === 'ride'), note = multi.filter(m => m.android && m.android.notification);
  assert.equal(data.length, 5, 'first push + 4 again'); assert.equal(note.length, 1, 'the old-app notification only once');
  assert.ok(data.every(m => m.tokens.length === 1 && m.tokens[0] === 't1' && m.android.priority === 'high'));
  assert.deepEqual(waits, [20000, 20000, 25000, 35000]);
});
test('taken after the first wait: no more pushes', async () => {
  setup(); const b = ride(); store.set('bookings/r2', b);
  onWait = n => { if (n === 2) store.set('bookings/r2', { ...b, status: 'assigned', driverPhone: '+911' }); };
  await run('r2', b);
  assert.equal(multi.filter(m => m.data && m.data.type === 'ride').length, 2, 'first + one again, then stops');
});
test('outstation, cancelled, or switch noRepush: no repeat', async () => {
  setup(); let b = ride({ kind: 'outstation' }); store.set('bookings/r3', b); await run('r3', b);
  assert.equal(multi.filter(m => m.data && m.data.type === 'ride').length, 1);
  setup(); b = ride(); store.set('bookings/r4', b); onWait = n => { if (n === 1) store.set('bookings/r4', { ...b, status: 'cancelled' }); }; await run('r4', b);
  assert.equal(multi.filter(m => m.data && m.data.type === 'ride').length, 1);
  setup(); store.set('config/app', { push: { vapid: 'v' }, noRepush: true }); b = ride(); store.set('bookings/r5', b); await run('r5', b);
  assert.equal(multi.filter(m => m.data && m.data.type === 'ride').length, 1); assert.equal(waits.length, 0);
});
