# Driver phone clock 20 minutes fast: requests must still arrive (server-time correction).
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
SKEW="if(location.pathname.endsWith('d2.html')){const _n=Date.now.bind(Date);Date.now=()=>_n()+20*60e3}"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        await ctx.add_init_script(SKEW)
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        print('driver clock ahead by min:',round((await df.evaluate("Date.now()")-await pg.evaluate("Date.now()"))/6e4))
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1500);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        off=await df.evaluate("VCTCLK.off");print('learned offset min:',round(off/6e4))
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(5000)
        got=await df.evaluate("!!document.getElementById('acc')")
        print('request reached the driver despite the wrong clock:',got)
        ok=got and abs(off/6e4+20)<1
        print('ERR',errs[:3]);print('RESULT','PASS' if ok and not errs else 'FAIL');await b.close()
asyncio.run(main())
