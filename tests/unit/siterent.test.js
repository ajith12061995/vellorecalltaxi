// node tests/unit/siterent.test.js — website rental prices (vellore-next/rent.js) = the customer app's own rental code
const assert = require('assert'), fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../..'); let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };
const SR = require(path.join(R, 'vellore-next/rent.js'));
const app = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const grab = re => { const m = re.exec(app); assert.ok(m, 'not found in app: ' + re); return m[0]; };
const src = [grab(/const PKG=\[[^\n]*\];/), grab(/const RANCH=\[[^\n]*\];/), grab(/const RENT=\{[^\n]*\};/), grab(/const XKM=\{[^\n]*\};/),
  grab(/function rentPrice\(id,h\)\{[\s\S]*?return null\}/)].join('\n');
const APP = new Function(src + '\nreturn {PKG,RANCH,RENT,XKM,XHR,rentPrice};')();
ok('same packages, anchor hours and built-in prices as the app', () => {
  assert.deepStrictEqual(SR.PKG, APP.PKG); assert.deepStrictEqual(SR.RANCH, APP.RANCH); assert.deepStrictEqual(SR.RENT0, APP.RENT);
  assert.deepStrictEqual(SR.tables(null).XKM, APP.XKM); assert.deepStrictEqual(SR.tables(null).XHR, APP.XHR);
});
ok('every vehicle × every package: same price as the app', () => {
  for (const id of Object.keys(APP.RENT)) for (const p of APP.PKG) assert.strictEqual(SR.price(id, p.h, null), APP.rentPrice(id, p.h), id + ' ' + p.h + 'h');
});
ok('Office prices replace the built-in ones the way the app applies them', () => {
  const r = { price: { sedan: [399, 699, 1199, 2199, 3099], trav: [0, 0, 2600, 4100, 5600] }, xkm: { sedan: 14 } };
  const RENT = JSON.parse(JSON.stringify(APP.RENT)); RENT.sedan = r.price.sedan.slice(); RENT.trav = r.price.trav.map(x => +x > 0 ? +x : null);
  const P2 = new Function(src.replace(/const RENT=\{[^\n]*\};/, 'const RENT=' + JSON.stringify(RENT) + ';') + '\nreturn rentPrice;')();
  for (const id of ['sedan', 'trav', 'mini']) for (const p of APP.PKG) assert.strictEqual(SR.price(id, p.h, r), P2(id, p.h), id + ' ' + p.h);
  assert.strictEqual(SR.tables(r).XKM.sedan, 14);
});
console.log(n, 'passed');
