// Runs the real buySub and onBookingDone functions against an in-memory database (subscription money paths).
const test = require('node:test'), assert = require('node:assert'), Module = require('module');
const store = new Map(); let seq = 0;
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const T = ms => ({ toMillis: () => ms, __ms: ms });
const apply = (cur, d) => { const o = { ...(cur || {}) }; for (const [k, v] of Object.entries(d)) { if (v && v.__inc != null) o[k] = (+o[k] || 0) + v.__inc; else if (v instanceof Date) o[k] = T(v.getTime()); else if (v && typeof v === 'object' && !Array.isArray(v) && !v.__ms && !v.__ts) o[k] = apply({}, v); else o[k] = v; } return o; };
const snap = path => ({ exists: store.has(path), data: () => (store.has(path) ? revive(store.get(path)) : undefined), ref: docRef(path) });
const revive = o => { if (!o || typeof o !== 'object') return o; const r = Array.isArray(o) ? [] : {}; for (const [k, v] of Object.entries(o)) r[k] = v && v.__ms != null ? T(v.__ms) : (v && typeof v === 'object' ? revive(v) : v); return r; };
function docRef(path) {
  return { path, id: path.split('/').pop(), get: async () => snap(path),
    set: async d => { store.set(path, apply({}, d)); },
    update: async d => { if (!store.has(path)) throw new Error('NOT_FOUND ' + path); store.set(path, apply(store.get(path), d)); } };
}
let failNext = false;
const db = { doc: docRef, collection: n => ({ doc: id => docRef(n + '/' + (id || 'auto' + (++seq))) }),
  runTransaction: async fn => { const q = []; const r = await fn({ get: x => x.get(), update: (x, d) => q.push(() => x.update(d)), set: (x, d) => q.push(() => x.set(d)) });
    if (failNext) { failNext = false; throw new Error('aborted'); } for (const f of q) await f(); return r; } };
const mocks = {
  'firebase-admin': { initializeApp() {}, firestore: () => db, messaging: () => ({}), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => ({ __ts: 1 }), increment: n => ({ __inc: n }), delete: () => null } },
  'firebase-functions/v2/firestore': { onDocumentUpdated: (o, h) => h, onDocumentCreated: (o, h) => h, onDocumentWritten: (o, h) => h },
  'firebase-functions/v2/scheduler': { onSchedule: (o, h) => h },
  'firebase-functions/v2/https': { onCall: (o, h) => h, onRequest: (o, h) => h, HttpsError: class extends Error { constructor(c, m) { super(`${c}: ${m}`); this.code = c; } } },
  'firebase-functions/v2': { setGlobalOptions() {}, logger: { info() {}, warn() {}, error() {} } },
  'firebase-functions/params': { defineString: () => ({ value: () => '' }), defineSecret: () => ({ value: () => '' }) }
};
const load0 = Module._load; Module._load = function (r, ...a) { return mocks[r] || load0.call(this, r, ...a); };
const F = require('../index.js'); Module._load = load0;
const ME = '+919999900002';
const buy = (plan, phone = ME) => F.buySub({ auth: phone ? { token: { phone_number: phone } } : null, data: { plan }, app: {} });
const reset = (drv) => { store.clear(); store.set('config/app', { comm: 10, subs: { mini: { day: 99, week: 599, month: 1999 } } }); store.set(`drivers/${ME}`, { veh: 'mini', wallet: 700, ...drv }); };
const ledger = () => [...store.keys()].filter(k => k.startsWith('ledger/')).map(k => store.get(k));
const done = async (id, doneMs, extra) => {
  const before = { status: 'ontrip', driverPhone: ME, fare: 300 }, after = { ...before, status: 'done', doneAt: T(doneMs), ...extra };
  store.set('bookings/' + id, after);
  await F.onBookingDone({ params: { id }, data: { before: { data: () => before }, after: { data: () => revive(after), ref: docRef('bookings/' + id) } } });
};

test('buy: wallet down by the price, plan set for 24 h, ledger entry; second buy refused while it runs', async () => {
  reset();
  const t0 = Date.now(); const r = await buy('day');
  assert.equal(r.ok, true); assert.equal(r.price, 99);
  const d = store.get(`drivers/${ME}`);
  assert.equal(d.wallet, 601); assert.equal(d.sub.plan, 'day'); assert.equal(d.sub.price, 99);
  assert.ok(Math.abs(d.sub.until.__ms - d.sub.from.__ms - 864e5) < 5); assert.ok(d.sub.from.__ms >= t0);
  const l = ledger(); assert.equal(l.length, 1); assert.equal(l[0].type, 'sub'); assert.equal(l[0].walletDelta, -99); assert.equal(l[0].driverPhone, ME);
  const r2 = await buy('week'); assert.deepEqual([r2.ok, r2.why], [false, 'active']);
  assert.equal(store.get(`drivers/${ME}`).wallet, 601, 'nothing taken on refusal'); assert.equal(ledger().length, 1);
});
test('refusals: not signed in, not enough wallet, plan not offered, blocked, unknown driver — wallet untouched', async () => {
  reset({ wallet: 50 });
  await assert.rejects(buy('day', null), /unauthenticated/);
  assert.deepEqual(await buy('day'), { ok: false, why: 'wallet', need: 49 });
  store.get('config/app').subs.mini.month = 0; reset({ wallet: 5000 }); store.set('config/app', { subs: { mini: { day: 99 } } });
  assert.equal((await buy('month')).why, 'off');
  assert.equal((await buy('decade')).why, 'plan');
  reset({ blocked: true }); assert.equal((await buy('day')).why, 'blocked');
  assert.equal((await buy('day', '+910000000000')).why, 'driver');
  assert.equal(ledger().length, 0); assert.equal(store.get(`drivers/${ME}`).wallet, 700);
});
test('a failed transaction changes nothing', async () => {
  reset(); failNext = true; await assert.rejects(buy('day'));
  assert.equal(store.get(`drivers/${ME}`).wallet, 700); assert.equal(store.get(`drivers/${ME}`).sub, undefined); assert.equal(ledger().length, 0);
});
test('trips while subscribed: no commission (server mode); after the plan ends: commission again', async () => {
  reset(); store.set('config/app', { comm: 10, serverComm: true, subs: { mini: { day: 99 } } });
  await buy('day'); const d = store.get(`drivers/${ME}`), w = d.wallet;
  await done('b1', d.sub.from.__ms + 3600e3);
  assert.equal(store.get(`drivers/${ME}`).wallet, w, 'no commission taken'); assert.equal(store.get('ledger/b1').comm, 0); assert.equal(store.get('ledger/b1').sub, 'day');
  await done('b2', d.sub.until.__ms + 1);
  assert.equal(store.get(`drivers/${ME}`).wallet, w - 30, 'plan over: 10% commission'); assert.equal(store.get('ledger/b2').comm, 30); assert.equal(store.get('ledger/b2').sub, undefined);
  await done('b0', d.sub.from.__ms - 1);
  assert.equal(store.get('ledger/b0').comm, 30, 'trip finished before the plan started pays commission');
});
test('app mode: app that takes no commission while subscribed is not flagged; one that took it is', async () => {
  reset(); store.set('config/app', { comm: 10, subs: { mini: { day: 99 } } });
  await buy('day'); const d = store.get(`drivers/${ME}`), at = d.sub.from.__ms + 60e3;
  await done('a1', at, { comm: 0, commLocal: true }); assert.equal(store.get('ledger/a1').mismatch, false);
  await done('a2', at, { comm: 30, commLocal: true }); assert.equal(store.get('ledger/a2').mismatch, true);
});
