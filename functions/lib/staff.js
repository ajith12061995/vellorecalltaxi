/* Office logins: the owner works any time; a staff member only while active and inside their duty hours.
   Same rule as firestore.rules (onDuty). shift = {from, to} in minutes after midnight, India time (may cross midnight). */
function istMin(now) { const d = new Date((now || Date.now()) + 330 * 60e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function onDuty(st, now) {
  if (!st) return false;
  if (st.role === 'owner') return true;
  if (st.active === false) return false;
  const sh = st.shift; if (!sh) return true;
  const m = istMin(now);
  return sh.from <= sh.to ? (m >= sh.from && m < sh.to) : (m >= sh.from || m < sh.to);
}
const KIND = { fare: ['கட்டணம் மாற்றம் / extra km', 'Fare change / extra km'], bill: ['Bill திருத்தம்', 'Bill correction'],
  block: ['Block', 'Block'], other: ['மற்றவை', 'Other'] };
// WhatsApp template parameters for the owner's "approval needed" message (vct_owner_request)
function ownerReqParams(r, ta) {
  const k = KIND[r.kind] || KIND.other, money = n => '₹' + Math.round(+n || 0);
  const what = (ta ? k[0] : k[1]) + (r.want ? ` ${r.cur ? money(r.cur) + ' → ' : ''}${money(r.want)}` : '');
  const ref = r.bkId ? `Booking ${r.bkId}` : r.drv ? `Driver ${String(r.drv).replace('+91', '')}` : '-';
  return [r.byName || String(r.by || '').replace('+91', '') || 'Staff', what, ref, r.why || '-'];
}
module.exports = { istMin, onDuty, ownerReqParams, KIND };
