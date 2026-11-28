# 28 Nov (owner): several rides waiting → "See N more orders" on the request card; pick another; the count follows the list.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9716,'longitude':79.1590},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        veh=await df.evaluate("me().veh")
        def bk(id,lat,fare,tip=0):return f"MOCK.fs.setDoc({{path:'bookings/{id}'}},{{status:'searching',veh:'{veh}',kind:'ride',fare:{fare},tip:{tip},km:3,pay:'cash',when:Date.now()-60000,createdAt:Date.now(),custName:'P',from:{{ta:'இடம் {id}',en:'Place {id}',lat:{lat},lon:79.1610}},to:{{ta:'சிஎம்சி',en:'CMC',lat:12.92,lon:79.13}}}})"
        await pg.evaluate(bk('m1',12.9730,80));await pg.wait_for_timeout(1500)
        check('one ride: no "more orders" button',await D.locator('#acc').count()==1 and await D.locator('#moreq').is_hidden())
        await pg.evaluate(bk('m2',12.9740,120,20));await pg.evaluate(bk('m3',12.9750,60));await pg.wait_for_timeout(1500)
        t=await D.locator('#moreq').inner_text() if await D.locator('#moreq').is_visible() else ''
        check('three rides: "See 2 more orders" on the card',('2' in t),t)
        await D.locator('#moreq').click();await pg.wait_for_timeout(600)
        items=await D.locator('.moreitem').count()
        check('list shows the 2 other rides with fare (tip in green)',items==2 and await D.locator('.moreitem .tipadd').count()==1,items)
        first=await df.evaluate("J.id")
        await D.locator('.moreitem').first.click();await pg.wait_for_timeout(1200)
        now=await df.evaluate("J&&J.id")
        check('tapping one shows that ride with its own Accept',now in ('m2','m3') and now!=first and await D.locator('#acc').count()==1,[first,now])
        await pg.evaluate("MOCK.fs.updateDoc({path:'bookings/"+("m3" if now!='m3' else 'm2')+"'},{status:'assigned',driverPhone:'+919999900077'})");await pg.wait_for_timeout(1200)
        t=await D.locator('#moreq').inner_text() if await D.locator('#moreq').is_visible() else 'hidden'
        check('another driver took one: the count goes down',('1' in t),t)
        await D.locator('#acc').click();await pg.wait_for_timeout(2500)
        check('accept from the switched ride works',(await pg.evaluate(f"MOCK.store.get('bookings/{now}').driverPhone"))=='+919999900002')
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
