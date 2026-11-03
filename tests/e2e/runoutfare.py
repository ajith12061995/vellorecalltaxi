# Outstation: one way and round trip have separate ₹/km and allowance in Settings; customer quotes use the right one.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        O=pg.frame_locator('#o');C=pg.frame_locator('#c');of=pg.frame(url=B+'o2.html');cf=pg.frame(url=B+'c2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='set';show()");await pg.wait_for_timeout(800)
        for k,v in [('rate1.sedan','14'),('bata1.sedan','400'),('rate.sedan','11'),('bata.sedan','350')]:
            el=O.locator(f'[data-o="{k}"]');await el.fill(v);await el.dispatch_event('input')
        pv=await of.evaluate("document.querySelector('[data-ov=sedan]').innerText.replace(/\\s+/g,' ')")
        check('settings preview updates (one way 140x14+400=2360, round 280x11+350=3430)','2,360' in pv and '3,430' in pv,pv)
        await of.evaluate("document.querySelector('.otab').scrollIntoView()");await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/outfare_settings.png',clip={'x':800,'y':0,'width':1100,'height':860})
        await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        out=await pg.evaluate("MOCK.dump()['config/app'].out")
        check('saved separately',out['rate1']['sedan']==14 and out['rate']['sedan']==11 and out['bata1']['sedan']==400,(out['rate1']['sedan'],out['rate']['sedan']))
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2500)
        one=await cf.evaluate("OS.type='one';oQuote('sedan',140).total");rnd=await cf.evaluate("OS.type='round';OS.leave=Date.now();OS.ret=Date.now()+3600e3;oQuote('sedan',140).total")
        check('customer one-way quote uses one-way price',one==2360,one)
        check('customer round-trip quote uses round-trip price',rnd==3430,rnd)
        check('no page errors',not errs,errs[:3]);await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
