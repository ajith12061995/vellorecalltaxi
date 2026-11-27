# 27 Nov: no ride push reached the driver's phone — his driver record had no push token (the page trusted its own saved
# copy and never saved it again). The page now checks the record itself and saves the token; if it cannot, the reason
# goes into the phone report the office sees.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
BRIDGE="""(()=>{window.__calls=[];window.__can=%s;window.__take={action:null,id:null};let n=0;
 window.Capacitor={isNativePlatform:()=>true,
  nativePromise:(p,m,o)=>{__calls.push([p,m,o]);
    if(p==='BackgroundGeolocation'&&m==='checkPermissions')return Promise.resolve({location:'granted'});
    if(p==='PushNotifications'&&m==='checkPermissions')return Promise.resolve({receive:'granted'});
    if(p==='RideOverlay'&&m==='status')return Promise.resolve({can:window.__can});
    if(m==='checkPermissions')return Promise.resolve({location:'granted',receive:'granted'});
    if(p==='RideOverlay'&&m==='power')return Promise.resolve({free:false,maker:'realme'});
    if(p==='RideOverlay'&&m==='fsi')return window.__v17?Promise.resolve({can:window.__fsi!==false}):Promise.reject(new Error('not implemented'));
    if(p==='RideOverlay'&&m==='take'){const t=window.__take;window.__take={action:null,id:null};return Promise.resolve(t)}
    return Promise.resolve({})},
  nativeCallback:(p,m,o,cb)=>{__calls.push([p,m,o]);if(m==='addWatcher')window.__cb=cb;return String(++n)},
  addListener:(p,ev,cb)=>{__calls.push([p,'addListener',ev]);return{remove:async()=>{}}}};})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9716,'longitude':79.1590},permissions=['geolocation'],user_agent='Mozilla/5.0 (Linux; Android 16) VCTApp VCTPush')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,push:{vapid:'v-test'}})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        await df.evaluate(BRIDGE%'true');await df.evaluate("window.__v17=true;ovlInit()");await pg.wait_for_timeout(800)
        # the phone remembers a token, but the driver record has none (the 27 Nov state)
        await df.evaluate("localStorage.setItem('vct_fcm','tok-A');CL.nativePush=()=>true;CL.nativePushToken=async()=>'tok-A';PUSHTRY=0")
        await pg.evaluate("(()=>{const d=MOCK.store.get('drivers/+919999900002');delete d.fcm;MOCK.store.set('drivers/+919999900002',d)})()")
        await df.evaluate("ensurePush()");await pg.wait_for_timeout(1500)
        check('record without a token: the token is saved to the driver record',(await pg.evaluate("MOCK.store.get('drivers/+919999900002').fcm"))=='tok-A')
        n=await pg.evaluate("(()=>{window.__w=0;const f=MOCK.fs.updateDoc;MOCK.fs.updateDoc=function(r,d){if(d&&d.fcm)__w++;return f.apply(this,arguments)};return 1})()")
        await df.evaluate("PUSHTRY=0;ensurePush()");await pg.wait_for_timeout(800)
        check('record has the same token: nothing written again',await pg.evaluate("__w")==0)
        # a new token on the phone (reinstall): saved over the old one
        await df.evaluate("CL.nativePushToken=async()=>'tok-B';localStorage.setItem('vct_fcm','tok-B');PUSHTRY=0;ensurePush()");await pg.wait_for_timeout(1500)
        check('phone has a different token than the record: record updated',(await pg.evaluate("MOCK.store.get('drivers/+919999900002').fcm"))=='tok-B')
        # no token from the phone: the reason reaches the office (phone report)
        await pg.evaluate("MOCK.fs.updateDoc({path:'drivers/+919999900002'},{fcm:null})");await pg.wait_for_timeout(800)
        await df.evaluate("CL.nativePushToken=async()=>null;PUSHTRY=0;ensurePush()");await pg.wait_for_timeout(2500)
        dv=await pg.evaluate("(MOCK.store.get('drivers/+919999900002')||{}).dev||{}")
        check('no token from the phone: the office sees why (notoken)','notoken' in str(dv.get('notif','')),dv)
        # push not set up in Office Settings: says so
        await pg.evaluate("MOCK.fs.setDoc({path:'config/app'},{comm:0,minbal:100})");await pg.wait_for_timeout(800)
        await df.evaluate("PUSHTRY=0;ensurePush()");await pg.wait_for_timeout(2500)
        dv=await pg.evaluate("(MOCK.store.get('drivers/+919999900002')||{}).dev||{}")
        check('push not switched on in Office Settings: no reason invented, nothing tried',not any(x in str(dv.get('notif','')) for x in ('nocfg','noua')),dv)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
