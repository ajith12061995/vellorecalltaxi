/* Vellore website · page logic: language, menu, contact numbers / places / prices from Office (public/site,
   public/prices), the booking box (places → route → fares → open the app with the trip filled in), contact form.
   Works without the database (built-in values) and without Google Maps (popular places + straight-line estimate). */
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], H = document.documentElement;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = (ta, en) => H.dataset.l === 'en' ? en : ta;
  const money = x => Math.round(+x || 0).toLocaleString('en-IN');
  const fmtPh = p => String(p || '').replace(/^(\d{5})(\d{5})$/, '$1 $2');

  /* ---------- language (English first; தமிழ் button switches; remembered on this phone) ---------- */
  const setLang = l => { H.dataset.l = l; H.lang = l; try { localStorage.setItem('vct-site-lang', l); } catch (e) { } document.dispatchEvent(new Event('langchange')); };
  try { const s = localStorage.getItem('vct-site-lang'); if (s === 'en' || s === 'ta') { H.dataset.l = s; H.lang = s; } } catch (e) { }
  $('#lang').onclick = () => setLang(H.dataset.l === 'ta' ? 'en' : 'ta');

  /* ---------- menu (phones) ---------- */
  const top = $('#top'), burger = $('#burger');
  const menu = open => { top.classList.toggle('open', open); burger.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  burger.onclick = () => menu(!top.classList.contains('open'));
  $$('#menu a').forEach(a => a.addEventListener('click', () => menu(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu(false); });

  /* ---------- content: built-in values = what Office had on 9 Nov 2026; the database replaces them ---------- */
  const SITE0 = { phone: '9344640416', driverPhone: '9944039933', whatsapp: '', email: 'vellorecalltaxi.office@gmail.com', address: 'Vellore, Tamil Nadu',
    places: [
      { id: 'fort', ta: 'வேலூர் கோட்டை', en: 'Vellore Fort', dta: '16-ஆம் நூற்றாண்டு கருங்கல் கோட்டை, அகழியுடன்.', den: 'A 16th-century granite fort with its moat.' },
      { id: 'temple', ta: 'ஜலகண்டேஸ்வரர் கோவில்', en: 'Jalakandeswarar Temple', dta: 'கோட்டைக்குள் இருக்கும் சிற்பக் கோவில்.', den: 'The carved temple inside the fort.' },
      { id: 'golden', ta: 'ஸ்ரீபுரம் பொற்கோவில்', en: 'Sripuram Golden Temple', dta: 'மாலை விளக்கொளியில் பார்க்க மிக அழகு. நகரத்திலிருந்து சுமார் 10 கி.மீ.', den: 'Best seen lit up in the evening. About 10 km from town.' },
      { id: 'amirthi', ta: 'அமிர்தி அருவி', en: 'Amirthi Falls', dta: 'காட்டுக்குள் சிறிய அருவியும் விலங்கியல் பூங்காவும்.', den: 'A small forest waterfall and zoo park.' },
      { id: 'yelagiri', ta: 'ஏலகிரி மலை', en: 'Yelagiri Hills', dta: '14 ஹேர்பின் வளைவுகள், புங்கனூர் ஏரி. சுமார் 90 கி.மீ.', den: '14 hairpin bends and Punganur Lake. About 90 km.' },
      { id: 'cmc', ta: 'CMC, VIT, Katpadi Junction', en: 'CMC, VIT, Katpadi Junction', dta: 'மருத்துவமனை, கல்லூரி, ரயில் நிலையம் — தினமும் அதிகம் போகும் இடங்கள்.', den: 'Hospital, college and the railway station — our busiest pickups.' }] };
  const PRICES0 = { fares: { mini: { base: 105, per: 16 }, sedan: { base: 120, per: 19 }, suv: { base: 180, per: 22 }, psuv: { base: 250, per: 26 }, trav: { base: 600, per: 28 } },
    out: { rate: { mini: 11, sedan: 12, suv: 16, psuv: 20, trav: 24 }, rate1: { mini: 16, sedan: 17, suv: 19, psuv: 24, trav: 29 },
      bata: { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 }, bata1: { mini: 300, sedan: 300, suv: 350, psuv: 400, trav: 500 }, min1: 80, mind: 250, daykm: 400 } };
  let SITE = SITE0, PRICES = PRICES0;
  const IMG = {};   // place id → photo (data URL) from siteImg

  // drawings used when a place has no photo (own artwork)
  const ART = {
    fort: '<rect y="112" width="240" height="38" fill="#2F7D74"/><path d="M20 112V70h14v-9h14v9h14v-9h14v9h14v-9h14v9h14v-9h14v9h14v-9h14v9h14v-9h14v9h14v-9h14v9h8v42Z" fill="#8E8576" stroke="#5E574C" stroke-width="2"/><path d="M30 124h40M120 130h50" stroke="#6FB3A8" stroke-width="3" stroke-linecap="round"/>',
    temple: '<rect y="128" width="240" height="22" fill="#9CC2AE"/><g fill="#C9A27A" stroke="#8A6A47" stroke-width="2"><path d="M80 128 86 60h68l6 68Z"/><path d="M92 60l4-22h48l4 22Z"/><path d="M102 38l3-16h30l3 16Z"/><path d="M108 22c3-12 21-12 24 0Z"/></g><path d="M88 84h64M86 106h68M98 48h44" stroke="#8A6A47" stroke-width="2"/>',
    golden: '<rect y="124" width="240" height="26" fill="#9CC2AE"/><path d="M60 124h120l-16-36H76Z" fill="#E7B422" stroke="#A47A0E" stroke-width="2"/><path d="M82 88c0-44 76-44 76 0Z" fill="#F4C842" stroke="#A47A0E" stroke-width="2"/><g fill="#F4C842" stroke="#A47A0E" stroke-width="2"><ellipse cx="120" cy="54" rx="8" ry="4"/><circle cx="120" cy="45" r="5"/><path d="M120 40c-2-5 2-5 0-10"/></g>',
    amirthi: '<path d="M0 150V60c40-30 70-10 90-30 20 20 30 10 50 0 30 20 60 0 100 30v90Z" fill="#6E9E83"/><path d="M112 30c-6 30 6 60 0 120h22c-6-60 6-90 0-120Z" fill="#CFE8F2"/><ellipse cx="123" cy="140" rx="46" ry="10" fill="#9ED0E2"/>',
    yelagiri: '<path d="M0 150V96L50 50l40 34 46-54 50 48 54-30v106Z" fill="#7FAF92"/><path d="M0 150v-30c60-16 120 6 240-14v44Z" fill="#5E8F74"/><circle cx="196" cy="34" r="14" fill="#FFC21A"/>',
    cmc: '<rect y="128" width="240" height="22" fill="#9CC2AE"/><rect x="56" y="54" width="128" height="74" fill="#fff" stroke="#0B4A36" stroke-width="2"/><path d="M110 74h20v14h14v20h-14v14h-20v-14H96V88h14Z" fill="#C23B3B"/><path d="M72 66h16M152 66h16" stroke="#0B4A36" stroke-width="2"/>',
    any: '<path d="M0 150V100c50-30 90-10 130-30s80 0 110-20v100Z" fill="#9CC2AE"/><path d="M120 40c-16 0-28 12-28 28 0 20 28 46 28 46s28-26 28-46c0-16-12-28-28-28Z" fill="#0B4A36"/><circle cx="120" cy="68" r="10" fill="#FFC21A"/>'
  };
  const art = id => `<svg viewBox="0 0 240 150" aria-hidden="true" preserveAspectRatio="xMidYMid slice">${ART[id] || ART.any}</svg>`;

  function renderContacts() {
    const s = SITE;
    $$('[data-show]').forEach(el => {
      const k = el.dataset.show;
      if (['phone', 'driverPhone', 'whatsapp'].includes(k)) { if (s[k]) el.textContent = fmtPh(s[k]); }
      else if (k === 'email' || k === 'address') { if (s[k]) el.textContent = s[k]; }
    });
    $$('[data-tel]').forEach(a => { const v = s[a.dataset.tel]; if (v) a.href = 'tel:+91' + v; });
    $$('[data-wa]').forEach(a => { const v = s[a.dataset.wa]; a.hidden = !v; if (!v) { a.removeAttribute('href'); return; } a.href = 'https://wa.me/91' + v + '?text=' + encodeURIComponent(L('வணக்கம் Vellore Taxi, ', 'Hello Vellore Taxi, ')); });
    $$('[data-mail]').forEach(a => { if (s.email) a.href = 'mailto:' + s.email; });
  }
  function renderFares() {
    const vs = SITEQ.city(PRICES.fares);
    $('#board').innerHTML = vs.map(v => `<div class="row">
      <img src="/vehicles/${v.id}.jpg" alt="" loading="lazy" width="92" height="62">
      <div><h3><span class="ta">${esc(v.ta)}</span><span class="en">${esc(v.en)}</span></h3>
        <small><span class="ta">${v.seats} பேர்${v.models ? ' · ' + esc(v.models) : ''}</span><span class="en">${v.seats} seats${v.models ? ' · ' + esc(v.models) : ''}</span></small></div>
      <div class="price">₹${money(v.base)}<small><span class="ta"> முதல் ${v.govt ? '1.8' : '1.5'} கி.மீ., பிறகு ₹${money(v.per)}/கி.மீ.</span><span class="en"> first ${v.govt ? '1.8' : '1.5'} km, then ₹${money(v.per)}/km</span></small></div></div>`).join('');
    const mini = vs.find(v => v.id === 'mini'), T = SITEQ.outTable(PRICES);
    $$('[data-show=mini]').forEach(el => el.textContent = money(mini.base));
    $$('[data-show=oround]').forEach(el => el.textContent = money(Math.min(...Object.values(T.R))));
    $$('[data-show=local]').forEach(el => el.textContent = FARE.areaKm(PRICES.area, 'local'));
    const ex = SITEQ.out('mini', 124, 'one', PRICES); if (ex) $('#exAmt').textContent = money(ex.total);
  }
  function renderPlaces() {
    $('#plist').innerHTML = (SITE.places || []).map(p => {
      const name = L(p.ta || p.en, p.en || p.ta), d = L(p.dta || p.den, p.den || p.dta), im = IMG[p.id];
      return `<article class="place"><div class="pic">${im ? `<img src="${im}" alt="${esc(name)}" loading="lazy">` : art(p.id)}</div><h3>${esc(name)}</h3>${d ? `<p>${esc(d)}</p>` : ''}</article>`;
    }).join('');
  }
  function renderAll() { renderContacts(); renderFares(); renderPlaces(); }
  document.addEventListener('langchange', () => { renderPlaces(); renderContacts(); if (B.q) showQuote(); renderSugLabels(); });

  /* ---------- data from Office (after first paint) ---------- */
  const validPh = x => /^[6-9]\d{9}$/.test(String(x || ''));
  function useSite(d) {
    if (!d) return;
    const s = { ...SITE0 };
    ['phone', 'driverPhone', 'whatsapp'].forEach(k => { if (validPh(d[k])) s[k] = d[k]; });
    if (typeof d.email === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.email)) s.email = d.email.slice(0, 80);
    if (typeof d.address === 'string' && d.address.trim()) s.address = d.address.trim().slice(0, 160);
    if (Array.isArray(d.places)) s.places = d.places.filter(p => p && typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) && (p.ta || p.en)).slice(0, 24)
      .map(p => ({ id: p.id, ta: String(p.ta || '').slice(0, 60), en: String(p.en || '').slice(0, 60), dta: String(p.dta || '').slice(0, 200), den: String(p.den || '').slice(0, 200), img: +p.img || 0 }));
    SITE = s;
  }
  function loadData() {
    if (!window.SITEDB) return;
    window.SITEDB().then(db => Promise.all([db.get('public/site').catch(() => null), db.get('public/prices').catch(() => null)]).then(([site, prices]) => {
      useSite(site);
      if (prices && prices.fares) PRICES = { fares: prices.fares || {}, out: prices.out || {}, rent: prices.rent || {}, night: prices.night || null, area: prices.area || null };
      renderAll(); if (B.a && B.b) quoteNow();
      (SITE.places || []).filter(p => p.img).forEach(p => db.get('siteImg/' + p.id).then(d => {
        if (d && typeof d.data === 'string' && /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d.data)) { IMG[p.id] = d.data; renderPlaces(); }
      }).catch(() => { }));
    })).catch(() => { /* no database here: built-in values stay */ });
  }
  const idle = f => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 2500 }) : setTimeout(f, 600));
  if (window.SITEDB) idle(loadData); else document.addEventListener('sitedb-ready', () => idle(loadData), { once: true });

  /* ---------- booking box ---------- */
  const PTS = {
    katpadi: { ta: 'காட்பாடி ஜங்ஷன்', en: 'Katpadi Junction', lat: 12.9716, lon: 79.1376 }, newbus: { ta: 'புதிய பேருந்து நிலையம்', en: 'New Bus Stand', lat: 12.9349, lon: 79.1435 },
    cmc: { ta: 'CMC மருத்துவமனை', en: 'CMC Hospital', lat: 12.9246, lon: 79.1356 }, vit: { ta: 'VIT பல்கலைக்கழகம்', en: 'VIT University', lat: 12.9692, lon: 79.1559 },
    oldbus: { ta: 'பழைய பேருந்து நிலையம்', en: 'Old Bus Stand', lat: 12.9180, lon: 79.1330 }, fort: { ta: 'வேலூர் கோட்டை', en: 'Vellore Fort', lat: 12.9206, lon: 79.1295 },
    golden: { ta: 'ஸ்ரீபுரம் பொற்கோவில்', en: 'Sripuram Golden Temple', lat: 12.8710, lon: 79.0880 }, sathu: { ta: 'சத்துவாச்சாரி', en: 'Sathuvachari', lat: 12.9370, lon: 79.1640 },
    maa: { ta: 'சென்னை விமான நிலையம்', en: 'Chennai Airport', lat: 12.9941, lon: 80.1709 }, blr: { ta: 'பெங்களூரு', en: 'Bengaluru', lat: 12.9767, lon: 77.5713 },
    tpt: { ta: 'திருப்பதி', en: 'Tirupati', lat: 13.6288, lon: 79.4192 }, tvm: { ta: 'திருவண்ணாமலை', en: 'Tiruvannamalai', lat: 12.2253, lon: 79.0747 },
    ylg: { ta: 'ஏலகிரி', en: 'Yelagiri', lat: 12.5784, lon: 78.6386 }, pdy: { ta: 'புதுச்சேரி', en: 'Puducherry', lat: 11.9416, lon: 79.8083 },
    kpm: { ta: 'காஞ்சிபுரம்', en: 'Kanchipuram', lat: 12.8342, lon: 79.7036 }, mas: { ta: 'சென்னை சென்ட்ரல்', en: 'Chennai Central', lat: 13.0827, lon: 80.2757 }
  };
  const ptName = k => L(PTS[k].ta, PTS[k].en);
  const B = { a: null, b: null, km: 0, mins: 0, approx: false, q: null, veh: 'mini', o: 'one', pts: null, seq: 0 };
  const field = w => w === 'a' ? $('#bf') : $('#bt');
  function setPoint(w, p) {
    B[w] = p; const inp = field(w); inp.value = p ? p.n : ''; inp.closest('.stop').classList.toggle('has', !!p);
    closeSug(); $('#berr').textContent = '';
    if (B.a && B.b) quoteNow(); else { $('#res').classList.remove('on'); B.q = null; (B.a ? $('#bt') : $('#bf')).focus(); }
  }
  const fromKey = k => ({ lat: PTS[k].lat, lon: PTS[k].lon, n: ptName(k) });
  // popular places under the boxes: fill the empty box first
  const CH = ['katpadi', 'newbus', 'cmc', 'vit', 'maa', 'tpt', 'blr'];
  function renderChips() { $('#chips').innerHTML = CH.map(k => `<button type="button" data-pt="${k}">${esc(ptName(k))}</button>`).join(''); }
  $('#chips').addEventListener('click', e => { const b = e.target.closest('[data-pt]'); if (!b) return; const k = b.dataset.pt;
    setPoint(!B.a ? 'a' : !B.b ? 'b' : (document.activeElement === $('#bf') ? 'a' : 'b'), fromKey(k)); });
  const DEST = [['newbus', 'tpt'], ['newbus', 'blr'], ['newbus', 'tvm'], ['newbus', 'ylg'], ['newbus', 'pdy'], ['newbus', 'kpm'], ['katpadi', 'mas']];
  function renderDest() { $('#dest').innerHTML = DEST.map(([a, b]) => `<button type="button" data-trip="${a}|${b}">${esc(ptName(b))}</button>`).join(''); }
  document.addEventListener('click', e => { const b = e.target.closest('[data-trip]'); if (!b) return; const [a, c] = b.dataset.trip.split('|');
    B.a = fromKey(a); $('#bf').value = B.a.n; $('#sf').classList.add('has'); setPoint('b', fromKey(c)); $('#book').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $$('[data-focus]').forEach(a => a.addEventListener('click', () => setTimeout(() => $('#' + a.dataset.focus).focus({ preventScroll: true }), 450)));
  function renderSugLabels() { renderChips(); renderDest(); }

  /* suggestions: popular places at once + Google places when Google Maps is available */
  let G = null, GFAIL = false, gLoading = null, gSess = null, sugT = 0, sugFor = null, sugItems = [], hi = -1;
  function loadGoogle() {
    if (G || GFAIL) return Promise.resolve(G);
    if (gLoading) return gLoading;
    gLoading = new Promise(res => {
      const go = () => {
        if (!window.GMAPS_KEY) { GFAIL = true; return res(null); }
        window.gm_authFailure = () => { GFAIL = true; G = null; };
        window.__vctGm = () => { G = window.google && window.google.maps ? window.google.maps : null; if (!G) GFAIL = true; res(G); };
        const s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(window.GMAPS_KEY) + '&libraries=places&loading=async&region=IN&language=' + (H.dataset.l === 'en' ? 'en' : 'ta') + '&callback=__vctGm';
        s.async = true; s.onerror = () => { GFAIL = true; res(null); }; document.head.appendChild(s);
        setTimeout(() => { if (!G) { GFAIL = true; res(null); } }, 8000);
      };
      if (window.GMAPS_KEY !== undefined) go();
      else { const k = document.createElement('script'); k.src = '/maps-config.js'; k.onload = go; k.onerror = () => { GFAIL = true; res(null); }; document.head.appendChild(k); }
    });
    return gLoading;
  }
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  function closeSug() { $$('.sug').forEach(s => { s.classList.remove('on'); s.innerHTML = ''; }); $$('.stop input').forEach(i => i.setAttribute('aria-expanded', 'false')); sugItems = []; hi = -1; }
  function drawSug(w) {
    const box = w === 'a' ? $('#sgf') : $('#sgt');
    if (!sugItems.length) { box.classList.remove('on'); box.innerHTML = ''; return; }
    box.innerHTML = sugItems.map((x, i) => `<button type="button" role="option" data-i="${i}" class="${i === hi ? 'hi' : ''}">${esc(x.name)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('');
    box.classList.add('on'); field(w).setAttribute('aria-expanded', 'true');
  }
  async function suggest(w) {
    const q = norm(field(w).value); sugFor = w; hi = -1;
    const local = Object.keys(PTS).filter(k => !q || norm(PTS[k].ta).includes(q) || norm(PTS[k].en).includes(q)).slice(0, q ? 5 : 8)
      .map(k => ({ name: ptName(k), sub: '', key: k }));
    sugItems = local; drawSug(w);
    if (q.length < 2) return;
    const g = await loadGoogle(); if (!g || sugFor !== w || norm(field(w).value) !== q) return;
    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await g.importLibrary('places');
      if (!gSess) gSess = new AutocompleteSessionToken();
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: q, sessionToken: gSess, includedRegionCodes: ['in'], language: H.dataset.l === 'en' ? 'en' : 'ta',
        locationBias: { center: { lat: 12.9165, lng: 79.1325 }, radius: 50000 } });
      if (sugFor !== w || norm(field(w).value) !== q) return;
      const gs = (suggestions || []).filter(s => s.placePrediction).slice(0, 6).map(s => { const p = s.placePrediction;
        return { name: (p.mainText && p.mainText.text) || p.text.text, sub: (p.secondaryText && p.secondaryText.text) || '', pred: p }; });
      sugItems = local.slice(0, 3).concat(gs); drawSug(w);
    } catch (e) { /* keep the popular places */ }
  }
  async function pick(w, x) {
    if (x.key) return setPoint(w, fromKey(x.key));
    try {
      const place = x.pred.toPlace(); await place.fetchFields({ fields: ['location'] }); gSess = null;
      setPoint(w, { lat: place.location.lat(), lon: place.location.lng(), n: x.name.slice(0, 80) });
    } catch (e) { $('#berr').textContent = L('அந்த இடத்தை எடுக்க முடியலை. வேற பெயர் போட்டு பாருங்க.', 'Could not get that place. Try another name.'); }
  }
  [['a', '#bf', '#sgf'], ['b', '#bt', '#sgt']].forEach(([w, inp, sg]) => {
    const el = $(inp);
    el.addEventListener('focus', () => { loadGoogle(); });   // the popular places are already shown as buttons; the list opens when typing
    el.addEventListener('input', () => { if (B[w]) { B[w] = null; el.closest('.stop').classList.remove('has'); $('#res').classList.remove('on'); B.q = null; } clearTimeout(sugT); sugT = setTimeout(() => suggest(w), 220); });
    el.addEventListener('keydown', e => {
      if (!sugItems.length || sugFor !== w) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length; drawSug(w); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(w, sugItems[hi >= 0 ? hi : 0]); }
      else if (e.key === 'Escape') closeSug();
    });
    $(sg).addEventListener('mousedown', e => e.preventDefault());
    $(sg).addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(w, sugItems[+b.dataset.i]); });
    el.closest('.stop').querySelector('.clr').onclick = () => { B[w] = null; el.value = ''; el.closest('.stop').classList.remove('has'); $('#res').classList.remove('on'); B.q = null; el.focus(); };
  });
  document.addEventListener('click', e => { if (!e.target.closest('.stop')) closeSug(); });
  $('#book').addEventListener('submit', e => e.preventDefault());

  /* route: Google road distance; without Google a straight-line estimate (marked "approx.") */
  const decodePoly = str => { let i = 0, lat = 0, lng = 0; const out = []; while (i < str.length) { let b, s = 0, r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5 } while (b >= 32); lat += (r & 1) ? ~(r >> 1) : (r >> 1); s = 0; r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5 } while (b >= 32); lng += (r & 1) ? ~(r >> 1) : (r >> 1); out.push({ lat: lat / 1e5, lng: lng / 1e5 }) } return out; };
  async function route(a, b) {
    const g = await loadGoogle();
    if (g && window.GMAPS_KEY) {
      try {
        const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': window.GMAPS_KEY, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
          body: JSON.stringify({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lon } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lon } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }) });
        const j = await r.json(), rt = j.routes && j.routes[0];
        if (rt && rt.distanceMeters) return { km: Math.max(1, rt.distanceMeters / 1000), mins: rt.duration ? Math.round(parseInt(rt.duration) / 60) : 0, pts: rt.polyline ? decodePoly(rt.polyline.encodedPolyline) : null, approx: false };
      } catch (e) { }
    }
    const c = FARE.crow(a, b); return { km: Math.max(1.2, c * (c > 25 ? 1.25 : 1.35)), mins: 0, pts: null, approx: true };
  }
  let gmap = null, gobjs = [];
  function drawMap() {
    const el = $('#bmap');
    if (!G || GFAIL || !B.a || !B.b) { el.hidden = true; return; }
    try {
      el.hidden = false;
      if (!gmap) gmap = new G.Map(el, { disableDefaultUI: true, gestureHandling: 'cooperative', clickableIcons: false, mapId: undefined });
      gobjs.forEach(o => o.setMap(null)); gobjs = [];
      const path = B.pts || [{ lat: B.a.lat, lng: B.a.lon }, { lat: B.b.lat, lng: B.b.lon }];
      gobjs.push(new G.Polyline({ path, map: gmap, strokeColor: '#0B4A36', strokeWeight: 5, strokeOpacity: B.pts ? 1 : .5 }));
      gobjs.push(new G.Marker({ position: { lat: B.a.lat, lng: B.a.lon }, map: gmap, label: { text: 'A', color: '#fff' } }));
      gobjs.push(new G.Marker({ position: { lat: B.b.lat, lng: B.b.lon }, map: gmap, label: { text: 'B', color: '#fff' } }));
      const bd = new G.LatLngBounds(); path.forEach(p => bd.extend(p)); gmap.fitBounds(bd, 30);
    } catch (e) { el.hidden = true; }
  }
  async function quoteNow() {
    const seq = ++B.seq, a = B.a, b = B.b;
    if (FARE.crow(a, b) < 0.15) { $('#berr').textContent = L('Pickup-ம் drop-ம் ஒரே இடம். வேற இடம் தேர்ந்தெடுங்க.', 'Pickup and drop are the same place. Choose another.'); $('#res').classList.remove('on'); return; }
    $('#rinfo').textContent = L('கட்டணம் கணக்கிடுது…', 'Working out the fare…'); $('#res').classList.add('on');
    const r = await route(a, b); if (seq !== B.seq) return;
    Object.assign(B, { km: r.km, mins: r.mins, pts: r.pts, approx: r.approx });
    B.q = SITEQ.quote(a, b, B.km, PRICES);
    if (!B.q.rows.length) { $('#berr').textContent = L('இந்த பயணத்துக்கு வண்டி இல்லை. அழையுங்க.', 'No vehicle for this trip online. Please call us.'); $('#res').classList.remove('on'); return; }
    showQuote(); drawMap();
  }
  function showQuote() {
    const q = B.q, out = q.kind === 'out';
    if (!q.rows.some(r => r.v.id === B.veh)) B.veh = q.rows[0].v.id;
    const roundOnly = out && q.rows.every(r => !r.one || r.one.type === 'round');
    if (roundOnly) B.o = 'round';
    const seg = $('#otype'); seg.hidden = !out;
    seg.querySelectorAll('[data-o]').forEach(b => { b.classList.toggle('on', b.dataset.o === B.o); b.disabled = roundOnly && b.dataset.o === 'one'; });
    const km = Math.round(B.km * 10) / 10, t = B.mins ? (B.mins >= 60 ? `${Math.floor(B.mins / 60)} ${L('மணி', 'hr')} ${B.mins % 60} ${L('நிமி', 'min')}` : `${B.mins} ${L('நிமி', 'min')}`) : '';
    $('#rinfo').textContent = (B.approx ? L('சுமார் ', 'About ') : '') + `${km} ${L('கி.மீ.', 'km')}` + (t ? ' · ' + t : '') + ' · ' + (out ? 'Outstation' : 'City ride') + (B.approx ? L(' (தோராயம்)', ' (approx.)') : '');
    $('#vl').innerHTML = q.rows.map(r => {
      const v = r.v, f = out ? (B.o === 'round' ? r.round : r.one) : null, amt = out ? (f ? f.total : null) : r.fare;
      if (amt == null) return '';
      return `<label class="${v.id === B.veh ? 'on' : ''}"><input type="radio" name="veh" value="${v.id}" ${v.id === B.veh ? 'checked' : ''}><img src="/vehicles/${v.id}.jpg" alt="" loading="lazy">
        <span><b>${esc(L(v.ta, v.en))}</b><small>${v.seats} ${L('பேர்', 'seats')}${out && f && f.days > 1 ? ' · ' + f.days + ' ' + L('நாள்', 'days') : ''}</small></span><span class="p">₹${money(amt)}</span></label>`;
    }).join('');
    $$('#vl input').forEach(i => i.onchange = () => { B.veh = i.value; $$('#vl label').forEach(l => l.classList.toggle('on', l.contains(i))); bookLink(); });
    $('#bnote').textContent = out ? L('Driver பேட்டா சேர்த்து. Toll, parking, permit தனி. App-ல் book பண்ணும்போது சரியான கட்டணம் உறுதியாகும்.', 'Driver allowance included. Tolls, parking and permits extra. The app confirms the exact fare when you book.')
      : L('இரவு நேரத்தில் கூடுதல் கட்டணம் சேரலாம். App-ல் book பண்ணும்போது சரியான கட்டணம் உறுதியாகும்.', 'A night charge may apply. The app confirms the exact fare when you book.');
    bookLink();
  }
  $('#otype').addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (!b || b.disabled) return; B.o = b.dataset.o; showQuote(); });
  // the app reads #book=<base64url JSON> after the customer signs in (index.html readBookLink)
  function bookLink() {
    const x = { f: { lat: +B.a.lat.toFixed(6), lon: +B.a.lon.toFixed(6), n: B.a.n }, t: { lat: +B.b.lat.toFixed(6), lon: +B.b.lon.toFixed(6), n: B.b.n }, v: B.veh, k: B.q.kind, o: B.o };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(x)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    $('#go').href = '/#book=' + b64;
  }

  /* ---------- contact form → enquiries (Office → Support) ---------- */
  const T0 = Date.now(), form = $('#enq'), fmsg = $('#fmsg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form), name = String(f.get('name') || '').trim(), msg = String(f.get('msg') || '').trim(), kind = String(f.get('kind') || 'other');
    const phone = String(f.get('phone') || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    const bad = t => { fmsg.className = 'fmsg err'; fmsg.textContent = t; };
    if (name.length < 2) return bad(L('உங்க பெயரை போடுங்க.', 'Please enter your name.'));
    if (!/^[6-9]\d{9}$/.test(phone)) return bad(L('10 இலக்க மொபைல் எண் போடுங்க.', 'Please enter a 10-digit mobile number.'));
    if (f.get('website') || Date.now() - T0 < 2500) { form.reset(); fmsg.className = 'fmsg ok'; fmsg.textContent = L('நன்றி! விரைவில் அழைக்கிறோம்.', 'Thank you! We will call you soon.'); return; }   // robots
    const btn = $('#esend'); btn.disabled = true; fmsg.className = 'fmsg'; fmsg.textContent = L('அனுப்புது…', 'Sending…');
    try {
      if (!window.SITEDB) throw new Error('no-db');
      const db = await window.SITEDB();
      await db.enquiry({ name: name.slice(0, 60), phone, kind: ['ride', 'outstation', 'rental', 'event', 'corporate', 'driver', 'other'].includes(kind) ? kind : 'other', msg: msg.slice(0, 500) });
      form.reset(); fmsg.className = 'fmsg ok'; fmsg.textContent = L('நன்றி! Office விரைவில் உங்களை அழைக்கும்.', 'Thank you! The office will call you soon.');
    } catch (err) {
      bad(L(`அனுப்ப முடியலை. தயவு செய்து ${fmtPh(SITE.phone)}-ஐ அழையுங்க.`, `Could not send. Please call ${fmtPh(SITE.phone)}.`));
    } finally { btn.disabled = false; }
  });

  /* the round call / WhatsApp buttons step aside while the booking box is on screen (they would cover the fares) */
  if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => $('.fab').classList.toggle('away', e.isIntersecting)), { threshold: 0.15 }).observe($('#book'));

  renderAll(); renderSugLabels();
  window.__vctSite = { B, PTS, setPoint, fromKey, state: () => ({ SITE, PRICES }) };   // for the page tests
})();
