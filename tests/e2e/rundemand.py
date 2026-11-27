# Demand map (27 Nov): the server keeps config/demand (busiest pickup places per time of day, last 14 days).
# Office → Reports shows it on a map with a list per time of day; the driver app, while ON and free, shows the busiest
# places for the current time of day with distance and a Maps link.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
BANDS="""(()=>{const P=[{lat:12.9716,lon:79.1590,n:9,ta:'காட்பாடி ரயில் நிலையம்',en:'Katpadi Junction'},{lat:12.9246,lon:79.1353,n:6,ta:'CMC',en:'CMC'},{lat:12.9340,lon:79.1450,n:3,ta:'புதிய பேருந்து நிலையம்',en:'New Bus Stand'},{lat:12.95,lon:79.14,n:1,ta:'ஒரு இடம்',en:'One place'}];
  return {m:P,a:P,e:P,n:P}})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1500,'height':1000},geolocation={'latitude':12.9165,'longitude':79.1325},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        # Office before the server has built it
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2500)
        await of.evaluate("S.sec='rep';save();show()");await pg.wait_for_timeout(2500)
        check('office: not built yet → says so',await O.locator('#demp').count()==1 and ('தயாராகல' in await O.locator('#demp').inner_text() or 'not ready' in await O.locator('#demp').inner_text()))
        await pg.evaluate(f"MOCK.store.set('config/demand',{{at:{{__ms:Date.now()}},days:14,total:40,bands:{BANDS}}})")
        await of.evaluate("DEMAND=null;demandPanel()");await pg.wait_for_timeout(1500)
        t=' '.join((await O.locator('#demp').inner_text()).split())
        check('office: list ranked by rides',t.index('காட்பாடி') < t.index('CMC') if 'காட்பாடி' in t and 'CMC' in t else False,t[:200])
        check('office: 4 time-of-day tabs, the current one selected',await O.locator('#demp [data-db]').count()==4 and await O.locator('#demp [data-db].on').count()==1)
        check('office: a map is drawn',await O.locator('#demp .omap canvas, #demp .omap .lmap, #demp .omap .gmap, #demp .dmapw > *').count()>=1)
        await O.locator('#demp [data-db="n"]').click();await pg.wait_for_timeout(600)
        check('office: switching tab works',await O.locator('#demp [data-db="n"].on').count()==1)
        # driver app
        D=pg.frame_locator('#d');df=lambda:pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(2500)
        check('driver OFF: no hint',await D.locator('#demhint:not([hidden])').count()==0)
        await D.locator('#ons').click();await pg.wait_for_timeout(2500)
        await df().evaluate("home()");await pg.wait_for_timeout(1500)
        h=' '.join((await D.locator('#demhint').inner_text()).split()) if await D.locator('#demhint').count() else ''
        check('driver ON: busiest 3 places (a place with 1 ride left out)','காட்பாடி' in h and 'CMC' in h and ('பேருந்து' in h or 'Bus' in h) and 'ஒரு இடம்' not in h,h)
        check('driver: distance shown, Maps link to the place',await D.locator('#demhint a[href*="destination=12.9716,79.159"]').count()==1 and ('km' in h or 'மீ' in h))
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
