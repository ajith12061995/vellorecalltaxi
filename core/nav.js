/* VCT core · in-app turn-by-turn navigation logic (no map, no network: pure maths, unit-tested).
   The route line comes from our routing (Google Routes polyline / OSRM geometry). The turns and the spoken
   sentences are worked out HERE from the line's shape — Google's own step texts are not used.

   route  = {pts:[{lat,lon}], cum:[metres from start at each point], len:metres, secs:route duration}
   maneuver = {i, at:metres from start, type:'left'|'right'|'slight-left'|'slight-right'|'uturn'|'arrive', angle} */
const VNAV = (() => {
  const R = 6371000, rad = Math.PI / 180;
  const dist = (a, b) => { const x = (b.lon - a.lon) * rad * Math.cos((a.lat + b.lat) / 2 * rad), y = (b.lat - a.lat) * rad; return Math.sqrt(x * x + y * y) * R; };
  const brg = (a, b) => { const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad), x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad); return (Math.atan2(y, x) / rad + 360) % 360; };
  const turn = (b1, b2) => { let d = b2 - b1; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }; // + right, − left

  function build(pts, secs) {
    const p = []; (pts || []).forEach(q => { if (q && isFinite(q.lat) && isFinite(q.lon) && (!p.length || dist(p[p.length - 1], q) > 1)) p.push({ lat: +q.lat, lon: +q.lon }); });
    const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i - 1], p[i]));
    return { pts: p, cum, len: cum[cum.length - 1] || 0, secs: +secs || 0 };
  }
  // the point `m` metres from the start (clamped)
  function at(r, m) {
    const c = r.cum, n = r.pts.length; if (!n) return null; if (m <= 0) return r.pts[0]; if (m >= r.len) return r.pts[n - 1];
    let i = 1; while (i < n && c[i] < m) i++;
    const f = (m - c[i - 1]) / ((c[i] - c[i - 1]) || 1), a = r.pts[i - 1], b = r.pts[i];
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
  }
  // turns: compare the heading 25 m before and 25 m after each bend (so GPS-like zig-zags of the line don't count)
  function maneuvers(r) {
    const out = [], n = r.pts.length; if (n < 2) return out;
    let last = -1e9;
    for (let i = 1; i < n - 1; i++) {
      const m = r.cum[i]; if (m < 15 || r.len - m < 15) continue;
      const a = at(r, Math.max(0, m - 25)), b = r.pts[i], c = at(r, Math.min(r.len, m + 25));
      if (dist(a, b) < 5 || dist(b, c) < 5) continue;
      const d = turn(brg(a, b), brg(b, c)), ad = Math.abs(d);
      if (ad < 28) continue;
      const type = ad >= 150 ? 'uturn' : ad < 55 ? (d > 0 ? 'slight-right' : 'slight-left') : (d > 0 ? 'right' : 'left');
      if (m - last < 30 && out.length) { const prev = out[out.length - 1]; if (Math.abs(d) > Math.abs(prev.angle)) out[out.length - 1] = { i, at: m, type, angle: Math.round(d) }; continue; }
      out.push({ i, at: m, type, angle: Math.round(d) }); last = m;
    }
    out.push({ i: n - 1, at: r.len, type: 'arrive', angle: 0 });
    return out;
  }
  // where the driver is on the line: metres along it and metres off it
  function progress(r, pos, hint) {
    const n = r.pts.length; if (!n || !pos) return { along: 0, off: Infinity, seg: 0 };
    let best = { along: 0, off: Infinity, seg: 0 };
    const from = Math.max(1, (hint || 0) - 3); // usually just ahead of the last match
    const scan = (s, e) => {
      for (let i = s; i < e; i++) {
        const a = r.pts[i - 1], b = r.pts[i], kx = Math.cos(a.lat * rad) * rad * R, ky = rad * R;
        const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky, px = (pos.lon - a.lon) * kx, py = (pos.lat - a.lat) * ky;
        const L2 = bx * bx + by * by, t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
        const dx = px - t * bx, dy = py - t * by, off = Math.sqrt(dx * dx + dy * dy);
        if (off < best.off) best = { along: r.cum[i - 1] + t * Math.sqrt(L2), off, seg: i };
      }
    };
    scan(from, n); if (best.off > 40 && from > 1) scan(1, from);
    return best;
  }
  const next = (man, along) => man.find(x => x.at > along - 8) || man[man.length - 1];

  // spoken / shown sentences (our own words)
  const TXT = {
    ta: { left: 'இடது பக்கம் திரும்புங்க', right: 'வலது பக்கம் திரும்புங்க', 'slight-left': 'கொஞ்சம் இடது பக்கம் போங்க', 'slight-right': 'கொஞ்சம் வலது பக்கம் போங்க', uturn: 'U-turn எடுங்க', arrive: 'சேர வேண்டிய இடம் வந்துடும்', arrived: 'நீங்க சேர வேண்டிய இடத்துக்கு வந்துட்டீங்க', straight: 'நேரா போங்க', reroute: 'வழி மாறிட்டீங்க. புது வழி பார்க்கிறேன்', gpslost: 'GPS signal கிடைக்கல', start: 'Navigation ஆரம்பம்' },
    en: { left: 'turn left', right: 'turn right', 'slight-left': 'keep slightly left', 'slight-right': 'keep slightly right', uturn: 'make a U-turn', arrive: 'you will reach the destination', arrived: 'You have arrived', straight: 'Continue straight', reroute: 'You are off the route. Finding a new route', gpslost: 'GPS signal lost', start: 'Starting navigation' },
  };
  const round = m => m >= 1000 ? Math.round(m / 100) / 10 : m >= 300 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
  const distTxt = (m, lang) => { if (m >= 975) m = Math.max(m, 1000); const v = round(m); return m >= 1000 ? (lang === 'ta' ? `${v} கி.மீ` : `${v} km`) : (lang === 'ta' ? `${v} மீ` : `${v} m`); };
  function phrase(type, m, lang) {
    const t = TXT[lang === 'ta' ? 'ta' : 'en'], w = t[type] || t.straight;
    if (m == null || m < 25) return lang === 'ta' ? (type === 'arrive' ? t.arrived : 'இப்போ ' + w) : (type === 'arrive' ? t.arrived : (w.charAt(0).toUpperCase() + w.slice(1)) + ' now');
    if (m >= 975) m = Math.max(m, 1000); const v = round(m);
    if (lang === 'ta') return m >= 1000 ? `${v} கிலோமீட்டரில் ${w}` : `${v} மீட்டரில் ${w}`;
    return `In ${m >= 1000 ? v + (v === 1 ? ' kilometre' : ' kilometres') : v + ' metres'}, ${w}`;
  }
  // which announcement is due for the next maneuver (each threshold said once)
  const CALLS = [800, 300, 100, 25];
  function due(man, distToIt, said) {
    for (const th of CALLS) {
      if (distToIt <= th && !said.has(man.at + ':' + th)) {
        CALLS.filter(x => x >= th).forEach(x => said.add(man.at + ':' + x));
        if (th === 800 && distToIt < 400) continue; // skip far call when it's already close
        return th;
      }
    }
    return null;
  }
  // off-route: far from the line for several fixes in a row (one bad GPS fix is ignored)
  function offRoute(state, off, acc) {
    const lim = Math.max(45, Math.min(90, (acc || 20) * 1.5));
    state.bad = off > lim ? (state.bad || 0) + 1 : 0;
    return state.bad >= 3;
  }
  return { build, at, maneuvers, progress, next, phrase, distTxt, due, offRoute, dist, brg, TXT };
})();
if (typeof module !== 'undefined') module.exports = VNAV;
