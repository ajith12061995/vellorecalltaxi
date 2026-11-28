# 28 Nov (owner): like Rapido, the first ON shows one setup screen (Tamil + English) with a button per missing setting;
# it checks again when the driver comes back from settings; Auto launch is confirmed by the driver; then the driver goes online.
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
    if(p==='RideOverlay'&&m==='power')return Promise.resolve({free:!!window.__free,maker:'realme'});
    if(p==='RideOverlay'&&m==='fsi')return window.__v17?Promise.resolve({can:window.__fsi!==false}):Promise.reject(new Error('not implemented'));
    if(p==='RideOverlay'&&m==='take'){const t=window.__take;window.__take={action:null,id:null};return Promise.resolve(t)}
    return Promise.resolve({})},
  nativeCallback:(p,m,o,cb)=>{__calls.push([p,m,o]);if(m==='addWatcher')window.__cb=cb;return String(++n)},
  addListener:(p,ev,cb)=>{__calls.push([p,'addListener',ev]);return{remove:async()=>{}}}};})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9716,'longitude':79.1590},permissions=['geolocation'],user_agent='Mozilla/5.0 (Linux; Android 16) VCTApp')
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        await df.evaluate(BRIDGE%'true');await df.evaluate("window.__v17=true;window.__fsi=false;ovlInit()");await pg.wait_for_timeout(1000)
        await df.evaluate("localStorage.removeItem('vct_auto')")
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        items=await D.locator('.setupitem').count();okn=await D.locator('.setupitem.ok').count()
        check('ON with battery, full-screen and auto launch missing: setup screen, not online',items==5 and okn==2 and await df.evaluate("!S.online"),[items,okn])
        txt=await D.locator('.setuplist').inner_text()
        check('each item says what and why (Tamil + English names)','Auto launch' in txt and 'Unrestricted' in txt and 'Full screen' in txt,txt[:200])
        check('"Go online" is disabled while something is missing',await D.locator('#setupok').is_disabled())
        await D.locator('.setupgo[data-k="pwr"]').click();await pg.wait_for_timeout(300)
        await D.locator('.setupgo[data-k="auto"]').click();await pg.wait_for_timeout(300)
        calls=await df.evaluate("__calls.filter(c=>c[0]==='RideOverlay').map(c=>c[1])")
        check('buttons open the right settings (battery page, maker auto-start screen)','askPower' in calls and 'autostart' in calls,calls[-6:])
        # driver turns battery + full screen on in settings and comes back
        await df.evaluate("window.__free=true;window.__fsi=true;setupRecheck()");await pg.wait_for_timeout(1200)
        check('back from settings: list updated, only auto launch left',await D.locator('.setupitem:not(.ok)').count()==1 and await df.evaluate("!S.online"))
        await D.locator('.setupdone[data-k="auto"]').click();await pg.wait_for_timeout(1500)
        check('auto launch confirmed: everything done → online at once',await df.evaluate("S.online===true") and await D.locator('.setupm').count()==0)
        await D.locator('#offs').click();await pg.wait_for_timeout(600)
        if await D.locator('.modal .btn, .modal button').count():
            for sel in ['#offok','.modal .btn.red','.modal button:has-text("OFF")']:
                if await D.locator(sel).count():await D.locator(sel).first.click();break
        await pg.wait_for_timeout(800)
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        check('next ON with everything set: straight online, no setup screen',await df.evaluate("S.online===true") and await D.locator('.setupm').count()==0)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
