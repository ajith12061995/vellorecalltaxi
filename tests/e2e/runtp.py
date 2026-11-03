import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('http://localhost:8765/tests/e2e/out/harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');cf=pg.frame(url='http://localhost:8765/tests/e2e/out/c2.html');CL={'x':0,'y':0,'width':400,'height':860}
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        await C.locator('[data-svc=sched]').click();await pg.wait_for_timeout(600)
        await pg.screenshot(path='shots/tp1.png',clip=CL)
        await C.locator('.tpdays button').nth(1).click();await pg.wait_for_timeout(300)
        await C.locator('[data-tpp=dawn]').click();await pg.wait_for_timeout(300)
        await C.locator('.tpgrid button').nth(16).click();await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/tp2.png',clip=CL)
        print('label',await cf.evaluate("document.getElementById('wok').textContent"))
        await C.locator('#wok').click();await pg.wait_for_timeout(600)
        print('S.when',await cf.evaluate("new Date(S.when).toString().slice(0,21)"))
        await cf.evaluate("home('out');OS.veh='sedan';OS.type='round';OS.leave=null;OS.ret=null;pickCity(0)");await pg.wait_for_timeout(600)
        await C.locator('#whenb').click();await pg.wait_for_timeout(600);await pg.screenshot(path='shots/tp3.png',clip=CL)
        await C.locator('[data-tab=ret]').click();await pg.wait_for_timeout(400);await pg.screenshot(path='shots/tp4.png',clip=CL)
        await C.locator('#wok').click();await pg.wait_for_timeout(500)
        print('OS',await cf.evaluate("[new Date(OS.leave).toString().slice(0,21),new Date(OS.ret).toString().slice(0,21)]"))
        print('ERR',errs);await b.close()
asyncio.run(main())
