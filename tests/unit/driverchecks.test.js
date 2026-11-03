// node tests/unit/driverchecks.test.js
const C=require('../../core/driverchecks.js');const assert=require('assert');let n=0;const ok=(t,f)=>{f();n++;console.log('PASS',t)};
const now=Date.parse('2026-11-03T10:00:00Z'),Y=365*864e5;
const good={id:'+919876500000',phone:'+919876500000',name:'Murugan K',dlNo:'TN23 20190001234',ecName:'Lakshmi',ecPhone:'+919876511111',plate:'TN 23 CK 4455',year:2021,ownVehicle:true,upi:'murugan@okaxis',
  files:['photo','aadhaarF','aadhaarB','dlF','dlB','rcF','rcB','ins','vehF','permit','fc','pcc'],exp:{dl:now+5*Y,ins:now+Y,permit:now+2*Y,fc:now+Y},consent:{v:C.AGREEMENT.v,name:'Murugan K',at:now}};
ok('complete application passes with no warnings',()=>{const r=C.check(good,[],now);assert.equal(r.bad,0);assert.equal(r.warn,0)});
ok('plate formats',()=>{['TN 23 AB 1234','TN23Q7788','KA01AB1234','22BH1234AA'].forEach(p=>assert.ok(C.plateOk(p),p));['TN 23','1234','ABCDEFG'].forEach(p=>assert.ok(!C.plateOk(p),p))});
ok('licence formats',()=>{['TN23 20190001234','TN2320190001234','TN-23-2019-0001234'].forEach(d=>assert.ok(C.dlOk(d),d));['12345','TN23'].forEach(d=>assert.ok(!C.dlOk(d),d))});
ok('expired insurance blocks',()=>{const r=C.check({...good,exp:{...good.exp,ins:now-864e5}},[],now);assert.ok(r.items.some(i=>i.k==='x_ins'&&i.level==='bad'))});
ok('insurance ending in 20 days only warns',()=>{const r=C.check({...good,exp:{...good.exp,ins:now+20*864e5}},[],now);assert.equal(r.bad,0);assert.ok(r.items.some(i=>i.k==='x_ins'&&i.level==='warn'))});
ok('no permit/FC/police only warns',()=>{const r=C.check({...good,files:good.files.filter(f=>!['permit','fc','pcc'].includes(f)),exp:{dl:good.exp.dl,ins:good.exp.ins}},[],now);assert.equal(r.bad,0);assert.ok(r.warn>=3)});
ok('missing agreement blocks',()=>{const r=C.check({...good,consent:null},[],now);assert.ok(r.items.some(i=>i.k==='consent'&&i.level==='bad'))});
ok('emergency contact = own number blocks',()=>{assert.ok(C.check({...good,ecPhone:good.phone},[],now).items.some(i=>i.k==='ec'&&i.level==='bad'))});
ok('duplicate plate / licence with an existing driver blocks',()=>{const r=C.check(good,[{id:'+919000000001',name:'Ravi',plate:'TN23CK4455',dlNo:'TN2320190001234'}],now);assert.ok(r.items.some(i=>i.k==='dupPlate'));assert.ok(r.items.some(i=>i.k==='dupDl'))});
ok('old vehicle only warns',()=>{const r=C.check({...good,year:2010},[],now);assert.equal(r.bad,0);assert.ok(r.items.some(i=>i.k==='year'&&i.level==='warn'))});
ok('signature must match the name (English or Tamil)',()=>{assert.ok(C.sameName('murugan k','Murugan K'));assert.ok(!C.sameName('Ravi','Murugan K'));assert.ok(C.sameName('முருகன் கே','முருகன் கே'))});
ok('agreement has 10 points in both languages',()=>{assert.equal(C.AGREEMENT.ta.length,10);assert.equal(C.AGREEMENT.en.length,10)});
console.log(n,'driver check tests passed');
