# Driver help line (9 Nov): customers keep calling the office number (72007 30416); drivers call a separate
# "driver help" number set in Office → Settings. Empty driver help = drivers call the office number as before.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        check('before: drivers call the office number',await df.evaluate("CFGD.office")=='7200730416')
        # owner sets the driver help line
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        await O.locator('#dh').fill('12345');await O.locator('#sv').click();await pg.wait_for_timeout(800)
        check('a short driver help number is refused',(await pg.evaluate("MOCK.store.get('config/app')")).get('driverHelp') in (None,''))
        await O.locator('#dh').fill('9876543210');await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        cfg=await pg.evaluate("MOCK.store.get('config/app')")
        check('driver help saved, office number unchanged',cfg.get('driverHelp')=='9876543210' and cfg.get('office')=='7200730416',(cfg.get('driverHelp'),cfg.get('office')))
        check('driver app now calls the driver help line',await df.evaluate("CFGD.office")=='9876543210')
        check('customer app still shows the office number',await cf.evaluate("CFG.office")=='7200730416')
        await of.evaluate("show()");await pg.wait_for_timeout(600)
        check('Settings shows the saved driver help number',await O.locator('#dh').input_value()=='9876543210')
        # clearing it sends drivers back to the office number
        await O.locator('#dh').fill('');await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        check('empty driver help → drivers call the office number again',await df.evaluate("CFGD.office")=='7200730416')
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
