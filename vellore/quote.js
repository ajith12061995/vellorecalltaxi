/* Vellore website · fare estimate before booking. Uses the same prices as the apps (public/prices, mirrored from
   Office → Settings) and the same rules: city fare = core/fare.js cityFare; outstation = the server's outCheck in
   functions/lib/logic.js (tests/unit/sitequote.test.js checks both give the same rupees). Needs core/fare.js (FARE). */
const SITEQ = (() => {
  const F = typeof FARE !== 'undefined' ? FARE : require('../core/fare.js');
  const n = v => { const x = +v; return isFinite(x) && x > 0 ? x : 0; };
  // built-in prices = what the apps use when Settings has no value (same numbers as functions/lib/logic.js)
  const VEH = [
    { id: 'mini', ta: 'Mini கார்', en: 'Mini', seats: 4, models: 'Swift · Wagon R', base: 100, per: 16 },
    { id: 'sedan', ta: 'Sedan கார்', en: 'Sedan', seats: 4, models: 'Dzire · Aura · Etios', base: 130, per: 19 },
    { id: 'suv', ta: 'MPV', en: 'MPV', seats: 6, models: 'Ertiga · Rumion', base: 180, per: 22 },
    { id: 'psuv', ta: 'Premium MPV', en: 'Premium MPV', seats: 7, models: 'Innova Crysta · Hycross', base: 250, per: 26 },
    { id: 'trav', ta: 'Tempo Traveller', en: 'Tempo Traveller', seats: 12, models: 'Tempo Traveller · Maxi Cab', base: 600, per: 28 },
    { id: 'auto', ta: 'ஆட்டோ', en: 'Auto', seats: 3, models: '', base: 50, per: 25, govt: true }
  ];
  const ORATE0 = { mini: 11, sedan: 12, suv: 16, psuv: 20, trav: 22 }, OBATA0 = { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 };
  const OUT0 = { min1: 80, mind: 250, daykm: 400, longKm: 400, longPct: 0 };
  // city vehicles with the office prices (fares = config/app.fares {id:{base,per}})
  function city(fares) {
    return VEH.map(v => {
      const f = fares && fares[v.id];
      return v.govt ? { ...v, base: F.AUTO_GOVT.base, per: F.AUTO_GOVT.per } : { ...v, base: f && n(f.base) ? +f.base : v.base, per: f && n(f.per) ? +f.per : v.per };
    });
  }
  // outstation price table = tariffs() in functions/lib/logic.js
  function outTable(c) {
    const R1 = { ...ORATE0 }, B1 = { ...OBATA0 }, R = { ...ORATE0 }, B = { ...OBATA0 }, O = { ...OUT0 }, o = c && c.out;
    if (o) {
      Object.keys(R).forEach(id => {
        R1[id] = +((o.rate1 && o.rate1[id] > 0) ? o.rate1[id] : (o.rate && o.rate[id] > 0 ? o.rate[id] : R1[id]));
        B1[id] = +((o.bata1 && o.bata1[id] != null) ? o.bata1[id] : (o.bata && o.bata[id] != null ? o.bata[id] : B1[id]));
        if (o.rate && o.rate[id] > 0) R[id] = +o.rate[id];
        if (o.bata && o.bata[id] != null) B[id] = +o.bata[id];
      });
      if (o.min1 != null) O.min1 = +o.min1; if (o.mind != null) O.mind = +o.mind; if (o.daykm >= 100) O.daykm = +o.daykm;
      if (o.longKm != null) O.longKm = +o.longKm; if (o.longPct != null) O.longPct = +o.longPct;
    }
    return { R1, B1, R, B, O };
  }
  /* outstation estimate for one vehicle: km = one-way road km; type 'one' | 'round' (round = leave and return the
     same day unless the km need more days). Returns {total, type, days} or null for vehicles without outstation. */
  function out(id, km, type, c) {
    const T = outTable(c), o = (c && c.out) || {}, O = T.O;
    km = Math.round(n(km)); if (!km) return null;
    const cat = F.outCat(km, o.cat), A = cat === 'A', one = !A && type !== 'round';
    const rate = (one ? T.R1 : T.R)[id], bata0 = (one ? T.B1 : T.B)[id];
    if (!(rate > 0) || bata0 == null) return null;
    const bata = F.catBata(o.cb, cat, id, bata0), mind = A ? 0 : O.mind;
    const days = one ? Math.max(1, Math.ceil(km / O.daykm)) : Math.max(1, Math.ceil(2 * km / O.daykm));
    const billed = one ? Math.max(km, O.min1) : Math.max(km * 2, mind * days);
    const extra = one && O.longPct > 0 && km > O.longKm ? Math.round((km - O.longKm) * rate * O.longPct / 100) : 0;
    return { total: Math.round((billed * rate + bata * days + extra) / 10) * 10, type: one ? 'one' : 'round', days, roundOnly: A };
  }
  /* the trip kind for two points: 'local' when both are inside the town area (autos a little further), else 'out' */
  function kind(a, b, area) {
    const far = Math.max(F.fromCentre(a, area), F.fromCentre(b, area));
    return { local: far <= F.areaKm(area, 'local') + 0.5, auto: far <= F.areaKm(area, 'auto') + 0.5 };
  }
  // all prices for a trip: [{v, fare}] for a city trip, or [{v, one, round}] for an outstation trip
  function quote(a, b, km, c) {
    const k = kind(a, b, c && c.area), vs = city(c && c.fares);
    if (k.local) return { kind: 'local', rows: vs.filter(v => !v.govt || k.auto).map(v => ({ v, fare: F.cityFare(v, km) })) };
    return { kind: 'out', rows: vs.filter(v => !v.govt).map(v => ({ v, one: out(v.id, km, 'one', c), round: out(v.id, km, 'round', c) })).filter(r => r.one || r.round) };
  }
  return { VEH, city, out, outTable, kind, quote };
})();
if (typeof module !== 'undefined') module.exports = SITEQ;
