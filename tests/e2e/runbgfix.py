# Android driver app (6 Nov field test): the "Online" location notification never appeared.
# 1) the plugin's service binds a moment after start → first addWatcher fails with "Service not running." → retry,
#    web GPS meanwhile, then switch back to the native watcher;  2) location permission is asked BEFORE the watcher
#    starts (Android 14+ refuses a location service started without it);  3) notification permission is asked;
# 4) Me → Settings shows the background-location state;  5) no web-push button inside the app (customer + driver).
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
FAKE="""(()=>{window.__log=[];window.__n=0;window.__bg=null;
 window.Capacitor={isNativePlatform:()=>true,Plugins:{PushNotifications:{checkPermissions:async()=>({receive:'prompt'}),requestPermissions:async()=>{__log.push('notif');return{receive:'granted'}}}},
  registerPlugin:(n)=>n==='PushNotifications'?window.Capacitor.Plugins.PushNotifications:({checkPermissions:async()=>({location:window.__locGranted?'granted':'prompt'}),requestPermissions:async()=>{__log.push('locperm');window.__locGranted=true;return{location:'granted'}},
   addWatcher:(o,cb)=>{__log.push('add'+(window.__locGranted?'+perm':'-noperm'));window.__n++;
     if(window.__n===1){setTimeout(()=>cb(null,{message:'Service not running.'}),10);return Promise.resolve('w1')}
     window.__bg={o,cb};return Promise.resolve('w'+window.__n)},removeWatcher:()=>Promise.resolve(),openSettings:()=>{}})};})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.95,'longitude':79.14},permissions=['geolocation'],user_agent='Mozilla/5.0 (Linux; Android 16) VCTApp')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100,push:{vapid:'BTESTKEY'}})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html');C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200)
        await df.evaluate(FAKE);await pg.evaluate(FAKE)
        await pg.evaluate("MOCK.fs.setDoc({path:'config/app'},{comm:10,minbal:100,push:{vapid:'BTESTKEY'}})");await pg.wait_for_timeout(1200)
        check('driver: no web-push button inside the Android app',not await df.evaluate("!!document.getElementById('pushon')"))
        await D.locator('#ons').click();await pg.wait_for_timeout(400)
        st=await df.evaluate("BGST");check('first try fails → retrying',st=='retry',st)
        check('web GPS keeps running meanwhile',await df.evaluate("GEO!=null"))
        await pg.wait_for_timeout(2500)
        log=await df.evaluate("__log")
        check('location permission asked before the first watcher',log[:2]==['locperm','notif'] or log[0]=='locperm',log)
        check('watcher retried with permission',log.count('add+perm')>=2,log)
        check('notification permission asked',('notif' in log),log)
        await df.evaluate("window.__bg.cb({latitude:12.9611,longitude:79.1342,accuracy:8,time:Date.now()})");await pg.wait_for_timeout(800)
        check('native fix → BGST on, web GPS stopped',await df.evaluate("BGST==='on'&&GEO==null"),await df.evaluate("[BGST,GEO]"))
        await df.evaluate("pushLive(true)");await pg.wait_for_timeout(500)  # sends are rate-limited to one per 8 s
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('native fix reaches live',lv and abs(lv['lat']-12.9611)<1e-6,lv)
        await df.evaluate("S.tab='me';profileTab()");await pg.wait_for_timeout(700)
        t=await df.evaluate("(document.getElementById('bgst')||{}).innerText||''")
        check('Me → Settings shows background location ON',('ON' in t),t)
        await df.evaluate("goLive(false)");await pg.wait_for_timeout(500)
        check('offline → status off',await df.evaluate("BGST")=='off')
        # customer app inside the Android wrapper: no web-push prompt either
        await cf.evaluate(FAKE.replace('window.Capacitor','window.Capacitor'));
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        check('customer: pushReadyC false in the app without native push',await cf.evaluate("pushReadyC()")==False)
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
