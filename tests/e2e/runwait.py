# Customer search screen (25 Nov): every booking that week was cancelled 9–53 s after booking, before a driver could
# answer. In the first minute of the search the first Cancel tap asks once "can you wait a little longer?";
# "Driver is taking too long" is not offered in that minute; the screen says how many drivers of that type are ON nearby.
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
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}");await pg.wait_for_timeout(2000)
        await cf.evaluate("S.lang='en';S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1000)
        # two sedans switched ON near the pickup (their phones quiet), one far away, one auto
        await pg.evaluate("""()=>{const w=document.getElementById('c').contentWindow,pu=w.eval('P[S.from]'),G=w.eval('VGEO').gh,t=Date.now();
          const c=(id,lat,lon,o)=>MOCK.store.set('cars/'+id,{lat,lon,gh:G(lat,lon),online:false,on:true,busy:false,veh:'sedan',updatedAt:{__ms:t-3600e3},...o});
          c('s1',pu.lat+0.005,pu.lon);c('s2',pu.lat,pu.lon+0.01);c('far',pu.lat+0.06,pu.lon);c('a1',pu.lat+0.003,pu.lon,{veh:'auto'});MOCK.notify&&MOCK.notify()}""")
        await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        ph=await cf.evaluate("R&&R.phase")
        check('booked, searching',ph=='search',ph)
        n=await C.locator('#nearon').inner_text() if await C.locator('#nearon').count() else ''
        check('search screen says how many sedans are ON nearby (2: not the far one, not the auto)','2 Sedan drivers ON near you' in n,n)
        # first Cancel tap in the first minute → "can you wait?"
        await C.locator('#cxs').click();await pg.wait_for_timeout(500)
        txt=await cf.evaluate("(document.querySelector('.modal')||{}).innerText||''")
        check('first Cancel in the first minute asks to wait (with seconds left)','wait a little longer' in txt and 'seconds' in txt and await C.locator('#wok').count()==1,txt[:120])
        await C.locator('#wok').click();await pg.wait_for_timeout(500)
        st=await pg.evaluate("(()=>{const k=[...MOCK.store.keys()].find(k=>k.startsWith('bookings/'));return MOCK.store.get(k).status})()")
        check('"OK, I will wait": still searching, booking untouched',await cf.evaluate("R&&R.phase")=='search' and st=='searching' and await cf.evaluate("!document.querySelector('.modal')"),st)
        # second tap: straight to the reasons, without "taking too long" (still inside the first minute)
        await C.locator('#cxs').click();await pg.wait_for_timeout(500)
        rs=await cf.evaluate("[...document.querySelectorAll('.modal .reason')].map(b=>b.textContent.trim())")
        check('second Cancel: reasons at once, no "Driver is taking too long" in the first minute',len(rs)==4 and not any('too long' in r for r in rs) and await C.locator('#wok').count()==0,rs)
        await C.locator('#cno').click();await pg.wait_for_timeout(400)
        # after a minute the reason is offered again
        await cf.evaluate("R.t0=Date.now()-65000");await C.locator('#cxs').click();await pg.wait_for_timeout(500)
        rs=await cf.evaluate("[...document.querySelectorAll('.modal .reason')].map(b=>b.textContent.trim())")
        check('after the first minute: "Driver is taking too long" is back',len(rs)==5 and 'Driver is taking too long' in rs,rs)
        await C.locator('.modal .reason').first.click();await C.locator('#cyes').click();await pg.wait_for_timeout(1200)
        st=await pg.evaluate("(()=>{const k=[...MOCK.store.keys()].find(k=>k.startsWith('bookings/'));const d=MOCK.store.get(k);return [d.status,d.cancelReason]})()")
        check('cancel still works (booking cancelled with the reason)',st[0]=='cancelled' and 'too long' in (st[1] or ''),st)
        # a new booking asks again; "No, I want to cancel" goes on to the reasons
        await cf.evaluate("S.dest='cmc';S.veh='sedan';fareScreen()");await pg.wait_for_timeout(1000);await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        await C.locator('#cxs').click();await pg.wait_for_timeout(400)
        asked=await C.locator('#wno').count()==1
        await C.locator('#wno').click();await pg.wait_for_timeout(600)
        rs=await cf.evaluate("[...document.querySelectorAll('.modal .reason')].map(b=>b.textContent.trim())")
        check('next booking asks again; "No, I want to cancel" opens the reasons',asked and len(rs)==4,rs)
        await C.locator('#cno').click();await pg.wait_for_timeout(300)
        # Tamil
        await cf.evaluate("S.lang='ta';R.waitAsked=false");await C.locator('#cxs').click();await pg.wait_for_timeout(400)
        t=await cf.evaluate("(document.querySelector('.modal')||{}).innerText||''")
        check('Tamil text','காத்திருக்கலாமா' in t,t[:60])
        await C.locator('#wok').click()
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
