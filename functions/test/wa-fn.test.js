// Runs the real waBooking / waWebhook functions from index.js against an in-memory database and a fake Meta API.
const test = require('node:test'), assert = require('node:assert'), Module = require('module'), crypto = require('crypto');

// ---- in-memory Firestore -------------------------------------------------------------------------------------
const store = new Map();
const snap = (path) => ({ exists: store.has(path), data: () => (store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : undefined), ref: docRef(path) });
function docRef(path) {
  return {
    path, get: async () => snap(path),
    create: async d => { if (store.has(path)) { const e = new Error('6 ALREADY_EXISTS: doc exists'); e.code = 6; throw e; } store.set(path, d); },
    set: async d => { store.set(path, d); },
    update: async d => { if (!store.has(path)) throw new Error('NOT_FOUND ' + path); store.set(path, { ...store.get(path), ...d }); },
    collection: c => ({ doc: id => docRef(`${path}/${c}/${id}`) })
  };
}
const coll = name => ({ where: (f, op, v) => ({ get: async () => ({ docs: [...store.keys()]
  .filter(k => k.startsWith(name + '/') && k.split('/').length === 2 && store.get(k)[f] === v).map(k => snap(k)) }) }) });
const db = { doc: docRef, collection: coll, runTransaction: async fn => fn({ get: r => r.get(), update: (r, d) => r.update(d) }) };
const logs = [];
const mocks = {
  'firebase-admin': { initializeApp() {}, firestore: () => db, messaging: () => ({}), auth: () => ({}) },
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'TS', increment: n => n, delete: () => null } },
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

// ---- fake Meta Graph API ---------------------------------------------------------------------------------------
let sent = [], reply = () => ({ status: 200, body: { messages: [{ id: 'wamid.' + (sent.length) + '/x=' }] } });
global.fetch = async (url, opt) => { sent.push({ url, opt, body: JSON.parse(opt.body) }); const r = reply(); return { ok: r.status < 300, status: r.status, json: async () => r.body }; };

process.env.WA_TOKEN = 'test-token'; process.env.WA_APP_SECRET = 'app-secret'; process.env.WA_VERIFY_TOKEN = 'verify-me';
const ev = (id, before, after) => ({ params: { id }, data: {
  before: { exists: !!before, data: () => before },
  after: { exists: !!after, data: () => after, ref: docRef(`bookings/${id}`) } } });
const reset = () => { store.clear(); sent = []; logs.length = 0; store.set('config/app', { office: '7200730416' }); };
const BK = { custName: 'Priya', customerUid: 'u1', src: 'app', kind: 'schedule', veh: 'mini', vehTa: 'மினி', vehEn: 'Mini',
  from: { ta: 'காட்பாடி', en: 'Katpadi' }, fare: 450, when: Date.UTC(2026, 10, 10, 4, 0), status: 'scheduled' };

test('switched off (no waConfig) → nothing is sent', async () => {
  reset(); store.set('bookings/b1/private/contact', { custPhone: '+919944640416' });
  await F.waBooking(ev('b1', null, BK));
  assert.strictEqual(sent.length, 0); assert.ok(![...store.keys()].some(k => k.startsWith('waLog/')));
  store.set('waConfig/main', { on: false, phoneId: '123' });
  await F.waBooking(ev('b1', null, BK)); assert.strictEqual(sent.length, 0);
});

test('booking confirmed → one template call with the right number, token and values; logged', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1234567890' });
  store.set('bookings/b1/private/contact', { custPhone: '+919944640416' });
  store.set('users/u1', { lang: 'ta' });
  await F.waBooking(ev('b1', null, BK));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].url, 'https://graph.facebook.com/v23.0/1234567890/messages');
  assert.strictEqual(sent[0].opt.headers.Authorization, 'Bearer test-token');
  assert.strictEqual(sent[0].body.to, '919944640416');
  assert.strictEqual(sent[0].body.template.name, 'vct_booking_confirmed');
  assert.deepStrictEqual(sent[0].body.template.components[0].parameters.map(p => p.text), ['Priya', 'மினி', 'காட்பாடி', '10 Nov, 9:30 AM', '450', 'B1']);
  const lg = store.get('waLog/b1_confirmed');
  assert.strictEqual(lg.status, 'accepted'); assert.strictEqual(lg.wamid, 'wamid.1/x='); assert.strictEqual(lg.to, '919944640416'); assert.strictEqual(lg.tpl, 'vct_booking_confirmed');
  // the message id is stored under a safe key (wamids can contain "/")
  const keys = [...store.keys()].filter(k => k.startsWith('waMsgs/'));
  assert.strictEqual(keys.length, 1); assert.ok(/^waMsgs\/[0-9a-f]{40}$/.test(keys[0])); assert.strictEqual(store.get(keys[0]).log, 'b1_confirmed');
  // the same trigger delivered twice (Cloud Functions may retry) → still one message
  await F.waBooking(ev('b1', null, BK)); assert.strictEqual(sent.length, 1);
});

test('number comes from the booking when there is no private contact; English customer gets English', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' }); store.set('users/u1', { lang: 'en' });
  await F.waBooking(ev('b2', null, { ...BK, custPhone: '+919876543210' }));
  assert.strictEqual(sent[0].body.to, '919876543210'); assert.strictEqual(sent[0].body.template.language.code, 'en');
  assert.strictEqual(sent[0].body.template.components[0].parameters[2].text, 'Katpadi');
});

test('driver assigned → driver details (never the ride PIN); a new driver after a cancel gets its own message', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' });
  store.set('bookings/b3/private/contact', { custPhone: '+919944640416' }); store.set('bookings/b3/private/pin', { pin: '4821' });
  const a = { ...BK, status: 'assigned', driverPhone: '+919999900002', driverName: 'Suresh P', plate: 'TN 23 CA 2108', vehModel: 'Swift' };
  await F.waBooking(ev('b3', { ...BK, status: 'searching' }, a));
  assert.strictEqual(sent[0].body.template.name, 'vct_driver_assigned');
  assert.deepStrictEqual(sent[0].body.template.components[0].parameters.map(p => p.text), ['Priya', 'Suresh P', 'Swift · TN 23 CA 2108', 'B3']);
  assert.ok(!JSON.stringify(sent[0].body).includes('4821'));
  await F.waBooking(ev('b3', { ...BK, status: 'searching' }, a)); assert.strictEqual(sent.length, 1, 'retry: no second message');
  await F.waBooking(ev('b3', { ...BK, status: 'searching' }, { ...a, driverPhone: '+919999900077', driverName: 'Ravi' }));
  assert.strictEqual(sent.length, 2); assert.ok(store.has('waLog/b3_assigned_0002') && store.has('waLog/b3_assigned_0077'));
  // office phone booking made straight to a driver
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' });
  await F.waBooking(ev('b4', null, { custName: 'Kumar', custPhone: '+919944640416', src: 'office', status: 'assigned', driverPhone: '+919999900002', driverName: 'Suresh', plate: 'TN23' }));
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].body.template.name, 'vct_driver_assigned');
});

test('trip started / completed / cancelled', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' }); store.set('bookings/b5/private/contact', { custPhone: '+919944640416' });
  const a = { ...BK, status: 'assigned', driverPhone: '+919999900002', plate: 'TN 23 CA 2108' };
  await F.waBooking(ev('b5', a, { ...a, status: 'ontrip' }));
  await F.waBooking(ev('b5', { ...a, status: 'ontrip' }, { ...a, status: 'done', fareFinal: 520 }));
  assert.deepStrictEqual(sent.map(s => s.body.template.name), ['vct_trip_started', 'vct_trip_completed']);
  assert.deepStrictEqual(sent[0].body.template.components[0].parameters.map(p => p.text), ['Priya', 'TN 23 CA 2108', '7200730416']);
  assert.deepStrictEqual(sent[1].body.template.components[0].parameters.map(p => p.text), ['Priya', '520', 'B5']);
  await F.waBooking(ev('b5', a, { ...a, status: 'cancelled', cancelReason: 'customer' }));
  assert.strictEqual(sent.length, 2, 'customer cancelled → no message');
  await F.waBooking(ev('b5', a, { ...a, status: 'cancelled', cancelReason: 'office: no car' }));
  assert.strictEqual(sent[2].body.template.name, 'vct_booking_cancelled');
});

test('test list and kinds: only listed numbers / message types', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1', testTo: ['7200730416'] });
  store.set('bookings/b6/private/contact', { custPhone: '+919944640416' });
  await F.waBooking(ev('b6', null, BK)); assert.strictEqual(sent.length, 0, 'not on the test list');
  store.set('waConfig/main', { on: true, phoneId: '1', testTo: ['9944640416'], kinds: ['done'] });
  await F.waBooking(ev('b6', null, BK)); assert.strictEqual(sent.length, 0, 'confirmed not in kinds');
  await F.waBooking(ev('b6', { ...BK, status: 'ontrip' }, { ...BK, status: 'done' })); assert.strictEqual(sent.length, 1);
});

test('Meta refuses / network down → logged as failed, no crash, not resent on retry', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' }); store.set('bookings/b7/private/contact', { custPhone: '+919944640416' });
  reply = () => ({ status: 400, body: { error: { code: 132001, message: 'Template name does not exist in the translation' } } });
  await F.waBooking(ev('b7', null, BK));
  assert.strictEqual(store.get('waLog/b7_confirmed').status, 'failed');
  assert.match(store.get('waLog/b7_confirmed').error, /132001 Template name does not exist/);
  assert.ok(logs.some(l => l[0] === 'warn' && l[1] === 'whatsapp failed'));
  reply = () => { throw new Error('boom'); };
  global.fetch0 = global.fetch; global.fetch = async () => { const e = new Error('connect ETIMEDOUT'); e.name = 'TimeoutError'; throw e; };
  await F.waBooking(ev('b8', null, { ...BK, custPhone: '+919944640416' }));
  assert.strictEqual(store.get('waLog/b8_confirmed').status, 'failed'); assert.match(store.get('waLog/b8_confirmed').error, /network TimeoutError/);
  global.fetch = global.fetch0; reply = () => ({ status: 200, body: { messages: [{ id: 'wamid.' + sent.length }] } });
  sent = []; await F.waBooking(ev('b7', null, BK)); assert.strictEqual(sent.length, 0, 'a failed message is not repeated by a retry');
});

test('bad or missing phone number → nothing sent', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' });
  await F.waBooking(ev('b9', null, { ...BK, custPhone: '+1415555' })); await F.waBooking(ev('b10', null, BK));
  assert.strictEqual(sent.length, 0);
});

// ---- webhook --------------------------------------------------------------------------------------------------
function res() { const r = { code: null, body: null, ctype: null, status(c) { r.code = c; return r; }, sendStatus(c) { r.code = c; return r; }, send(b) { r.body = b; return r; }, type(t) { r.ctype = t; return r; } }; return r; }
const signed = (obj, secret = 'app-secret') => { const raw = Buffer.from(JSON.stringify(obj)); return { method: 'POST', rawBody: raw, body: obj, get: h => h.toLowerCase() === 'x-hub-signature-256' ? 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') : undefined }; };

test('webhook GET: verify token', async () => {
  let r = res(); await F.waWebhook({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' } }, r);
  assert.strictEqual(r.code, 200); assert.strictEqual(r.body, '12345'); assert.strictEqual(r.ctype, 'text/plain');
  r = res(); await F.waWebhook({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' } }, r);
  assert.strictEqual(r.code, 403);
  r = res(); await F.waWebhook({ method: 'PUT' }, r); assert.strictEqual(r.code, 405);
});

test('webhook POST: signature checked; receipts update the log in order; replies saved', async () => {
  reset(); store.set('waConfig/main', { on: true, phoneId: '1' }); store.set('bookings/b1/private/contact', { custPhone: '+919944640416' });
  reply = () => ({ status: 200, body: { messages: [{ id: 'wamid.HBg/abc=' }] } });
  await F.waBooking(ev('b1', null, BK));
  const body = st => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.HBg/abc=', status: st, timestamp: '1762700000' }] } }] }] });
  // forged (wrong secret) → refused, nothing changes
  let r = res(); await F.waWebhook(signed(body('read'), 'not-the-secret'), r);
  assert.strictEqual(r.code, 401); assert.strictEqual(store.get('waLog/b1_confirmed').status, 'accepted');
  r = res(); await F.waWebhook({ ...signed(body('read')), get: () => undefined }, r); assert.strictEqual(r.code, 401, 'no signature');
  // real ones
  r = res(); await F.waWebhook(signed(body('delivered')), r); assert.strictEqual(r.code, 200);
  assert.strictEqual(store.get('waLog/b1_confirmed').status, 'delivered');
  await F.waWebhook(signed(body('read')), res()); assert.strictEqual(store.get('waLog/b1_confirmed').status, 'read');
  await F.waWebhook(signed(body('sent')), res()); assert.strictEqual(store.get('waLog/b1_confirmed').status, 'read', 'late "sent" ignored');
  // unknown message id → ignored, still 200 (Meta must not keep retrying)
  r = res(); await F.waWebhook(signed({ ...body('read'), entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.zzz', status: 'read' }] } }] }] }), r); assert.strictEqual(r.code, 200);
  // a customer replies
  const msg = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ profile: { name: 'Priya' } }],
    messages: [{ id: 'wamid.reply1', from: '919944640416', type: 'text', timestamp: '1762700100', text: { body: 'Driver எங்கே?' } }] } }] }] };
  await F.waWebhook(signed(msg), res());
  const inbox = [...store.entries()].filter(([k]) => k.startsWith('waInbox/'));
  assert.strictEqual(inbox.length, 1); assert.strictEqual(inbox[0][1].text, 'Driver எங்கே?'); assert.strictEqual(inbox[0][1].from, '919944640416'); assert.strictEqual(inbox[0][1].seen, false);
});

test('webhook POST without the app secret stored → refused', async () => {
  const s = process.env.WA_APP_SECRET; process.env.WA_APP_SECRET = '';
  const r = res(); await F.waWebhook(signed({ object: 'whatsapp_business_account', entry: [] }, ''), r);
  process.env.WA_APP_SECRET = s; assert.strictEqual(r.code, 401);
});

// ---- driver welcome (drivers/{phone} created by the office approving an app application) ---------------------
const dev = (ph, d) => ({ params: { ph }, data: { data: () => d } });
test('driver welcome: sent once to an app-joined driver, in their language, with the driver help number', async () => {
  reset(); store.set('config/app', { office: '9344640416', driverHelp: '9344039933' }); store.set('waConfig/main', { on: true, phoneId: '1', kinds: ['done'] });
  await F.waDriverWelcome(dev('+919876500001', { name: 'Murugan', fromApp: true, consent: { lang: 'en' } }));
  assert.strictEqual(sent.length, 1, 'booking message types do not block it');
  const t = sent[0].body.template;
  assert.strictEqual(t.name, 'vct_driver_welcome'); assert.strictEqual(t.language.code, 'en');
  assert.deepStrictEqual(t.components[0].parameters.map(p => p.text), ['Murugan', '9344039933']);
  assert.strictEqual(sent[0].body.to, '919876500001');
  assert.strictEqual(store.get('waLog/drv_919876500001_welcome').status, 'accepted');
  await F.waDriverWelcome(dev('+919876500001', { name: 'Murugan', fromApp: true }));
  assert.strictEqual(sent.length, 1, 'a retried trigger never sends twice');
  await F.waDriverWelcome(dev('+919876500002', { name: 'Ravi', fromApp: true }));
  assert.strictEqual(sent[1].body.template.language.code, 'ta', 'Tamil by default');
});
test('driver welcome: not sent when off, for office-added drivers, outside the test list, or when turned off', async () => {
  reset(); await F.waDriverWelcome(dev('+919876500001', { name: 'A', fromApp: true }));
  assert.strictEqual(sent.length, 0, 'WhatsApp switch off');
  store.set('waConfig/main', { on: true, phoneId: '1' });
  await F.waDriverWelcome(dev('+919876500001', { name: 'A' })); assert.strictEqual(sent.length, 0, 'added by office, not via the app');
  store.set('waConfig/main', { on: true, phoneId: '1', testTo: ['9944640416'] });
  await F.waDriverWelcome(dev('+919876500001', { name: 'A', fromApp: true })); assert.strictEqual(sent.length, 0, 'test list only');
  store.set('waConfig/main', { on: true, phoneId: '1', drvWelcome: false });
  await F.waDriverWelcome(dev('+919876500001', { name: 'A', fromApp: true })); assert.strictEqual(sent.length, 0, 'driver welcome turned off');
  store.set('waConfig/main', { on: true, phoneId: '1' });
  reply = () => ({ status: 400, body: { error: { code: 132001, message: 'Template name does not exist in the translation' } } });
  await F.waDriverWelcome(dev('+919876500003', { name: 'B', fromApp: true }));
  assert.strictEqual(store.get('waLog/drv_919876500003_welcome').status, 'failed', 'template not approved yet → logged as failed, no crash');
  reply = () => ({ status: 200, body: { messages: [{ id: 'wamid.ok' }] } });
});

// ---- office reply (waReply) -------------------------------------------------------------------------------------
const call = (phone, data) => F.waReply({ auth: phone ? { token: { phone_number: phone } } : null, data, app: {} });
test('office reply: staff only, within 24 h of their last message, logged with delivery tracking', async () => {
  reset(); store.set('waConfig/main', { on: false, phoneId: '1' }); store.set('staff/+918220201462', { role: 'owner' }); store.set('staff/+919000000001', { role: 'staff' });
  store.set('waInbox/m1', { from: '919944640416', text: 'Driver எங்கே?', at: new Date(Date.now() - 3600e3).toISOString() });
  await assert.rejects(call(null, { to: '9944640416', text: 'hi' }), /login/);
  await assert.rejects(call('+919999999999', { to: '9944640416', text: 'hi' }), /office only/);
  await assert.rejects(call('+919000000001', { to: '9944640416', text: '   ' }), /bad request/);
  await assert.rejects(call('+919000000001', { to: '12345', text: 'hi' }), /bad request/);
  await assert.rejects(call('+919000000001', { to: '9944640416', text: 'x'.repeat(1001) }), /bad request/);
  await assert.rejects(call('+919000000001', { to: '9876500009', text: 'hi' }), /window closed/, 'never messaged us');
  reply = () => ({ status: 200, body: { messages: [{ id: 'wamid.rep1' }] } });
  const r = await call('+919000000001', { to: '+91 99446 40416', text: '  5 நிமிஷத்துல வருவார்  ' });
  assert.deepStrictEqual(r, { ok: true }, 'staff can reply; works while booking messages are switched off');
  assert.strictEqual(sent.length, 1); assert.deepStrictEqual(sent[0].body, { messaging_product: 'whatsapp', to: '919944640416', type: 'text', text: { body: '5 நிமிஷத்துல வருவார்', preview_url: false } });
  const log = [...store.entries()].find(([k]) => k.startsWith('waLog/reply_919944640416_'));
  assert.ok(log); assert.strictEqual(log[1].status, 'accepted'); assert.strictEqual(log[1].by, '+919000000001'); assert.strictEqual(log[1].kind, 'reply');
  assert.ok(store.get(`waMsgs/${require('crypto').createHash('sha256').update('wamid.rep1').digest('hex').slice(0, 40)}`), 'receipts can find it');
});
test('office reply: closed after 24 h; Meta error is returned, not thrown', async () => {
  reset(); store.set('waConfig/main', { phoneId: '1' }); store.set('staff/+918220201462', { role: 'owner' });
  store.set('waInbox/m1', { from: '919944640416', text: 'hi', at: new Date(Date.now() - 25 * 3600e3).toISOString() });
  await assert.rejects(call('+918220201462', { to: '9944640416', text: 'hello' }), /window closed/);
  store.set('waInbox/m2', { from: '919944640416', text: 'hi again', at: new Date(Date.now() - 60e3).toISOString() });
  reply = () => ({ status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } });
  const r = await call('+918220201462', { to: '9944640416', text: 'hello' });
  assert.strictEqual(r.ok, false); assert.match(r.error, /131047/);
  store.delete('waConfig/main'); await assert.rejects(call('+918220201462', { to: '9944640416', text: 'hello' }), /not set up/);
  reply = () => ({ status: 200, body: { messages: [{ id: 'wamid.ok' }] } });
});
