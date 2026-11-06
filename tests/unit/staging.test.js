// node tests/unit/staging.test.js — the TEST copy (staging/) is the same code as live, and test/live never mix
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../..'); let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
const rd = p => fs.readFileSync(path.join(R, p), 'utf8');
const strip = s => s.replace('<meta name="robots" content="noindex,nofollow">', '');
ok('every app page in staging/ equals the live page (only noindex added)', () => {
  for (const p of ['index.html', 'driver/index.html', 'driver/join/index.html', 'office/index.html', 'privacy/index.html', 'join/index.html']) {
    const s = rd('staging/' + p); assert.ok(s.includes('noindex'), p + ' noindex'); assert.strictEqual(strip(s), rd(p), p + ' differs: run python3 tools/bump.py');
  }
  for (const p of ['vct-cloud.js', 'firebase-config.js', 'core/fare.js', 'core/map.js', 'version.json']) assert.strictEqual(rd('staging/' + p), rd(p), p);
});
// firebase-config.js picks the project from the address: load it with a fake location
const cfgFor = href => {
  const src = rd('firebase-config.js').replace(/export const /g, 'const ') + '\nreturn { VCT_ENV, firebaseConfig, APPCHECK_SITE_KEY };';
  const u = new URL(href); return new Function('location', src)({ href, hostname: u.hostname });
};
ok('live address → live project; /staging/, localhost → never the live project', () => {
  const live = cfgFor('https://velloretaxi.app/office/');
  assert.strictEqual(live.VCT_ENV, 'production'); assert.strictEqual(live.firebaseConfig.projectId, 'vellore-taxi23');
  for (const h of ['https://velloretaxi.app/staging/', 'https://velloretaxi.app/staging/driver/', 'http://localhost:8765/', 'http://127.0.0.1/x']) {
    const c = cfgFor(h); assert.strictEqual(c.VCT_ENV, 'staging', h);
    assert.ok(!c.firebaseConfig || c.firebaseConfig.projectId !== 'vellore-taxi23', h + ' must not use live data');
    assert.strictEqual(c.APPCHECK_SITE_KEY, '', h + ' app check off on test');
    assert.strictEqual(c.firebaseConfig.projectId, 'vellore-taxi-staging', h + ' uses the TEST project');
  }
});
console.log(`RESULT PASS ${n}/${n}`);
