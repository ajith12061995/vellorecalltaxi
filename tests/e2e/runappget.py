# "Get the app" card: one-tap install (Chrome's beforeinstallprompt) and the Play Store notice the owner switches on
# in Office → Settings. Never inside the Play Store app (Capacitor). Customer and driver apps.
import asyncio,json
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
UA='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
FAKE="""(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});window.__asked=0;e.prompt=()=>{window.__asked++};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e)})()"""
ACC=FAKE.replace("'dismissed'","'accepted'")
async def login_c(C,pg):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},user_agent=UA,geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await login_c(C,pg)
        card=lambda f:f.evaluate("(()=>{const b=document.getElementById('appget');return b&&!b.hidden?b.innerText:''})()")
        check('customer: no card before Chrome offers install',await card(cf)=='',await card(cf))
        await cf.evaluate(FAKE);await pg.wait_for_timeout(300)
        t=await card(cf);check('customer: Install card appears',('Install' in t),t)
        await C.locator('#agGo').click();await pg.wait_for_timeout(500)
        check('Install opens Chrome prompt once, then card goes',await cf.evaluate('window.__asked')==1 and await card(cf)=='',await card(cf))
        # second offer → dismiss with × → stays hidden after re-render
        await cf.evaluate(FAKE);await pg.wait_for_timeout(300);await C.locator('#agX').click();await pg.wait_for_timeout(200)
        await cf.evaluate("home()");await pg.wait_for_timeout(500)
        check('× hides the install card (also after home is drawn again)',await card(cf)=='',await card(cf))
        # driver
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        await df.evaluate(FAKE);await pg.wait_for_timeout(300)
        t=await card(df);check('driver: Install card shows "VCT Driver"',('VCT Driver' in t),t)
        await D.locator('#agGo').click();await pg.wait_for_timeout(300)
        await df.evaluate(ACC);await pg.wait_for_timeout(300);await D.locator('#agGo').click();await pg.wait_for_timeout(400)
        await df.evaluate(FAKE);await pg.wait_for_timeout(300)
        check('driver: after the app is installed, no install card again',await card(df)=='',await card(df))
        # office owner: Play Store notice
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("settings()");await pg.wait_for_timeout(800)
        await O.locator('#plcu').fill('https://example.com/x');await O.locator('#plc').check();await O.locator('#plsv').click();await pg.wait_for_timeout(500)
        d=await pg.evaluate("((MOCK.dump()['config/app']||{}).play)||null")
        check('office: a non-Play link is refused',d is None,d)
        await O.locator('#plcu').fill('https://play.google.com/store/apps/details?id=app.velloretaxi');await O.locator('#plsv').click();await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.dump()['config/app'].play")
        check('office: customer notice ON saved, driver OFF',d and d['on'] and d['cust'].endswith('id=app.velloretaxi') and d['drv']=='',d)
        await pg.wait_for_timeout(800)
        await cf.evaluate("home()");await pg.wait_for_timeout(600)
        t=await card(cf);href=await cf.evaluate("(document.querySelector('#agGo')||{}).href||''")
        check('customer (Android, Chrome): Play Store card with the link',('Play Store' in t) and href.endswith('id=app.velloretaxi'),(t,href))
        await df.evaluate("home()");await pg.wait_for_timeout(500)
        t=await card(df);check('driver: no Play card while driver notice is OFF (install card still allowed)','Play Store' not in t,t)
        await of.evaluate("settings()");await pg.wait_for_timeout(600)
        await O.locator('#pld').check();await O.locator('#plsv').click();await pg.wait_for_timeout(1500)
        await df.evaluate("home()");await pg.wait_for_timeout(500)
        href=await df.evaluate("(document.querySelector('#agGo')||{}).href||''")
        check('driver notice ON → driver Play card with the driver link',href.endswith('id=app.velloretaxi.driver'),href)
        await of.evaluate("settings()");await pg.wait_for_timeout(600)
        v=await of.evaluate("[document.getElementById('plc').checked,document.getElementById('pld').checked]")
        check('office re-opens with both switches ON',v==[True,True],v)
        await pg.screenshot(path='shots/appget.png',clip={'x':0,'y':0,'width':900,'height':880})
        # inside the Play Store app: never
        await cf.evaluate("window.Capacitor={isNativePlatform:()=>true};home()");await pg.wait_for_timeout(500)
        check('inside the Play Store app: no card',await card(cf)=='',await card(cf))
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
