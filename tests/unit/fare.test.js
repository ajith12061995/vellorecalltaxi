// node tests/unit/fare.test.js
const F=require('../../core/fare.js');const assert=require('assert');let n=0;const ok=(name,fn)=>{fn();n++;console.log('PASS',name)};
ok('local: fare only',()=>{const r=F.final({fare:190,tariff:{t:'local'}},{});assert.equal(r.total,190);assert.equal(r.trip,190)});
ok('local: old booking without tariff',()=>{assert.equal(F.final({fare:250},{toll:0}).total,250)});
ok('local: toll + parking are pass-through',()=>{const r=F.final({fare:190,tariff:{t:'local'}},{toll:65,parking:20});assert.equal(r.trip,190);assert.equal(r.pass,85);assert.equal(r.total,275)});
ok('local: waiting charge after free minutes',()=>{const r=F.final({fare:190,tariff:{t:'local',wait:2,free:3}},{waitMin:10});assert.equal(r.trip,190+14)});
ok('local: waiting off when rate 0',()=>{assert.equal(F.final({fare:190,tariff:{t:'local',wait:0}},{waitMin:30}).total,190)});
const rent={fare:1149,tariff:{t:'rent',h:4,km:40,price:1149,xkm:13,xhr:170}};
ok('rental within package',()=>{assert.equal(F.final(rent,{km:38,mins:235}).total,1149)});
ok('rental grace 10 min',()=>{assert.equal(F.final(rent,{km:40,mins:250}).total,1149)});
ok('rental extra km and time',()=>{const r=F.final(rent,{km:62,mins:300});assert.equal(r.trip,1149+22*13+2*85)});
const one={fare:2190,tariff:{t:'out',otype:'one',km:140,days:1,rate:12,bata:300,min1:80,mind:250,daykm:400,longKm:400,longPct:0}};
ok('outstation one-way: actual below quote keeps quote',()=>{assert.equal(F.final(one,{km:120}).trip,2190)});
ok('outstation one-way: actual above quote charges extra',()=>{const r=F.final(one,{km:180,toll:150});assert.equal(r.trip,F.r10(180*12+300));assert.equal(r.total,F.r10(180*12+300)+150)});
const round={fare:6600,tariff:{t:'out',otype:'round',km:140,days:2,rate:12,bata:300,min1:80,mind:250,daykm:400}};
ok('outstation round: minimum km per day',()=>{assert.equal(F.final(round,{km:300}).trip,6600)});
ok('outstation round: extra day',()=>{const r=F.final(round,{km:300,days:3});assert.equal(r.trip,F.r10(750*12+900))});
ok('commission on trip only',()=>{assert.equal(F.comm(1149+22*13,10),144)});
ok('billOf / tripOf',()=>{assert.equal(F.billOf({fare:100}),100);assert.equal(F.billOf({fare:100,fareFinal:150}),150);assert.equal(F.tripOf({fare:100,fareFinal:150,fx:{trip:120}}),120)});
ok('garbage input never NaN',()=>{const r=F.final({fare:'abc',tariff:{t:'rent',h:'x'}},{km:'-5',toll:'abc'});assert.ok(isFinite(r.total))});
const IST=(h,m)=>Date.UTC(2026,10,4,h,m)-19800000, NC={on:true,from:'22:00',to:'05:00',pct:25};
ok('night: 22:00–05:00 Indian time, crossing midnight',()=>{assert.deepEqual([[21,59],[22,0],[23,30],[0,0],[4,59],[5,0],[12,0]].map(([h,m])=>F.nightPct(NC,IST(h,m))),[0,25,25,25,25,0,0])});
ok('night: off, bad hours, 0 % or same from/to → no charge; % capped at 100',()=>{
  assert.equal(F.nightPct({...NC,on:false},IST(23,0)),0);assert.equal(F.nightPct({...NC,from:'25:00'},IST(23,0)),0);
  assert.equal(F.nightPct({...NC,pct:0},IST(23,0)),0);assert.equal(F.nightPct({...NC,to:'22:00'},IST(23,0)),0);
  assert.equal(F.nightPct(null,IST(23,0)),0);assert.equal(F.nightPct({...NC,pct:500},IST(23,0)),100)});
ok('night: a window inside one day (e.g. 05:00–09:00) also works',()=>{const c={on:true,from:'05:00',to:'09:00',pct:10};assert.equal(F.nightPct(c,IST(6,0)),10);assert.equal(F.nightPct(c,IST(23,0)),0)});
ok('night: fare +25 % rounded to ₹5',()=>{assert.equal(F.withNight(190,25),240);assert.equal(F.withNight(100,25),125);assert.equal(F.withNight(190,0),190)});
ok('night: final bill shows the night line, total unchanged; commission base unchanged',()=>{
  const r=F.final({fare:240,tariff:{t:'local',night:25,nightAmt:50}},{toll:20});
  assert.deepEqual(r.lines.map(l=>[l.k,l.amt]),[['fare',190],['night',50],['toll',20]]);assert.equal(r.trip,240);assert.equal(r.total,260)});
ok('night: a broken nightAmt never changes the total',()=>{assert.equal(F.final({fare:190,tariff:{t:'local',night:25,nightAmt:999}},{}).total,190)});
ok('server copy of the night rule matches the apps (every 7 min over 2 days, several windows)',()=>{const S=require('../../functions/lib/logic.js');
  const cs=[NC,{on:true,from:'05:00',to:'09:30',pct:10},{on:true,from:'23:45',to:'00:15',pct:40},{on:false,from:'22:00',to:'05:00',pct:25}];
  for(const c of cs)for(let t=IST(0,0);t<IST(0,0)+2*864e5;t+=7*6e4)assert.equal(S.nightPct(c,t),F.nightPct(c,t));
  for(const f of [0,95,190,333,1000])for(const p of [0,10,25,33])assert.equal(S.withNight(f,p),F.withNight(f,p))});

// ---- Auto: Tamil Nadu Government fare (G.O. Ms. No. 366, 27 Oct 2026) + local area; must match the server copy
const SL=require('../../functions/lib/logic.js');
ok('auto govt fare: ₹50 up to 1.8 km, ₹25/km after',()=>{const a={id:'auto'};assert.equal(F.cityFare(a,0.5),50);assert.equal(F.cityFare(a,1.8),50);assert.equal(F.cityFare(a,2.8),75);assert.equal(F.cityFare(a,10),255);assert.equal(F.cityFare(a,3.3),Math.round(50+25*1.5))});
ok('auto ignores office base/per',()=>{assert.equal(F.cityFare({id:'auto',base:40,per:16},5),130)});
ok('cars unchanged (₹5 rounding, 1.5 km)',()=>{assert.equal(F.cityFare({id:'sedan',base:130,per:19},5),Math.round((130+19*3.5)/5)*5)});
ok('auto night 1.5× 22:00–05:00 even when office night is off',()=>{assert.equal(F.nightFor('auto',null,IST(23,0)),50);assert.equal(F.nightFor('auto',null,IST(4,0)),50);assert.equal(F.nightFor('auto',null,IST(5,0)),0);assert.equal(F.nightFor('auto',null,IST(12,0)),0);assert.equal(F.withNightV('auto',130,50),195)});
ok('cars keep the office night setting',()=>{assert.equal(F.nightFor('sedan',null,IST(23,0)),0);assert.equal(F.nightFor('sedan',{on:true,from:'22:00',to:'05:00',pct:25},IST(23,0)),25)});
ok('client and server use the same Government auto fare + area',()=>{assert.deepStrictEqual(F.AUTO_GOVT,SL.AUTO_GOVT);assert.deepStrictEqual(F.AREA,SL.AREA);for(const km of [0,1,1.8,2,3.3,7.7,18,25])assert.equal(F.cityFare({id:'auto'},km),SL.autoFare(km))});
ok('local area: Katpadi/VIT inside 18 km, Arcot/Gudiyatham outside',()=>{assert.ok(F.fromCentre({lat:12.9690,lon:79.1440})<18);assert.ok(F.fromCentre({lat:12.9692,lon:79.1559})<18);assert.ok(F.fromCentre({lat:12.9063,lon:79.3189})>18);assert.ok(F.fromCentre({lat:12.9450,lon:78.8720})>18)});
console.log(n,'fare tests passed');
