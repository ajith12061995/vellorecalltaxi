// functions/lib/weather.js (forecast → summary, polite request) and core/weather.js (the line shown in the apps)
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const W=require('../../functions/lib/weather');
const w={};vm.runInNewContext(fs.readFileSync(__dirname+'/../../core/weather.js','utf8'),{window:w});const X=w.VCTWX;
let n=0;const t=(c,m)=>{assert.ok(c,m);n++};
const T0=Date.parse('2026-11-10T08:00:00Z');
const hr=(k,temp,sym,mm)=>({time:new Date(T0+k*3600e3).toISOString(),data:{instant:{details:{air_temperature:temp}},next_1_hours:{summary:{symbol_code:sym},details:{precipitation_amount:mm}}}});
const fc=(...h)=>({properties:{timeseries:h}});
(async()=>{
  let s=W.summary(fc(hr(0,29.4,'partlycloudy_day',0),hr(1,29,'cloudy',0),hr(2,28,'cloudy',0)),T0+20*60000);
  t(s&&s.kind==='ok'&&s.t===29.4&&s.r1===0&&!s.heavy,'dry');
  s=W.summary(fc(hr(0,27,'rain',1.2),hr(1,27,'rain',2),hr(2,26,'cloudy',0)),T0+5*60000);
  t(s.kind==='rain'&&s.r1===1.2&&s.r3===3.2&&!s.heavy,'rain now');
  s=W.summary(fc(hr(0,26,'heavyrainandthunder',9),hr(1,26,'rain',2)),T0);t(s.kind==='rain'&&s.heavy,'heavy rain');
  s=W.summary(fc(hr(0,30,'cloudy',0),hr(1,29,'rainshowers_day',1.5),hr(2,28,'rain',1)),T0+10*60000);t(s.kind==='soon','rain in the next hours');
  s=W.summary(fc(hr(0,38.2,'clearsky_day',0),hr(1,38,'clearsky_day',0)),T0);t(s.kind==='hot','hot');
  s=W.summary(fc(hr(-1,25,'rain',3),hr(0,30,'cloudy',0),hr(1,30,'cloudy',0)),T0+59*60000);t(s.kind==='ok'&&s.t===30,'uses the hour we are in, not the past one');
  s=W.summary(fc(hr(0,30,'lightrain',0.1)),T0);t(s.kind==='soon','drizzle forecast (0.1 mm) is "rain likely", not "raining now"');
  s=W.summary(fc(hr(0,30,'lightrain',0.4)),T0);t(s.kind==='rain','0.4 mm in this hour is rain');
  t(W.summary(fc(hr(0,30,'cloudy',0)),T0+5*3600e3)===null,'forecast too old → nothing');
  t(W.summary(null,T0)===null&&W.summary({},T0)===null&&W.summary(fc(),T0)===null&&W.summary(fc({time:'x'}),T0)===null,'bad data → nothing');
  t(W.summary(fc(hr(0,'<b>','x',0)),T0)===null&&W.summary(fc(hr(0,99,'x',0)),T0)===null,'bad temperature → nothing');
  // request rules: User-Agent names us, ≤ 4 decimals, If-Modified-Since
  const m=W.URL.match(/lat=([\d.]+)&lon=([\d.]+)/);t(m&&(m[1].split('.')[1]||'').length<=4&&(m[2].split('.')[1]||'').length<=4,'≤ 4 decimals');
  t(/velloretaxi\.app/.test(W.UA),'User-Agent names the site');
  let seen;const fake=(st,body,lm)=>async(u,o)=>{seen={u,o};return{status:st,json:async()=>body,headers:{get:()=>lm}}};
  let r=await W.get(fake(200,{a:1},'Tue, 10 Nov 2026 08:00:00 GMT'),'');t(r.status===200&&r.data.a===1&&r.lastMod.startsWith('Tue')&&!('If-Modified-Since' in seen.o.headers)&&seen.o.headers['User-Agent']===W.UA,'first request');
  r=await W.get(fake(304),'Tue, 10 Nov 2026 08:00:00 GMT');t(r.status===304&&seen.o.headers['If-Modified-Since'].startsWith('Tue'),'unchanged');
  r=await W.get(fake(429),'');t(r.status===429&&!r.data,'refused');
  // the line in the apps
  const now=T0,d=(o)=>({at:now-5*60000,t:28.6,kind:'ok',heavy:false,...o});
  let l=X.line(d(),now,'customer');t(l&&l.ta==='⛅ வேலூர் · 29°C'&&l.en==='⛅ Vellore · 29°C','plain line');
  l=X.line(d({kind:'rain'}),now,'customer');t(/மழை பெய்யுது · 29°C/.test(l.ta)&&/taxi/.test(l.ta)&&/Raining now/.test(l.en),'customer rain');
  l=X.line(d({kind:'rain',heavy:true}),now,'driver');t(/கன மழை/.test(l.ta)&&/Booking/.test(l.ta)&&/Drive slowly/.test(l.en),'driver heavy rain');
  l=X.line(d({kind:'soon'}),now,'driver');t(/மழை வரலாம்/.test(l.ta)&&/More bookings/.test(l.en),'driver rain soon');
  l=X.line(d({kind:'hot',t:38}),now,'driver');t(/38°C/.test(l.ta)&&/தண்ணி/.test(l.ta),'driver hot');
  t(X.line(d({at:now-101*60000}),now,'customer')===null,'older than 100 minutes → no line');
  t(X.line(null,now)===null&&X.line({},now)===null&&X.line(d({t:'29'}),now)===null&&X.line(d({t:99}),now)===null&&X.line(d({at:'x'}),now)===null,'bad data → no line');
  l=X.line(d({kind:'<img src=x onerror=1>'}),now,'customer');t(l.kind==='ok'&&!/</.test(l.ta+l.en),'unknown kind is treated as plain');
  const h=X.html(d({kind:'<script>',t:30,sym:'<b>'}),now,'customer','ta');t(!/<script|<b>/.test(h)&&/id="wx"/.test(h)&&/MET Norway/.test(h),'html has only our text + credit');
  t(/hidden/.test(X.html(null,now,'customer','ta')),'no data → hidden placeholder');
  console.log(n+' weather tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
