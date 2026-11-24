# Map marker = the driver's vehicle type (24 Nov): bike → bike, auto → auto, Tempo Traveller → van, cars → car.
# Driver app: own marker follows the driver's registered vehicle. Customer ride map: follows the booked vehicle.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2000)
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html');cf=pg.frame(url=B+'c2.html')
        k=await df.evaluate("['bike','auto','mini','sedan','suv','psuv','trav',undefined].map(topKind)")
        check('vehicle → marker kind',k==['bike','auto','car','car','car','car','van','car'],k)
        sv=await df.evaluate("['bike','auto','car','van'].map(k=>topSvg(k,30,48))")
        check('4 different marker drawings, all valid svg',len(set(sv))==4 and all(s.startswith('<svg') and 'rotate(30 24 24)' in s for s in sv))
        check('explicit d.veh wins',await df.evaluate("drvKind({veh:'auto'})")=='auto')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1800)
        v0=await df.evaluate("me().veh")
        check('driver app: marker kind = own vehicle',await df.evaluate("drvKind({lat:1,lon:1})")==await df.evaluate("topKind(me().veh)"),v0)
        for veh,kind in [('bike','bike'),('auto','auto'),('trav','van'),('sedan','car')]:
            await df.evaluate(f"DME.veh='{veh}'")
            got=await df.evaluate("drvKind({lat:1,lon:1})")
            check(f'driver registered as {veh} → {kind} marker',got==kind,got)
        # the marker actually drawn on the driver's home map (Leaflet in tests): redraw home as a bike driver
        await df.evaluate("DME.veh='bike';home()");await pg.wait_for_timeout(1500)
        html=await df.evaluate("(document.querySelector('.lcar2')||{}).innerHTML||''")
        bike=await df.evaluate("topSvg('bike',0)")
        if html:check('home map draws the bike marker',html==bike or 'width=\"9\" height=\"17\"' in html,html[:200])
        else:print('note: no Leaflet marker in this harness (canvas map) — kind checks above cover it')
        # customer: booked vehicle decides the marker; no ride → car
        check('customer, no ride: car',await cf.evaluate("drvKind({lat:1,lon:1})")=='car')
        for veh,kind in [('auto','auto'),('bike','bike'),('trav','van'),('mini','car')]:
            got=await cf.evaluate(f"(()=>{{R={{v:{{id:'{veh}'}}}};const k=drvKind({{lat:1,lon:1}});R=null;return k}})()")
            check(f'customer booked {veh} → {kind} marker',got==kind,got)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
