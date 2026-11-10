import asyncio
from playwright.async_api import async_playwright
async def run(perm):
    async with async_playwright() as p:
        b=await p.chromium.launch();kw=dict(viewport={'width':1900,'height':880})
        if perm:kw.update(geolocation={'latitude':12.9941,'longitude':80.1709},permissions=['geolocation'])
        ctx=await b.new_context(**kw)
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('http://localhost:8765/tests/e2e/out/harness_x.html');await pg.wait_for_timeout(2500)
        D=pg.frame_locator('#d');df=pg.frame(url='http://localhost:8765/tests/e2e/out/d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200)
        await D.locator('#ons').click();await pg.wait_for_timeout(3000)
        print(perm,'gpsw',await df.evaluate("!!document.getElementById('gpsw')"),'live',await df.evaluate("!!document.querySelector('.liveCard')"),'GOTFIX',await df.evaluate("GOTFIX"))
        await pg.screenshot(path=f'gps{int(perm)}.png',clip={'x':400,'y':0,'width':420,'height':860})
        print('ERR',errs);await b.close()
asyncio.run(run(False));asyncio.run(run(True))
