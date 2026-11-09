// node tests/unit/sitequote.test.js — the website's fare estimate gives the same rupees as the server's price check
// (functions/lib/logic.js fareCheck / outCheck, which corrects any app booking below the price list)
const assert = require('assert');
const Q = require('../../vellore/quote.js'), L = require('../../functions/lib/logic.js'), F = require('../../core/fare.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
// the live Settings on 9 Nov 2026 + a second, different set
const LIVE = { fares: { mini: { base: 105, per: 16 }, sedan: { base: 120, per: 19 }, suv: { base: 180, per: 22 }, psuv: { base: 250, per: 26 }, trav: { base: 600, per: 28 } },
  out: { rate: { mini: 11, sedan: 12, suv: 16, psuv: 20, trav: 24 }, rate1: { mini: 16, sedan: 17, suv: 19, psuv: 24, trav: 29 },
    bata: { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 }, bata1: { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 }, min1: 80, mind: 250, daykm: 400 } };
const OTHER = { fares: { mini: { base: 99, per: 15 } }, out: { rate1: { sedan: 18 }, min1: 120, mind: 300, daykm: 350, longKm: 300, longPct: 10,
  cat: { a: 90, b: 160 }, cb: { B: { mini: 450 }, C: { suv: 600 } } } };
const NEWBUS = { lat: 12.9341, lon: 79.1377 }, CHENNAI_AIRPORT = { lat: 12.9941, lon: 80.1709 }, CMC = { lat: 12.9249, lon: 79.1353 }, VIT = { lat: 12.9692, lon: 79.1559 };

ok('live: New Bus Stand → Chennai Airport 124 km one way, Mini ₹2,280 (as checked on the live app)', () => {
  assert.strictEqual(Q.out('mini', 124, 'one', LIVE).total, 2280);
  assert.strictEqual(Q.out('sedan', 124, 'one', LIVE).total, 2410);
  assert.strictEqual(Q.out('mini', 124, 'round', LIVE).total, 3050);
  assert.strictEqual(Q.out('trav', 124, 'round', LIVE).total, 6500);
});
for (const [name, c] of [['live', LIVE], ['other', OTHER], ['defaults', {}]]) {
  ok(`${name}: outstation = server outCheck for every vehicle, one way and round trip, 20–900 km`, () => {
    for (const id of ['mini', 'sedan', 'suv', 'psuv', 'trav']) for (const km of [20, 45, 80, 95, 101, 124, 150, 151, 230, 399, 401, 650, 900])
      for (const type of ['one', 'round']) {
        const mine = Q.out(id, km, type, c);
        const srv = L.outCheck({ veh: id, fare: 0, src: 'app', kind: 'outstation', tariff: { t: 'out', km, otype: type } }, c);
        assert.ok(mine && srv, `${id} ${km} ${type}`);
        assert.strictEqual(mine.total, srv.fare, `${name} ${id} ${km} km ${type}: site ${mine.total} vs server ${srv.fare}`);
        assert.strictEqual(mine.type, srv.tariff.otype, `${id} ${km} type`);
      }
  });
  ok(`${name}: city fare = server fareCheck for every vehicle and distance`, () => {
    for (const v of Q.city(c.fares)) for (const km of [0.5, 1.5, 2, 3.7, 8, 12.4, 17.9]) {
      const fare = F.cityFare(v, km);
      if (v.govt) { assert.strictEqual(fare, L.autoFare(km), `auto ${km}`); continue; }
      const f = c.fares && c.fares[v.id];
      if (!f) { assert.strictEqual(v.base, Q.VEH.find(x => x.id === v.id).base); continue; }   // server checks only priced vehicles
      // a booking at exactly the site's fare is accepted by the server (not corrected) …
      assert.strictEqual(L.fareCheck({ src: 'app', kind: 'ride', veh: v.id, km, fare }, c, Date.UTC(2026, 10, 9, 6)), null, `${v.id} ${km} accepted`);
      // … and ₹10 less is corrected back up to it
      const low = L.fareCheck({ src: 'app', kind: 'ride', veh: v.id, km, fare: fare - 10 }, c, Date.UTC(2026, 10, 9, 6));
      assert.ok(low && low.fare === fare, `${v.id} ${km} km: server wants ${low && low.fare}, site says ${fare}`);
    }
  });
}
ok('trip kind: town trips are local, Chennai is outstation, autos only in their area', () => {
  assert.deepStrictEqual(Q.kind(CMC, VIT), { local: true, auto: true });
  assert.strictEqual(Q.kind(NEWBUS, CHENNAI_AIRPORT).local, false);
  const q = Q.quote(CMC, VIT, 7.2, LIVE); assert.strictEqual(q.kind, 'local'); assert.ok(q.rows.some(r => r.v.id === 'auto'));
  assert.strictEqual(q.rows.find(r => r.v.id === 'mini').fare, F.cityFare({ base: 105, per: 16 }, 7.2));
  const o = Q.quote(NEWBUS, CHENNAI_AIRPORT, 124, LIVE); assert.strictEqual(o.kind, 'out'); assert.ok(!o.rows.some(r => r.v.id === 'auto'));
  assert.strictEqual(o.rows.find(r => r.v.id === 'mini').one.total, 2280);
  const ar = Q.kind({ lat: 12.9165, lon: 79.1325 + 22 / 108.5 }, CMC);   // ~22 km east of the centre: not local, auto ok
  assert.deepStrictEqual(ar, { local: false, auto: true });
});
ok('short outstation trips are round trip only (category A), as in the app', () => {
  const r = Q.out('mini', 60, 'one', LIVE); assert.strictEqual(r.type, 'round'); assert.strictEqual(r.roundOnly, true);
});
ok('garbage input never gives NaN', () => {
  assert.strictEqual(Q.out('mini', 'x', 'one', LIVE), null); assert.strictEqual(Q.out('bike', 100, 'one', LIVE), null);
  for (const v of Q.city({ mini: { base: 'abc', per: -3 } })) assert.ok(isFinite(F.cityFare(v, 5)));
});
console.log(`RESULT PASS ${n}/${n}`);
