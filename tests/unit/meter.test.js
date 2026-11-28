// node tests/unit/meter.test.js — GPS trip meter (core/meter.js), its server copy and its Java port
const M = require('../../core/meter.js'); const assert = require('assert'); const fs = require('fs'); const path = require('path');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
// a deterministic "random" so the traces are the same every run
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const KAT = { lat: 12.9716, lon: 79.1376 }, CMC = { lat: 12.9246, lon: 79.1356 };
const mPerDegLat = 111320;
// a drive along a polyline at `kmh`, one fix every `every` s, GPS noise of `noise` m
function drive(route, kmh, every, noise, t0) {
  const out = []; let t = t0 || 1e12;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1], d = M.dist(a, b), steps = Math.max(1, Math.round(d / (kmh / 3.6) / every));
    for (let k = 0; k < steps; k++) {
      const f = k / steps, lat = a.lat + (b.lat - a.lat) * f, lon = a.lon + (b.lon - a.lon) * f;
      out.push({ lat: lat + (rnd() - 0.5) * 2 * noise / mPerDegLat, lon: lon + (rnd() - 0.5) * 2 * noise / (mPerDegLat * Math.cos(lat * Math.PI / 180)), t, acc: 8 + rnd() * 10 });
      t += every * 1000;
    }
  }
  const l = route[route.length - 1]; out.push({ lat: l.lat, lon: l.lon, t, acc: 8 });
  return out;
}
const route = [KAT, { lat: 12.955, lon: 79.139 }, { lat: 12.935, lon: 79.1366 }, CMC];
const trueKm = route.slice(1).reduce((a, p, i) => a + M.dist(route[i], p), 0) / 1000;
const run = fixes => { const s = M.fresh(); fixes.forEach(f => M.add(s, f)); return s; };

ok(`clean drive Katpadi → CMC (${trueKm.toFixed(2)} km) measured within 2 %`, () => {
  const s = run(drive(route, 30, 3, 4)); assert.ok(Math.abs(M.km(s) - trueKm) / trueKm < 0.02, M.km(s));
});
ok('normal city GPS (±8 m, fix every 2–3 s, 15–40 km/h) within 3 %', () => {
  for (const [kmh, ev, nz] of [[15, 2, 8], [25, 3, 8], [40, 3, 8], [10, 3, 6]]) { const s = run(drive(route, kmh, ev, nz)); assert.ok(Math.abs(M.km(s) / trueKm - 1) < 0.03, [kmh, M.km(s)]); }
});
ok('normal driving is not counted as waiting', () => {
  for (const [kmh, ev] of [[25, 3], [40, 2], [15, 3]]) { const s = run(drive(route, kmh, ev, 8)); assert.equal(M.summary(s).waitMin, 0, [kmh, M.summary(s).waitMin]); }
});
ok('very bad GPS (±15 m, independent every 2 s) still within 7 %', () => {
  const s = run(drive(route, 25, 2, 15)); assert.ok(M.km(s) / trueKm < 1.07 && M.km(s) / trueKm > 0.97, M.km(s));
});
ok('standing 5 minutes at a signal with GPS drift: no distance, counted as waiting', () => {
  const t0 = 1e12, fx = []; for (let i = 0; i < 100; i++) fx.push({ lat: KAT.lat + (rnd() - 0.5) * 12 / mPerDegLat, lon: KAT.lon + (rnd() - 0.5) * 12 / mPerDegLat, t: t0 + i * 3000, acc: 12 });
  const s = run(fx); assert.ok(M.km(s) < 0.05, M.km(s)); assert.ok(M.summary(s).waitMin >= 4, M.summary(s).waitMin);
});
ok('a 3 km GPS jump in 3 seconds is ignored and counted', () => {
  const fx = drive(route, 30, 3, 4); const i = 50; fx.splice(i, 0, { lat: fx[i].lat + 0.027, lon: fx[i].lon, t: fx[i - 1].t + 1500, acc: 10 });
  const s = run(fx); assert.ok(Math.abs(M.km(s) - trueKm) / trueKm < 0.02, M.km(s)); assert.ok(s.jumps >= 1);
});
ok('poor fixes (accuracy 80 m) are skipped', () => {
  const fx = drive(route, 30, 3, 4).map((f, i) => i % 5 === 2 ? { ...f, lat: f.lat + 0.001, acc: 80 } : f);
  const s = run(fx); assert.ok(Math.abs(M.km(s) - trueKm) / trueKm < 0.02, M.km(s)); assert.ok(s.bad > 0);
});
ok('tunnel / no signal for 2 minutes: the gap is filled with straight line × 1.3 and counted', () => {
  const fx = drive(route, 30, 3, 0); const a = 100, b = 150; const cut = fx.slice(0, a).concat(fx.slice(b));
  const s = run(cut); const missing = M.dist(fx[a - 1], fx[b]) * 1.3 / 1000;
  assert.equal(s.gaps, 1); assert.ok(M.summary(s).gapKm >= missing - 0.01 && M.summary(s).gapKm < missing + 0.06, [M.summary(s).gapKm, missing]);  // from the last used point (≤ 30 m before the cut)
});
ok('fake-GPS (mock) fixes are counted for the server to flag', () => {
  const s = run(drive(route, 30, 3, 4).map((f, i) => i < 10 ? { ...f, mock: true } : f)); assert.equal(s.mock, 10);
});
ok('garbage input never breaks the meter', () => {
  const s = M.fresh(); [null, {}, { lat: 'x', lon: 1, t: 1 }, { lat: 200, lon: 1, t: 1 }, { lat: 12, lon: 79, t: NaN }].forEach(f => M.add(s, f));
  assert.equal(M.km(s), 0); assert.equal(s.n, 0);
});
ok('the server replay of the stored points gives the same km (±1 %) and the same waiting (±1 min)', () => {
  const fx = drive(route, 25, 3, 10); const t0 = fx[0].t;
  // with a 4-minute stop in the middle
  const mid = 120, stop = []; for (let i = 0; i < 80; i++) stop.push({ ...fx[mid], t: fx[mid].t + (i + 1) * 3000, lat: fx[mid].lat + (rnd() - 0.5) * 8 / mPerDegLat });
  const shift = 81 * 3000, all = fx.slice(0, mid + 1).concat(stop, fx.slice(mid + 1).map(f => ({ ...f, t: f.t + shift })));
  const s = run(all);
  const chunks = []; for (let i = 0; i < s.pts.length; i += 60) chunks.push({ n: i / 60, t0: s.t0, p: s.pts.slice(i, i + 60).join(';') });
  const r = M.replay(chunks);
  assert.ok(Math.abs(M.km(r) - M.km(s)) / M.km(s) < 0.01, [M.km(r), M.km(s)]);
  assert.ok(Math.abs(M.summary(r).waitMin - M.summary(s).waitMin) <= 1, [M.summary(r).waitMin, M.summary(s).waitMin]);
  assert.equal(r.gaps, 0, 'a stop is not a gap in the replay');
});
ok('server copy (functions/lib/meter.js) is identical to core/meter.js', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../functions/lib/meter.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../core/meter.js'), 'utf8'));
});
// the Java port (native Android) must give the same km on the same fixes — checked when a Java compiler is here (CI, dev)
ok('native TripMeter.java gives the same km and waiting as core/meter.js', () => {
  const { execSync } = require('child_process');
  let javac = ''; try { javac = execSync('command -v javac', { encoding: 'utf8' }).trim(); } catch (e) { /* none */ }
  if (!javac) { console.log('  (skipped: no javac)'); return; }
  const src = path.join(__dirname, '../../mobile/driver/android/app/src/main/java/app/velloretaxi/driver/TripMeter.java');
  const tmp = fs.mkdtempSync('/tmp/tm-'); fs.mkdirSync(path.join(tmp, 'app/velloretaxi/driver'), { recursive: true });
  fs.copyFileSync(src, path.join(tmp, 'app/velloretaxi/driver/TripMeter.java'));
  fs.writeFileSync(path.join(tmp, 'Run.java'), `import app.velloretaxi.driver.TripMeter;import java.io.*;public class Run{public static void main(String[] a)throws Exception{TripMeter m=new TripMeter();BufferedReader r=new BufferedReader(new InputStreamReader(System.in));String l;while((l=r.readLine())!=null){String[] x=l.split(",");m.add(Double.parseDouble(x[0]),Double.parseDouble(x[1]),Long.parseLong(x[2]),Double.parseDouble(x[3]),x[4].equals("1"));}System.out.println(m.km()+" "+m.waitMin()+" "+m.gaps+" "+m.jumps+" "+m.mock+" "+m.points().split(";").length);}}`);
  execSync(`javac -d ${tmp} ${tmp}/app/velloretaxi/driver/TripMeter.java ${tmp}/Run.java 2>&1`, { encoding: 'utf8' });
  for (const [name, fx] of [['clean', drive(route, 30, 3, 4)], ['noisy', drive(route, 20, 2, 18)], ['gap', (() => { const f = drive(route, 30, 3, 0); return f.slice(0, 100).concat(f.slice(150)); })()]]) {
    const inp = fx.map(f => [f.lat, f.lon, Math.round(f.t), f.acc, f.mock ? 1 : 0].join(',')).join('\n');
    const out = execSync(`java -cp ${tmp} Run 2>/dev/null`, { input: inp, encoding: 'utf8' }).trim().split(' ');
    const s = run(fx);
    assert.equal(+out[0], M.km(s), `${name}: java ${out[0]} vs js ${M.km(s)}`);
    assert.equal(+out[1], M.summary(s).waitMin, `${name}: waiting`); assert.equal(+out[2], s.gaps); assert.equal(+out[3], s.jumps);
    assert.equal(+out[5], s.pts.length, `${name}: stored points`);
  }
});
console.log(n, 'meter tests passed');
