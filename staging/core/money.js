/* VCT core · money: totals for Office → Money (owner 28 Nov: "payment features at pro level").
   Input: ledger lines the server writes (one per wallet change) — trip commission, subscription, coupon / referral
   discount paid to the driver, recharge, bonus, office adjustment. Output: what came in, what the company earned,
   what it paid out, per period and per IST day. No money moves here; this only adds up the ledger. */
const MONEY = (() => {
  const v = x => { const y = +x; return isFinite(y) ? y : 0; };
  const typeOf = l => l.type || (l.kind ? 'disc' : 'trip');
  const atMs = l => { const a = l.at; return a && a.toMillis ? a.toMillis() : a && a.seconds ? a.seconds * 1000 : +a || 0; };
  const istDay = ms => new Date(+ms + 19800000).toISOString().slice(0, 10);
  function sum(lines) {
    const t = { rch: 0, rchN: 0, rzp: 0, rzpN: 0, comm: 0, trips: 0, tripAmt: 0, sub: 0, subN: 0, coupon: 0, couponN: 0,
      referral: 0, referralN: 0, bonus: 0, bonusN: 0, adjIn: 0, adjOut: 0, adjN: 0 };
    for (const l of lines || []) {
      const ty = typeOf(l);
      if (ty === 'trip') { t.trips++; t.tripAmt += v(l.trip); t.comm += v(l.comm); }
      else if (ty === 'sub') { t.sub += v(l.price); t.subN++; }
      else if (ty === 'disc') { if (l.kind === 'coupon-discount') { t.coupon += v(l.disc); t.couponN++; } else { t.referral += v(l.disc); t.referralN++; } }
      else if (ty === 'recharge') { if (l.method === 'razorpay') { t.rzp += v(l.amt); t.rzpN++; } else { t.rch += v(l.amt); t.rchN++; } }
      else if (ty === 'bonus') { t.bonus += v(l.amt); t.bonusN++; }
      else if (ty === 'adjust') { t.adjN++; if (v(l.amt) > 0) t.adjIn += v(l.amt); else t.adjOut -= v(l.amt); }
    }
    t.cashIn = t.rch + t.rzp;                       // reached the owner's account
    t.earn = t.comm + t.sub;                        // taken from driver wallets
    t.cost = t.coupon + t.referral + t.bonus;       // the company paid into driver wallets
    t.net = t.earn - t.cost;
    return t;
  }
  // per IST day, newest first
  function byDay(lines) {
    const g = {};
    for (const l of lines || []) { const d = istDay(atMs(l)); (g[d] = g[d] || []).push(l); }
    return Object.keys(g).sort().reverse().map(d => ({ day: d, ...sum(g[d]) }));
  }
  // one CSV row per ledger line (for the accountant)
  const LABEL = { trip: 'Ride commission', sub: 'Subscription', disc: 'Discount paid', recharge: 'Wallet recharge', bonus: 'Bonus', adjust: 'Office adjustment' };
  function csv(lines, nameOf) {
    const q = x => { const s = String(x == null ? '' : x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Date (IST)', 'Time', 'Driver', 'Phone', 'Type', 'Amount', 'Wallet change', 'Ride fare', 'Detail']];
    for (const l of (lines || []).slice().sort((a, b) => atMs(a) - atMs(b))) {
      const ty = typeOf(l), ms = atMs(l), t = new Date(ms + 19800000).toISOString();
      const amt = ty === 'trip' ? v(l.comm) : ty === 'sub' ? v(l.price) : ty === 'disc' ? v(l.disc) : v(l.amt);
      const wd = l.walletDelta != null ? v(l.walletDelta) : ty === 'disc' ? v(l.disc) : '';
      const det = ty === 'recharge' ? (l.method === 'razorpay' ? 'Razorpay ' : 'UTR ') + (l.utr || '') : ty === 'disc' ? (l.kind || '') + (l.coupon ? ' ' + l.coupon : '')
        : ty === 'sub' ? (l.plan || '') : ty === 'bonus' ? (l.day || '') : ty === 'adjust' ? (l.reason || '') : (l.bookingId || '');
      // a leading = + - @ would make a spreadsheet run it as a formula
      const safe = s => /^[=+\-@]/.test(String(s)) ? "'" + s : s;
      rows.push([t.slice(0, 10), t.slice(11, 16), safe(nameOf ? nameOf(l.driverPhone) : ''), l.driverPhone || '', LABEL[ty] || ty, amt, wd, ty === 'trip' ? v(l.trip) : '', safe(det)]);
    }
    return rows.map(r => r.map(q).join(',')).join('\n');
  }
  return { sum, byDay, csv, typeOf, atMs, istDay };
})();
if (typeof module !== 'undefined') module.exports = MONEY;
