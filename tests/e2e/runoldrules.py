# Deploy-order safety: the new driver app must still close a trip while the OLD security rules are live.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
OLD="(p,d)=>p.startsWith('bookings/')&&Object.keys(d).some(k=>!['status','pay','pinTry','arrivedAt','doneAt','paidAt','custRating','cancelReason','updatedAt','driverPhone','driverName','plate','vehModel','assignedAt','startedAt','tip','rating'].includes(k))"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{MOCK.denyUpdate="+OLD+"}")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3500);bid=await cf.evaluate("R.id")
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        await df.evaluate("collect()");await pg.wait_for_timeout(500);await D.locator('#got').click();await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']")
        ok=bk['status']=='done' and 'fareFinal' not in bk
        print('trip closed under old rules (basic fields only):',ok,bk['status'])
        print('ERR',errs);print('RESULT','PASS' if ok and not errs else 'FAIL');await b.close()
asyncio.run(main())
