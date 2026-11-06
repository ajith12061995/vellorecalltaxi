# Office sets local / auto limits, outstation A/B limits and allowance per category → customer app follows.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
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
        check('office shows distance limits panel',await of.evaluate("!!document.getElementById('a_local')&&!!document.querySelector('[data-cb=\"A.sedan\"]')"))
        await O.locator('#a_local').fill('22');await O.locator('#a_auto').fill('28');await O.locator('#a_ca').fill('100');await O.locator('#a_cb').fill('150')
        await O.locator('[data-cb="A.sedan"]').fill('450');await O.locator('[data-cb="A.sedan"]').dispatch_event('input')
        # bad order is refused
        await O.locator('#a_ca').fill('20');await O.locator('#sv').click();await pg.wait_for_timeout(600)
        cfg=await pg.evaluate("(MOCK.dump()['config/app']||{}).area")
        check('wrong order (A below local) not saved',not cfg or cfg.get('local')!=22,cfg)
        await O.locator('#a_ca').fill('100');await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.dump()['config/app']")
        check('saved: local 22, auto 28, A 100, B 150, bata A sedan 450',d.get('area',{}).get('local')==22 and d['area']['auto']==28 and d['out']['cat']=={'a':100,'b':150} and d['out']['cb']['A']['sedan']==450,(d.get('area'),d['out'].get('cat'),d['out'].get('cb')))
        await pg.wait_for_timeout(800)
        # customer: Arcot (~20 km from centre) is now local
        await cf.evaluate("setCustom('drop',{lat:12.9063,lon:79.3189});P.drop.ta=P.drop.en='Arcot';S.dest='drop';S.mode='';S.autoFor='';fareScreen();0");await pg.wait_for_timeout(700)
        check('customer: Arcot is local after raising the limit to 22 km',not await cf.evaluate("!!document.querySelector('#aout')") and await cf.evaluate("!!document.getElementById('bookb')"))
        # Kanchipuram (~85 km trip) = A: round trip only, up + down, A allowance
        await cf.evaluate("forgetRide&&forgetRide();setCustom('drop',{lat:12.8342,lon:79.7036});P.drop.ta=P.drop.en='Kanchipuram';S.dest='drop';S.mode='out';OS.type='one';OS.veh='sedan';outFare2();0");await pg.wait_for_timeout(900)
        q=await cf.evaluate("(()=>{const {km}=oInfo();return{km,type:OS.type,one:document.querySelector('[data-t=\"one\"]').disabled,q:oQuote('sedan',km),rate:ORATE.sedan}})()")
        exp=round((q['km']*2*q['rate']+450*q['q']['days'])/10)*10
        check('A: one way disabled, round trip forced',q['type']=='round' and q['one'],q)
        check('A: price = up+down km × rate + A allowance (no 250 km/day minimum)',q['q']['total']==exp and q['q']['billed']==q['km']*2,(q['q'],exp))
        page=await cf.evaluate("document.body.innerText")
        check('customer never sees category letters',not any(x in page for x in ['Category','வகை A','Outstation A']))
        await pg.screenshot(path='shots/cat_cust.png',clip={'x':0,'y':0,'width':400,'height':860})
        # Tirupati (~115 km) = B: one way allowed
        await cf.evaluate("setCustom('drop',{lat:13.6288,lon:79.4192});P.drop.ta=P.drop.en='Tirupati';S.dest='drop';S.mode='out';OS.type='one';outFare2();0");await pg.wait_for_timeout(900)
        q=await cf.evaluate("(()=>{const {km}=oInfo();return{km,type:OS.type,one:document.querySelector('[data-t=\"one\"]').disabled}})()")
        check('B: one way allowed',q['type']=='one' and not q['one'],q)
        await of.evaluate("settings()");await pg.wait_for_timeout(500);await pg.screenshot(path='shots/cat_office.png')
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
