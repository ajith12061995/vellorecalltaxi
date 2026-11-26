/* Vellore website (new design) · the parts on top of site.js: trip tabs (one way / outstation / rental), pickup date
   and time, hourly rental prices, corporate enquiry shortcut, the hero contour map of the fort and the service-area map.
   Uses window.__vctSite from site.js; nothing here talks to the database. */
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], H = document.documentElement;
  const V = window.__vctSite; if (!V) return;
  const L = (ta, en) => H.dataset.l === 'en' ? en : ta;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = x => Math.round(+x || 0).toLocaleString('en-IN');

  /* ---------- pickup date and time: now + 30 min by default, never in the past, at most 30 days ahead ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function setWhenDefault() {
    const d = new Date(Date.now() + 30 * 60e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    $('#wd').value = dstr(d); $('#wt').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('#wd').min = dstr(new Date()); $('#wd').max = dstr(new Date(Date.now() + 30 * 864e5));
  }
  function when() {
    const d = $('#wd').value, t = $('#wt').value; if (!d || !t) return null;
    const ms = new Date(d + 'T' + t).getTime(); return isFinite(ms) ? ms : null;
  }
  function checkWhen() {
    const ms = when(), now = Date.now();
    if (ms == null) return L('தேதியும் நேரமும் தேர்ந்தெடுங்க.', 'Choose a date and time.');
    if (ms < now - 5 * 60e3) return L('அந்த நேரம் போயிடுச்சு. இனிமேல் வரும் நேரத்தை தேர்ந்தெடுங்க.', 'That time has passed. Choose a later time.');
    if (ms > now + 30 * 864e5) return L('30 நாளுக்குள் ஒரு தேதியை தேர்ந்தெடுங்க.', 'Choose a date within 30 days.');
    return '';
  }
  // within 30 minutes of now counts as "now" for the app (its own minimum for a scheduled ride); later = scheduled
  window.__vctWhen = () => { const ms = when(); return ms && !checkWhen() && ms > Date.now() + 30 * 60e3 ? ms : null; };
  function whenHint() { const ms = when(), h = $('#whint'); if (!h) return; h.textContent = ms && !checkWhen() && ms <= Date.now() + 30 * 60e3 ? L('30 நிமிஷத்துக்குள் = இப்போவே ride.', 'Within 30 minutes = a ride now.') : ''; }
  ['#wd', '#wt'].forEach(s => $(s).addEventListener('change', () => { const e = checkWhen(); $('#berr').textContent = e; whenHint(); V.bookLink(); if (TAB === 'rent') rentShow(); }));
  setWhenDefault();
  $('#go').addEventListener('click', e => { const er = checkWhen(); if (er) { e.preventDefault(); $('#berr').textContent = er; $('#wd').focus(); } });

  /* ---------- tabs ---------- */
  let TAB = 'one';
  const OUTCH = ['maa', 'tpt', 'blr', 'tvm', 'ylg', 'pdy', 'kpm', 'mas'];
  function setTab(t, focus) {
    TAB = t;
    $$('[data-tab]').forEach(b => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    $('#pane-trip').hidden = t === 'rent'; $('#pane-rent').hidden = t !== 'rent';
    $('#res').classList.toggle('on', t === 'rent' ? !!RS.pt : !!(V.B.q));
    $('#berr').textContent = '';
    if (t === 'out') {   // outstation: show the far places as quick picks and start with the drop
      $('#chips').innerHTML = OUTCH.map(k => `<button type="button" data-pt="${k}">${esc(V.ptName(k))}</button>`).join('');
      if (V.B.q && V.B.q.kind === 'local') $('#berr').textContent = L('இது நகருக்குள் உள்ள பயணம் — city கட்டணம் காட்டுது.', 'This trip is within town — showing city fares.');
      if (focus) setTimeout(() => (V.B.a ? $('#bt') : $('#bf')).focus({ preventScroll: true }), 300);
    } else if (t === 'one') {
      document.dispatchEvent(new Event('langchange'));   // site.js redraws the town quick picks
      if (focus) setTimeout(() => $('#bf').focus({ preventScroll: true }), 300);
    } else { rentShow(); if (focus) setTimeout(() => $('#rf').focus({ preventScroll: true }), 300); }
  }
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab, true)));
  $('.tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ts = $$('[data-tab]'), i = ts.findIndex(b => b.dataset.tab === TAB), n = ts[(i + (e.key === 'ArrowRight' ? 1 : ts.length - 1)) % ts.length];
    setTab(n.dataset.tab); n.focus(); e.preventDefault();
  });
  $$('[data-tab-go]').forEach(a => a.addEventListener('click', () => setTab(a.dataset.tabGo, true)));
  $$('[data-trip]').forEach(a => a.addEventListener('click', () => { if (TAB === 'rent') setTab('out'); }, true));
  $$('[data-kind]').forEach(a => a.addEventListener('click', () => { const s = $('#ekind'); if (s) s.value = a.dataset.kind; setTimeout(() => { const n = $('#enq [name=name]'); if (n) n.focus({ preventScroll: true }); }, 450); }));

  /* ---------- hourly rental ---------- */
  const RS = { h: 4, veh: 'sedan', pt: null };
  const rentVeh = () => (typeof SITEQ !== 'undefined' ? SITEQ.VEH : []).filter(v => SITERENT.RENT0[v.id]);
  function rentPick() {
    const q = $('#rf').value.trim().toLowerCase(), P = V.PTS;
    const k = Object.keys(P).find(k => P[k].ta.toLowerCase() === q || P[k].en.toLowerCase() === q);
    const was = RS.pt && RS.pt.key;
    RS.pt = k ? { key: k, lat: P[k].lat, lon: P[k].lon, n: V.ptName(k) } : null;
    $('#srf').classList.toggle('has', !!$('#rf').value);
    if ((RS.pt && RS.pt.key) !== was) rentShow();   // a blur that changes nothing must not redraw the buttons under the finger
  }
  function rentList() { $('#rflist').innerHTML = ['katpadi', 'newbus', 'cmc', 'vit', 'oldbus', 'fort', 'sathu', 'golden'].filter(k => V.PTS[k]).map(k => `<option value="${esc(V.ptName(k))}">`).join(''); }
  $('#rpk').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (!b) return; RS.h = +b.dataset.h; rentShow(); });
  $('#vl').addEventListener('change', e => { if (e.target.name === 'rveh') { RS.veh = e.target.value; rentShow(); } });
  $('#rf').addEventListener('change', rentPick); $('#rf').addEventListener('input', () => { if (!$('#rf').value) rentPick(); });
  $('#srf .clr').onclick = () => { $('#rf').value = ''; rentPick(); $('#rf').focus(); };
  function rentPrices() { const st = V.state(); return st && st.PRICES && st.PRICES.rent; }
  function rentShow() {
    if (TAB !== 'rent') return;
    const r = rentPrices();
    $('#rpk').innerHTML = SITERENT.PKG.map(p => {
      const from = Math.min(...rentVeh().map(v => SITERENT.price(v.id, p.h, r)).filter(x => x != null));
      return `<button type="button" role="radio" aria-checked="${p.h === RS.h}" class="${p.h === RS.h ? 'on' : ''}" data-h="${p.h}"><b>${p.h} ${L('மணி', p.h > 1 ? 'hrs' : 'hr')}</b><small>${p.km} km${isFinite(from) ? ' · ₹' + money(from) : ''}</small></button>`;
    }).join('');

    if (!RS.pt) { $('#res').classList.remove('on'); return; }
    const rows = rentVeh().map(v => ({ v, p: SITERENT.price(v.id, RS.h, r) })).filter(x => x.p != null);
    if (!rows.some(x => x.v.id === RS.veh) && rows.length) RS.veh = rows[0].v.id;
    const pk = SITERENT.PKG.find(p => p.h === RS.h), T = SITERENT.tables(r);
    $('#bmap').hidden = true; $('#otype').hidden = true;
    $('#rinfo').textContent = `${RS.pt.n} · ${pk.h} ${L('மணி', pk.h > 1 ? 'hours' : 'hour')} · ${pk.km} km`;
    $('#vl').innerHTML = rows.map(({ v, p }) => `<label class="${v.id === RS.veh ? 'on' : ''}"><input type="radio" name="rveh" value="${v.id}" ${v.id === RS.veh ? 'checked' : ''}><img src="/vehicles/${v.id}.jpg" alt="" loading="lazy">
      <span><b>${esc(L(v.ta, v.en))}</b><small>${v.seats} ${L('பேர்', 'seats')} · +₹${money(T.XKM[v.id])}/km · +₹${money(T.XHR[v.id])}/${L('மணி', 'hr')}</small></span><span class="p">₹${money(p)}</span></label>`).join('');
    $('#bnote').textContent = L('Package-க்கு மேல் போனா கூடுதல் கி.மீ., கூடுதல் மணி கட்டணம். Toll, parking தனி. இந்த package-ஓட app திறக்கும்.', 'Beyond the package, extra km and extra hours are charged as shown. Tolls and parking extra. The app opens with this package.');
    const x = { f: { lat: +RS.pt.lat.toFixed(6), lon: +RS.pt.lon.toFixed(6), n: RS.pt.n }, v: RS.veh, k: 'rent', h: RS.h }, w = window.__vctWhen(); if (w) x.w = w;
    $('#go').href = '/#book=' + btoa(unescape(encodeURIComponent(JSON.stringify(x)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    $('#res').classList.add('on');
  }
  document.addEventListener('langchange', () => { rentList(); if (TAB === 'rent') rentShow(); else if (TAB === 'out') setTab('out'); drawTowns(); });
  rentList();

  /* ---------- maps: the fort and its moat as contour lines (hero), the service area (pickup ring + towns) ---------- */
  const fortR = a => { const c = Math.abs(Math.cos(a)), q = Math.abs(Math.sin(a)), n = 5;
    return Math.pow(Math.pow(c, n) + Math.pow(q * 1.18, n), -1 / n) * (1 + .11 * Math.pow(Math.max(0, Math.cos((a - Math.PI / 4) * 4)), 14) + .07 * Math.pow(Math.max(0, Math.cos(a * 4)), 18)); };
  const ring = (cx, cy, S, N) => { let d = ''; for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, r = fortR(a) * S; d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1); } return d + 'Z'; };
  function hero() {
    const s = $('#heromap'); if (!s) return;
    const cx = 1250, cy = 150; let h = '<g fill="none" stroke-linecap="round">';
    h += '<path d="M-20 640 C240 600 420 690 700 600 S1180 470 1460 430" stroke="#1F6B50" stroke-width="2" opacity=".55"/>';
    h += '<path d="M180 -20 C230 180 300 420 470 780" stroke="#1F6B50" stroke-width="1.5" opacity=".45"/>';
    h += '<path d="M1460 700 C1300 650 1220 600 1170 470" stroke="#1F6B50" stroke-width="1.5" opacity=".45"/>';
    for (let k = 0; k < 26; k++) h += `<path d="${ring(cx, cy, 96 + k * 22, 160)}" stroke="${k % 4 ? '#1B5E46' : '#2F8A66'}" stroke-width="${k % 4 ? 1 : 1.4}" opacity="${(0.9 - k / 32).toFixed(2)}"/>`;
    h += `</g><path d="${ring(cx, cy, 84, 160)}" fill="#0B3A2B" stroke="#E6D9BC" stroke-width="2" opacity=".9"/>`;
    s.innerHTML = h;
  }
  // service area: equirectangular around Vellore; real coordinates
  const C0 = { lat: 12.9165, lon: 79.1325 };
  const TOWNS = [
    { ta: 'காட்பாடி', en: 'Katpadi', lat: 12.9716, lon: 79.1376, pick: 1 }, { ta: 'ஆற்காடு', en: 'Arcot', lat: 12.9057, lon: 79.3195 },
    { ta: 'ராணிப்பேட்டை', en: 'Ranipet', lat: 12.9224, lon: 79.3332 }, { ta: 'குடியாத்தம்', en: 'Gudiyatham', lat: 12.9475, lon: 78.8697 },
    { ta: 'ஆம்பூர்', en: 'Ambur', lat: 12.7904, lon: 78.7166 }, { ta: 'திருவண்ணாமலை', en: 'Tiruvannamalai', lat: 12.2253, lon: 79.0747 },
    { ta: 'சென்னை', en: 'Chennai', lat: 13.0827, lon: 80.2707 }, { ta: 'பெங்களூரு', en: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
    { ta: 'திருப்பதி', en: 'Tirupati', lat: 13.6288, lon: 79.4192 }, { ta: 'காஞ்சிபுரம்', en: 'Kanchipuram', lat: 12.8342, lon: 79.7036 }];
  function areaMap() {
    const s = $('#areamap'); if (!s || typeof FARE === 'undefined') return;
    // true direction, distance on a square-root scale so the near towns do not sit on top of each other
    const Kr = 17, P = p => { const km = FARE.crow(C0, p), a = Math.atan2(p.lat - C0.lat, (p.lon - C0.lon) * Math.cos(C0.lat * Math.PI / 180)), r = Kr * Math.sqrt(km);
      return { x: 300 + Math.cos(a) * r, y: 300 - Math.sin(a) * r }; };
    let h = '<rect width="600" height="600" fill="#062A1F"/>';
    [25, 50, 100, 200].forEach(k => { const r = Kr * Math.sqrt(k); h += `<circle cx="300" cy="300" r="${r.toFixed(1)}" fill="none" stroke="#134634" stroke-width="1"/><text x="${(300 + r * .7071 + 4).toFixed(1)}" y="${(300 + r * .7071 + 14).toFixed(1)}" fill="#3E7A62" font-family="Hind Madurai,sans-serif" font-size="12">${k} km</text>`; });
    const km = FARE.areaKm((V.state().PRICES || {}).area, 'local') || 18, rr = Kr * Math.sqrt(km);
    h += `<circle cx="300" cy="300" r="${rr.toFixed(1)}" fill="rgba(245,184,0,.16)" stroke="#F5B800" stroke-width="2"/>`;
    TOWNS.filter(t => !t.pick).forEach(t => { const q = P(t); h += `<path d="M300 300 L${q.x.toFixed(1)} ${q.y.toFixed(1)}" stroke="#2F8A66" stroke-width="1.5" stroke-dasharray="4 5"/>`; });
    const DY = { Ranipet: -10, Arcot: 12, Katpadi: -10, Gudiyatham: -2, Ambur: 8 };
    TOWNS.forEach(t => { const q = P(t), x = q.x, y = q.y, right = x >= 300 || t.en === 'Katpadi', dy = DY[t.en] || 0;
      h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${t.pick ? 5 : 6}" fill="${t.pick ? '#F5B800' : '#E6D9BC'}"/>`;
      h += `<text x="${(x + (right ? 10 : -10)).toFixed(1)}" y="${(y + 5 + dy).toFixed(1)}" fill="#EAF3EE" font-family="Hind Madurai,sans-serif" font-size="15" font-weight="600" text-anchor="${right ? 'start' : 'end'}">${esc(L(t.ta, t.en))}</text>`; });
    h += `<path d="${ring(300, 300, 9, 80)}" fill="#0B4A36" stroke="#E6D9BC" stroke-width="2"/><text x="300" y="${(300 + rr + 18).toFixed(1)}" fill="#F5B800" font-family="Hind Madurai,sans-serif" font-size="14" font-weight="700" text-anchor="middle">${esc(L('Pickup பகுதி', 'Pickup area'))}</text>`;
    s.innerHTML = h;
  }
  function drawTowns() {
    const ul = $('#towns'); if (!ul || typeof FARE === 'undefined') return;
    ul.innerHTML = TOWNS.map(t => { const k = Math.round(FARE.crow(C0, t) * (FARE.crow(C0, t) > 25 ? 1.25 : 1.35));
      return `<li><span>${esc(L(t.ta, t.en))}</span><small>${t.pick ? L('Pickup', 'Pickup') : L('சுமார் ', 'about ') + k + ' km'}</small></li>`; }).join('');
    areaMap();
  }
  hero(); drawTowns();
  window.__vctNext = { setTab, RS, rentShow, when, checkWhen };
})();
