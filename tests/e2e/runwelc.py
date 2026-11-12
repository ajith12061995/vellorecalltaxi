# A driver approved through the app (fromApp, approved within 30 days) sees a one-time celebration on first sign-in;
# it is remembered per phone on the device, and old / office-added drivers never see it.
import asyncio, time
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,driverHelp:'9344039933'});const d=MOCK.store.get('drivers/+919999900002');d.fromApp=true;d.createdAt=Date.now()-3600e3")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1800)
        txt=await df.evaluate("(document.querySelector('.welc')||{}).innerText||''")
        nm=await df.evaluate("DME.ta")
        check('celebration shows after first sign-in',bool(txt) and (nm in txt),txt[:80])
        check('message: welcome, 0% commission, help number, next steps',('Vellore Taxi' in txt) and ('0%' in txt) and ('93440 39933' in txt) and ('Online' in txt),txt[:200])
        check('help number is a call link',await df.evaluate("!!document.querySelector('.welc a[href=\"tel:+919344039933\"]')"))
        await pg.screenshot(path='shots/welcome_driver.png',clip={'x':400,'y':0,'width':400,'height':860})
        await D.locator('#welok').click();await pg.wait_for_timeout(700)
        check('closes to driver home',not await df.evaluate("!!document.querySelector('.welc')") and await df.evaluate("!!(document.getElementById('ons')||document.getElementById('offs'))"))
        check('shown only once on this phone',await df.evaluate("welcomeDue(MOCK_D=parent.MOCK.store.get('drivers/+919999900002'))")==False)
        old=await df.evaluate("(()=>{localStorage.removeItem('vct_welc_'+CL.phone);return welcomeDue({fromApp:true,createdAt:Date.now()-40*864e5})})()")
        check('approved more than 30 days ago: no celebration',old==False)
        off=await df.evaluate("welcomeDue({createdAt:Date.now()})")
        check('driver added by the office (not via app): no celebration',off==False)
        fresh=await df.evaluate("welcomeDue({fromApp:true,createdAt:Date.now()})")
        check('fresh approval on a new phone: shows',fresh==True)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
