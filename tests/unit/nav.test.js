// node tests/unit/nav.test.js — in-app navigation maths
const assert = require('assert'), N = require('../../core/nav.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
// helpers: move `m` metres north/east from a point
const north = (p, m) => ({ lat: p.lat + m / 111195, lon: p.lon });
const east = (p, m) => ({ lat: p.lat, lon: p.lon + m / (111195 * Math.cos(p.lat * Math.PI / 180)) });
const line = (p, step, count, fn) => { const out = [p]; for (let i = 0; i < count; i++) out.push(fn(out[out.length - 1], step)); return out; };
const A = { lat: 12.955, lon: 79.139 };
// 300 m north, then 200 m east  (a right turn), then 200 m north (a left turn)
const leg1 = line(A, 20, 15, north), leg2 = line(leg1[15], 20, 10, east), leg3 = line(leg2[10], 20, 10, north);
const pts = [...leg1, ...leg2.slice(1), ...leg3.slice(1)];
const r = N.build(pts, 180);

ok('route length ≈ 700 m', () => assert(Math.abs(r.len - 700) < 3, r.len));
ok('finds right turn at 300 m, left turn at 500 m, then arrive', () => {
  const m = N.maneuvers(r);
  assert.deepStrictEqual(m.map(x => x.type), ['right', 'left', 'arrive']);
  assert(Math.abs(m[0].at - 300) < 3 && Math.abs(m[1].at - 500) < 3, JSON.stringify(m));
});
ok('a straight road has no turns, only arrive', () => {
  assert.deepStrictEqual(N.maneuvers(N.build(line(A, 20, 30, north))).map(x => x.type), ['arrive']);
});
ok('small GPS-like wiggles are not turns', () => {
  const w = line(A, 20, 30, north).map((p, i) => i % 2 ? east(p, 2) : p);
  assert.deepStrictEqual(N.maneuvers(N.build(w)).map(x => x.type), ['arrive']);
});
ok('a gentle road curve (radius 150 m, 60° in total) is not announced as a turn', () => {
  const c = [A]; let h = 0; for (let i = 0; i < 40; i++) { if (i >= 10 && i < 26) h += 60 / 16; const p = c[c.length - 1], s = 10;
    c.push(east(north(p, s * Math.cos(h * Math.PI / 180)), s * Math.sin(h * Math.PI / 180))); }
  // 16 steps × 10 m = 160 m of arc for 60° ≈ radius 150 m
  assert.deepStrictEqual(N.maneuvers(N.build(c)).map(x => x.type), ['arrive']);
});
ok('U-turn detected', () => {
  const up = line(A, 20, 10, north), back = line(east(up[10], 8), 20, 10, (p, m) => north(p, -m));
  assert(N.maneuvers(N.build([...up, ...back])).some(x => x.type === 'uturn'));
});
ok('slight turn (~40°) is "slight"', () => {
  const a = line(A, 20, 10, north), b = line(a[10], 20, 10, (p, m) => east(north(p, m * 0.77), m * 0.64));
  const t = N.maneuvers(N.build([...a, ...b.slice(1)]))[0].type;
  assert(t === 'slight-right', t);
});
ok('progress: on the line → small offset, correct distance along', () => {
  const p = N.progress(r, east(north(A, 150), 6));
  assert(Math.abs(p.along - 150) < 3 && p.off < 7, JSON.stringify(p));
  const q = N.progress(r, east(leg2[5], 0));
  assert(Math.abs(q.along - 400) < 3 && q.off < 1, JSON.stringify(q));
});
ok('progress: 120 m away from the road is off the line', () => {
  assert(N.progress(r, east(north(A, 150), 120)).off > 100);
});
ok('next maneuver and distance to it', () => {
  const m = N.maneuvers(r), x = N.next(m, 120);
  assert(x.type === 'right' && Math.round(x.at - 120) === 180);
  assert(N.next(m, 690).type === 'arrive');
});
ok('off-route needs 3 bad fixes in a row; one jump is ignored', () => {
  const s = {};
  assert(!N.offRoute(s, 120, 10)); assert(!N.offRoute(s, 10, 10)); assert(!N.offRoute(s, 120, 10)); assert(!N.offRoute(s, 120, 10)); assert(N.offRoute(s, 120, 10));
  const t = {}; [1, 2, 3].forEach(() => N.offRoute(t, 60, 60)); assert(!t.bad, 'with poor accuracy the limit grows');
});
ok('announcements: 800 / 300 / 100 / now, each once; far call skipped when already close', () => {
  const man = { at: 1000, type: 'right' }, said = new Set();
  assert.strictEqual(N.due(man, 790, said), 800); assert.strictEqual(N.due(man, 700, said), null);
  assert.strictEqual(N.due(man, 290, said), 300); assert.strictEqual(N.due(man, 95, said), 100);
  assert.strictEqual(N.due(man, 20, said), 25); assert.strictEqual(N.due(man, 10, said), null);
  const s2 = new Set(); assert.strictEqual(N.due(man, 250, s2), 300);
});
ok('Tamil and English sentences', () => {
  assert.strictEqual(N.phrase('right', 200, 'ta'), '200 மீட்டரில் வலது பக்கம் திரும்புங்க');
  assert.strictEqual(N.phrase('left', 1540, 'ta'), '1.5 கிலோமீட்டரில் இடது பக்கம் திரும்புங்க');
  assert.strictEqual(N.phrase('uturn', 10, 'ta'), 'இப்போ U-turn எடுங்க');
  assert.strictEqual(N.phrase('right', 330, 'en'), 'In 350 metres, turn right');
  assert.strictEqual(N.phrase('arrive', 5, 'en'), 'You have arrived');
  assert.strictEqual(N.distTxt(80, 'ta'), '80 மீ'); assert.strictEqual(N.distTxt(2340, 'en'), '2.3 km');
  assert.strictEqual(N.distTxt(999.6, 'ta'), '1 கி.மீ'); assert.strictEqual(N.phrase('right', 990, 'en'), 'In 1 kilometre, turn right');
});
console.log(`${n} nav tests passed`);
