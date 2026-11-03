import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('http://localhost:8765/tests/e2e/out/harness_x.html');await pg.wait_for_timeout(1500)
        await pg.evaluate("MOCK.store.get('config/app').office='8220201462'")
        D=pg.frame_locator('#d');O=pg.frame_locator('#o');df=pg.frame(url='http://localhost:8765/tests/e2e/out/d2.html');of=pg.frame(url='http://localhost:8765/tests/e2e/out/o2.html')
        DL={'x':400,'y':0,'width':400,'height':860}
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1200)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/dw1.png',clip=DL)
        # office announcement
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(800)
        await O.locator('#ant').fill('இன்று மாலை Katpadi-ல booking அதிகம்');await O.locator('#anm').fill('5 மணி முதல் 9 மணி வரை Katpadi station பக்கம் இருங்க');await O.locator('#ans').click();await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/dw2.png',clip=DL)
        await D.locator('#menu').click();await pg.wait_for_timeout(500);await pg.screenshot(path='shots/dw3.png',clip=DL)
        await D.locator('[data-dm=notes]').click();await pg.wait_for_timeout(600);await pg.screenshot(path='shots/dw4.png',clip=DL)
        for k,n in [('perf','dw5'),('docs','dw6'),('qr','dw7'),('faq','dw8')]:
            await D.locator('#bk').click();await pg.wait_for_timeout(400);await D.locator('#menu').click();await pg.wait_for_timeout(400)
            await D.locator(f'[data-dm={k}]').click();await pg.wait_for_timeout(800);await pg.screenshot(path=n+'.png',clip=DL)
        print('ERR',errs);await b.close()
asyncio.run(main())
