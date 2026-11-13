// Runs the real rzpOrder / rzpVerify / rzpWebhook functions against an in-memory database and a fake Razorpay API.
const test = require('node:test'), assert = require('node:assert'), Module = require('module'), crypto = require('crypto');

const store = new Map();
const clone = v => JSON.parse(JSON.stringify(v));
const apply = (cur, d) => { const o = { ...(cur || {}) }; for (const [k, v] of Object.entries(d)) o[k] = v && v.__inc != null ? (+o[k] || 0) + v.__inc : v; return o; };
const snap = path => ({ exists: store.has(path), data: () => (store.has(path) ? clone(store.get(path)) : undefined), ref: docRef(path) });
function docRef(path) {
  return { path, get: async () => snap(path),
    set: async d => { store.set(path, apply({}, d)); },
    update: async d => { if (!store.has(path)) throw new Error('NOT_FOUND ' + path); store.set(path, apply(store.get(path), d)); } };
}
const db = { doc: docRef, runTransaction: async fn => fn({ get: r => r.get(), update: (r, d) => r.update(d), set: (r, d) => r.set(d) }) };
const logs = [];
const mocks = {
  'firebase-admin': { initializeApp() {}, firestore: () => db, messaging: () => ({}), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'TS', increment: n => ({ __inc: n }), delete: () => null } },
  'firebase-functions/v2/firestore': { onDocumentUpdated: (o, h) => h, onDocumentCreated: (o, h) => h, onDocumentWritten: (o, h) => h },
  'firebase-functions/v2/scheduler': { onSchedule: (o, h) => h },
  'firebase-functions/v2/https': { onCall: (o, h) => h, onRequest: (o, h) => h, HttpsError: class extends Error { constructor(c, m) { super(`${c}: ${m}`); this.code = c; } } },
  'firebase-functions/v2': { setGlobalOptions() {}, logger: { info: (...a) => logs.push(['info', ...a]), warn: (...a) => logs.push(['warn', ...a]) } },
  'firebase-functions/params': { defineString: () => ({ value: () => '' }), defineSecret: n => ({ value: () => process.env[n] || '' }) }
};
const load0 = Module._load;
Module._load = function (req, ...rest) { return mocks[req] || load0.call(this, req, ...rest); };
const F = require('../index.js');
Module._load = load0;

let calls = [], reply = () => ({ status: 200, body: { id: 'order_T' + (calls.length - 1), amount: 50000, currency: 'INR' } });
global.fetch = async (url, opt) => { calls.push({ url, opt, body: JSON.parse(opt.body) }); const r = reply(); return { ok: r.status < 300, status: r.status, json: async () => r.body }; };
process.env.RZP_KEY_ID = 'rzp_test_KEY'; process.env.RZP_KEY_SECRET = 'key-secret'; process.env.RZP_WEBHOOK_SECRET = 'hook-secret';
const hm = (s, d) => crypto.createHmac('sha256', s).update(d).digest('hex');
const ME = '+919999900002';
const call = (fn, phone, data) => F[fn]({ auth: phone ? { token: { phone_number: phone } } : null, data, app: {} });
const reset = () => { store.clear(); calls = []; logs.length = 0; store.set('config/app', { rzp: true }); store.set(`drivers/${ME}`, { name: 'Raja', wallet: 100, blocked: false }); };
function res() { const r = { code: 0, sendStatus(c) { r.code = c; return r; } }; return r; }
const hook = (body, secret = 'hook-secret') => { const raw = Buffer.from(JSON.stringify(body)); return { method: 'POST', rawBody: raw, body, get: h => (h === 'x-razorpay-signature' ? hm(secret, raw) : '') }; };
const paid = (order, pay, paise, ev = 'payment.captured') => ({ event: ev, payload: { payment: { entity: { id: pay, order_id: order, amount: paise, currency: 'INR', status: 'captured', method: 'upi' } } } });

test('order: drivers only, amount limits, switch, then one Razorpay order saved for this driver', async () => {
  reset();
  await assert.rejects(call('rzpOrder', null, { amt: 500 }), /login/);
  await assert.rejects(call('rzpOrder', '+919000000001', { amt: 500 }), /drivers only/);
  for (const a of [0, 99, 10001, 250.5, '500x']) await assert.rejects(call('rzpOrder', ME, { amt: a }), /amount/, String(a));
  store.set('config/app', { rzp: false }); await assert.rejects(call('rzpOrder', ME, { amt: 500 }), /razorpay off/);
  store.set('config/app', { rzp: true }); store.set(`drivers/${ME}`, { name: 'Raja', wallet: 100, blocked: true });
  await assert.rejects(call('rzpOrder', ME, { amt: 500 }), /blocked/);
  store.set(`drivers/${ME}`, { name: 'Raja', wallet: 100, blocked: false });
  assert.strictEqual(calls.length, 0, 'nothing sent to Razorpay for refused requests');
  const r = await call('rzpOrder', ME, { amt: 500 });
  assert.deepStrictEqual(r, { orderId: 'order_T0', keyId: 'rzp_test_KEY', amount: 50000, currency: 'INR' });
  assert.strictEqual(calls[0].url, 'https://api.razorpay.com/v1/orders');
  assert.strictEqual(calls[0].opt.headers.Authorization, 'Basic ' + Buffer.from('rzp_test_KEY:key-secret').toString('base64'));
  assert.strictEqual(calls[0].body.amount, 50000); assert.strictEqual(calls[0].body.payment_capture, 1); assert.strictEqual(calls[0].body.notes.driver, '9999900002');
  const o = store.get('rzpOrders/order_T0'); assert.strictEqual(o.driverPhone, ME); assert.strictEqual(o.amt, 500); assert.strictEqual(o.status, 'created');
  assert.strictEqual(store.get(`drivers/${ME}`).wallet, 100, 'no money before payment');
  reply = () => ({ status: 500, body: { error: { description: 'down' } } });
  await assert.rejects(call('rzpOrder', ME, { amt: 500 }), /unavailable/);
  reply = () => ({ status: 200, body: { id: 'order_T' + (calls.length - 1) } });
});

test('checkout proof credits once; forged / other driver refused; webhook afterwards does not double-credit', async () => {
  reset(); await call('rzpOrder', ME, { amt: 500 });
  const sig = hm('key-secret', 'order_T0|pay_A1');
  await assert.rejects(call('rzpVerify', ME, { orderId: 'order_T0', paymentId: 'pay_A1', signature: 'bad' }), /bad signature/);
  await assert.rejects(call('rzpVerify', ME, { orderId: 'order_T0', paymentId: 'pay_A2', signature: sig }), /bad signature/, 'signature bound to the payment id');
  await assert.rejects(call('rzpVerify', '+919999900003', { orderId: 'order_T0', paymentId: 'pay_A1', signature: sig }), /not your order/);
  assert.strictEqual(store.get(`drivers/${ME}`).wallet, 100);
  assert.deepStrictEqual(await call('rzpVerify', ME, { orderId: 'order_T0', paymentId: 'pay_A1', signature: sig }), { ok: true, result: 'credited' });
  assert.strictEqual(store.get(`drivers/${ME}`).wallet, 600);
  const rc = store.get('recharges/rzp_order_T0');
  assert.strictEqual(rc.status, 'approved'); assert.strictEqual(rc.method, 'razorpay'); assert.strictEqual(rc.amt, 500); assert.strictEqual(rc.utr, 'pay_A1'); assert.strictEqual(rc.driverPhone, ME);
  assert.deepStrictEqual(await call('rzpVerify', ME, { orderId: 'order_T0', paymentId: 'pay_A1', signature: sig }), { ok: true, result: 'already' });
  const r = res(); await F.rzpWebhook(hook(paid('order_T0', 'pay_A1', 50000)), r);
  assert.strictEqual(r.code, 200); assert.strictEqual(store.get(`drivers/${ME}`).wallet, 600, 'still credited only once');
});

test('webhook alone credits (driver closed the app); bad signature, wrong amount, unknown order and other events do nothing', async () => {
  reset(); await call('rzpOrder', ME, { amt: 500 });
  let r = res(); await F.rzpWebhook(hook(paid('order_T0', 'pay_B1', 50000), 'wrong-secret'), r);
  assert.strictEqual(r.code, 401); assert.strictEqual(store.get(`drivers/${ME}`).wallet, 100);
  r = res(); await F.rzpWebhook({ method: 'GET' }, r); assert.strictEqual(r.code, 405);
  r = res(); await F.rzpWebhook(hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_B1', order_id: 'order_T0', amount: 50000, currency: 'INR', status: 'failed' } } } }), r);
  assert.strictEqual(r.code, 200); assert.strictEqual(store.get(`drivers/${ME}`).wallet, 100, 'failed payment never credits');
  r = res(); await F.rzpWebhook(hook(paid('order_ZZ', 'pay_B1', 50000)), r); assert.strictEqual(r.code, 200, 'unknown order acknowledged');
  r = res(); await F.rzpWebhook(hook(paid('order_T0', 'pay_B1', 100)), r);
  assert.strictEqual(store.get(`drivers/${ME}`).wallet, 100, 'amount must match the order'); assert.strictEqual(store.get('rzpOrders/order_T0').status, 'mismatch');
  reset(); await call('rzpOrder', ME, { amt: 2000 });
  r = res(); await F.rzpWebhook(hook(paid('order_T0', 'pay_C1', 200000, 'order.paid')), r);
  assert.strictEqual(r.code, 200); assert.strictEqual(store.get(`drivers/${ME}`).wallet, 2100);
  assert.strictEqual(store.get('rzpOrders/order_T0').via, 'webhook');
  r = res(); await F.rzpWebhook(hook(paid('order_T0', 'pay_C1', 200000)), r);
  assert.strictEqual(store.get(`drivers/${ME}`).wallet, 2100, 'duplicate webhook delivery ignored');
});
