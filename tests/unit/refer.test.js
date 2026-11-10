// core/refer.js: referral code ⇄ mobile number, link reading, what is stored
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const w={};vm.runInNewContext(fs.readFileSync(__dirname+'/../../core/refer.js','utf8'),{window:w,URLSearchParams});const R=w.VCTREF;
let n=0;const t=(c,m)=>{assert.ok(c,m);n++};
for(const p of['9944039933','6000000000','9999999999','8220201462','7200730416']){const c=R.code(p);t(/^[0-9a-z]{6,10}$/.test(c)&&R.phone(c)===p,'round trip '+p)}
t(R.code('+91 99440 39933')===R.code('9944039933'),'+91 and spaces ignored');
t(R.code('12345')===''&&R.code('5944039933')===''&&R.code('')==='','bad numbers give no code');
const c=R.code('9944039933');
t(R.phone(c.toUpperCase())==='9944039933','capital letters accepted');
t(R.phone(c.slice(0,-1)+(c.slice(-1)==='a'?'b':'a'))===null,'one wrong character is refused (check part)');
t(R.phone('')===null&&R.phone(null)===null&&R.phone('<script>')===null&&R.phone('zzzzzzzzzzzzzzz')===null&&R.phone('abc')===null,'junk refused');
t(R.fromUrl('?ref='+c,'9999900001')==='9944039933','link read');
t(R.fromUrl('?ref='+c,'9944039933')===null,'own link is ignored');
t(R.fromUrl('?ref=%3Cimg%3E','9999900001')===null&&R.fromUrl('','9')===null&&R.fromUrl('?x=1','9')===null,'bad / missing ref');
t(R.clean('99440 39933','9999900001')==='+919944039933','typed number stored as +91…');
t(R.clean('9944039933','+919944039933')===''&&R.clean('12345','9999900001')===''&&R.clean('<b>','9')===''&&R.clean('','9')==='','own / bad / empty → nothing stored');
console.log(n+' refer tests passed');
