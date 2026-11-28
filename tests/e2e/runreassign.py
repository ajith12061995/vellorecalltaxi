# Ride given to another driver by the server (27 Nov): the first driver's phone switched off before pickup. The customer
# app goes back to "finding a driver" and says why; the first driver's app (when back) says the ride was moved; another
# driver can take it, the first one is not offered it again.
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
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3000);bid=await cf.evaluate("R.id")
        await D.locator('#acc').click();await pg.wait_for_timeout(2500)
        check('driver accepted, customer sees the driver coming',(await pg.evaluate(f"MOCK.store.get('bookings/{bid}').status"))=='assigned' and await cf.evaluate("R.phase")!='search')
        # what the server does when the driver's phone was switched off before pickup
        await pg.evaluate(f"""(()=>{{const b=MOCK.store.get('bookings/{bid}');MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{status:'searching',driverPhone:null,driverName:null,plate:null,vehModel:null,assignedAt:null,arrivedAt:null,
          exclude:['+919999900002'],when:Date.now(),reopenedAt:Date.now(),reassigned:{{why:'phoneoff',from:'+919999900002',at:Date.now(),gapMin:2}}}})}})()""")
        await pg.wait_for_timeout(2500)
        ct=await cf.evaluate("document.body.innerText")
        check('customer back to finding a driver',await cf.evaluate("R.phase")=='search',await cf.evaluate("R.phase"))
        check('customer told: driver phone switched off, finding another driver',('switch off' in ct) or ('switched off' in ct),re.findall(r'.{0,40}switch.{0,40}',ct))
        dt=await df.evaluate("document.body.innerText")
        check('first driver: the ride left his screen with a clear note',await df.evaluate("!J") and (('ரத்து / மாற்றப்பட்டது' in dt) or ('reassigned' in dt) or await df.evaluate("!document.getElementById('arr')")),dt[:120])
        await pg.wait_for_timeout(3500)
        check('first driver is not offered the same ride again',await df.evaluate(f"!SHOWING||SHOWING!=='{bid}'") and await D.locator('#acc').count()==0)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
