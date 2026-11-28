# Accept pressed twice (27 Nov, lock-screen card + page): the customer saw the driver, the driver app went back to
# "waiting for rides". A ride that is already this driver's counts as accepted; a driver never sits on the home
# screen while a ride is his; a ride really taken by another driver still says so.
import asyncio,re
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}");await pg.wait_for_timeout(2000)
        me=await df.evaluate("CL.phone")
        async def book():
            await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
            await C.locator('#bookb').click();await pg.wait_for_timeout(3000);return await cf.evaluate("R.id")
        async def onPickup():return await df.evaluate("!!J&&!!J.id&&!document.getElementById('ons')&&!document.getElementById('offs')")
        async def finish(bid):
            await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{status:'cancelled',cancelReason:'test'}})");await pg.wait_for_timeout(2500)
            await cf.evaluate("try{R={};home()}catch(e){}");await pg.wait_for_timeout(800)
        # 1. the accept went through once already (lock-screen card / retried commit), then the page accepts again
        bid=await book();await D.locator('#acc').wait_for(timeout=8000)
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{status:'assigned',driverPhone:'{me}',driverName:'A',assignedAt:Date.now()}})")
        await pg.wait_for_timeout(300);await df.evaluate("acceptCloud()");await pg.wait_for_timeout(2500)
        dt=await df.evaluate("document.body.innerText")
        check('already mine: driver goes to pickup, not "another driver took it"',await onPickup() and 'Another driver' not in dt and 'வேற driver எடுத்துட்டாங்க' not in dt,dt[:100])
        await finish(bid)
        # 2. two accepts at the same moment
        bid=await book();await D.locator('#acc').wait_for(timeout=8000)
        await df.evaluate("acceptCloud();acceptCloud()");await pg.wait_for_timeout(3000)
        dt=await df.evaluate("document.body.innerText")
        check('double accept: booking is this driver\'s and the driver is on the pickup screen',(await pg.evaluate(f"MOCK.store.get('bookings/{bid}').driverPhone"))==me and await onPickup() and 'Another driver' not in dt,dt[:100])
        # 3. the app somehow fell back to the home screen with a ride assigned: it comes back by itself
        await df.evaluate("stopJob();J=null;home()");await pg.wait_for_timeout(3500)
        check('home screen with a ride of his: the ride comes back on screen',await onPickup() and await df.evaluate(f"J.id==='{bid}'"))
        await finish(bid)
        # 4. really taken by another driver: still says so and stays home
        bid=await book();await D.locator('#acc').wait_for(timeout=8000)
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{status:'assigned',driverPhone:'+919999900077',driverName:'B'}})")
        await df.evaluate("acceptCloud()");await pg.wait_for_timeout(2500)
        dt=await df.evaluate("document.body.innerText")
        check('taken by another driver: told so, stays on home',await df.evaluate("!J") and await D.locator('#ons, #offs').count()>0 and ('Another driver' in dt or 'வேற driver' in dt),dt[:120])
        await pg.wait_for_timeout(3000)
        check('...and is not pulled into the other driver\'s ride',await df.evaluate("!J"))
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
