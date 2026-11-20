# City fares: office sets "km in base" per vehicle (e.g. Mini ₹110 for the first 3 km, then ₹20/km) → customer app follows.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def login_c(C,pg):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');O=pg.frame_locator('#o');cf=pg.frame(url=B+'c2.html');of=pg.frame(url=B+'o2.html')
        await login_c(C,pg)
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("settings()");await pg.wait_for_timeout(800)
        v=await of.evaluate("[document.querySelector('[data-fi=mini]').value,!document.querySelector('[data-fi=auto]')]")
        check('office: Km-in-base column, default 1.5, none for auto',v==['1.5',True],v)
        for bad in ['0','11','']:
            await O.locator('[data-fi=mini]').fill(bad);await O.locator('#sv').click();await pg.wait_for_timeout(400)
            d=await pg.evaluate("(((MOCK.dump()['config/app']||{}).fares||{}).mini||{}).incl")
            check(f'office: km in base "{bad}" not saved',d is None,d)
        await O.locator('[data-f="mini.base"]').fill('110');await O.locator('[data-fi=mini]').fill('3');await O.locator('[data-f="mini.per"]').fill('20')
        await O.locator('[data-fi=mini]').dispatch_event('input');await pg.wait_for_timeout(200)
        pv=await of.evaluate("document.querySelector('[data-pv=mini]').textContent")
        check('office: 5 km preview = ₹150',pv.replace(',','').endswith('150'),pv)
        await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.dump()['config/app'].fares")
        check('saved: mini 110 / 3 km / 20; sedan incl 1.5',d['mini']=={'base':110,'per':20,'incl':3} and d['sedan'].get('incl')==1.5,d)
        pub=await pg.evaluate("(MOCK.dump()['public/prices']||{}).fares||{}")
        check('public price copy has incl',pub.get('mini',{}).get('incl')==3,pub.get('mini'))
        await pg.wait_for_timeout(800)
        f=await cf.evaluate("(()=>{const m=VEH.find(v=>v.id==='mini');return[m.incl,fare0(m,2),fare0(m,5),fare0(m,10),fare0(VEH.find(v=>v.id==='sedan'),5)]})()")
        check('customer: Mini 2 km ₹110, 5 km ₹150, 10 km ₹250',f[0]==3 and f[1:4]==[110,150,250],f)
        check('customer: other cars still 1.5 km',f[4]==round((await cf.evaluate("(()=>{const s=VEH.find(v=>v.id==='sedan');return s.base+s.per*3.5})()"))/5)*5,f)
        await of.evaluate("settings()");await pg.wait_for_timeout(500)
        v=await of.evaluate("document.querySelector('[data-fi=mini]').value")
        check('office re-opens with 3',v=='3',v)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
