// node tests/unit/seopages.test.js — search landing pages (/taxi/…) are in sync with tools/seo_pages.py and safe
const assert = require('assert'), fs = require('fs'), path = require('path'), cp = require('child_process');
const R = path.join(__dirname, '../..'); let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
const dirs = fs.readdirSync(path.join(R, 'taxi')).filter(d => fs.existsSync(path.join(R, 'taxi', d, 'index.html')));
const rd = d => fs.readFileSync(path.join(R, 'taxi', d, 'index.html'), 'utf8');
ok('pages and sitemap match the generator', () => { assert.strictEqual(cp.execFileSync('python3', [path.join(R, 'tools/seo_pages.py'), '--check']).toString().trim(), 'in sync'); });
ok('at least seven pages, each in the sitemap with its own canonical URL', () => {
  assert.ok(dirs.length >= 7); const sm = fs.readFileSync(path.join(R, 'sitemap.xml'), 'utf8');
  for (const d of dirs) { const u = `https://velloretaxi.app/taxi/${d}/`; assert.ok(sm.includes(`<loc>${u}</loc>`), d); assert.ok(rd(d).includes(`<link rel="canonical" href="${u}">`), d); }
});
ok('anti-clickjacking guard first in <head>; indexable; one h1; title and description present', () => {
  for (const d of dirs) { const s = rd(d), i = s.indexOf('<head>');
    assert.ok(s.slice(i, i + 200).includes('anti-clickjacking'), d); assert.ok(s.includes('content="index,follow'), d);
    assert.strictEqual((s.match(/<h1>/g) || []).length, 1, d); assert.match(s, /<title>[^<]{20,70}<\/title>/, d); assert.match(s, /<meta name="description" content="[^"]{80,170}">/, d); }
});
ok('no car price is written into the pages: only the Government auto fare (₹50, ₹25, ₹1) appears as text', () => {
  for (const d of dirs) { const body = rd(d).replace(/<script[\s\S]*?<\/script>/g, ''); const nums = (body.match(/₹\s?[\d,]+/g) || []).map(x => x.replace(/[₹\s,]/g, ''));
    assert.ok(nums.every(x => ['50', '25', '1'].includes(x)), d + ': ' + nums.join(',')); }
});
ok('structured data is valid JSON with TaxiService, BreadcrumbList and FAQPage', () => {
  for (const d of dirs) { const m = rd(d).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/); const j = JSON.parse(m[1]);
    assert.deepStrictEqual(j['@graph'].map(x => x['@type']), ['TaxiService', 'BreadcrumbList', 'FAQPage'], d); }
});
ok('fare tables use the app prices and rules (seo.js built-ins equal the website built-ins)', () => {
  const a = fs.readFileSync(path.join(R, 'taxi/seo.js'), 'utf8').match(/const P0 = (\{[\s\S]*?\});\n/)[1], b = fs.readFileSync(path.join(R, 'vellore/site.js'), 'utf8').match(/const PRICES0 = (\{[\s\S]*?\});\n/)[1];
  assert.deepStrictEqual(eval('(' + a + ')'), eval('(' + b + ')'));
});
console.log(`RESULT PASS ${n}/${n}`);
