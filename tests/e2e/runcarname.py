# Customer sees the driver's car by name (24 Nov): "Maruti Suzuki Swift" + number plate on the ride screen and in the share text.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await pg.evaluate("(()=>{const k='drivers/+919999900002',d=MOCK.store.get(k)||{};MOCK.store.set(k,{...d,veh:'sedan',model:'Honda Amaze',plate:'TN 23 CK 4455'})})()")
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        check('driver profile carries the car name',await df.evaluate("me().model")=='Honda Amaze',await df.evaluate("me().model"))
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(4000)
        check('driver gets the offer',await df.evaluate("!!document.getElementById('acc')"))
        await D.locator('#acc').click();await pg.wait_for_timeout(2500)
        bk=[v for k,v in (await pg.evaluate('MOCK.dump()')).items() if k.startswith('bookings/') and k.count('/')==1 and v.get('status')]
        check('booking stores plate + car name',bk and bk[-1].get('vehModel')=='Honda Amaze' and bk[-1].get('plate')=='TN 23 CK 4455',bk and {k:bk[-1].get(k) for k in ('vehModel','plate','status')})
        txt=await cf.evaluate("(document.querySelector('.drv')||{}).innerText||''")
        check('customer ride screen shows "Honda Amaze" and the plate',('Honda Amaze' in txt) and ('TN 23 CK 4455' in txt),txt)
        check('share text names the car',await cf.evaluate("carName('en')")=='Honda Amaze')
        check('car name falls back to the vehicle type when a driver has none',await cf.evaluate("(()=>{const m=R.drv.model;R.drv.model='';const x=carName('en');R.drv.model=m;return x})()")==await cf.evaluate("R.v.en"))
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
