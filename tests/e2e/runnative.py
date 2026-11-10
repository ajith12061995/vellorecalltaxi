# Android wrapper (Capacitor): driver going online starts the native background-location watcher (foreground
# service), its fixes reach live/{phone}, going offline removes it; native push token is saved on the driver
# record and the ride-alert channel is created. Browser (non-native) behaviour is covered by the other suites.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
FAKE="""(()=>{window.__ch=[];window.__rm=0;window.__bg=null;
 window.Capacitor={isNativePlatform:()=>true,registerPlugin:(n)=>n==='BackgroundGeolocation'?{
   addWatcher:(o,cb)=>{window.__bg={o,cb};return Promise.resolve('w1')},removeWatcher:()=>{window.__rm++;return Promise.resolve()},openSettings:()=>{}}:
   {checkPermissions:async()=>({receive:'granted'}),requestPermissions:async()=>({receive:'granted'}),createChannel:async c=>{window.__ch.push(c.id)},
    addListener:(e,cb)=>{if(e==='registration')setTimeout(()=>cb({value:'NATIVE_TOKEN_1'}),20)},register:async()=>{}}}})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},user_agent='Mozilla/5.0 (Linux; Android 14) VCTApp VCTPush')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100,push:{vapid:'BTESTKEY'}})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200)
        await df.evaluate(FAKE);await pg.evaluate(FAKE)  # the mock cloud layer lives in the harness window
        await pg.evaluate("MOCK.fs.setDoc({path:'config/app'},{comm:10,minbal:100,push:{vapid:'BTESTKEY'}})");await pg.wait_for_timeout(1500)
        await D.locator('#ons').click();await pg.wait_for_timeout(1800)
        bg=await df.evaluate("window.__bg&&{m:window.__bg.o.backgroundMessage,t:window.__bg.o.backgroundTitle,df:window.__bg.o.distanceFilter,rp:window.__bg.o.requestPermissions}")
        check('going online starts the background watcher with a notification text',bg and bg['m'] and bg['t'] and bg['df']==10,bg)
        await df.evaluate("window.__bg.cb({latitude:12.9611,longitude:79.1342,accuracy:8,time:Date.now()})");await pg.wait_for_timeout(1500)
        lv=await pg.evaluate("[...MOCK.store.entries()].filter(([k])=>k.startsWith('live/')).map(([k,v])=>v)")
        check('a background fix reaches live/{phone}',any(abs((v.get('lat') or 0)-12.9611)<1e-6 and v.get('online') for v in lv),lv)
        check('GOTFIX true after native fix',await df.evaluate("GOTFIX===true&&POS.lat===12.9611"))
        dt=await pg.evaluate("(MOCK.store.get('drivers/+919999900002')||MOCK.store.get('drivers/9999900002')||{}).fcm")
        check('native push token saved on the driver',dt=='NATIVE_TOKEN_1',dt)
        check('ride-alert channel created',await pg.evaluate("window.__ch.includes('rides')"))
        await df.evaluate("goLive(false)");await pg.wait_for_timeout(600)
        check('going offline removes the watcher',await df.evaluate("window.__rm")==1)
        await df.evaluate("goLive(true)");await pg.wait_for_timeout(800)
        check('online again starts a new watcher once',await df.evaluate("!!window.__bg")and await df.evaluate("window.__rm")==1)
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
