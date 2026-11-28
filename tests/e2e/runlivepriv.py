# Driver position privacy: the customer "nearby" map reads cars/{login id} (no phone number, ~110 m rounding);
# live/{phone} keeps the exact position and carries bk = the ride the driver is on, which is what lets
# (only) that ride's customer follow the driver (see firestore.rules riderOf + tests/rules).
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.99413,'longitude':80.17087},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        # the sandbox has no internet: a failed street-name lookup is logged (errors/ write), and the mock fires every
        # listener on any write — that would re-open the live listener during the "denied read" check below
        await ctx.route('**/nominatim.openstreetmap.org/**',lambda r:r.fulfill(status=200,content_type='application/json',body='{}'))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200)
        await D.locator('#ons').click();await pg.wait_for_timeout(3000)
        car=await pg.evaluate("MOCK.store.get('cars/u9999900002')")
        check('online driver writes cars/{login id}',bool(car) and car.get('online') is True,car)
        check('cars doc has only map fields (no phone, name, plate, booking)',car and set(car)<= {'lat','lon','gh','online','on','busy','veh','updatedAt'},car and sorted(car))
        check('cars position rounded to 3 decimals',car and abs(car['lat']*1e3-round(car['lat']*1e3))<1e-6 and abs(car['lat']-12.99413)<0.001,car and car.get('lat'))
        allcars=await pg.evaluate("JSON.stringify([...MOCK.store.keys()].filter(k=>k.startsWith('cars/')))")
        check('no phone number in any cars id','99999' not in allcars.replace('u9999900002',''),allcars)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('live keeps exact position, bk empty while free',lv and abs(lv['lat']-12.99413)<1e-6 and lv.get('bk')=='' and lv.get('busy') is False,lv)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)  # guest home → sign in
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}");await pg.wait_for_timeout(2500)
        await cf.evaluate("CFG.area={lat:12.99,lon:80.17};P.maa={ta:'Chennai Airport',en:'Chennai Airport',sub:'Meenambakkam',lat:12.9900,lon:80.1693,km:0};P.tbm={ta:'Tambaram',en:'Tambaram',sub:'',lat:12.9249,lon:80.1000,km:0};S.from='maa';S.dest='tbm';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(2500)
        near=await cf.evaluate("JSON.stringify(NEAR)")
        check('customer map shows the car from cars/ (login id, not phone)','u9999900002' in near and '+91' not in near,near)
        check('car rotation is a number',await cf.evaluate("NEAR.every(n=>Number.isFinite(n.rot))"))
        await cf.evaluate("CFG.area={lat:12.99,lon:80.17}")
        await C.locator('#bookb').click();await pg.wait_for_timeout(4000)
        if not await cf.evaluate("typeof R!=='undefined'&&!!(R&&R.id)"):  # the test area (Chennai) can be reset by a late config snapshot → "outside the local area" dialog; set it again and re-tap
            await cf.evaluate("CFG.area={lat:12.99,lon:80.17};document.querySelectorAll('.modal').forEach(m=>m.remove());fareScreen()");await pg.wait_for_timeout(800)
            await C.locator('#bookb').click();await pg.wait_for_timeout(4000)
        await D.locator('#acc').click();await pg.wait_for_timeout(3000)
        bid=await cf.evaluate("R&&R.id")
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('after accepting, live.bk = the booking id',lv and bid and lv.get('bk')==bid,(lv and lv.get('bk'),bid))
        car=await pg.evaluate("MOCK.store.get('cars/u9999900002')")
        check('busy car stays without booking id',car and car.get('busy') is True and 'bk' not in car,car)
        check('customer follows the driver position',await cf.evaluate("!!(R&&R.dpos&&R.dpos.lat)"))
        # the car turns to where it is going and the arrival time uses its speed (26 Nov)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        await pg.evaluate("MOCK.fs.setDoc({path:'live/+919999900002'},{...MOCK.store.get('live/+919999900002'),hd:180,sp:30})");await pg.wait_for_timeout(500)
        r=await cf.evaluate("(()=>{const d=R.map&&0;const o={lat:R.dpos.lat,lon:R.dpos.lon};return{hd:R.dhd,sp:R.dsp}})()")
        check('rider: phone heading used',r['hd']==180,r)
        e=await cf.evaluate("[etaMin({lat:12.99,lon:80.17},{lat:12.99+0.045,lon:80.17}),(R.dsp=0,etaMin({lat:12.99,lon:80.17},{lat:12.99+0.045,lon:80.17}))]")
        check('rider: ETA faster at 30 km/h than the 21 km/h default (5 km straight)',e[0]<e[1] and e[1]==19,e)
        await pg.evaluate("MOCK.fs.setDoc({path:'live/+919999900002'},{...MOCK.store.get('live/+919999900002'),hd:-1,sp:0,lon:MOCK.store.get('live/+919999900002').lon+0.0005})");await pg.wait_for_timeout(500)
        hd=await cf.evaluate("R.dhd");check('rider: no phone heading → direction of the move (east ≈ 90)',abs(hd-90)<3,hd)
        nd=await cf.evaluate("(()=>{const h=R.dhd*Math.PI/180,d={...R.dpos,nlat:R.dpos.lat+Math.cos(h)*1e-4,nlon:R.dpos.lon+Math.sin(h)*1e-4};return bearing(d,{lat:d.nlat,lon:d.nlon})})()")
        check('rider: map marker points the same way',abs(nd-90)<3,nd)
        # the map slides the rider's driver marker (Google path, recording fake)
        g=await cf.evaluate("""new Promise(res=>{const MK=[];function Map(el,o){this.c=o.center;this.z=15;this.controls={0:[]}}
          Map.prototype={addListener(){},getCenter(){const c=this.c;return{lat:()=>c.lat,lng:()=>c.lng}},setCenter(){},getZoom(){return 15},setZoom(){},fitBounds(){},getMapTypeId(){return'roadmap'}};
          function Mk(o){Object.assign(this,o);MK.push(this)}Mk.prototype={setPosition(p){this.position=p},getPosition(){const p=this.position;return{lat:()=>p.lat,lng:()=>p.lng}},setIcon(i){this.icon=i},setMap(m){this.map=m},setZIndex(){},setLabel(){}};
          function Pl(){}Pl.prototype={setPath(){},setMap(){},setCenter(){},setRadius(){}};
          const keep=[window.GMAPS_KEY,window.google];window.GMAPS_KEY='t';window.google={maps:{Map,Marker:Mk,Polyline:Pl,Circle:Pl,Size:function(){},Point:function(){},LatLngBounds:function(){this.extend=()=>{}},SymbolPath:{CIRCLE:0},ControlPosition:{LEFT_BOTTOM:0}}};
          const cv=document.createElement('canvas');document.body.appendChild(cv);let pos={lat:12.99,lon:80.17};
          const m=makeMap(cv,{glide:true,driver:()=>({...pos,nlat:pos.lat+1e-4,nlon:pos.lon})});
          setTimeout(()=>res(['timeout',MK.length]),6000);const dm=()=>MK.find(x=>x.zIndex===300);setTimeout(()=>{pos={lat:12.991,lon:80.17};setTimeout(()=>{const a=dm()?dm().position.lat:'none';setTimeout(()=>{res([a,dm()?dm().position.lat:MK.length]);const gm=document.querySelector('.gmap');if(gm)gm.remove();setTimeout(()=>{window.GMAPS_KEY=keep[0];window.google=keep[1]},700);document.querySelector('.gmap')&&document.querySelector('.gmap').remove()},1600)},800)},300)})""")
        check('rider map: driver marker slides between updates',isinstance(g[0],float) and 12.99<g[0]<12.991 and abs(g[1]-12.991)<1e-7,g)
        # a first denied read (driver app not yet marked the ride) is retried
        await cf.evaluate("""(()=>{if(LIVEUNSUB){LIVEUNSUB();LIVEUNSUB=null}R.dpos=null;const o=F().onSnapshot;let n=0;
          window.__deny=1;F().onSnapshot=(r,a,e)=>{if(r&&r.path&&r.path.startsWith('live/')&&window.__deny){window.__deny=0;n++;setTimeout(()=>e&&e({code:'permission-denied'}),10);return()=>{}}return o(r,a,e)};
          watchDrv(R.b.driverPhone)})()""")
        await pg.wait_for_timeout(1000)
        check('denied read leaves no listener',await cf.evaluate("LIVEUNSUB===null"))
        await pg.wait_for_timeout(8500)
        check('retried after 8 s and follows the driver',await cf.evaluate("!!LIVEUNSUB&&!!(R.dpos&&R.dpos.lat)"))
        await df.evaluate("goLive(false)") if await df.evaluate("!J") else None
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
