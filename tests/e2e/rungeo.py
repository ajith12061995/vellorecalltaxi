# Place name + full address: slow/failed lookups never put coordinates in the name, coordinates stay exact, address is saved in the booking.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        cf=pg.frame(url=B+'c2.html')
        real=await cf.evaluate("REALMAP");print('REALMAP',real)
        # 1) setCustom never uses coordinates as the address
        await cf.evaluate("setCustom('drop',{lat:12.97321,lon:79.16543})")
        d=await cf.evaluate("P.drop")
        check('no coordinates in name or sub',not any(__import__('re').search(r'\d+\.\d{4}',str(d[k])) for k in('ta','en','sub')),d)
        check('exact coordinates kept',d['lat']==12.97321 and d['lon']==79.16543)
        # 2) lookup resolves in time -> name + full address saved and sent in booking
        await cf.evaluate("window.revGeo=async()=>({ta:'காட்பாடி ரேடியேஷன்',en:'Katpadi Radiation',sub:'Katpadi, Vellore',addr:'Katpadi Radiation, Gandhi Nagar, Vellore, Tamil Nadu'})")
        if real:
            await cf.evaluate("(async()=>{const c={lat:12.97321,lon:79.16543};setCustom('drop',c);await geoConfirm('drop',c)})()");await pg.wait_for_timeout(500)
            po=await cf.evaluate("placeOf('drop')")
            check('name+address in booking place',po['ta']=='காட்பாடி ரேடியேஷன்' and 'Vellore' in po['addr'] and po['lat']==12.97321,po)
            # 3) lookup never answers -> confirm continues within ~5s, coordinates intact, name is area text (not numbers), address filled later
            await cf.evaluate("window.__late=null;window.revGeo=()=>new Promise(r=>{window.__late=r})")
            t=await cf.evaluate("(async()=>{const c={lat:12.9801,lon:79.1702};setCustom('drop',c);const t0=Date.now();await geoConfirm('drop',c);return Date.now()-t0})()")
            po=await cf.evaluate("placeOf('drop')")
            check('slow lookup: confirm not blocked',t<5500,t)
            check('slow lookup: coordinates exact, no numbers as name',po['lat']==12.9801 and po['lon']==79.1702 and not __import__('re').search(r'\d+\.\d{4}',po['ta']+po['en']),po)
            await cf.evaluate("window.__late&&window.__late({ta:'Late',en:'Late',sub:'S',addr:'Late St, Vellore'})");await pg.wait_for_timeout(400)
            po=await cf.evaluate("placeOf('drop')")
            check('late answer fills the address',po['addr']=='Late St, Vellore',po)
        await b.close()
        check('no page errors',not errs,errs[:3])
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
