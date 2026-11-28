/* VCT core · meter: the GPS trip meter (owner 28 Nov: "GPS fare like Uber / Red Taxi").
   ONE algorithm, three places that must agree:
     - the driver's phone (native Android TripMeter.java — same numbers, runs while the phone is locked;
       this file is the fallback for older apps, while the page is on screen)
     - the server (functions/lib/meter.js is a byte-for-byte copy; tests/unit/meter.test.js checks that)
     - the office (shows and replays the track)
   A fix is used only when it is good enough:
     - accuracy worse than 40 m: skipped (GPS bounce near buildings)
     - speed between the last used point and this one above 130 km/h: skipped (a jump), and counted
     - closer than 30 m (or half the accuracy) to the last used point: not counted yet (drift at a signal); the next
       real move is measured from that point, so a stop shows as a slow segment = waiting time
     - a gap (no usable fix for over 60 s and more than 300 m away): the straight line × 1.3 is added and the gap counted
     - a fix the phone marks as a mock (fake GPS app): counted as "mock" — the server flags the ride
   Waiting: seconds spent slower than 5 km/h between used points (traffic signals, pickup waiting); pendS = the stop going on now.
   Points kept for the server and the map: "lat,lon,t,acc" (5 decimals, t = seconds since the trip start). */
const METER = (() => {
  const MAX_ACC = 40, MAX_KMH = 130, DRIFT_M = 30, GAP_S = 60, GAP_M = 300, GAP_ROAD = 1.3, SLOW_KMH = 5;
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dist = (a, b) => { const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
  const fresh = t0 => ({ t0: t0 || 0, pendS: 0, m: 0, gapM: 0, waitS: 0, gaps: 0, jumps: 0, bad: 0, mock: 0, n: 0, last: null, pts: [] });
  // add one fix {lat, lon, t (ms), acc (m), mock (bool)} → true when used
  function add(s, f) {
    if (!f || !isFinite(+f.lat) || !isFinite(+f.lon) || !isFinite(+f.t) || Math.abs(+f.lat) > 90 || Math.abs(+f.lon) > 180) { s.bad++; return false; }
    if (f.mock) s.mock++;
    const acc = isFinite(+f.acc) && +f.acc > 0 ? +f.acc : 0;
    if (acc > MAX_ACC) { s.bad++; return false; }
    const p = { lat: +f.lat, lon: +f.lon, t: +f.t, acc };
    if (!s.t0) s.t0 = p.t;
    const l = s.last;
    if (!l) { s.last = p; s.n++; s.pts.push(pack(s, p)); return true; }
    const dt = (p.t - l.t) / 1000; if (!(dt > 0)) { s.bad++; return false; }
    const d = dist(l, p);
    if (dt > GAP_S && d > GAP_M) {                         // signal lost for a while: straight line × 1.3
      const g = d * GAP_ROAD; s.m += g; s.gapM += g; s.gaps++;
      s.pendS = 0; s.last = p; s.n++; s.pts.push(pack(s, p)); return true;
    }
    if (d / dt * 3.6 > MAX_KMH) { s.jumps++; return false; }
    if (d < Math.max(DRIFT_M, acc / 2)) { s.pendS = dt; return false; }   // not moved enough yet: the clock keeps running from the last used point
    s.pendS = 0; if (d / dt * 3.6 < SLOW_KMH) s.waitS += dt;          // slower than 5 km/h since the last used point = waiting
    s.m += d; s.last = p; s.n++; s.pts.push(pack(s, p)); return true;
  }
  const r5 = x => Math.round(x * 1e5) / 1e5;
  const pack = (s, p) => `${r5(p.lat)},${r5(p.lon)},${Math.round((p.t - s.t0) / 1000)},${Math.round(p.acc)}`;
  const unpack = (str, t0) => String(str || '').split(';').filter(Boolean).map(x => { const [lat, lon, ts, acc] = x.split(',').map(Number); return { lat, lon, t: (t0 || 0) + ts * 1000, acc }; });
  const km = s => Math.round(s.m / 10) / 100;            // km with 2 decimals
  // recompute a whole trip from stored chunks [{t0, p}] (server / office)
  function replay(chunks) {
    const s = fresh(0);
    for (const c of (chunks || []).slice().sort((a, b) => (+a.n || 0) - (+b.n || 0))) for (const f of unpack(c.p, +c.t0 || 0)) add(s, f);
    return s;
  }
  const summary = s => ({ km: km(s), gapKm: Math.round(s.gapM / 10) / 100, waitMin: Math.round((s.waitS + s.pendS) / 60), gaps: s.gaps, jumps: s.jumps, mock: s.mock, pts: s.n });
  return { MAX_ACC, MAX_KMH, DRIFT_M, GAP_S, GAP_M, GAP_ROAD, SLOW_KMH, dist, fresh, add, pack, unpack, km, replay, summary };
})();
if (typeof module !== 'undefined') module.exports = METER;
