// node tests/unit/pagesec.test.js — page-level protections stay in place on every app page
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../..'); let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
const rd = p => fs.readFileSync(path.join(R, p), 'utf8');
const PAGES = ['index.html', 'driver/index.html', 'office/index.html', 'driver/join/index.html'];
ok('every third-party script / stylesheet is pinned with an integrity hash (Leaflet 1.9.4 from npm)', () => {
  for (const p of PAGES) {
    const s = rd(p);
    for (const tag of s.match(/<(script|link)[^>]*(src|href)="https:\/\/unpkg\.com[^>]*>/g) || []) {
      assert.match(tag, /integrity="sha256-[A-Za-z0-9+/=]{44}"/, p + ': ' + tag);
      assert.match(tag, /crossorigin=""/, p + ': ' + tag);
    }
  }
  const s = rd('index.html');
  assert.ok(s.includes('sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='), 'leaflet.js hash');
  assert.ok(s.includes('sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='), 'leaflet.css hash');
});
ok('anti-clickjacking guard is the first thing in <head> on every app page', () => {
  for (const p of PAGES) { const s = rd(p); const i = s.indexOf('<head>'); assert.ok(s.slice(i, i + 200).includes('anti-clickjacking'), p); }
});
ok('the guard hides the page inside a foreign frame but not on localhost (tests)', () => {
  const g = rd('office/index.html').match(/<script>\/\* anti-clickjacking[^<]*<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const run = (host, framed) => { const doc = { documentElement: { style: {} } }, self = { location: { href: 'x' } }, top = framed ? { location: 'y' } : self;
    new Function('window', 'document', 'location', g)({ top, self }, doc, { hostname: host }); return doc.documentElement.style.display; };
  assert.strictEqual(run('velloretaxi.app', true), 'none');
  assert.strictEqual(run('velloretaxi.app', false), undefined);
  assert.strictEqual(run('localhost', true), undefined);
});
ok('office and driver pages are kept out of search engines', () => {
  for (const p of ['office/index.html', 'driver/index.html']) assert.match(rd(p), /<meta name="robots" content="noindex/, p);
});
console.log(`RESULT PASS ${n}/${n}`);
