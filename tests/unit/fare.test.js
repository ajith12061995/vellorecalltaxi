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
ok('outstation categories: A ≤100, B ≤150, C beyond; owner limits; same as server',()=>{assert.equal(F.outCat(40),'A');assert.equal(F.outCat(100),'A');assert.equal(F.outCat(101),'B');assert.equal(F.outCat(151),'C');assert.equal(F.outCat(90,{a:80,b:120}),'B');
  for(const km of [19,80,99,100,101,150,151,400])for(const cat of [null,{a:80,b:120},{a:120,b:100}])assert.equal(F.outCat(km,cat),SL.outCat(km,cat));
  assert.equal(F.catBata({A:{mini:450}},'A','mini',300),450);assert.equal(F.catBata({A:{mini:0}},'A','mini',300),300);assert.equal(SL.catBata({B:{sedan:500}},'B','sedan',300),500)});

// ---- Category-A round trip: hours in the price + extra time (Arani ~40 km each way)
ok('A hours table: 30→3, 31–90→4, 91–140→5, 141–180→6, 181–200→7, then +1 per 35 km; same as server',()=>{
  assert.deepEqual([20,30,31,80,90,91,140,141,180,181,200,201,235,236].map(k=>F.aHours(k)),[3,3,4,4,4,5,5,6,6,7,7,8,8,9]);
  const own=[{km:50,h:2},{km:100,h:5}];assert.equal(F.aHours(40,own),2);assert.equal(F.aHours(60,own),5);assert.equal(F.aHours(101,own),6);
  for(const k of [0,25,80,90,91,199,260])for(const t of [null,own,[[90,4]],[{km:0,h:1}],'x'])assert.equal(F.aHours(k,t),SL.aHours(k,t));
  assert.deepStrictEqual(F.AXH,SL.AXH);assert.deepStrictEqual(F.AHRS,SL.AHRS)});
ok('planned hours: 15 min free, then half hours; same as server',()=>{const H=36e5,w=1e12;
  assert.deepEqual([4*H,4*H+15*6e4,4*H+16*6e4,4.5*H,12*H].map(d=>F.planHours(w,w+d)),[4,4,4.5,4.5,12]);assert.equal(F.planHours(w,0),0);assert.equal(F.planHours(0,w),0);
  for(const d of [0,1,9e5,4*H+1,30*H])assert.equal(F.planHours(w,w+d),SL.planHours(w,w+d))});
const aT={t:'out',otype:'round',km:40,days:1,rate:11,bata:100,min1:80,mind:0,cat:'A',ph:4,xh:80,plan:4,hx:0},aB={fare:980,tariff:aT};
ok('A within 4 hrs + 15 min grace: booked fare only',()=>{assert.equal(F.final(aB,{km:80,mins:240}).trip,980);assert.equal(F.final(aB,{km:80,mins:255}).trip,980)});
ok('A late: per started half hour at half the hourly price',()=>{assert.equal(F.final(aB,{km:80,mins:256}).trip,1020);assert.equal(F.final(aB,{km:80,mins:285}).trip,1020);assert.equal(F.final(aB,{km:80,mins:286}).trip,1060);
  const r=F.final(aB,{km:80,mins:720,toll:60});assert.equal(r.trip,1620);assert.equal(r.pass,60);assert.ok(r.lines.some(l=>l.k==='xhr'&&l.amt===640&&/8 hrs/.test(l.en)))});
ok('A booked 12 hrs: hours already in the quote, nothing extra until past 12 h 15 m',()=>{const b={fare:1620,tariff:{...aT,plan:12,hx:640}};
  assert.equal(F.final(b,{km:80,mins:735}).trip,1620);assert.equal(F.final(b,{km:80,mins:736}).trip,1660);assert.equal(F.final(b,{km:85,mins:700}).trip,F.r10(85*11+100+640))});
ok('old bookings without hours: unchanged',()=>{const b={fare:980,tariff:{...aT,ph:undefined,xh:undefined}};assert.equal(F.final(b,{km:80,mins:720}).trip,980)});
ok('hours text',()=>{assert.equal(F.hrsTxt(1.5,'ta'),'1 மணி 30 நிமி');assert.equal(F.hrsTxt(8,'en'),'8 hrs');assert.equal(F.hrsTxt(1,'en'),'1 hr');assert.equal(F.hrsTxt(0.5,'en'),'30 min')});
ok('server: A quote with planned hours accepted; missing hours corrected; tampered ph/xh corrected',()=>{const H=36e5,w=Date.parse('2026-11-25T02:30:00Z'),c={out:{rate:{mini:11},bata:{mini:100}}};
  const base={kind:'outstation',veh:'mini',from:{lat:12.9165,lon:79.1325},to:{lat:12.6693,lon:79.2856},when:w,otype:'round',retAt:w+4*H,fare:980,tariff:aT};
  assert.equal(SL.outCheck(base,c),null);
  const late=SL.outCheck({...base,retAt:w+12*H},c);assert.equal(late.fare,1620);assert.equal(late.tariff.plan,12);assert.equal(late.tariff.hx,640);
  assert.equal(SL.outCheck({...base,retAt:w+12*H,fare:1620,tariff:{...aT,plan:12,hx:640}},c),null);
  const cheat=SL.outCheck({...base,tariff:{...aT,ph:9,xh:1}},c);assert.equal(cheat.tariff.ph,4);assert.equal(cheat.tariff.xh,80);
  const own=SL.outCheck(base,{out:{...c.out,xh:{mini:100},hrs:[{km:60,h:2},{km:200,h:6}]}});assert.equal(own.tariff.ph,6);assert.equal(own.tariff.xh,100);
  const old={...base,tariff:{...aT}};delete old.tariff.ph;delete old.tariff.xh;delete old.tariff.plan;delete old.tariff.hx;const fx=SL.outCheck(old,c);assert.equal(fx.fare,980);assert.equal(fx.tariff.ph,4);assert.equal(fx.tariff.xh,80)});
ok('km in base: office incl (0.5–10), else 1.5; same as server',()=>{
  assert.equal(F.cityFare({id:'mini',base:110,per:20,incl:3},2),110);assert.equal(F.cityFare({id:'mini',base:110,per:20,incl:3},5),150);assert.equal(F.cityFare({id:'mini',base:110,per:20,incl:3},10),250);
  assert.equal(F.cityFare({id:'mini',base:105,per:19},5),170);for(const bad of [0,-1,11,'x',null])assert.equal(F.inclKm({incl:bad}),1.5);
  assert.equal(F.cityFare({id:'auto',base:1,per:1,incl:5},5),130,'auto ignores incl');
  for(const v of [{incl:3},{incl:0.5},{incl:10},{},{incl:'abc'},{incl:20}])assert.equal(F.inclKm(v),SL.inclKm(v));
  const c={fares:{mini:{base:110,per:20,incl:3}}},b={src:'app',kind:'ride',veh:'mini',km:5,from:{lat:12.9165,lon:79.1325},to:{lat:12.9165,lon:79.1325}};
  assert.equal(SL.fareCheck({...b,fare:150},c,Date.UTC(2026,10,20,6,0)),null,'server accepts the 3 km base price');
  assert.ok(SL.fareCheck({...b,fare:100},c,Date.UTC(2026,10,20,6,0)),'server corrects a too-low fare');
  assert.equal(SL.fareLooksWrong({...b,fare:150},c.fares),false)});
console.log(n,'fare tests passed');
