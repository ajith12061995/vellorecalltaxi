# Android app: ride card + ringtone over other apps (25 Nov). The page drives the RideOverlay plugin through the native
# bridge: online state, ring on a new request, stop when it ends, and "Accept" on the card presses the page's own Accept.
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
    if(p==='RideOverlay'&&m==='take'){const t=window.__take;window.__take={action:null,id:null};return Promise.resolve(t)}
    return Promise.resolve({})},
  nativeCallback:(p,m,o,cb)=>{__calls.push([p,m,o]);if(m==='addWatcher')window.__cb=cb;return String(++n)},
  addListener:(p,ev,cb)=>{__calls.push([p,'addListener',ev]);return{remove:async()=>{}}}};})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9165,'longitude':79.1325},permissions=['geolocation'],user_agent='Mozilla/5.0 (Linux; Android 16) VCTApp')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html');C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1200)
        await df.evaluate(BRIDGE%'false');await df.evaluate("ovlInit()");await pg.wait_for_timeout(800)
        ov=lambda:df.evaluate("__calls.filter(c=>c[0]==='RideOverlay').map(c=>[c[1],c[2]])")
        check('plugin found, permission not given yet',await df.evaluate("!!OVL&&OVLCAN===false"))
        check('home asks once for "Display over other apps"',await D.locator('#ovlon').count()==1)
        await D.locator('#ovlon').click();await pg.wait_for_timeout(300)
        check('tap opens the permission screen (ask)',any(c[0]=='ask' for c in await ov()))
        await df.evaluate("window.__can=true;ovlInit()");await pg.wait_for_timeout(800)
        check('after Allow: the ask button is gone',await df.evaluate("OVLCAN===true")and await D.locator('#ovlon').count()==0)
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await df.evaluate("window.__cb&&__cb({latitude:12.9165,longitude:79.1325,accuracy:8,time:Date.now()})");await pg.wait_for_timeout(800)
        on=[c for c in await ov() if c[0]=='online']
        check('going online tells the plugin (floating icon)',bool(on) and on[-1][1].get('on')==True,on[-1:] )
        # a customer books → the driver gets the request
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        veh=await df.evaluate("me().veh")
        await cf.evaluate(f"S.dest='cmc';S.veh='{veh}';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(4000)
        check('driver sees the request in the app',await D.locator('#acc').count()==1)
        rg=[c for c in await ov() if c[0]=='ring']
        r=rg[-1][1] if rg else {}
        check('plugin asked to ring with the ride details',bool(rg) and r.get('id') and '→' in r.get('line1','') and ('km' in r.get('line2','') or 'கி.மீ' in r.get('line2','')) and r.get('secs')==20,r)
        check('card shows the fare and Accept / View',r.get('fare','').startswith('₹') and r.get('accept') in ('Accept','ஏற்கிறேன்') and r.get('open') in ('View','பார்க்க'),r)
        check('no customer phone number or name sent to the card',not any(('9999900001' in str(v)) or ('Priya' in str(v)) for v in r.values()),r)
        bid=r.get('id')
        # "View" on the card: the app only comes to the front, nothing is accepted
        await df.evaluate(f"window.__take={{action:'open',id:'{bid}'}};ovlTake()");await pg.wait_for_timeout(800)
        st=await pg.evaluate(f"MOCK.store.get('bookings/{bid}').status")
        check('"View" does not accept the ride',st=='searching' and await D.locator('#acc').count()==1,st)
        # "Accept" for some other ride id: ignored
        await df.evaluate("window.__take={action:'accept',id:'someone-else'};ovlTake()");await pg.wait_for_timeout(800)
        check('"Accept" for a different ride is ignored',await pg.evaluate(f"MOCK.store.get('bookings/{bid}').status")=='searching')
        # "Accept" on the card for this ride → the page's own Accept runs
        n0=len([c for c in await ov() if c[0]=='stop'])
        await df.evaluate(f"window.__take={{action:'accept',id:'{bid}'}};ovlTake()");await pg.wait_for_timeout(3000)
        bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('"Accept" on the card accepts the ride for this driver',bk.get('status')!='searching' and bk.get('driverPhone')=='+919999900002',[bk.get('status'),bk.get('driverPhone')])
        check('ringing is stopped once the request ends',len([c for c in await ov() if c[0]=='stop'])>n0)
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
