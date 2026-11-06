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
        real=await cf.evaluate("(window.__rg=revGeo,REALMAP)");print('REALMAP',real)
        # 1) setCustom never uses coordinates as the address
        await cf.evaluate("setCustom('drop',{lat:12.97321,lon:79.16543})")
        d=await cf.evaluate("P.drop")
        check('no coordinates in name or sub',not any(__import__('re').search(r'\d+\.\d{4}',str(d[k])) for k in('ta','en','sub')),d)
        check('exact coordinates kept',d['lat']==12.97321 and d['lon']==79.16543)
        # 2) lookup resolves in time -> name + full address saved and sent in booking
        await cf.evaluate("window.revGeo=async()=>({ta:'காட்பாடி ரேடியேஷன்',en:'Katpadi Radiation',sub:'Katpadi, Vellore',addr:'Katpadi Radiation, Gandhi Nagar, Vellore, Tamil Nadu'});0")
        if real:
            await cf.evaluate("(async()=>{const c={lat:12.97321,lon:79.16543};setCustom('drop',c);await geoConfirm('drop',c)})()");await pg.wait_for_timeout(500)
            po=await cf.evaluate("placeOf('drop')")
            check('name+address in booking place',po['ta']=='காட்பாடி ரேடியேஷன்' and 'Vellore' in po['addr'] and po['lat']==12.97321,po)
            # 3) lookup never answers -> confirm continues within ~5s, coordinates intact, name is area text (not numbers), address filled later
            await cf.evaluate("window.__late=null;window.revGeo=()=>new Promise(r=>{window.__late=r});0")
            t=await cf.evaluate("(async()=>{const c={lat:12.9801,lon:79.1702};setCustom('drop',c);const t0=Date.now();await geoConfirm('drop',c);return Date.now()-t0})()")
            po=await cf.evaluate("placeOf('drop')")
            check('slow lookup: confirm not blocked',t<5500,t)
            check('slow lookup: no guessed text saved as address',not po.get('addr'),po)
            check('slow lookup: coordinates exact, no numbers as name',po['lat']==12.9801 and po['lon']==79.1702 and not __import__('re').search(r'\d+\.\d{4}',po['ta']+po['en']),po)
            await cf.evaluate("window.__late&&window.__late({ta:'Late',en:'Late',sub:'S',addr:'Late St, Vellore'});0");await pg.wait_for_timeout(400)
            po=await cf.evaluate("placeOf('drop')")
            check('late answer fills the address',po['addr']=='Late St, Vellore',po)
        # 4) the real lookup chain: Google refused -> OpenStreetMap answers; both down -> null (no crash, nothing cached), reason reported
        osm={'ok':True}
        async def route(r):
            if osm['ok']:await r.fulfill(status=200,content_type='application/json',body='{"name":"Katpadi Junction","display_name":"Katpadi Junction, Katpadi, Vellore, Tamil Nadu, 632007, India","address":{"suburb":"Katpadi","city":"Vellore"}}')
            else:await r.fulfill(status=503,body='down')
        await pg.route('**/reverse*',route)
        await cf.evaluate("window.revGeo=window.__rg;window.GMAPS_KEY='test';window.google={maps:{Map:function(){}}};window.gRevGeo=()=>Promise.reject(new Error('REQUEST_DENIED'));MAPCFG.reverse=location.origin+'/reverse';0")
        g=await cf.evaluate("revGeo(12.9721,79.1386)")
        check('Google refused -> OSM name + full address',g and g['ta']=='Katpadi Junction' and 'Vellore' in g['addr'],g)
        osm['ok']=False
        g=await cf.evaluate("revGeo(12.9111,79.1222)")
        check('everything down -> null, no crash',g is None,g)
        osm['ok']=True
        g=await cf.evaluate("revGeo(12.9111,79.1222)")
        check('recovers after failure (failure not cached)',g and g['ta']=='Katpadi Junction',g)
        errs2=await pg.evaluate("Object.entries(MOCK.dump()).filter(([k,v])=>k.startsWith('errors/')).map(([k,v])=>v.msg)")
        check('failure reason reported to errors',any('revGeo google' in m for m in errs2) and any('revGeo osm' in m for m in errs2),errs2)
        # 5) driver offer card and office booking sheet show the full address
        df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html');O=pg.frame_locator('#o')
        bk="{id:'G1',customerUid:'u1',custName:'Priya',kind:'ride',veh:'sedan',km:4,fare:150,pay:'cash',status:'searching',created:Date.now(),from:{key:null,ta:'காட்பாடி ரேடியேஷன்',en:'Katpadi Radiation',lat:12.97321,lon:79.16543,addr:'Katpadi Radiation, Gandhi Nagar, Vellore, Tamil Nadu'},to:{key:null,ta:'CMC',en:'CMC',lat:12.9246,lon:79.1353,addr:'CMC Hospital, Ida Scudder Rd, Vellore'}}"
        await df.evaluate(f"(()=>{{const b={bk};incoming(buildJ(b,'G1'))}})()");await pg.wait_for_timeout(800)
        txt=await df.evaluate("document.body.innerText")
        check('driver offer shows pickup + drop full address','Gandhi Nagar, Vellore' in txt and 'Ida Scudder Rd' in txt)
        await pg.screenshot(path='shots/geo_driver.png',clip={'x':400,'y':0,'width':400,'height':860})
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await pg.evaluate(f"MOCK.fs.setDoc({{path:'bookings/G1'}},Object.assign({bk},{{custPhone:'+919000000000',src:'app'}}))");await pg.wait_for_timeout(1500)
        await of.evaluate("bookSheet(DB.bk.find(x=>x._id==='G1'))");await pg.wait_for_timeout(500)
        txt=await of.evaluate("document.body.innerText")
        check('office booking shows full address + exact coordinates','Gandhi Nagar, Vellore' in txt and '12.97321, 79.16543' in txt)
        await pg.screenshot(path='shots/geo_office.png')
        await b.close()
        check('no page errors',not errs,errs[:3])
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
