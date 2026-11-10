# Backend hardening, app side: (1) a booking whose fare the server corrected shows "🛡️ Fare corrected by the
# server ₹50 → ₹280" in the office booking sheet; (2) when the server cancels a booking for the booking limit,
# the customer sees "Too many bookings at once" (not "no vehicle"). The server logic itself is tested in
# functions/test (unit) and tests/fnint (real functions in the emulator).
import asyncio
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
        C=pg.frame_locator('#c');O=pg.frame_locator('#o');D=pg.frame_locator('#d')
        cf=pg.frame(url=B+'c2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1000)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500);bid=await cf.evaluate("R.id")
        # what the server does to a tampered booking
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{fare:280,fareFlag:'corrected',fareWas:50}})");await pg.wait_for_timeout(1500)
        await of.evaluate(f"bookSheet(DB.bk.find(x=>x._id==='{bid}'))");await pg.wait_for_timeout(700)
        sh=await of.evaluate("(document.querySelector('.modal')||{}).innerText||''")
        check('office booking sheet: fare corrected by the server, ₹50 → ₹280',('server திருத்தியது' in sh or 'corrected by the server' in sh) and '₹50' in sh and '₹280' in sh,[l for l in sh.split('\n') if '→' in l][:2])
        await pg.screenshot(path='shots/harden_office.png',clip={'x':1100,'y':0,'width':800,'height':860})
        await of.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove())")
        # server cancels the booking for the limit
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{status:'cancelled',cancelReason:'limit',cancelledBy:'server'}})");await pg.wait_for_timeout(1800)
        t=await cf.evaluate("(document.querySelector('.modal')||{}).innerText||''")
        check('customer told "too many bookings at once" (not "no vehicle")',('நிறைய booking' in t or 'Too many bookings' in t) and 'வண்டி இல்லை' not in t,t[:80].replace('\n',' '))
        await pg.screenshot(path='shots/harden_limit.png',clip={'x':0,'y':0,'width':400,'height':860})
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
