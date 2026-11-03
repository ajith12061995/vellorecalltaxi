# Network + app-closed scenarios:
#  A. slow network (1.5 s per call): full ride book → accept → PIN → done still works
#  B. no internet when booking: error shown, no crash; works again when back online
#  C. customer closes the app while searching and reopens: search screen comes back
#  D. driver closes the app mid-trip and reopens: trip comes back, GPS km kept, bill correct
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def login_d(D,pg):
    await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
    await D.locator('#go').click();await pg.wait_for_timeout(2500)
    if await D.locator('#ons').count():await D.locator('#ons').click();await pg.wait_for_timeout(2500)
async def login_c(C,pg):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(800)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(1500)
    if await C.locator('#nm').count():await C.locator('#nm').fill('Priya');await C.locator('#go').click()
    await pg.wait_for_timeout(3000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');D=pg.frame_locator('#d')
        cf=lambda:pg.frame(url=B+'c2.html');df=lambda:pg.frame(url=B+'d2.html')
        await pg.evaluate("()=>{MOCK.delay=1500}")
        await login_d(D,pg);await login_c(C,pg)
        # A. slow network
        await cf().evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1500)
        await C.locator('#bookb').click();await pg.wait_for_timeout(300)
        busy=await cf().evaluate("document.getElementById('bookb')&&document.getElementById('bookb').textContent")
        check('A slow: button shows Booking… while waiting',busy and ('ஆகுது' in busy or 'Booking' in busy),busy)
        await pg.wait_for_timeout(9000);bid=await cf().evaluate("R&&R.id")
        check('A slow: booking created',bool(bid))
        await D.locator('#acc').click();await pg.wait_for_timeout(6000)
        pin=(await pg.evaluate(f"MOCK.dump()['bookings/{bid}/private/pin']"))['pin']
        await df().evaluate("atPickup()");await pg.wait_for_timeout(1000)
        await df().evaluate(f"(()=>{{const ins=[...document.querySelectorAll('#pinb input')];'{pin}'.split('').forEach((d,i)=>ins[i].value=d);cloudStart(ins)}})()");await pg.wait_for_timeout(6000)
        st=(await pg.evaluate(f"MOCK.dump()['bookings/{bid}']"))['status'];check('A slow: trip started',st=='ontrip',st)
        # D. driver closes the app mid-trip (GPS km so far saved), reopens
        await df().evaluate("J.gpsKm=3.7;trackKm();localStorage.setItem('vct_km_'+J.id,'3.7')")
        await pg.evaluate("document.getElementById('d').src='d2.html?r=1'");await pg.wait_for_timeout(2500)
        await pg.evaluate("()=>{MOCK.delay=0}")
        dfr=pg.frame(url=B+'d2.html?r=1');Dr=pg.frame_locator('#d')
        await Dr.locator('#ph').fill('9999900002');await Dr.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await Dr.locator(f'#o{i}').fill(d)
        await Dr.locator('#go').click();await pg.wait_for_timeout(3500)
        back=await dfr.evaluate("!!(J&&J.id)&&J.b&&J.b.status");kmk=await dfr.evaluate("J&&J.gpsKm")
        check('D reopen: driver is back in the trip',back=='ontrip',back)
        check('D reopen: GPS km kept',kmk==3.7,kmk)
        await dfr.evaluate("collect()");await pg.wait_for_timeout(600);await Dr.locator('#got').click();await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']");check('D reopen: trip closed with fx.gpsKm',bk['status']=='done' and bk['fx']['gpsKm']==3.7,(bk['status'],bk.get('fx',{}).get('gpsKm')))
        # B. no internet when booking
        await Dr.locator('#next').click();await pg.wait_for_timeout(1500);await dfr.evaluate("pushLive(true)");await pg.wait_for_timeout(1500)
        await cf().evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove());R=null;S.dest='cmc';S.veh='sedan';fareScreen()");await pg.wait_for_timeout(1500)
        await pg.evaluate("()=>{MOCK.down=true}");n0=len(errs)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        t=await cf().evaluate("document.getElementById('toast').textContent")
        en=await cf().evaluate("!document.getElementById('bookb').disabled")
        check('B offline: error message, button usable again, no crash',('ERR' in t or 'offline' in t.lower() or 'unavailable' in t) and en and len(errs)==n0,t)
        await pg.evaluate("()=>{MOCK.down=false}")
        await C.locator('#bookb').click();await pg.wait_for_timeout(3000)
        bid2=await cf().evaluate("R&&R.id");check('B back online: booking works',bool(bid2))
        # C. customer closes the app while searching and reopens
        await pg.evaluate("document.getElementById('c').src='c2.html?r=1'");await pg.wait_for_timeout(2500)
        cfr=pg.frame(url=B+'c2.html?r=1');Cr=pg.frame_locator('#c')
        await login_c(Cr,pg);await pg.wait_for_timeout(2000)
        srch=await cfr.evaluate("!!(R&&R.id)&&!!document.getElementById('cxs')")
        check('C reopen: customer sees the search again',srch)
        await pg.screenshot(path='shots/net.png')
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
