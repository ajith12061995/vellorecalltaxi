# Bug 7 Nov (owner): typed Mini 110/21 in Office → Settings → City fares, pressed Save, but config/app kept 100/16
# and the customer app still showed ₹100. Cause: a config/app update from Firebase while Settings was open replaced
# DB.cfg.fares/out/rent with new objects, so the typed values (written into the old objects) were dropped on Save.
# Fix: Save re-reads every price input on screen. This test types prices, pushes a server update, then saves.
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
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,fares:{mini:{base:100,per:16},sedan:{base:130,per:19},suv:{base:180,per:22}}})")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        async def put(sel,v):
            el=O.locator(sel);await el.fill(str(v))
        await put('[data-f="mini.base"]',110);await put('[data-f="mini.per"]',21)
        await put('[data-f="sedan.base"]',110);await put('[data-f="sedan.per"]',23)
        await put('[data-f="suv.per"]',24)
        await put('[data-o="rate.mini"]',13)
        # a config/app update arrives from Firebase while the owner is still on the screen (another device / a server write)
        await pg.evaluate("MOCK.fs.updateDoc({path:'config/app'},{upi:'',fares:{mini:{base:100,per:16},sedan:{base:130,per:19},suv:{base:180,per:22}}})")
        await pg.wait_for_timeout(1200)
        shown=await O.locator('[data-f="mini.base"]').input_value()
        check('the typed price is still on screen',shown=='110',shown)
        await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        f=(await pg.evaluate("MOCK.store.get('config/app')"))
        fa=f.get('fares',{})
        check('Mini saved as 110 / 21',fa.get('mini')=={'base':110,'per':21},fa.get('mini'))
        check('Sedan saved as 110 / 23',fa.get('sedan')=={'base':110,'per':23},fa.get('sedan'))
        check('MPV per km saved as 24',fa.get('suv',{}).get('per')==24,fa.get('suv'))
        check('outstation rate typed before the update is saved too',f.get('out',{}).get('rate',{}).get('mini')==13,f.get('out',{}).get('rate'))
        # the customer app picks up the new prices
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        mini=await cf.evaluate("(()=>{const v=VEH.find(x=>x.id==='mini');return [v.base,v.per,fare0(v,1.6)]})()")
        check('customer app: Mini 110 + 21/km, 1.6 km ride = ₹110',mini==[110,21,110],mini)
        # a second save with nothing typed keeps the saved prices (no reset to defaults)
        await of.evaluate("show()");await pg.wait_for_timeout(800)
        await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        fa=(await pg.evaluate("MOCK.store.get('config/app')")).get('fares',{})
        check('saving again keeps 110 / 21',fa.get('mini')=={'base':110,'per':21},fa.get('mini'))
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
