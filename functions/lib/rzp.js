/* Razorpay helpers for driver wallet recharge (pure, testable).
   Money flow: driver pays VELLORE CALL TAXI through Razorpay Checkout → the wallet is credited only after the
   server has proof: (a) the checkout signature HMAC(order_id|payment_id, key secret), or (b) a signed webhook
   (payment.captured / order.paid) — whichever arrives first. Each order credits at most once. */
const crypto = require('crypto');

const MIN = 100, MAX = 10000;                       // rupees per recharge
function amountOk(a) { return Number.isInteger(a) && a >= MIN && a <= MAX; }

function eq(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hmac(secret, data) { return crypto.createHmac('sha256', String(secret || '')).update(data).digest('hex'); }

// Checkout success handler signature
function checkoutSigOk(orderId, paymentId, sig, keySecret) {
  if (!keySecret || !/^order_\w+$/.test(orderId || '') || !/^pay_\w+$/.test(paymentId || '')) return false;
  return eq(hmac(keySecret, `${orderId}|${paymentId}`), sig);
}
// Webhook signature over the exact raw body
function webhookSigOk(rawBody, sig, webhookSecret) {
  if (!webhookSecret || !rawBody) return false;
  return eq(hmac(webhookSecret, rawBody), sig);
}

// From a webhook body: the captured payment we should credit, or null
function webhookPayment(body) {
  const ev = body && body.event;
  if (ev !== 'payment.captured' && ev !== 'order.paid') return null;
  const p = body.payload && body.payload.payment && body.payload.payment.entity;
  if (!p || p.status !== 'captured' || p.currency !== 'INR') return null;
  if (!/^order_\w+$/.test(p.order_id || '') || !/^pay_\w+$/.test(p.id || '')) return null;
  return { orderId: p.order_id, paymentId: p.id, paise: +p.amount || 0, method: String(p.method || '').slice(0, 20) };
}

// Order request body for POST /v1/orders
function orderBody(amt, phone10, now) {
  return { amount: amt * 100, currency: 'INR', receipt: `drv_${phone10}_${now}`.slice(0, 40), payment_capture: 1,
    notes: { purpose: 'driver wallet recharge', driver: phone10 } };
}

module.exports = { MIN, MAX, amountOk, checkoutSigOk, webhookSigOk, webhookPayment, orderBody, hmac };
