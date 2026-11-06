# The real Android app: the page is loaded from velloretaxi.app, so window.Capacitor is ONLY the native bridge
# (nativePromise / nativeCallback / addListener) — no @capacitor/core, no registerPlugin. v70 field test showed
# "Not in this app version" because the code called Capacitor.registerPlugin. This suite mocks the bridge exactly.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
BRIDGE="""(()=>{window.__calls=[];window.__cb=null;let n=0;
 window.Capacitor={isNativePlatform:()=>true,
  nativePromise:(p,m,o)=>{__calls.push([p,m,o]);
    if(p==='BackgroundGeolocation'&&m==='checkPermissions')return Promise.resolve({location:'granted'});
    if(p==='PushNotifications'&&m==='checkPermissions')return Promise.resolve({receive:'granted'});
    return Promise.resolve({})},
  nativeCallback:(p,m,o,cb)=>{__calls.push([p,m,o]);if(m==='addWatcher')window.__cb=cb;return String(++n)},
  addListener:(p,ev,cb)=>{__calls.push([p,'addListener',ev]);return{remove:async()=>{}}}};})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.95,'longitude':79.14},permissions=['geolocation'],user_agent='Mozilla/5.0 (Linux; Android 16) VCTApp')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200)
        await df.evaluate(BRIDGE)
        check('no registerPlugin in the mocked bridge',await df.evaluate("typeof Capacitor.registerPlugin==='undefined'"))
        await D.locator('#ons').click();await pg.wait_for_timeout(1200)
        calls=await df.evaluate("__calls")
        names=[c[0]+'.'+c[1] for c in calls]
        check('permission checked through the bridge before the watcher',names.index('BackgroundGeolocation.checkPermissions')<names.index('BackgroundGeolocation.addWatcher') if 'BackgroundGeolocation.addWatcher' in names else False,names)
        aw=[c for c in calls if c[1]=='addWatcher']
        check('addWatcher sent through nativeCallback with the notification text',aw and aw[0][2].get('backgroundMessage') and aw[0][2].get('backgroundTitle'),aw and aw[0][2])
        check('notification permission checked',('PushNotifications.checkPermissions' in names),names)
        check('status is not "no-plugin"',await df.evaluate("BGST")!='no-plugin',await df.evaluate("BGST"))
        await df.evaluate("__cb({latitude:12.9611,longitude:79.1342,accuracy:8,time:Date.now()})");await pg.wait_for_timeout(600)
        check('native fix → status ON',await df.evaluate("BGST")=='on',await df.evaluate("BGST"))
        check('native position used',await df.evaluate("POS.lat===12.9611"))
        await df.evaluate("goLive(false)");await pg.wait_for_timeout(500)
        rm=[c for c in await df.evaluate("__calls") if c[1]=='removeWatcher']
        check('offline → removeWatcher with the watcher id',rm and rm[0][2].get('id')=='1',rm)
        # push token path in vct-cloud with the bridge only (VCTPush build): no registerPlugin crash
        r=await df.evaluate("""(async()=>{const C=window.Capacitor;C.nativePromise=(p,m,o)=>{__calls.push([p,m,o]);return Promise.resolve(m==='checkPermissions'?{receive:'granted'}:{})};
           C.addListener=(p,ev,cb)=>{__calls.push([p,'addListener',ev]);if(ev==='registration')setTimeout(()=>cb({value:'TOK1'}),10);return{remove:async()=>{}}};
           return 'ok'})()""")
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
