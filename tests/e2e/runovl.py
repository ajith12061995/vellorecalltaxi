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
    if(m==='checkPermissions')return Promise.resolve({location:'granted',receive:'granted'});
    if(p==='RideOverlay'&&m==='power')return Promise.resolve({free:false,maker:'realme'});
    if(p==='RideOverlay'&&m==='fsi')return window.__v17?Promise.resolve({can:window.__fsi!==false}):Promise.reject(new Error('not implemented'));
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
        await pg.wait_for_timeout(800);await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}");await pg.wait_for_timeout(2000)
        veh=await df.evaluate("me().veh")
        await cf.evaluate(f"S.dest='cmc';S.veh='{veh}';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(4000)
        check('driver sees the request in the app',await D.locator('#acc').count()==1)
        rg=[c for c in await ov() if c[0]=='ring']
        r=rg[-1][1] if rg else {}
        check('plugin asked to ring with the ride details',bool(rg) and r.get('id') and '→' in r.get('line1','') and ('km' in r.get('line2','') or 'கி.மீ' in r.get('line2','')) and r.get('secs')==20,r)
        check('card shows the fare and Accept / View',r.get('fare','').startswith('₹') and r.get('accept') in ('Accept','ஏற்கிறேன்') and r.get('open') in ('View','பார்க்க'),r)
        check('Rapido-like card fields: vehicle, payment, pickup km + place, drop km + place',r.get('veh') and r.get('pay') in ('Cash','UPI','Wallet') and r.get('pkm','').endswith(' km') and r.get('dkm','').endswith(' km') and r.get('pname') and r.get('dname'),r)
        check('voice: Tamil sentence with the pickup and the fare, English one too',('சவாரி' in r.get('say','')) and ('ரூபாய்' in r.get('say','')) and ('rupees' in r.get('sayEn','')) and (r.get('pname','')[:4] in r.get('say','') if r.get('pname') else True),[r.get('say'),r.get('sayEn')])
        check('page tells the app it is running (ready) once',len([c for c in await ov() if c[0]=='ready'])==1,[c[0] for c in await ov()])
        check('battery state asked',any(c[0]=='power' for c in await ov()))
        dv=await pg.evaluate("(MOCK.store.get('drivers/+919999900002')||{}).dev")
        check('phone setup reported to the office (app, overlay, battery, GPS, notifications, maker, Android)',dv and dv.get('app')=='1.0.16+' and dv.get('ovl') is True and dv.get('pwr') is False and dv.get('loc')=='granted' and dv.get('notif')=='granted' and dv.get('mk')=='realme' and dv.get('os')=='Android 16',dv)
        await pg.evaluate("(()=>{window.__dw=0;const f=MOCK.fs.updateDoc;MOCK.fs.updateDoc=function(r,d){if(d&&d.dev)__dw++;return f.apply(this,arguments)}})()")
        await df.evaluate("devReport('1.0.16+','realme')");await pg.wait_for_timeout(400)
        check('unchanged report is not written again',await pg.evaluate("__dw")==0)
        await df.evaluate("OVLCAN=false;devReport('1.0.16+','realme')");await pg.wait_for_timeout(400)
        check('changed (overlay taken away) → written again',await pg.evaluate("__dw")==1 and (await pg.evaluate("MOCK.store.get('drivers/+919999900002').dev.ovl")) is False)
        await df.evaluate("OVLCAN=true;localStorage.removeItem('vct_dev');devReport('1.0.16+','realme')");await pg.wait_for_timeout(400)
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
        for _ in range(8):  # under load a late snapshot can redraw the screen: draw home again until the tip is there
            await df.evaluate("J=null;SHOWING=null;document.querySelectorAll('.modal').forEach(m=>m.remove());if(!document.getElementById('pwron'))home()");await pg.wait_for_timeout(600)
            if await D.locator('#pwron').count():break
        check('battery limited (power free:false) → tip with a button to the settings',await D.locator('#pwron').count()==1)
        await D.locator('#pwron').click();await pg.wait_for_timeout(300)
        check('tip opens the app settings (askPower)',any(c[0]=='askPower' for c in await ov()))
        # 1.0.17 app: lock-screen rides + position from the phone itself
        await df.evaluate("window.__v17=true;window.__fsi=false;S.online=true;ovlPower()");await pg.wait_for_timeout(1200)
        ls=[c[1] for c in await ov() if c[0]=='liveStart']
        check('1.0.17 app detected and reported to the office',(await pg.evaluate("MOCK.store.get('drivers/+919999900002').dev.app"))=='1.0.17+')
        check('ON: the page hands the sign-in to the phone once (key, project, phone, refresh token)',len(ls)==1 and ls[0].get('apiKey')=='key-mock' and ls[0].get('project')=='proj-mock' and ls[0].get('phone')=='+919999900002' and ls[0].get('refresh','').startswith('rt-mock'),ls)
        await df.evaluate("ovlPower()");await pg.wait_for_timeout(800)
        check('…not again while nothing changed',len([c for c in await ov() if c[0]=='liveStart'])==1)
        await df.evaluate("window.__lp=0;const f=pushLive;window.pushLive=function(){__lp++;return f.apply(this,arguments)}");
        await df.evaluate("window.dispatchEvent(new Event('vctwake'))");await pg.wait_for_timeout(300)
        check('server push wakes the page (vctwake): position sent at once',await df.evaluate("__lp")>=1)
        await df.evaluate("J=null;document.querySelectorAll('.modal').forEach(m=>m.remove());home()");await pg.wait_for_timeout(600)
        check('full-screen alerts off → the driver is shown how to allow them',await D.locator('#fsion').count()==1)
        await D.locator('#fsion').click();await pg.wait_for_timeout(300)
        check('tap → opens the setting',any(c[0]=='askFsi' for c in await ov()))
        await df.evaluate("localStorage.setItem('vct_voice','off')");sv=await df.evaluate("JSON.stringify(rideSay({away:1.2},150,{ta:'காட்பாடி'},{}))")
        check('voice switched off in Settings → nothing said',sv=='{"say":"","sayEn":""}',sv)
        await df.evaluate("localStorage.removeItem('vct_voice')")
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
