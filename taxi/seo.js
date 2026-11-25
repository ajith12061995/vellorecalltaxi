/* Vellore Taxi · search landing pages (/taxi/…): fills the fare tables with the same prices and rules as the apps
   (core/fare.js + vellore/quote.js, prices from public/prices — mirrored from Office → Settings).
   Built-in prices below = vellore/site.js PRICES0; the database replaces them as soon as it answers. */
(() => {
  const P0 = { fares: { mini: { base: 105, per: 16 }, sedan: { base: 120, per: 19 }, suv: { base: 180, per: 22 }, psuv: { base: 250, per: 26 }, trav: { base: 600, per: 28 } },
    out: { rate: { mini: 11, sedan: 12, suv: 16, psuv: 20, trav: 24 }, rate1: { mini: 16, sedan: 17, suv: 19, psuv: 24, trav: 29 },
      bata: { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 }, bata1: { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 }, min1: 80, mind: 250, daykm: 400 } };
  let P = P0;
  const money = n => Number(n).toLocaleString('en-IN'), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render() {
    if (typeof SITEQ === 'undefined' || typeof FARE === 'undefined') return;
    const vs = SITEQ.city(P.fares);
    document.querySelectorAll('[data-fares]').forEach(el => {
      const kind = el.dataset.fares, km = +el.dataset.km || 0, only = (el.dataset.only || '').split(',').filter(Boolean);
      let rows = '';
      if (kind === 'local') {
        rows = vs.filter(v => !only.length || only.includes(v.id)).sort((x, y) => (y.govt ? 1 : 0) - (x.govt ? 1 : 0)).map(v => `<tr><th scope="row">${esc(v.en)}<small>${v.seats} seats${v.models ? ' · ' + esc(v.models) : ''}</small></th>
          <td>₹${money(v.base)}<small>first ${v.govt ? '1.8' : v.incl || 1.5} km, then ₹${money(v.per)}/km</small></td>${km ? `<td><b>₹${money(FARE.cityFare(v, km))}</b></td>` : ''}</tr>`).join('');
        el.innerHTML = `<thead><tr><th scope="col">Vehicle</th><th scope="col">Fare</th>${km ? `<th scope="col">About ${km} km</th>` : ''}</tr></thead><tbody>${rows}</tbody>`;
      } else {
        rows = vs.filter(v => !v.govt).map(v => { const a = SITEQ.out(v.id, km, 'one', P), b = SITEQ.out(v.id, km, 'round', P); if (!a && !b) return '';
          return `<tr><th scope="row">${esc(v.en)}<small>${v.seats} seats${v.models ? ' · ' + esc(v.models) : ''}</small></th><td>${a && a.type === 'one' ? '<b>₹' + money(a.total) + '</b>' : '—'}</td><td>${b ? '<b>₹' + money(b.total) + '</b>' : '—'}</td></tr>`; }).join('');
        el.innerHTML = `<thead><tr><th scope="col">Vehicle</th><th scope="col">One way</th><th scope="col">Round trip, same day</th></tr></thead><tbody>${rows}</tbody>`;
      }
    });
  }
  render();
  const load = () => { if (!window.SITEDB) return; window.SITEDB().then(db => db.get('public/prices')).then(p => { if (p && typeof p === 'object') { P = { ...P0, ...p }; render(); } }).catch(() => {}); };
  if (window.SITEDB) load(); else document.addEventListener('sitedb-ready', load, { once: true });
})();
