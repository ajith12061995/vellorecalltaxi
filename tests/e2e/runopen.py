# Driver app start-up (25 Nov, from the owner's screen recording: white screen, then the logo for seconds):
#  - the logo screen is part of the page, so it shows the moment the page arrives (not after every script has run)
#  - Google Maps and the fonts load in the background; nothing is written into the page with document.write
#  - a signed-in driver's home waits for Maps at most 3 s (they load while the sign-in is checked)
#  - no network at start → "You are offline" with Try again, never the "not a driver" / joining page
#  - Office on a phone whose browser has "Desktop site" on comes up in the phone layout (core/phonefit.js)
import asyncio, os, re, json
from playwright.async_api import async_playwright
E=os.path.dirname(os.path.abspath(__file__));R=os.path.dirname(os.path.dirname(E));O=os.path.join(E,'out')
B='http://localhost:8765/tests/e2e/out/'
src=open(os.path.join(R,'driver/index.html')).read()
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
loader=[l for l in src.split('\n') if 'MAPS_READY=new Promise' in l]
head=src[:src.index('</head>')]
check('driver page: Maps loader is one background script, no document.write anywhere',len(loader)==1 and 'document.write(' not in src.replace('w.document.write(',''),len(loader))
check('driver page: Firebase modules and connections are requested at the top of the page',head.index('modulepreload')<head.index('unpkg.com/leaflet') and head.count('rel="modulepreload"')==4 and 'rel="preconnect" href="https://www.gstatic.com"' in head)
check('driver page: fonts do not hold up the first paint',re.search(r'fonts\.googleapis\.com/css2[^>]*media="print" onload="this\.media=\'all\'"',src) is not None)
body=src[src.index('<body'):];a=body.index('id="app"');first_script=body.index('<script',a)
check('driver page: the logo screen is in the page before any script of the body',a<body.index('id="splash"')<first_script and 'class="roofsign"' in body[a:first_script])
d2=open(os.path.join(O,'d2.html')).read()
open(os.path.join(O,'dk.html'),'w').write(d2.replace('<head>','<head><script>window.GMAPS_KEY="test-key"</script>'+loader[0],1))
open(os.path.join(O,'harness_k.html'),'w').write(open(os.path.join(O,'harness_x.html')).read().replace('src="d2.html"','src="dk.html"'))
INIT="""if(location.pathname.endsWith('/dk.html')){window.SEEN={};window.MM=[];
 const look=()=>{const a=document.getElementById('app');if(!a)return;const k=document.getElementById('splash')?'splash':a.querySelector('#ons,#offs')?'home':a.querySelector('#ph')?'login':a.querySelector('#rl')?'offline':'other';if(!(k in SEEN))SEEN[k]=Math.round(performance.now())};
 new MutationObserver(look).observe(document,{childList:true,subtree:true});
 addEventListener('DOMContentLoaded',()=>{window.SEEN.dcl=Math.round(performance.now());window.makeMap=function(cv,o){MM.push(GMAP());return makeCanvasMap(cv,o)}})}"""
async def run(p,maps_ms,down=False,extra='',slowms=1500,stored=None,evaljs=None,wait=None):
    b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9165,'longitude':79.1325},permissions=['geolocation'])
    pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script(INIT)
    async def maps(route):
        if maps_ms is None:await route.abort();return
        cb=re.search(r'callback=([\w$]+)',route.request.url).group(1)
        await asyncio.sleep(maps_ms/1000)
        await route.fulfill(content_type='text/javascript',body='window.google={maps:{Map:function(){}}};window.%s&&window.%s();'%(cb,cb))
    await pg.route('https://maps.googleapis.com/**',maps)
    async def slow(route):   # the app's own scripts arrive late, like on a weak mobile network
        await asyncio.sleep(slowms/1000);await route.continue_()
    await pg.route('**/core/report.js*',slow)
    pre="const mk=makeApi;window.makeApi=()=>{const a=mk();a.sendOtp('9999900002');a.verifyOtp('123456');return a};"+("MOCK.down=true;" if down else "")+extra
    await pg.add_init_script("if(location.pathname.endsWith('/harness_k.html'))addEventListener('DOMContentLoaded',()=>{"+pre+"})")
    STORED=json.dumps(stored or {'lang':'ta','logged':True,'pid':'cloud','phone':'9999900002'})
    await pg.add_init_script("if(location.pathname.endsWith('/dk.html'))try{localStorage.setItem('vctd',JSON.stringify("+STORED+"))}catch(e){}")
    await pg.goto(B+'harness_k.html');await pg.wait_for_timeout(wait or max(4800,(maps_ms or 0)+1500))
    df=pg.frame(url=B+'dk.html')
    r=await df.evaluate("({seen:SEEN,mm:MM,ready:typeof GMAP==='function'&&GMAP(),url:location.pathname,gmap:!!document.querySelector('.gmap')})")
    if evaljs:r['x']=await pg.evaluate(evaljs) if evaljs.startswith('H:')==False else None
    await b.close();return r,errs
async def main():
    async with async_playwright() as p:
        r,e=await run(p,1000)
        s=r['seen']
        check('logo screen is on screen before the page\'s scripts have finished (a script held back 1.5 s)',s.get('splash',9e9)<s.get('dcl',0)-800,s)
        check('Maps 1 s: home right after the page\'s own scripts (held 1.5 s), on Google\'s map',900<=s.get('home',0)<3000 and r['mm'][:1]==[True],[s,r['mm']])
        r,e2=await run(p,6000)
        check('Maps very slow (6 s): home does not wait for it (by ~2.6 s) on the built-in map',r['seen'].get('home',9e9)<2600 and r['mm'][:1]==[False],r)
        check('… and home switches to Google\'s map by itself when it arrives (home redrawn with it)',r['ready'] and r['mm'][:1]==[False] and True in r['mm'],r['mm'])
        r,e3=await run(p,None)
        check('Maps blocked: home without waiting',r['seen'].get('home',9e9)<2600 and r['mm'][:1]==[False],r)
        r,e4=await run(p,300,down=True,extra='MOCK.nocache=true;')
        check('no network and nothing saved on the phone: "You are offline" + Try again, still on the driver page',('offline' in r['seen']) and 'home' not in r['seen'] and r['url'].endswith('/dk.html'),r)
        r,e5=await run(p,300,down=True)
        check('no network but the phone has the driver\'s saved copy: home opens anyway',('home' in r['seen']) and 'offline' not in r['seen'],r)
        # saved copy vs server: the server delays every read 1.5 s; home must not wait for it
        r,e6=await run(p,300,extra='MOCK.delay=1500;',slowms=200)
        check('slow network (1.5 s per server read): home from the saved copy without waiting for the server',r['seen'].get('home',9e9)<1500,r['seen'])
        r,e7=await run(p,300,extra='MOCK.delay=1500;MOCK.nocache=true;',slowms=200)
        check('… first open on this phone (no saved copy): waits for the server read, as before',r['seen'].get('home',0)>=1500,r['seen'])
        # the saved copy is out of date: wallet was fine, the server says it is now below the minimum → taken offline with a message
        stale="MOCK.store.set('config/app',{comm:0,minbal:100});MOCK.cache={'drivers/+919999900002':{...MOCK.store.get('drivers/+919999900002'),wallet:500,online:true}};MOCK.store.set('drivers/+919999900002',{...MOCK.store.get('drivers/+919999900002'),wallet:40,online:true});"
        r,e8=await run(p,300,extra=stale,slowms=200,stored={'lang':'en','logged':True,'pid':'cloud','phone':'9999900002','online':True},evaljs="(()=>{const f=[...document.querySelectorAll('iframe')].find(x=>/dk\\.html/.test(x.src)).contentWindow;return {on:f.eval('S.online'),db:MOCK.store.get('drivers/+919999900002').online,toast:f.document.getElementById('toast').textContent}})()")
        check('saved copy out of date (wallet now low): the live record takes the driver offline, says why',r['x']['on']==False and r['x']['db']==False and 'Wallet' in r['x']['toast'],r['x'])
        gone="MOCK.cache={'drivers/+919999900002':MOCK.store.get('drivers/+919999900002')};MOCK.store.delete('drivers/+919999900002');"
        r,e9=await run(p,300,extra=gone,slowms=200,evaljs="(()=>{const f=[...document.querySelectorAll('iframe')].find(x=>/dk\\.html/.test(x.src)).contentWindow;return {txt:f.document.getElementById('app').innerText.slice(0,120),dme:f.eval('DME')}})()")
        check('driver removed by the office since the last open: the live record shows "not registered"',r['x']['dme'] is None and ('not registered' in r['x']['txt'] or 'சேர்க்கப்படல' in r['x']['txt']),r['x'])
        e4=e4+e5+e6+e7+e8+e9
        check('no page errors',not (e+e2+e3+e4),(e+e2+e3+e4)[:2])
        # GPS has not answered yet: a calm "finding your location" line first, the red warning only after 10 s
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();ge=[];pg.on('pageerror',lambda e:ge.append(str(e)))
        await pg.add_init_script("if(location.pathname.endsWith('/d2.html')){try{localStorage.setItem('vctd',JSON.stringify({lang:'en',logged:true,pid:'cloud',phone:'9999900002',online:true}))}catch(e){};Object.defineProperty(navigator,'geolocation',{value:{watchPosition(){return 7},clearWatch(){},getCurrentPosition(){}}})}")
        await pg.add_init_script("if(location.pathname.endsWith('/harness_x.html'))addEventListener('DOMContentLoaded',()=>{const mk=makeApi;window.makeApi=()=>{const a=mk();a.sendOtp('9999900002');a.verifyOtp('123456');return a}})")
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(3500)
        df=pg.frame(url=B+'d2.html')
        g=await df.evaluate("(()=>{const e=document.getElementById('gpsw');return {on:S.online,cls:e&&e.className,txt:e&&e.innerText.replace(/\\s+/g,' ')}})()")
        check('online, GPS silent, first seconds: "Finding your location…" (not the red warning)',g['on'] and g['cls']=='liveCard' and 'Finding your location' in (g['txt'] or ''),g)
        await pg.wait_for_timeout(8500)
        g=await df.evaluate("(()=>{const e=document.getElementById('gpsw');return {cls:e&&e.className,txt:e&&e.innerText.replace(/\\s+/g,' ').slice(0,60),retry:!!document.getElementById('gpsr')}})()")
        check('still no GPS after 10 s: the red warning with Retry',g['cls'] and 'warn' in g['cls'] and g['retry'],g)
        await df.evaluate("geoFix(12.9165,79.1325,10)");await pg.wait_for_timeout(600)
        g=await df.evaluate("({w:!!document.getElementById('gpsw'),t:document.querySelector('.liveCard')&&document.querySelector('.liveCard').innerText.replace(/\\s+/g,' ')})")
        check('GPS arrives: warning gone, normal "waiting for ride requests"',not g['w'] and 'Waiting for ride requests' in (g['t'] or ''),g)
        # live data redraws home: no entry animation (it blinked in the 25 Nov recording); a new screen still animates
        a1=await df.evaluate("(()=>{home();const sc=document.querySelector('#app .screen');return getComputedStyle(sc).animationName})()")
        a2=await df.evaluate("(()=>{S.tab='earn';document.querySelector('[data-tab=earn],[data-t=earn],.nav button:nth-child(2)').click();const sc=document.querySelector('#app .screen');return getComputedStyle(sc).animationName})()")
        a3=await df.evaluate("(()=>{home();const sc=document.querySelector('#app .screen');return getComputedStyle(sc).animationName})()")
        check('home redrawn in place: no blink; other screens and coming back to home still animate',a1=='none' and a2=='in' and a3=='in',[a1,a2,a3])
        check('no page errors (GPS)',not ge,ge[:2]);await b.close()
        # Office on a phone with "Desktop site" on
        async def office(desk,touch=True,screen=(360,800),vp=None):
            b=await p.chromium.launch();ctx=await b.new_context(viewport=vp or ({'width':980,'height':2178} if desk else {'width':360,'height':800}),screen={'width':screen[0],'height':screen[1]},has_touch=touch)
            pg=await ctx.new_page();await pg.goto(B+'o2.html');await pg.wait_for_timeout(1500)
            ins=pg.locator('input');await ins.nth(0).fill('9999900000');await ins.nth(1).fill('1234');await pg.locator('#lgn').click();await pg.wait_for_timeout(1800)
            if await pg.locator('.mob button').count() and await pg.locator('.mob').is_visible():await pg.locator('.mob button',has_text='Drivers').click();await pg.wait_for_timeout(1200)
            r=await pg.evaluate("""()=>{const k=(window.VCTFIT&&VCTFIT.on)?VCTFIT.k:1,g=q=>{const e=document.querySelector(q);return e?getComputedStyle(e).display:'-'};
              return {fit:window.VCTFIT,side:g('.side'),mob:g('.mob'),pos:[...document.querySelectorAll('h1,h2,.mob button,.btn,.lrow,.panel')].slice(0,40).map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.x/k),Math.round(r.y/k),Math.round(r.width/k),Math.round(r.height/k)]}),title:(document.querySelector('h1,h2')||{}).textContent}}""")
            await b.close();return r
        n=await office(False);d=await office(True)
        check('normal phone: nothing changed (helper off, phone layout)',n['fit']['on']==False and n['side']=='none' and n['mob']!='none',n['fit'])
        check('"Desktop site" phone: helper on, side menu hidden, bottom tabs shown',d['fit']['on']==True and d['side']=='none' and d['mob']!='none',[d['fit'],d['side'],d['mob']])
        same=len(n['pos'])==len(d['pos']) and all(abs(x-y)<=3 for a,b2 in zip(n['pos'],d['pos']) for x,y in zip(a,b2))
        check('"Desktop site" phone: Drivers screen laid out exactly like on a normal phone (bottom tab tapped)',same and n['title']==d['title'] and len(n['pos'])>5,[len(n['pos']),len(d['pos']),n['title'],d['title']])
        l=await office(True,touch=False,screen=(1400,900),vp={'width':1400,'height':900})
        check('real laptop: helper off, side menu shown',l['fit']['on']==False and l['side']!='none',[l['fit'],l['side']])
        t=await office(True,touch=True,screen=(800,1280),vp={'width':980,'height':1500})
        check('tablet: helper off',t['fit']['on']==False,t['fit'])
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
