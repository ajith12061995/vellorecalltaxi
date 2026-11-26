/* Vellore website · hourly rental prices. The same packages and the same price rule as the customer app
   (index.html PKG / RANCH / RENT / rentPrice), with the Office prices from public/prices.rent when they are set.
   tests/unit/siterent.test.js checks every package and vehicle against the app's own code. */
const SITERENT = (() => {
  const PKG = [{ h: 1, km: 10 }, { h: 2, km: 20 }, { h: 3, km: 30 }, { h: 4, km: 40 }, { h: 5, km: 50 }, { h: 6, km: 60 }, { h: 8, km: 80 }, { h: 10, km: 100 }, { h: 12, km: 120 }];
  const RANCH = [1, 2, 4, 8, 12];
  const RENT0 = { auto: [199, 379, null, null, null], mini: [299, 549, 999, 1799, 2599], sedan: [349, 649, 1149, 2099, 2999], suv: [499, 899, 1599, 2799, 3999], psuv: [699, 1199, 2099, 3599, 4999], trav: [null, null, 2499, 3999, 5499] };
  const XKM0 = { auto: 14, mini: 12, sedan: 13, suv: 17, psuv: 21, trav: 24 }, XHR0 = { auto: 120, mini: 150, sedan: 170, suv: 230, psuv: 290, trav: 350 };
  // tables with the Office prices applied (config rent = {price:{id:[5]}, xkm:{id}, xhr:{id}})
  function tables(r) {
    const RENT = {}, XKM = { ...XKM0 }, XHR = { ...XHR0 };
    Object.keys(RENT0).forEach(id => {
      RENT[id] = r && r.price && Array.isArray(r.price[id]) ? r.price[id].map(x => +x > 0 ? +x : null) : RENT0[id].slice();
      if (r && r.xkm && r.xkm[id] != null) XKM[id] = +r.xkm[id];
      if (r && r.xhr && r.xhr[id] != null) XHR[id] = +r.xhr[id];
    });
    return { RENT, XKM, XHR };
  }
  function price(id, h, r) {
    const row = tables(r).RENT[id]; if (!row) return null;
    const pts = RANCH.map((x, i) => [x, row[i]]).filter(x => x[1] != null); if (!pts.length || h < pts[0][0] || h > pts[pts.length - 1][0]) return null;
    for (let i = 0; i < pts.length; i++) { if (pts[i][0] === h) return pts[i][1]; if (pts[i][0] > h) { const [a, pa] = pts[i - 1], [b, pb] = pts[i]; return Math.round((pa + (pb - pa) * (h - a) / (b - a)) / 50) * 50 - 1; } }
    return null;
  }
  return { PKG, RANCH, RENT0, tables, price };
})();
if (typeof module !== 'undefined') module.exports = SITERENT;
