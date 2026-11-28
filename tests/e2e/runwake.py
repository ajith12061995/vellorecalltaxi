# Ride push after a long sleep (27 Nov): a locked phone 10–30 min in Doze did not ring. The page, woken by the push,
# starts the database connection afresh and reads the pushed ride from the server, rings it, and tells the phone it did
# (seen). A ride that is not for this driver is marked seen without ringing. "Accept" on a ride the phone rang by itself
# (page asleep) is accepted by the page with the same checks; a ride already gone is not.
import asyncio,json
from playwright.async_api import async_playwright
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
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9716,'longitude':79.1590},permissions=['geolocation'],user_agent='Mozilla/5.0 (Linux; Android 16) VCTApp')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1200)
        await df.evaluate(BRIDGE%'true');await df.evaluate("window.__v17=true;ovlInit()");await pg.wait_for_timeout(800)
        await df.evaluate("(()=>{window.setupGate=cb=>cb()})()")   # the one-time setup screen has its own test (runsetup)
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await df.evaluate("window.__cb&&__cb({latitude:12.9716,longitude:79.1590,accuracy:8,time:Date.now()})");await pg.wait_for_timeout(800)
        await df.evaluate("ovlPower()");await pg.wait_for_timeout(1200)
        check('1.0.17+ app: wake listener on',await df.evaluate("WAKEL===true"))
        veh=await df.evaluate("me().veh");other='auto' if veh!='auto' else 'mini'
        # the page's live list is stuck (long sleep): it does not hear new rides by itself
        await df.evaluate("if(REQUNSUB)REQUNSUB();REQUNSUB=()=>{};REQS=[]")
        def bk(id,v,lat=12.9750,st='searching'):
            return f"MOCK.store.set('bookings/{id}',{{status:'{st}',veh:'{v}',kind:'ride',fare:120,km:3,pay:'cash',when:Date.now(),createdAt:Date.now(),custName:'Priya',from:{{ta:'காட்பாடி',en:'Katpadi',lat:{lat},lon:79.1610}},to:{{ta:'சிஎம்சி',en:'CMC',lat:12.92,lon:79.13}}}})"
        seen=lambda:df.evaluate("__calls.filter(c=>c[0]==='RideOverlay'&&c[1]==='seen').map(c=>c[2].id)")
        rings=lambda:df.evaluate("__calls.filter(c=>c[0]==='RideOverlay'&&c[1]==='ring').map(c=>c[2].id)")
        # 1. not this driver's vehicle: marked seen, nothing shown
        await pg.evaluate(bk('wk-other',other))
        await df.evaluate("window.dispatchEvent(Object.assign(new Event('vctwake'),{vct:JSON.stringify({type:'ride',bookingId:'wk-other'})}))");await pg.wait_for_timeout(1500)
        check('other vehicle: the phone is told "seen", no request shown','wk-other' in await seen() and await D.locator('#acc').count()==0)
        # 2. a ride for this driver: read from the server after a fresh connection, shown and rung, phone told
        n0=await pg.evaluate("MOCK.netOn||0")
        await pg.evaluate(bk('wk-mine',veh))
        await df.evaluate("window.dispatchEvent(Object.assign(new Event('vctwake'),{vct:JSON.stringify({type:'ride',bookingId:'wk-mine'})}))");await pg.wait_for_timeout(2000)
        check('database connection started afresh',(await pg.evaluate("MOCK.netOn||0"))>n0 and (await pg.evaluate("MOCK.netOff||0"))>0)
        check('the pushed ride shows and rings even though the live list was stuck',await D.locator('#acc').count()==1 and 'wk-mine' in await rings())
        check('the phone is told the page rang it (no second ring)','wk-mine' in await seen())
        await pg.evaluate(bk('wk-noise',other));await df.evaluate("REQUNSUB=null;listenReq()");await pg.wait_for_timeout(1200)
        check('the live list comes back while the request shows: request stays (the ride is still waiting)',await D.locator('#acc').count()==1 and await df.evaluate("SHOWING==='wk-mine'"))
        await D.locator('#acc').click();await pg.wait_for_timeout(2500)
        check('accept from it works',(await pg.evaluate("MOCK.store.get('bookings/wk-mine').driverPhone"))=='+919999900002')
        await pg.evaluate("MOCK.fs.updateDoc({path:'bookings/wk-mine'},{status:'cancelled',cancelReason:'test'})");await pg.wait_for_timeout(2500)
        await df.evaluate("J=null;SHOWING=null;document.querySelectorAll('.modal').forEach(m=>m.remove());home()");await pg.wait_for_timeout(800)
        # 3. the page could not answer (the phone rang by itself); Accept on the lock screen → the page accepts it
        await pg.evaluate(bk('wk-native',veh))
        await df.evaluate("window.__take={action:'accept',id:'wk-native'};ovlTake()");await pg.wait_for_timeout(3000)
        bkn=await pg.evaluate("MOCK.store.get('bookings/wk-native')")
        check('Accept on a ride the phone rang itself: accepted for this driver',bkn.get('status')=='assigned' and bkn.get('driverPhone')=='+919999900002',[bkn.get('status'),bkn.get('driverPhone')])
        check('...and the driver is on the pickup screen',await df.evaluate("!!J&&J.id==='wk-native'&&!document.getElementById('ons')&&!document.getElementById('offs')"))
        await pg.evaluate("MOCK.fs.updateDoc({path:'bookings/wk-native'},{status:'cancelled',cancelReason:'test'})");await pg.wait_for_timeout(2500)
        await df.evaluate("J=null;SHOWING=null;document.querySelectorAll('.modal').forEach(m=>m.remove());home()");await pg.wait_for_timeout(800)
        # 4. same, but another driver took it meanwhile: told so, nothing accepted
        await pg.evaluate(bk('wk-gone',veh,st='assigned'));await pg.evaluate("MOCK.fs.updateDoc({path:'bookings/wk-gone'},{driverPhone:'+919999900077'})")
        await df.evaluate("window.__take={action:'accept',id:'wk-gone'};ovlTake()");await pg.wait_for_timeout(2000)
        dt=await df.evaluate("document.body.innerText")
        check('ride already taken: not accepted, driver told',(await pg.evaluate("MOCK.store.get('bookings/wk-gone').driverPhone"))=='+919999900077' and await df.evaluate("!J") and ('Another driver' in dt or 'வேற driver' in dt))
        # 5. too far (more than 4 km): seen, not shown
        await pg.evaluate(bk('wk-far',veh,lat=13.10))
        await df.evaluate("window.dispatchEvent(Object.assign(new Event('vctwake'),{vct:JSON.stringify({type:'ride',bookingId:'wk-far'})}))");await pg.wait_for_timeout(1500)
        check('pickup too far: seen, not shown','wk-far' in await seen() and await D.locator('#acc').count()==0)
        # 6. the server does not answer in time: the page stays quiet (no "seen"), so the phone rings by itself
        await pg.evaluate(bk('wk-slow',veh));await pg.evaluate("MOCK.down=true")
        await df.evaluate("window.dispatchEvent(Object.assign(new Event('vctwake'),{vct:JSON.stringify({type:'ride',bookingId:'wk-slow'})}))");await pg.wait_for_timeout(1500)
        await pg.evaluate("MOCK.down=false")
        check('no answer from the server: not marked seen (the phone takes over)','wk-slow' not in await seen())
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
