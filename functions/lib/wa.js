/* WhatsApp Cloud API (Meta) — booking messages to customers. Pure functions only (tested in test/wa.test.js);
   index.js does the database reads and the network call.
   Nothing is sent unless config/app.wa.on is true AND the secrets WA_TOKEN / WA_APP_SECRET exist.
   While config/app.wa.testTo has numbers in it, messages go ONLY to those numbers (testing with Meta's test number). */
const crypto = require('crypto');

// Template names (created and approved in WhatsApp Manager — same names in Tamil "ta" and English "en")
const TPL = {
  confirmed: 'vct_booking_confirmed',      // 1 name · 2 vehicle · 3 pickup · 4 time · 5 fare · 6 booking no.
  assigned: 'vct_driver_assigned',         // 1 name · 2 driver · 3 car + number plate · 4 booking no.
  ontrip: 'vct_trip_started',              // 1 name · 2 number plate · 3 help phone
  done: 'vct_trip_completed',              // 1 name · 2 fare · 3 booking no.
  cancelled: 'vct_booking_cancelled',      // 1 name · 2 booking no. · 3 office phone
  drvwelcome: 'vct_driver_welcome'         // to a new DRIVER when the office approves them: 1 name · 2 driver help phone
};
const KINDS = ['confirmed', 'assigned', 'ontrip', 'done', 'cancelled'];
const OFFER = ['outstation', 'rental'];

// Which messages a booking change needs. before = null for a new booking.
function waEvents(before, after) {
  if (!after) return [];
  const b = before || {}, out = [], st = after.status, was = b.status;
  if (!before) {
    // a ride booked now gets "driver assigned" within a minute — no separate confirmation for it
    const advance = st === 'scheduled' || OFFER.includes(after.kind) || (after.src && after.src !== 'app');
    if (advance && (st === 'scheduled' || st === 'searching')) out.push('confirmed');
  }
  if (st === 'assigned' && was !== 'assigned' && after.driverPhone) out.push('assigned');
  else if (st === 'ontrip' && was !== 'ontrip') out.push('ontrip');
  else if (st === 'done' && was !== 'done') out.push('done');
  else if (st === 'cancelled' && was !== 'cancelled' && before) {
    const why = String(after.cancelReason || '');
    const selfCancel = /^customer/.test(why) || why === 'limit';
    // the customer app books again by itself when a driver cancels a city ride — no "cancelled" message then
    const autoRebook = /^driver/.test(why) && after.src === 'app' && !after.startedAt && !OFFER.includes(after.kind);
    if (!selfCancel && !autoRebook) out.push('cancelled');
  }
  return out;
}

// '+91 99446 40416' → '919944640416' (Indian mobiles only); anything else → null
function waPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  else if (d.length === 12 && d.startsWith('91')) { /* ok */ } else return null;
  return /^91[6-9]\d{9}$/.test(d) ? d : null;
}

// WhatsApp refuses template values with new lines, tabs or more than 4 spaces in a row
const clean = (v, max = 60) => {
  const s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return (s.length > max ? s.slice(0, max - 1) + '…' : s) || '-';
};
const ref6 = id => String(id || '').slice(0, 6).toUpperCase();
const IST = 19800000;
function istTime(ms) {
  const d = new Date(+ms + IST), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0'), pm = h >= 12;
  h = h % 12 || 12;
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]}, ${h}:${m} ${pm ? 'PM' : 'AM'}`;
}
const place = (p, ta) => p ? ((ta ? p.ta || p.en : p.en || p.ta) || p.name || '') : '';
const money = v => { const x = Math.round(+v || 0); return x > 0 ? x.toLocaleString('en-IN') : '-'; };

/* The message body for Graph API POST /{phone-number-id}/messages.
   b = booking, id = booking id, o = { to, lang, office, now } */
function waMessage(kind, b, id, o) {
  const ta = o.lang !== 'en', name = clean(b.custName || (ta ? 'வாடிக்கையாளர்' : 'Customer'), 40), ref = ref6(id);
  const veh = clean(ta ? (b.vehTa || b.vehEn || b.veh) : (b.vehEn || b.vehTa || b.veh));
  const car = clean([b.vehModel, b.plate].filter(Boolean).join(' · ') || b.plate);
  let tpl, p;
  if (kind === 'confirmed') {
    const when = b.status === 'scheduled' || OFFER.includes(b.kind) ? istTime(b.when || o.now) : (ta ? 'இப்போதே' : 'Now');
    tpl = TPL.confirmed; p = [name, veh, clean(place(b.from, ta)), when, money(b.fare), ref];
  } else if (kind === 'assigned') {
    // no ride PIN here: Meta classes a template with a PIN as an OTP/authentication message and rejects it.
    // App customers see the PIN in the app; phone bookings have no PIN.
    tpl = TPL.assigned; p = [name, clean(b.driverName, 40), car, ref];
  } else if (kind === 'ontrip') { tpl = TPL.ontrip; p = [name, clean(b.plate), clean(o.help || o.office)]; }
  else if (kind === 'done') { tpl = TPL.done; p = [name, money(b.fareFinal || b.fare), ref]; }
  else if (kind === 'cancelled') { tpl = TPL.cancelled; p = [name, ref, clean(o.office)]; }
  else return null;
  return { messaging_product: 'whatsapp', to: o.to, type: 'template',
    template: { name: tpl, language: { code: ta ? 'ta' : 'en' },
      components: [{ type: 'body', parameters: p.map(text => ({ type: 'text', text })) }] } };
}

/* Welcome message to a driver the office has just approved (joined through the app). d = drivers/{phone} doc. */
function waDriverWelcome(d, o) {
  const ta = o.lang !== 'en';
  const p = [clean(d && d.name || (ta ? 'Driver' : 'Driver'), 40), clean(o.help)];
  return { messaging_product: 'whatsapp', to: o.to, type: 'template',
    template: { name: TPL.drvwelcome, language: { code: ta ? 'ta' : 'en' },
      components: [{ type: 'body', parameters: p.map(text => ({ type: 'text', text })) }] } };
}

/* A typed reply from the office to someone who messaged us (customer or driver). WhatsApp allows free text only
   within 24 hours of that person's last message. lastIn = ms of their last message (0 = never). */
const REPLY_WINDOW = 24 * 3600e3;
function replyOpen(lastIn, now) { return +lastIn > 0 && now - lastIn < REPLY_WINDOW && lastIn <= now + 60e3; }
function replyText(v) { const s = String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return s.length && s.length <= 1000 ? s : null; }
function waText(to, body) { return { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } }; }

// Should this number get a message now? (switch on, kind allowed, test list)
function waAllowed(w, kind, to) {
  if (!w || w.on !== true || !w.phoneId || !to) return false;
  if (Array.isArray(w.kinds) && !w.kinds.includes(kind)) return false;
  const test = (Array.isArray(w.testTo) ? w.testTo : []).map(waPhone).filter(Boolean);
  return !test.length || test.includes(to);
}

// Meta signs every webhook call: X-Hub-Signature-256: sha256=<HMAC of the raw body with the app secret>
function sigOk(raw, header, secret) {
  if (!raw || !secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const want = crypto.createHmac('sha256', secret).update(raw).digest('hex'), got = header.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(got)) return false;
  return crypto.timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got.toLowerCase(), 'hex'));
}

// Delivery receipts and customer replies from a webhook body
function waParse(body) {
  const st = [], msgs = [];
  for (const e of (body && body.object === 'whatsapp_business_account' && Array.isArray(body.entry) ? body.entry : []))
    for (const c of (Array.isArray(e.changes) ? e.changes : [])) {
      const v = c && c.field === 'messages' && c.value; if (!v) continue;
      for (const s of (v.statuses || [])) if (s && s.id && s.status)
        st.push({ wamid: String(s.id), status: String(s.status), at: +s.timestamp * 1000 || 0,
          error: s.errors && s.errors[0] ? clean(`${s.errors[0].code || ''} ${s.errors[0].title || s.errors[0].message || ''}`, 200) : null });
      for (const m of (v.messages || [])) if (m && m.id && m.from)
        msgs.push({ wamid: String(m.id), from: String(m.from), type: String(m.type || ''), at: +m.timestamp * 1000 || 0,
          text: m.type === 'text' && m.text ? clean(m.text.body, 1000) : m.type === 'button' && m.button ? clean(m.button.text, 200) : '',
          name: v.contacts && v.contacts[0] && v.contacts[0].profile ? clean(v.contacts[0].profile.name, 60) : '' });
    }
  return { statuses: st, messages: msgs };
}

// Graph API status order — a late "sent" must not overwrite "read"
const RANK = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const newer = (oldS, newS) => (RANK[newS] ?? -1) > (RANK[oldS] ?? -1);

module.exports = { TPL, KINDS, waEvents, waPhone, waMessage, waDriverWelcome, waAllowed, REPLY_WINDOW, replyOpen, replyText, waText, sigOk, waParse, newer, clean, istTime, ref6 };
