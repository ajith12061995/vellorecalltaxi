import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('http://localhost:8765/tests/e2e/out/harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url='http://localhost:8765/tests/e2e/out/c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        for name,lat,lon in [('Mumbai',19.076,72.8777),('Kolkata',22.5726,88.3639)]:
            await cf.evaluate(f"home('out');setCustom('drop',{{lat:{lat},lon:{lon}}});P.drop.ta=P.drop.en='{name}';S.dest='drop';S.mode='out';OS.type='one';outFare2()");await pg.wait_for_timeout(800)
            print(name, await cf.evaluate("JSON.stringify({km:oInfo().km,one:oQuote('sedan',oInfo().km)})"))
            await C.locator('[data-t=round]').click();await pg.wait_for_timeout(600)
            print(name,'round',await cf.evaluate("JSON.stringify({ret:new Date(OS.ret).toString().slice(0,21),q:oQuote('sedan',oInfo().km)})"))
        await C.locator('#bookb').click();await pg.wait_for_timeout(600)
        await pg.screenshot(path='shots/m1.png',clip={'x':0,'y':0,'width':400,'height':860})
        print('ERR',errs);await b.close()
asyncio.run(main())
