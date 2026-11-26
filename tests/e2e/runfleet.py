# Office live fleet map (26 Nov, "Rapido / Ola / Uber monitoring"): each vehicle is its own top-view icon turned to its heading,
# status ring colour, faded when the phone is silent; markers slide to new positions; tap → card (speed, last report,
# accuracy, ride, call, follow, details) and the route to pickup / drop; filters by state and vehicle.
# Runs the real Google-map code path against a recording fake of google.maps.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
FAKEG="""(()=>{const MK=window.__mk=[];window.__pl=[];
function Map(el,o){this.c=o.center;this.z=o.zoom;this.controls={0:[]}}
Map.prototype={addListener(){},getCenter(){const c=this.c;return{lat:()=>c.lat,lng:()=>c.lng}},setCenter(c){this.c=c},getZoom(){return this.z},setZoom(z){this.z=z},panTo(c){this.c=c},fitBounds(){},getMapTypeId(){return'roadmap'},setMapTypeId(){}};
function Marker(o){Object.assign(this,o);this.ls={};MK.push(this)}
Marker.prototype={setPosition(p){this.position=p},getPosition(){const p=this.position;return{lat:()=>p.lat,lng:()=>p.lng}},setIcon(i){this.icon=i},setLabel(l){this.label=l},setZIndex(z){this.zIndex=z},setMap(m){this.map=m},addListener(e,f){this.ls[e]=f}};
function Poly(o){Object.assign(this,o);__pl.push(this)}Poly.prototype={setPath(p){this.path=p},setMap(m){this.map=m},setCenter(){},setRadius(){}};
window.GMAPS_KEY='t';window.google={maps:{Map,Marker,Polyline:Poly,Circle:Poly,Size:function(w,h){this.w=w;this.h=h},Point:function(x,y){this.x=x;this.y=y},LatLngBounds:function(){this.extend=()=>{}},SymbolPath:{CIRCLE:0},ControlPosition:{LEFT_BOTTOM:0}}}})()"""
FM="(()=>__mk.filter(m=>m.map&&m.icon&&m.icon.url&&m.label&&m.label.className==='gflab').map(m=>({t:m.title,lab:m.label.text,lat:m.position.lat,lng:m.position.lng,svg:decodeURIComponent(m.icon.url),z:m.zIndex})))()"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1600,'height':1000})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("""(()=>{const t=Date.now();
          MOCK.store.set('drivers/+919999900011',{name:'Arun S',veh:'sedan',plate:'TN 23 AA 1111',model:'Dzire',wallet:500,rating:5,online:true,createdAt:{__ts:true}});
          MOCK.store.set('live/+919999900011',{lat:12.9600,lon:79.1400,online:true,busy:true,bk:'bk11',veh:'sedan',hd:90,sp:30,acc:7,updatedAt:{__ms:t-5000}});
          MOCK.store.set('drivers/+919999900012',{name:'Bala K',veh:'auto',plate:'TN 23 BB 2222',model:'Bajaj',wallet:500,rating:5,online:true,createdAt:{__ts:true}});
          MOCK.store.set('live/+919999900012',{lat:12.9500,lon:79.1300,online:true,busy:false,bk:'',veh:'auto',hd:-1,sp:0,acc:12,updatedAt:{__ms:t-8000}});
          MOCK.store.set('drivers/+919999900013',{name:'Chandru M',veh:'bike',plate:'TN 23 CC 3333',model:'Splendor',wallet:500,rating:5,online:true,createdAt:{__ts:true}});
          MOCK.store.set('live/+919999900013',{lat:12.9400,lon:79.1500,online:true,busy:false,bk:'',veh:'bike',updatedAt:{__ms:t-40*60000}});
          MOCK.store.set('bookings/bk11',{status:'assigned',driverPhone:'+919999900011',driverName:'Arun S',custName:'Priya',veh:'sedan',fare:150,km:3,
            from:{ta:'காட்பாடி',en:'Katpadi',lat:12.9700,lon:79.1440},to:{ta:'CMC',en:'CMC',lat:12.9250,lon:79.1350},createdAt:{__ts:true},when:t})})()""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2200)
        await of.evaluate(FAKEG);await of.evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(1500)
        mk=await of.evaluate(FM);by={m['lab'][:4]:m for m in mk}
        check('three vehicles drawn as vehicle icons',set(by)=={'1111','2222','3333'},[m['lab'] for m in mk])
        a=by.get('1111',{});c=by.get('3333',{})
        check('sedan turned to its heading (90)','rotate(90 24 24)' in a.get('svg',''),a.get('svg','')[:200])
        check('on a ride → ring in pickup colour','#F2A900' in a.get('svg',''))
        check('moving: speed in the label','30 km/h' in a.get('lab',''),a.get('lab'))
        check('silent phone: faded grey with how long ago','opacity="0.55"' in c.get('svg','') and '#9AA5A0' in c.get('svg','') and '·' in c.get('lab',''),c.get('lab'))
        check('auto drawn with the auto shape, bike with the bike shape',by.get('2222',{}).get('svg','')!=a.get('svg','') and 'translate(' in c.get('svg',''))
        # smooth movement: the sedan moves ~110 m north; the marker slides, it does not jump
        await pg.evaluate("MOCK.fs.setDoc({path:'live/+919999900011'},{...MOCK.store.get('live/+919999900011'),lat:12.9610,updatedAt:{__ms:Date.now()}})")
        await pg.wait_for_timeout(1000)
        mid=[m for m in await of.evaluate(FM) if m['lab'].startswith('1111')][0]['lat']
        await pg.wait_for_timeout(1500)
        end=[m for m in await of.evaluate(FM) if m['lab'].startswith('1111')][0]['lat']
        check('marker slides (in between after ~0.5 s)',12.9600<mid<12.9610,mid)
        check('marker reaches the new place',abs(end-12.9610)<1e-7,end)
        # the auto has no phone heading: worked out from its move east
        await pg.evaluate("MOCK.fs.setDoc({path:'live/+919999900012'},{...MOCK.store.get('live/+919999900012'),lon:79.1320,updatedAt:{__ms:Date.now()}})");await pg.wait_for_timeout(1200)
        hd=await of.evaluate("DB.drv.find(d=>d.id==='+919999900012').hd")
        check('heading from movement when the phone gives none (east ≈ 90)',abs(hd-90)<3,hd)
        # tap the sedan → card + route to the pickup
        await of.evaluate("__mk.find(m=>m.map&&m.label&&m.label.text.startsWith('1111')).ls.click()");await pg.wait_for_timeout(900)
        card=await of.evaluate("(()=>{const e=document.getElementById('fcard');return e&&!e.hidden?e.innerText:''})()")
        check('card: name, plate, ride, speed, last report, accuracy','Arun S' in card and 'TN 23 AA 1111' in card and '30 km/h' in card and '±7 m' in card and ('Katpadi' in card or 'காட்பாடி' in card),card)
        check('card: call link to the driver',await of.evaluate("!!document.querySelector('#fcard a[href=\"tel:+919999900011\"]')"))
        pl=await of.evaluate("__pl.filter(x=>x.map&&x.path&&x.strokeColor==='#12664A').map(x=>x.path)")
        check('route line from the vehicle to the pickup',len(pl)==1 and abs(pl[0][1]['lat']-12.97)<1e-6,pl)
        sel=[m for m in await of.evaluate(FM) if m['lab'].startswith('1111')][0]
        check('picked vehicle drawn on top with a bigger ring',sel['z']==400 and 'r="22.5"' in sel['svg'],sel['z'])
        # follow: the map keeps the vehicle in view as it moves
        await O.locator('#fcf').click();await pg.wait_for_timeout(300)
        await pg.evaluate("MOCK.fs.setDoc({path:'live/+919999900011'},{...MOCK.store.get('live/+919999900011'),lat:12.9700,updatedAt:{__ms:Date.now()}})");await pg.wait_for_timeout(1200)
        cen=await of.evaluate("FMAP.center()")
        check('follow: map moved to the vehicle',abs(cen['lat']-12.97)<1e-4,cen)
        # on the trip the route goes to the drop
        await pg.evaluate("MOCK.fs.setDoc({path:'bookings/bk11'},{...MOCK.store.get('bookings/bk11'),status:'ontrip'})");await pg.wait_for_timeout(1500)
        pl=await of.evaluate("__pl.filter(x=>x.map&&x.path&&x.strokeColor==='#12664A').map(x=>x.path)")
        check('on trip: route to the drop',len(pl)==1 and abs(pl[0][1]['lat']-12.925)<1e-6,pl)
        # filters
        txt=' '.join((await O.locator('#fbar').inner_text()).split())
        check('filter bar with counts',('No signal 1' in txt or 'Signal இல்லை 1' in txt),txt)
        await O.locator('[data-fst=old]').click();await pg.wait_for_timeout(900)
        mk=await of.evaluate(FM)
        check('"No signal" filter → only the silent bike',[m['lab'][:4] for m in mk]==['3333'],[m['lab'] for m in mk])
        check('card closes when its vehicle is filtered out',await of.evaluate("document.getElementById('fcard').hidden"))
        await O.locator('[data-fst=all]').click();await O.locator('[data-fvh=auto]').click();await pg.wait_for_timeout(900)
        mk=await of.evaluate(FM)
        check('"Auto" filter → only the auto',[m['lab'][:4] for m in mk]==['2222'],[m['lab'] for m in mk])
        await O.locator('[data-fvh=all]').click();await pg.wait_for_timeout(900)
        check('all back',len(await of.evaluate(FM))==3)
        # phone setup on the drivers page (26 Nov): what each driver's phone is missing
        await pg.evaluate("""(()=>{const t=Date.now();
          MOCK.fs.updateDoc({path:'drivers/+919999900011'},{dev:{app:'1.0.16+',ovl:true,pwr:true,loc:'granted',notif:'granted',os:'Android 14',mk:'realme',at:{__ms:t}}});
          MOCK.fs.updateDoc({path:'drivers/+919999900012'},{dev:{app:'1.0.15-',ovl:false,pwr:true,loc:'granted',notif:'denied',os:'Android 13',mk:'',at:{__ms:t}}});})()""")
        await of.evaluate("S.sec='drv';save();show()");await pg.wait_for_timeout(1500)
        txt=' '.join((await O.locator('.cards').inner_text()).split())
        check('drivers page: phone line per driver','App 1.0.16+' in txt and 'realme · Android 14' in txt and ('பழையது' in txt or 'older' in txt),txt[:300])
        check('drivers page: no report yet is said plainly',('No phone report yet' in txt or 'Phone விவரம் இன்னும் வரல' in txt))
        tabs=' '.join((await O.locator('.tabs').first.inner_text()).split())
        check('"Phone to fix" tab counts the old-app driver',('Phone to fix 1' in tabs or 'Phone சரி பண்ணணும் 1' in tabs),tabs)
        await O.locator('[data-df=ph]').click();await pg.wait_for_timeout(800)
        txt=' '.join((await O.locator('.cards').inner_text()).split())
        check('"Phone to fix" shows only Bala (old app, no notifications)','Bala K' in txt and 'Arun S' not in txt and ('App needs update' in txt or 'App update வேணும்' in txt or 'older' in txt or 'பழையது' in txt),txt[:300])
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
