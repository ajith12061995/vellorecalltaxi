/* VCT core · fare: the final bill at the end of a trip.
   Shared by the driver app (computes the bill), the office (shows / corrects it) and the customer app (shows it).
   The customer app still makes the upfront quote itself; a copy of the prices used for that quote is saved
   in the booking as `tariff`, so the final bill uses the same prices even if Settings change later.

   tariff kinds (booking.tariff.t):
     'local' : {wait: ₹ per minute after the free wait, free: free minutes}         (wait 0 = no waiting charge)
     'rent'  : {h, km, price, xkm, xhr}    package hours / km, price, ₹ per extra km, ₹ per extra hour
     'out'   : {otype:'one'|'round', km, days, rate, bata, min1, mind, daykm, longKm, longPct}
   actual (from the driver): {km, mins, waitMin, toll, parking, permit}
   Result: {trip, pass, total, comm, lines:[{k, ta, en, amt}]}
     trip  = what the ride itself costs (commission is taken on this)
     pass  = toll + parking + permit, paid through to others (no commission)
     total = trip + pass (the tip is added separately, it is all the driver's) */
const FARE = (() => {
  const r10 = x => Math.round(x / 10) * 10;
  const n = v => { const x = +v; return isFinite(x) && x > 0 ? x : 0; };
  function final(b, a) {
    a = a || {}; b = b || {};
    const t = b.tariff || {}, quoted = n(b.fare), lines = [];
    const add = (k, ta, en, amt) => { amt = Math.round(amt); if (amt) lines.push({ k, ta, en, amt }); return amt; };
    let trip = 0;
    if (t.t === 'rent') {
      const price = n(t.price) || quoted;
      trip += add('pkg', `Package ${t.h} மணி · ${t.km} கி.மீ`, `Package ${t.h} hr · ${t.km} km`, price);
      const xkm = Math.max(0, Math.round(n(a.km) - n(t.km)));
      if (xkm) trip += add('xkm', `கூடுதல் ${xkm} கி.மீ × ₹${n(t.xkm)}`, `Extra ${xkm} km × ₹${n(t.xkm)}`, xkm * n(t.xkm));
      const over = n(a.mins) - n(t.h) * 60 - 10;               // 10 minutes grace
      const blocks = over > 0 ? Math.ceil(over / 30) : 0;       // then charged per started half hour
      if (blocks) trip += add('xhr', `கூடுதல் ${blocks * 30} நிமி`, `Extra ${blocks * 30} min`, blocks * n(t.xhr) / 2);
    } else if (t.t === 'out') {
      const km = n(a.km) || n(t.km) * (t.otype === 'round' ? 2 : 1);
      const days = Math.max(n(t.days) || 1, Math.ceil(km / (n(t.daykm) || 400)), n(a.days));
      const billed = t.otype === 'one' ? Math.max(km, n(t.min1)) : Math.max(km, n(t.mind) * days);
      const extra = t.otype === 'one' && n(t.longPct) > 0 && n(t.km) > n(t.longKm) ? (n(t.km) - n(t.longKm)) * n(t.rate) * n(t.longPct) / 100 : 0;
      const calc = r10(billed * n(t.rate) + n(t.bata) * days + extra);
      trip += add('quote', 'முன்பதிவு கட்டணம்', 'Booked fare', quoted || calc);
      if (calc > (quoted || calc)) trip += add('xout', `கூடுதல் (${Math.round(km)} கி.மீ, ${days} நாள்)`, `Extra (${Math.round(km)} km, ${days} day${days > 1 ? 's' : ''})`, calc - quoted);
    } else {
      const nt = n(t.nightAmt) < quoted ? n(t.nightAmt) : 0;   // night charge is inside the quoted fare; shown on its own line
      trip += add('fare', 'பயணக் கட்டணம்', 'Ride fare', quoted - nt);
      if (nt) trip += add('night', `இரவு கட்டணம் +${n(t.night)}%`, `Night charge +${n(t.night)}%`, nt);
      const wm = Math.max(0, Math.round(n(a.waitMin) - (t.free != null ? n(t.free) : 3)));
      if (wm && n(t.wait)) trip += add('wait', `காத்திருப்பு ${wm} நிமி`, `Waiting ${wm} min`, wm * n(t.wait));
    }
    let pass = 0;
    pass += add('toll', 'Toll', 'Toll', n(a.toll));
    pass += add('parking', 'Parking', 'Parking', n(a.parking));
    pass += add('permit', 'மாநில permit', 'State permit', n(a.permit));
    return { trip, pass, total: trip + pass, lines };
  }
  // Night charge on city rides. cfg = config/app.night = {on, from:'22:00', to:'05:00', pct}; at = pickup time (ms).
  // Indian time is used whatever the phone's time zone; a window that crosses midnight (22:00–05:00) works.
  const hm = x => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(x || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
  function nightPct(cfg, at) {
    if (!cfg || !cfg.on) return 0;
    const pct = Math.min(100, n(cfg.pct)), f = hm(cfg.from), t = hm(cfg.to); if (!pct || f == null || t == null || f === t) return 0;
    const m = ((Math.floor((+at + 19800000) / 60000) % 1440) + 1440) % 1440;   // minutes after midnight, IST
    return (f < t ? m >= f && m < t : m >= f || m < t) ? pct : 0;
  }
  const withNight = (f, pct) => pct ? Math.round(n(f) * (1 + pct / 100) / 5) * 5 : n(f);
  const comm = (trip, pct) => Math.round(n(trip) * n(pct) / 100);
  // the amount a finished booking really cost (old bookings have no fareFinal)
  const billOf = b => b && b.fareFinal != null ? +b.fareFinal : +(b && b.fare) || 0;
  const tripOf = b => b && b.fx && b.fx.trip != null ? +b.fx.trip : billOf(b);
  return { final, comm, billOf, tripOf, r10, nightPct, withNight, hm };
})();
if (typeof module !== 'undefined') module.exports = FARE;
