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
  // Auto-rickshaw: Tamil Nadu Government fare, G.O. (Ms.) No. 366, 27 Oct 2026. Fixed by law, so the office
  // Settings can't change it: ₹50 for the first 1.8 km, ₹25 per km after, night (22:00–05:00) 1.5×, waiting ₹1/min.
  const AUTO_GOVT = { base: 50, incl: 1.8, per: 25, wait: 1, night: { on: true, from: '22:00', to: '05:00', pct: 50 } };
  // Local (city) area: a circle around Vellore town centre. Outside it a ride is an outstation trip; autos may go a bit further.
  const AREA = { lat: 12.9165, lon: 79.1325, local: 18, auto: 25 };
  const crow = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  // km from the town centre (area = config/app.area when the owner sets one, else AREA)
  const fromCentre = (p, area) => { const a = area && +area.lat && +area.lon ? area : AREA; return p && isFinite(+p.lat) && isFinite(+p.lon) ? crow({ lat: +a.lat, lon: +a.lon }, { lat: +p.lat, lon: +p.lon }) : 0; };
  const areaKm = (area, k) => { const a = area || {}; return +a[k] > 0 ? +a[k] : AREA[k]; };
  // Outstation categories by one-way trip km (owner sets the limits in office Settings; customers never see the letters):
  //   A: up to `a` km  → round trip only, billed = up + down km (no per-day minimum)
  //   B: up to `b` km, C: beyond → one way or round trip as before. Each category may have its own driver allowance.
  const OUTCAT = { a: 100, b: 150 };
  const outCat = (km, cat) => { const c = cat || {}, a = +c.a > 0 ? +c.a : OUTCAT.a, b = Math.max(+c.b > 0 ? +c.b : OUTCAT.b, a); return n(km) <= a ? 'A' : n(km) <= b ? 'B' : 'C'; };
  // driver allowance per day for a category (0 / blank in Settings = the normal outstation allowance)
  const catBata = (cb, cat, id, dflt) => { const x = cb && cb[cat] && +cb[cat][id]; return x > 0 ? x : n(dflt); };
  // city fare before the night charge. v = {id, base, per}
  const cityFare = (v, km) => v && v.id === 'auto' ? Math.round(AUTO_GOVT.base + AUTO_GOVT.per * Math.max(0, n(km) - AUTO_GOVT.incl))
    : Math.round((n(v && v.base) + n(v && v.per) * Math.max(0, n(km) - 1.5)) / 5) * 5;
  // night % for this vehicle (auto: Government night window, whatever the office night switch says)
  const nightFor = (vid, cfg, at) => nightPct(vid === 'auto' ? AUTO_GOVT.night : cfg, at);
  const withNightV = (vid, f, pct) => vid === 'auto' ? (pct ? Math.round(n(f) * (1 + pct / 100)) : n(f)) : withNight(f, pct);
  const comm = (trip, pct) => Math.round(n(trip) * n(pct) / 100);
  // the amount a finished booking really cost (old bookings have no fareFinal)
  const billOf = b => b && b.fareFinal != null ? +b.fareFinal : +(b && b.fare) || 0;
  const tripOf = b => b && b.fx && b.fx.trip != null ? +b.fx.trip : billOf(b);
  return { final, comm, billOf, tripOf, r10, nightPct, withNight, hm, AUTO_GOVT, AREA, crow, fromCentre, areaKm, cityFare, nightFor, withNightV, OUTCAT, outCat, catBata };
})();
if (typeof module !== 'undefined') module.exports = FARE;
