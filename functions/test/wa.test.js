const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto');
const W = require('../lib/wa');

test('waEvents: which booking changes send a message', () => {
  // a ride booked from the app right now: no "confirmed" (driver assigned follows in a minute)
  assert.deepStrictEqual(W.waEvents(null, { status: 'searching', src: 'app', kind: 'ride' }), []);
  // advance / outstation / rental / office phone booking: confirmed
  assert.deepStrictEqual(W.waEvents(null, { status: 'scheduled', src: 'app', kind: 'schedule' }), ['confirmed']);
  assert.deepStrictEqual(W.waEvents(null, { status: 'searching', src: 'app', kind: 'outstation' }), ['confirmed']);
  assert.deepStrictEqual(W.waEvents(null, { status: 'searching', src: 'app', kind: 'rental' }), ['confirmed']);
  assert.deepStrictEqual(W.waEvents(null, { status: 'searching', src: 'office' }), ['confirmed']);
  // office booking made straight to a driver: only "assigned"
  assert.deepStrictEqual(W.waEvents(null, { status: 'assigned', src: 'office', driverPhone: '+919999900002' }), ['assigned']);
  assert.deepStrictEqual(W.waEvents({ status: 'searching' }, { status: 'assigned', driverPhone: '+919999900002' }), ['assigned']);
  assert.deepStrictEqual(W.waEvents({ status: 'searching' }, { status: 'assigned' }), [], 'no driver phone → nothing');
  assert.deepStrictEqual(W.waEvents({ status: 'assigned' }, { status: 'assigned', arrivedAt: 1, driverPhone: 'x' }), [], 'same status → nothing');
  assert.deepStrictEqual(W.waEvents({ status: 'assigned' }, { status: 'ontrip' }), ['ontrip']);
  assert.deepStrictEqual(W.waEvents({ status: 'ontrip' }, { status: 'done' }), ['done']);
  assert.deepStrictEqual(W.waEvents({ status: 'done' }, { status: 'done', rating: 5 }), []);
  // cancellations
  assert.deepStrictEqual(W.waEvents({ status: 'searching' }, { status: 'cancelled', cancelReason: 'customer' }), [], 'customer cancelled it');
  assert.deepStrictEqual(W.waEvents({ status: 'searching' }, { status: 'cancelled', cancelReason: 'limit' }), [], 'spam limit');
  assert.deepStrictEqual(W.waEvents({ status: 'searching' }, { status: 'cancelled', cancelReason: 'nodriver' }), ['cancelled']);
  assert.deepStrictEqual(W.waEvents({ status: 'assigned' }, { status: 'cancelled', cancelReason: 'driver: tyre', src: 'app', kind: 'ride' }), [], 'app books again by itself');
  assert.deepStrictEqual(W.waEvents({ status: 'assigned' }, { status: 'cancelled', cancelReason: 'driver: tyre', src: 'app', kind: 'outstation' }), ['cancelled']);
  assert.deepStrictEqual(W.waEvents({ status: 'assigned' }, { status: 'cancelled', cancelReason: 'driver: tyre', src: 'office' }), ['cancelled']);
  assert.deepStrictEqual(W.waEvents({ status: 'assigned' }, { status: 'cancelled', cancelReason: 'office reason' }), ['cancelled']);
  assert.deepStrictEqual(W.waEvents({ status: 'scheduled' }, null), [], 'deleted booking');
});

test('waPhone: Indian mobiles only', () => {
  assert.strictEqual(W.waPhone('+919944640416'), '919944640416');
  assert.strictEqual(W.waPhone('9944640416'), '919944640416');
  assert.strictEqual(W.waPhone('+91 99446 40416'), '919944640416');
  assert.strictEqual(W.waPhone('919944640416'), '919944640416');
  assert.strictEqual(W.waPhone('5944640416'), null);
  assert.strictEqual(W.waPhone('+1 415 555 0100'), null);
  assert.strictEqual(W.waPhone(''), null);
  assert.strictEqual(W.waPhone(null), null);
});

const B = { custName: 'Priya', vehTa: 'மினி', vehEn: 'Mini', veh: 'mini', from: { ta: 'புதிய பேருந்து நிலையம்', en: 'New Bus Stand' },
  fare: 2280, status: 'scheduled', kind: 'schedule', when: Date.UTC(2026, 10, 10, 4, 0), driverName: 'Suresh P', plate: 'TN 23 CA 2108', vehModel: 'Swift' };
const params = m => m.template.components[0].parameters.map(p => p.text);

test('waMessage: templates and values', () => {
  let m = W.waMessage('confirmed', B, 'abcdef123', { to: '919944640416', lang: 'ta' });
  assert.strictEqual(m.messaging_product, 'whatsapp'); assert.strictEqual(m.type, 'template'); assert.strictEqual(m.to, '919944640416');
  assert.strictEqual(m.template.name, 'vct_booking_confirmed'); assert.strictEqual(m.template.language.code, 'ta');
  assert.deepStrictEqual(params(m), ['Priya', 'மினி', 'புதிய பேருந்து நிலையம்', '10 Nov, 9:30 AM', '2,280', 'ABCDEF']);
  m = W.waMessage('confirmed', { ...B, status: 'searching', kind: undefined, src: 'office' }, 'x1', { to: '1', lang: 'en', now: 0 });
  assert.strictEqual(m.template.language.code, 'en'); assert.deepStrictEqual(params(m).slice(1, 4), ['Mini', 'New Bus Stand', 'Now']);
  m = W.waMessage('assigned', B, 'abcdef', { to: '1', lang: 'ta', pin: '4821' });
  assert.strictEqual(m.template.name, 'vct_driver_assigned_pin'); assert.deepStrictEqual(params(m), ['Priya', 'Suresh P', 'Swift · TN 23 CA 2108', '4821', 'ABCDEF']);
  m = W.waMessage('assigned', B, 'abcdef', { to: '1', lang: 'ta', pin: null });
  assert.strictEqual(m.template.name, 'vct_driver_assigned'); assert.deepStrictEqual(params(m), ['Priya', 'Suresh P', 'Swift · TN 23 CA 2108', 'ABCDEF']);
  m = W.waMessage('assigned', B, 'abcdef', { to: '1', pin: '48a1' });
  assert.strictEqual(m.template.name, 'vct_driver_assigned', 'a bad PIN is never sent');
  m = W.waMessage('ontrip', B, 'abcdef', { to: '1', office: '7200730416' });
  assert.deepStrictEqual(params(m), ['Priya', 'TN 23 CA 2108', '7200730416']);
  m = W.waMessage('done', { ...B, fare: 2280, fareFinal: 2410 }, 'abcdef', { to: '1' });
  assert.deepStrictEqual(params(m), ['Priya', '2,410', 'ABCDEF']);
  m = W.waMessage('cancelled', B, 'abcdef', { to: '1', office: '7200730416' });
  assert.deepStrictEqual(params(m), ['Priya', 'ABCDEF', '7200730416']);
  assert.strictEqual(W.waMessage('other', B, 'x', { to: '1' }), null);
});

test('waMessage: values WhatsApp would refuse are cleaned, empty ones become "-"', () => {
  const m = W.waMessage('done', { custName: 'A\n\tB     C', fare: 0 }, 'x', { to: '1' });
  for (const t of params(m)) { assert.ok(!/[\n\t]| {5,}/.test(t)); assert.ok(t.length > 0); }
  assert.deepStrictEqual(params(m), ['A B C', '-', 'X']);
  const long = W.waMessage('ontrip', { custName: 'x'.repeat(200), plate: '' }, 'x', { to: '1', office: '' });
  assert.ok(params(long)[0].length <= 40); assert.strictEqual(params(long)[1], '-'); assert.strictEqual(params(long)[2], '-');
  assert.strictEqual(params(W.waMessage('done', { fare: 1 }, 'x', { to: '1', lang: 'ta' }))[0], 'வாடிக்கையாளர்');
});

test('waAllowed: switch, kinds and test list', () => {
  const to = '919944640416';
  assert.strictEqual(W.waAllowed(null, 'done', to), false);
  assert.strictEqual(W.waAllowed({ on: false, phoneId: '1' }, 'done', to), false);
  assert.strictEqual(W.waAllowed({ on: 'true', phoneId: '1' }, 'done', to), false, 'only boolean true');
  assert.strictEqual(W.waAllowed({ on: true }, 'done', to), false, 'no phone number id');
  assert.strictEqual(W.waAllowed({ on: true, phoneId: '1' }, 'done', null), false);
  assert.strictEqual(W.waAllowed({ on: true, phoneId: '1' }, 'done', to), true);
  assert.strictEqual(W.waAllowed({ on: true, phoneId: '1', kinds: ['assigned'] }, 'done', to), false);
  assert.strictEqual(W.waAllowed({ on: true, phoneId: '1', kinds: ['done'] }, 'done', to), true);
  assert.strictEqual(W.waAllowed({ on: true, phoneId: '1', testTo: ['+91 72007 30416'] }, 'done', to), false, 'testing: only listed numbers');
  assert.strictEqual(W.waAllowed({ on: true, phoneId: '1', testTo: ['9944640416'] }, 'done', to), true);
});

test('sigOk: webhook signature', () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account"}'), sec = 'app-secret-123';
  const good = 'sha256=' + crypto.createHmac('sha256', sec).update(raw).digest('hex');
  assert.strictEqual(W.sigOk(raw, good, sec), true);
  assert.strictEqual(W.sigOk(raw, good.toUpperCase().replace('SHA256=', 'sha256='), sec), true);
  assert.strictEqual(W.sigOk(Buffer.from(raw.toString() + ' '), good, sec), false, 'body changed');
  assert.strictEqual(W.sigOk(raw, good, 'other'), false, 'wrong secret');
  assert.strictEqual(W.sigOk(raw, good.slice(0, -2), sec), false, 'short');
  assert.strictEqual(W.sigOk(raw, undefined, sec), false);
  assert.strictEqual(W.sigOk(raw, 'sha1=abc', sec), false);
  assert.strictEqual(W.sigOk(raw, good, ''), false, 'no secret set → refuse');
  assert.strictEqual(W.sigOk(undefined, good, sec), false);
});

test('waParse: receipts and replies', () => {
  const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ profile: { name: 'Priya' } }],
    statuses: [{ id: 'wamid.A/b=', status: 'delivered', timestamp: '1762700000' },
               { id: 'wamid.B', status: 'failed', timestamp: '1762700001', errors: [{ code: 131026, title: 'Message undeliverable' }] }, { status: 'read' }],
    messages: [{ id: 'wamid.C', from: '919944640416', type: 'text', timestamp: '1762700002', text: { body: 'hi\nthanks' } }] } }] }] };
  const r = W.waParse(body);
  assert.deepStrictEqual(r.statuses, [{ wamid: 'wamid.A/b=', status: 'delivered', at: 1762700000000, error: null },
    { wamid: 'wamid.B', status: 'failed', at: 1762700001000, error: '131026 Message undeliverable' }]);
  assert.deepStrictEqual(r.messages, [{ wamid: 'wamid.C', from: '919944640416', type: 'text', at: 1762700002000, text: 'hi thanks', name: 'Priya' }]);
  assert.deepStrictEqual(W.waParse({ object: 'page', entry: [] }), { statuses: [], messages: [] });
  assert.deepStrictEqual(W.waParse(null), { statuses: [], messages: [] });
  assert.deepStrictEqual(W.waParse({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] }), { statuses: [], messages: [] });
});

test('newer: delivery status never goes backwards', () => {
  assert.ok(W.newer('sending', 'sent')); assert.ok(W.newer('accepted', 'delivered')); assert.ok(W.newer('delivered', 'read'));
  assert.ok(!W.newer('read', 'delivered')); assert.ok(!W.newer('read', 'sent')); assert.ok(W.newer('delivered', 'failed'));
});

test('deploy script: without WhatsApp secrets it still deploys every other function', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const all = [...src.matchAll(/^exports\.(\w+)\s*=/gm)].map(m => m[1]);
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'cloudshell-deploy.sh'), 'utf8');
  const line = sh.split('\n').find(l => l.includes('deploy --only firestore:rules,functions:onBookingDone'));
  const listed = [...line.matchAll(/functions:(\w+)/g)].map(m => m[1]);
  assert.deepStrictEqual(listed.sort(), all.filter(n => !/^wa[A-Z]/.test(n)).sort());
  assert.ok(all.includes('waBooking') && all.includes('waWebhook'));
});
