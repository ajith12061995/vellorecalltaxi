# In-app navigation: Navigate opens a full-screen map inside the driver app (not Google Maps); turn banner with
# distance; Tamil voice at 800/300/100 m and "now"; off-route → new route; GPS lost warning; arrival;
# office switch "old way" brings back the Google Maps link.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
# helpers in the driver frame: metres north/east of a point; an L-shaped route (600 m north, right turn, 400 m east)
SETUP="""(()=>{window.__said=[];
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak(u){__said.push(u.text)},cancel(){},getVoices(){return[]}}});
  window.N=(p,m)=>({lat:p.lat+m/111195,lon:p.lon});window.E=(p,m)=>({lat:p.lat,lon:p.lon+m/(111195*Math.cos(p.lat*Math.PI/180))});
  window.__routes=0;window.navRoute=async(a,b,traffic)=>{__routes++;window.__lastTraffic=traffic;const pts=[a];for(let i=0;i<30;i++)pts.push(N(pts[pts.length-1],20));
    const c=pts[pts.length-1];for(let i=0;i<20;i++)pts.push(E(pts[pts.length-1],20));return{pts,secs:300,src:'google'}};})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3000)
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        await df.evaluate(SETUP)
        btn=await df.evaluate("(()=>{const b=document.querySelector('[data-nav]');return b?b.tagName+':'+b.textContent.trim():''})()")
        check('Navigate is an in-app button, not a Google Maps link',btn.startswith('BUTTON') and not await df.evaluate("!!document.querySelector('a.navbtn')"),btn)
        await df.evaluate("stopGeo();GOTFIX=true;LASTFIX=Date.now();POS={lat:12.955,lon:79.139}")
        await D.locator('[data-nav]').click();await pg.wait_for_timeout(1500)
        check('full-screen navigation opened inside the app',await df.evaluate("!!document.getElementById('navfs')&&!!document.querySelector('#navfs .map')"))
        # the mock pickup is next to the driver; navigate to a point 1 km away (end of the test route) instead
        await df.evaluate("navClose();__said=[];__routes=0;navOpen(E(N({lat:12.955,lon:79.139},600),400),'Test drop')");await pg.wait_for_timeout(1500)
        check('first route asked with traffic (ETA)',await df.evaluate("__routes===1&&__lastTraffic===true"))
        st=await df.evaluate("[document.getElementById('ndist').textContent,document.getElementById('ntxt').textContent,document.getElementById('nrem').textContent]")
        check('banner: 600 m → turn right; remaining 1 km',st[0]=='600 மீ' and 'வலது' in st[1] and '1 கி.மீ' in st[2],st)
        check('voice: navigation start in Tamil',any('Navigation ஆரம்பம்' in x for x in await df.evaluate("__said")))
        await pg.screenshot(path='shots/nav_start.png',clip={'x':400,'y':0,'width':400,'height':860})
        # drive north: 250 m, 320 m, 520 m, 590 m
        async def drive(m,east=0):
            await df.evaluate(f"LASTFIX=Date.now();POS=E(N({{lat:12.955,lon:79.139}},{m}),{east});navTick()")
        for m in (250,330,520,590):await drive(m)
        said=await df.evaluate("__said")
        import re
        def call(lo,hi):return any((m:=re.match(r'(\d+) மீட்டரில் வலது',x)) and lo<=int(m.group(1))<=hi for x in said)
        # 600 m away at the start (800 m call), then ≤300 m, ≤100 m, and "now"
        check('voice at start, ~300 m, ~100 m and "now", in Tamil',call(550,650) and call(200,300) and call(50,100) and any('இப்போ வலது' in x for x in said),said)
        check('each call said once (4 calls)',len([x for x in said if 'வலது' in x])==4,said)
        check('map keeps following the driver while driving',await df.evaluate("(()=>{const c=NAV.map.center();return VNAV.dist({lat:c.lat,lon:c.lon},POS)<5||NAV.follow<=Date.now()})()"))
        await pg.wait_for_timeout(900)
        st=await df.evaluate("[document.getElementById('ndist').textContent,document.getElementById('ntxt').textContent]")
        await pg.screenshot(path='shots/nav_turn.png',clip={'x':400,'y':0,'width':400,'height':860})
        # turned right; now off the route: 150 m north of the eastward leg, 3 fixes
        await drive(600,100)
        n0=await df.evaluate("__routes")
        for m in (150,160,170):await drive(600+m,100)
        await pg.wait_for_timeout(500)
        check('off the route → voice + new route (without traffic, cheaper)',await df.evaluate(f"__routes==={n0}+1&&__lastTraffic===false") and any('வழி மாறிட்டீங்க' in x for x in await df.evaluate("__said")))
        # GPS lost
        await df.evaluate("LASTFIX=Date.now()-20000;navTick()")
        check('GPS lost → red warning + voice',await df.evaluate("!document.getElementById('ngps').hidden") and any('GPS signal' in x for x in await df.evaluate("__said")))
        await pg.screenshot(path='shots/nav_gps.png',clip={'x':400,'y':0,'width':400,'height':860})
        await df.evaluate("LASTFIX=Date.now();navTick()")
        await D.locator('#nmap').dispatch_event('pointerdown');f=await df.evaluate("NAV.follow-Date.now()")
        check('driver touches the map → stops following for ~8 s',7000<f<=8000,f)
        await df.evaluate("NAV.follow=0")
        check('GPS back → warning hidden',await df.evaluate("document.getElementById('ngps').hidden"))
        # backup + mute
        await D.locator('#nmore').click();await pg.wait_for_timeout(200)
        href=await df.evaluate("document.querySelector('#nmenu a').href")
        check('backup: Google Maps link only inside the ⋮ menu',href.startswith('https://www.google.com/maps/dir/'),href[:50])
        await D.locator('#nmute').click();k=len(await df.evaluate("__said"))
        await df.evaluate("NAV.said=new Set();LASTFIX=Date.now();navTick()")
        check('mute stops the voice',len(await df.evaluate("__said"))==k)
        await D.locator('#nmute').click()
        # arrive at the destination (the pin)
        await df.evaluate("POS={lat:NAV.dest.lat,lon:NAV.dest.lon};LASTFIX=Date.now();navTick()")
        check('arrival: banner + voice',await df.evaluate("document.getElementById('ndist').textContent")=='வந்தாச்சு' and any('வந்துட்டீங்க' in x for x in await df.evaluate("__said")))
        await D.locator('#nclose').click();await pg.wait_for_timeout(300)
        check('close returns to the trip screen',not await df.evaluate("!!document.getElementById('navfs')") and await df.evaluate("!!document.getElementById('arr')"))
        # office switch: old way
        await pg.evaluate("MOCK.fs.setDoc({path:'config/app'},{comm:10,minbal:100,extNav:true})");await pg.wait_for_timeout(1200)
        await df.evaluate("toPickup()");await pg.wait_for_timeout(600)
        a=await df.evaluate("(document.querySelector('a.navbtn')||{}).href||''")
        check('office switch "old way" → Google Maps link again',a.startswith('https://www.google.com/maps/dir/'),a[:50])
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
