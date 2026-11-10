// core/otp.js: finding the code in SMS texts, and the Android SMS reader bridge (no app / older app / app)
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const load=(C)=>{const w={Capacitor:C};vm.runInNewContext(fs.readFileSync(__dirname+'/../../core/otp.js','utf8'),{window:w,console});return w.VCTOTP};
let n=0;const t=(c,m)=>{assert.ok(c,m);n++};
(async()=>{
  const O=load();
  t(O.code('123456 is your verification code for velloretaxi.app.')==='123456','Firebase SMS');
  t(O.code('Your code: 654321')==='654321','code at end');
  t(O.code('1234567 is not it')===null,'7 digits is not a code');
  t(O.code('+91 99446 40416 code 112233')==='112233','phone digits ignored');
  t(O.code('')===null&&O.code(null)===null,'empty');
  t(O.native()===null,'browser: no SMS reader');
  const calls=[];const app=load({isNativePlatform:()=>true,nativePromise:(p,m)=>{calls.push(p+'.'+m);return Promise.resolve({code:'123456'})}});
  t(await app.native()==='123456'&&calls[0]==='SmsOtp.start','app: code from the plugin');
  const bad=load({isNativePlatform:()=>true,nativePromise:()=>Promise.resolve({code:'12<b>'})});
  t(await bad.native()===null,'app: anything but 6 digits is ignored');
  const old=load({isNativePlatform:()=>true,nativePromise:()=>Promise.reject(new Error('not implemented'))});
  t(await old.native()===null,'older app without the plugin: null, no error');
  const web=load({isNativePlatform:()=>false,nativePromise:()=>{throw 1}});
  t(web.native()===null,'Capacitor present but not native: null');
  console.log(n+' otp tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
