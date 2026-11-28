# Customer app (owner 28 Nov): Green Circle in the places list; Home / Work pinned once and booked in one tap (kept after a
# reload); the home map's centre pin sets the pickup when the map is dragged; after 30 s of searching other vehicle types with
# a driver ON nearby are offered and switching re-books them; cancelling after a driver accepted asks first (Call / wait / cancel).
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
BK="(()=>{const k=[...MOCK.store.keys()].filter(k=>/^bookings\\/[^/]+$/.test(k));return k.map(x=>[x,MOCK.store.get(x).status,MOCK.store.get(x).veh,MOCK.store.get(x).cancelReason||'',MOCK.store.get(x).fare,MOCK.store.get(x).tip||0])})()"
async def login(pg,C,cf):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(800)
    await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}")
    await pg.wait_for_timeout(2000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await login(pg,C,cf)
        await cf.evaluate("S.lang='en';home()");await pg.wait_for_timeout(2500)
        # 1) Green Circle + Add Home / Add Work
        await C.locator('#wh').click();await pg.wait_for_timeout(700)
        ls=' '.join((await C.locator('#ls').inner_text()).split())
        check('Where to: Green Circle is in the list','Green Circle' in ls,ls[:300])
        check('Where to: "Add Home" and "Add Work"','Add Home' in ls and 'Add Work' in ls)
        await C.locator('#dr').fill('green');await pg.wait_for_timeout(400)
        check('typing "green" finds Green Circle',await C.locator('#ls [data-p=green]').count()==1)
        await C.locator('#dr').fill('');await pg.wait_for_timeout(300)
        await C.locator('#ls [data-fav=home]').click();await pg.wait_for_timeout(900)
        bt=await C.locator('#ok').inner_text()
        check('Add Home opens the pin screen with "Save as Home"','Save as Home' in bt,bt)
        await C.locator('#ok').click();await pg.wait_for_timeout(5000)
        fav=await cf.evaluate("JSON.parse(localStorage.getItem('vct-fav')||'{}')")
        check('Home saved on the phone with exact coordinates',bool(fav.get('home')) and abs(fav['home']['lat']-12.955)<0.01,fav)
        check('back on Where to, a Home row with its place',await C.locator('#ls .favrow [data-p=fhome]').count()==1)
        await C.locator('#ls .favrow [data-p=fhome]').click();await pg.wait_for_timeout(1200)
        check('one tap on Home → fare screen to Home',await cf.evaluate("S.dest==='fhome'&&!!document.getElementById('bookb')"))
        po=await cf.evaluate("placeOf('fhome')")
        check('the booking place carries Home coordinates, no fixed key',po['key'] is None and abs(po['lat']-fav['home']['lat'])<1e-9,po)
        # edit Work via the row; edit icon on Home exists
        await cf.evaluate("search()");await pg.wait_for_timeout(600)
        check('Home row has a change button',await C.locator('#ls .favedit[data-fav=home]').count()==1)
        # 2) home map centre pin
        await cf.evaluate("home()");await pg.wait_for_timeout(1500)
        await cf.evaluate("locateMe(true)");await pg.wait_for_timeout(3500)
        hp=await cf.evaluate("[GOTPOS,!!document.getElementById('hpin'),(document.getElementById('hpinlbl')||{}).textContent||'',S.from]")
        check('home map shows the centre pin "Pickup · your location"',hp[0] and hp[1] and 'your location' in hp[2] and hp[3]=='home',hp)
        box=await C.locator('.mapwrap').first.bounding_box()
        if box:
            x,y=box['x']+box['width']/2,box['y']+box['height']/2
            await pg.mouse.move(x,y);await pg.mouse.down();await pg.mouse.move(x-120,y-90,steps=12);await pg.mouse.up();await pg.wait_for_timeout(1800)
        st=await cf.evaluate("[S.from,P.pick&&hav(P.pick,P.home),(document.getElementById('hpinlbl')||{}).textContent]")
        check('dragging the map moves the pickup to the pin',st[0]=='pick' and st[1] and st[1]>0.05,st)
        await C.locator('#wh').click();await pg.wait_for_timeout(600)
        pu=await C.locator('#pu').input_value()
        check('Where to shows the dragged pickup, not "Your location"',not pu.startswith('Your location'),pu)
        await cf.evaluate("home()");await pg.wait_for_timeout(1500)
        check('back on home the dragged pickup is kept',await cf.evaluate("S.from==='pick'"))
        await cf.evaluate("homePinEnd({lat:P.home.lat,lon:P.home.lon})")
        check('pin back on the phone location → pickup is "your location" again',await cf.evaluate("S.from==='home'&&HPICK===null"))
        # 3) also try another vehicle
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';S.tip0=20;fareScreen()");await pg.wait_for_timeout(1000)
        await pg.evaluate("""()=>{const w=document.getElementById('c').contentWindow,pu=w.eval('P[S.from]'),G=w.eval('VGEO').gh,t=Date.now();
          const c=(id,lat,lon,o)=>MOCK.store.set('cars/'+id,{lat,lon,gh:G(lat,lon),online:true,on:true,busy:false,veh:'sedan',updatedAt:{__ms:t-60e3},...o});
          c('s1',pu.lat+0.03,pu.lon);c('a1',pu.lat+0.003,pu.lon,{veh:'auto'});c('m1',pu.lat+0.01,pu.lon,{veh:'mini'});MOCK.notify&&MOCK.notify()}""")
        await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        dbg=await cf.evaluate("[R&&R.phase,R&&R.v&&R.v.id,S.from,(document.querySelector('.modal')||{}).innerText||'',document.querySelector('h2,h3')&&document.querySelector('h2,h3').textContent]")
        check('booked sedan, searching',await cf.evaluate("!!(R&&R.phase==='search'&&R.v.id==='sedan')"),dbg)
        rid=await cf.evaluate("R.id")
        check('booking id made on the phone (UUID), not a server counter',__import__('re').fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',rid or '') is not None,rid)
        # a retry of the same booking (answer lost) writes the same document: still one booking
        n0=await pg.evaluate("[...MOCK.store.keys()].filter(k=>/^bookings\\/[^/]+$/.test(k)).length")
        await cf.evaluate(f"(async()=>{{BKTRY={{key:'x',id:'{rid}'}};await makeBooking({{...MOCK_B=parent.MOCK.store.get('bookings/{rid}')}},'x')}})()")
        n1=await pg.evaluate("[...MOCK.store.keys()].filter(k=>/^bookings\\/[^/]+$/.test(k)).length")
        check('retrying with the same id never makes a second booking',n0==n1,[n0,n1])
        check('no "also try" in the first 30 s',await cf.evaluate("document.getElementById('alsotry').hidden"))
        await cf.evaluate("R.t0=Date.now()-35000");await pg.wait_for_timeout(5500)
        at=' '.join((await C.locator('#alsotry').inner_text()).split()) if await cf.evaluate("!document.getElementById('alsotry').hidden") else ''
        check('after 30 s: Auto and Mini offered with price and minutes, nearest first','Auto' in at and 'Mini' in at and '₹' in at and 'min' in at and at.index('Auto')<at.index('Mini'),at)
        af=await cf.evaluate("fare(VEH.find(v=>v.id==='auto'),R.km)")
        await C.locator('#alsotry [data-sw=auto]').click();await pg.wait_for_timeout(2500)
        bk=await pg.evaluate(BK)
        sed=[x for x in bk if x[2]=='sedan'];au=[x for x in bk if x[2]=='auto']
        check('switch: sedan booking cancelled by the customer',sed and sed[-1][1]=='cancelled' and sed[-1][3]=='customer',sed)
        check('switch: a new auto booking at the auto fare, tip kept',au and au[-1][1]=='searching' and au[-1][4]==af and au[-1][5]==20,au)
        check('switch: the customer is on the search screen for the auto',await cf.evaluate("R&&R.phase==='search'&&R.v.id==='auto'"))
        # a driver accepts at the same moment → no switch
        await pg.evaluate("(()=>{const k=[...MOCK.store.keys()].filter(k=>/^bookings\\/[^/]+$/.test(k)&&MOCK.store.get(k).status==='searching')[0];MOCK.fs.setDoc({path:k},{...MOCK.store.get(k),status:'assigned',driverPhone:'+919999900077',driverName:'Kumar',plate:'TN 23 AB 1234',vehModel:'Bajaj'})})()")
        await cf.evaluate("(async()=>{R.phase='search';await switchVeh('mini')})()");await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(BK)
        check('driver already took it: switching does nothing (no mini booking, auto stays assigned)',not [x for x in bk if x[2]=='mini'] and [x for x in bk if x[2]=='auto'][-1][1]=='assigned',bk)
        # 4) cancel after a driver accepted
        await pg.wait_for_timeout(1500)
        await cf.evaluate("if(!document.getElementById('cx'))rideCloud()");await pg.wait_for_timeout(800)
        await C.locator('#cx').click();await pg.wait_for_timeout(500)
        t=await cf.evaluate("(document.querySelector('.modal')||{}).innerText||''")
        check('Cancel with a driver coming: "Kumar is already on the way" + Call / wait / cancel','already on the way' in t and await C.locator('#cdcall').count()==1 and await C.locator('#cdback').count()==1 and await C.locator('#cdgo').count()==1,t[:160])
        await C.locator('#cdback').click();await pg.wait_for_timeout(400)
        bk=await pg.evaluate(BK)
        check('"OK, I will wait": ride untouched',[x for x in bk if x[2]=='auto'][-1][1]=='assigned' and await cf.evaluate("!document.querySelector('.modal')"))
        await C.locator('#cx').click();await pg.wait_for_timeout(400);await C.locator('#cdcall').click();await pg.wait_for_timeout(500)
        t=await cf.evaluate("(document.querySelector('.modal')||{}).innerText||''")
        check('"Call driver" opens the call sheet',('Call' in t or 'அழை' in t) and await C.locator('#cdask').count()==0,t[:120])
        await cf.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove())")
        await C.locator('#cx').click();await pg.wait_for_timeout(400);await C.locator('#cdgo').click();await pg.wait_for_timeout(600)
        check('"No, I want to cancel" goes on to the reasons',await C.locator('.modal .reason').count()>=4)
        await C.locator('.modal .reason').nth(1).click();await C.locator('#cyes').click();await pg.wait_for_timeout(1200)
        bk=await pg.evaluate(BK)
        check('cancel still works',[x for x in bk if x[2]=='auto'][-1][1]=='cancelled',bk[-1])
        # Tamil words
        await cf.evaluate("S.lang='ta';search()");await pg.wait_for_timeout(600)
        ls=await C.locator('#ls').inner_text()
        check('Tamil: Home / Work rows','வீடு' in ls and 'வேலை இடம்' in ls and 'கிரீன் சர்க்கிள்' in ls)
        # reload keeps Home
        await pg.reload();await pg.wait_for_timeout(3000);cf=pg.frame(url=B+'c2.html');C=pg.frame_locator('#c')
        await cf.evaluate("S.lang='en';search()");await pg.wait_for_timeout(800)
        check('after reopening the app Home is still there',await C.locator('#ls .favrow [data-p=fhome]').count()==1)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}')
asyncio.run(main())
