// node tests/unit/geo.test.js — geohash encode + 3x3 cover
const fs=require('fs');const src=fs.readFileSync(__dirname+'/../../core/geo.js','utf8');
const VGEO=new Function(src+';return VGEO;')();const assert=require('assert');
assert.equal(VGEO.gh(57.64911,10.40744,11),'u4pruydqqvj'); // reference value from the geohash spec
assert.equal(VGEO.gh(12.9165,79.1325,5).length,5);
const c=VGEO.cells(12.9165,79.1325);assert.equal(c.length,9);
// every point within 4 km of the centre falls in one of the 9 cells
const hav=(a,b)=>{const R=6371,r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lon-a.lon)*r;const x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))};
let n=0;for(let i=0;i<5000;i++){const p={lat:12.9165+(Math.random()-.5)*0.08,lon:79.1325+(Math.random()-.5)*0.08};if(hav(p,{lat:12.9165,lon:79.1325})<=4){n++;assert.ok(c.includes(VGEO.gh(p.lat,p.lon,5)),'missed '+JSON.stringify(p))}}
console.log('PASS geohash spec value, 9 cells, cover of',n,'random points within 4 km');
