# GPS fare (owner 28 Nov "like Uber / Red Taxi"): Office → Settings → GPS fare per vehicle; the customer sees how the
# fare works; the driver's meter (page meter here — the native 1.0.27 meter is tested on the emulator) counts the real
# km, shows it live, sends the running km to the booking and the route to bookings/{id}/track; the bill is by GPS km in
# meter mode; the rider sees the km live and the route after; a fare complaint reaches the office; the office replays the route.
import asyncio,re,json
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100,fares:{mini:{base:110,per:20},sedan:{base:130,per:19}}})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        # ---- office: GPS fare settings
        await of.evaluate("S.lang='en';S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        check('Settings has the GPS fare panel, every vehicle on "Booked fare"',await O.locator('#meterp').count()==1 and await of.evaluate("[...document.querySelectorAll('[data-mt]')].every(x=>x.value==='quote')"))
        await O.locator('[data-mt=mini]').select_option('upfront');await O.locator('#mt_sv').click();await pg.wait_for_timeout(400)
        check('upfront without a % is refused',(await pg.evaluate("MOCK.store.get('config/app')")).get('meter') is None)
        await O.locator('#mt_xp').fill('15');await O.locator('[data-mt=sedan]').select_option('meter');await O.locator('#mt_sv').click();await pg.wait_for_timeout(800)
        m=(await pg.evaluate("MOCK.store.get('config/app')")).get('meter')
        check('saved: mini upfront 15 %, sedan GPS meter, others booked fare',m=={'mode':{'mini':'upfront','sedan':'meter'},'xp':15},m)
        # ---- driver + customer sign in
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800)
        await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}")
        await pg.wait_for_timeout(2000);await cf.evaluate("S.lang='en';CFG.meter="+json.dumps(m));await df.evaluate("S.lang='en'")
        # ---- customer sees how the fare works
        await cf.evaluate("S.from='katpadi';S.dest='cmc';S.veh='mini';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1000)
        t=await C.locator('#mnote').inner_text() if await C.locator('#mnote').count() else ''
        check('mini (upfront): "This is your fare. It changes only if the trip is over 15% longer"','15%' in t and 'changes only' in t,t)
        await C.locator('.veh[data-v=sedan]').click();await pg.wait_for_timeout(300)
        t=await C.locator('#mnote').inner_text() if await C.locator('#mnote').count() else ''
        check('sedan (meter): "The final fare is by GPS km"','GPS km' in t,t)
        await C.locator('.veh[data-v=auto]').click();await pg.wait_for_timeout(300)
        check('auto (booked fare): no note',await cf.evaluate("document.getElementById('mnote').hidden===true"))
        await C.locator('.veh[data-v=sedan]').click();await pg.wait_for_timeout(300)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        bid=await cf.evaluate("R.id");bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        tar=bk['tariff']
        check('booking keeps the meter tariff: mode, vehicle, booked km, prices',tar.get('mode')=='meter' and tar.get('v')=='sedan' and tar.get('base')==130 and tar.get('per')==19 and abs(tar.get('km')-bk['km'])<0.11,tar)
        # driver takes it and starts
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        now=await pg.evaluate("Date.now()")
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{arrivedAt:{{toMillis(){{return {now-2*60e3}}}}},startedAt:{{toMillis(){{return {now-60e3}}}}},status:'ontrip'}})");await pg.wait_for_timeout(1500)
        check('driver on the trip screen with the meter box',await D.locator('#mtr').count()==1)
        # drive ~8.3 km south from Katpadi (longer than the booked route), one fix every 3 s, with a GPS jump
        r=await df.evaluate("""(()=>{const real=Date.now;let T=real();const pts=[];for(let i=0;i<=250;i++)pts.push([12.9716-i*0.0003,79.1376+(i%2?0.00003:0)]);
          let k=0;for(const [la,lo] of pts){T+=3000;Date.now=()=>T;geoFix(la,lo,8,180,10);if(++k===100){T+=1500;Date.now=()=>T;geoFix(la+0.03,lo,8)}}
          Date.now=real;MTT=0;const s=meterNow();return [s.km,s.jumps,J.mt.pts.length]})()""")
        expect=round(250*0.0003*111.32,2)
        check(f'page meter: ~{expect} km counted, the jump ignored',abs(r[0]-expect)/expect<0.03 and r[1]>=1,r)
        await df.evaluate("(()=>{const real=Date.now;Date.now=()=>real()+4000;geoFix(12.9716-250*0.0003,79.1376,8);Date.now=real})()");await pg.wait_for_timeout(1500)
        await df.evaluate("MTT=0;meterFix(POS.lat,POS.lon,8)");await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('running km sent to the booking for the rider',bk.get('meter') and abs(bk['meter']['km']-r[0])<0.2 and bk['meter']['src']=='web',bk.get('meter'))
        tr=await pg.evaluate(f"[...MOCK.store.keys()].filter(k=>k.startsWith('bookings/{bid}/track/')).sort()")
        check('route chunks of 60 points uploaded while driving',len(tr)>=4 and tr[0].endswith('/c000'),tr)
        await df.evaluate("onTrip()");await pg.wait_for_timeout(2500)
        mt=' '.join((await D.locator('#mtr').inner_text()).split())
        check('driver sees GPS km and the fare now',re.search(r'GPS \d+\.\d km',mt) is not None and 'Now ₹' in mt,mt)
        await pg.wait_for_timeout(1000)
        st=await cf.evaluate("(document.getElementById('stS')||{}).textContent||''")
        check('rider sees "On trip · GPS x km"','GPS' in st and 'km' in st,st)
        # end trip → bill by GPS km
        await df.evaluate("(async()=>{await meterEnd();collect()})()");await pg.wait_for_timeout(1500)
        bill=' '.join((await D.locator('.bill').inner_text()).split())
        gk=round(r[0],1)
        fare_exp=await df.evaluate(f"FARE.cityFare({{id:'sedan',base:130,per:19,incl:1.5}},{gk})")
        check(f'bill: "Fare for {gk} km (GPS)" = ₹{fare_exp}',f'Fare for {gk} km (GPS)' in bill and f'₹{fare_exp}' in bill,bill)
        tr2=await pg.evaluate(f"[...MOCK.store.keys()].filter(k=>k.startsWith('bookings/{bid}/track/')).length")
        check('the last points are uploaded at the end',tr2>len(tr),tr2)
        await D.locator('#got').click();await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('done: fareFinal by GPS, meter summary saved for the office',bk['status']=='done' and bk['fareFinal']==fare_exp and bk['fx']['gps']['km']>0 and bk['fx']['gps']['src']=='web',{k:bk.get(k) for k in ['fareFinal','status']})
        # ---- rider: route + fare complaint
        await pg.wait_for_timeout(1500)
        if await C.locator('#rtmap').count():
            await C.locator('#rtmap').click();await pg.wait_for_timeout(1500)
        t=await cf.evaluate("(document.querySelector('.modal')||{}).textContent||''")
        check('rider: "See the route" shows the map with GPS km',await cf.evaluate("!!document.querySelector('.modal .map')") and re.search(r'GPS \d+\.\d km',t) is not None,t[-80:])
        await C.locator('#rtok').click();await pg.wait_for_timeout(300)
        await C.locator('#fareq').click();await pg.wait_for_timeout(400);await C.locator('#fpn').fill('Driver took a longer road');await C.locator('#fps').click();await pg.wait_for_timeout(800)
        tk=await pg.evaluate("[...MOCK.store.entries()].filter(([k,v])=>k.startsWith('tickets/')&&v.type==='fare').map(([k,v])=>v)")
        check('fare complaint reaches the office with the ride and the note',len(tk)==1 and tk[0]['trip']==bid and 'longer road' in tk[0]['note'],tk)
        # ---- office: booking shows GPS + replay
        fn='bookSheet'
        if fn:
            await of.evaluate(f"{fn}(DB.bk.find(x=>x._id==='{bid}'))");await pg.wait_for_timeout(800)
            t=' '.join((await of.evaluate("(document.querySelector('.modal')||{}).innerText||''")).split())
            check('office booking: fare mode, GPS km and a Replay button','GPS meter' in t and 'GPS' in t and await O.locator('#brt').count()==1,t[:300])
            await O.locator('#brt').click();await pg.wait_for_timeout(1500)
        else:
            await of.evaluate(f"routeReplay(DB.bk.find(x=>x._id==='{bid}'))");await pg.wait_for_timeout(1500)
        t=' '.join((await of.evaluate("(document.querySelector('.modal')||{}).textContent||''")).split())
        check('office replay: route on the map with km and points',await of.evaluate("!!document.querySelector('.modal .map')") and re.search(r'GPS \d+\.\d\d km',t) is not None,t[:160])
        # upfront mini within 15 %: booked fare stays (pure bill function, same as the driver app)
        r2=await df.evaluate("(()=>{const t={t:'local',mode:'upfront',v:'mini',base:110,per:20,incl:1.5,km:6,xp:15};return [FARE.final({fare:210,tariff:t},{km:6.5,gps:true}).trip,FARE.final({fare:210,tariff:t},{km:7.5,gps:true}).trip]})()")
        check('upfront: within 15 % → booked fare; over → GPS km fare',r2[0]==210 and r2[1]==await df.evaluate("FARE.cityFare({id:'mini',base:110,per:20,incl:1.5},7.5)"),r2)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}')
asyncio.run(main())
