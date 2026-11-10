# Customer app start-up speed (the real page with the Google Maps loader; Google is faked here with a set delay):
#  - Google Maps no longer holds up the first screen; no fixed 1.7 s splash any more
#  - a signed-in customer's home waits for Maps (they load at the same time as the sign-in check), at most 3 s;
#    if Maps is slow or fails, the free map is used and Google's map is used on the next screen once it arrives
#  - a returning customer (same account on this phone) sees home without waiting for the profile download
import asyncio, os, re
from playwright.async_api import async_playwright
E=os.path.dirname(os.path.abspath(__file__));R=os.path.dirname(os.path.dirname(E));O=os.path.join(E,'out')
B='http://localhost:8765/tests/e2e/out/'
# the test page = mock-Firebase customer page + the real Maps loader line from index.html
src=open(os.path.join(R,'index.html')).read()
loader=[l for l in src.split('\n') if 'MAPS_READY=new Promise' in l]
assert len(loader)==1,'maps loader must stay on one line'
c2=open(os.path.join(O,'c2.html')).read()
open(os.path.join(O,'cs.html'),'w').write(c2.replace('<head>','<head><script>window.GMAPS_KEY="test-key"</script>'+loader[0],1))
open(os.path.join(O,'harness_s.html'),'w').write(open(os.path.join(O,'harness_x.html')).read().replace('src="c2.html"','src="cs.html"'))
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
# records when each screen first shows (ms from page start) and whether Google's map was ready when a map was made
INIT="""if(location.pathname.endsWith('/cs.html')){window.SEEN={};window.MM=[];
 new MutationObserver(()=>{const a=document.getElementById('app');if(!a)return;const k=document.getElementById('splash')?'splash':a.querySelector('.langcard')?'lang':a.querySelector('.vrow')?'home':a.querySelector('#ph')?'login':'other';if(!(k in SEEN))SEEN[k]=Math.round(performance.now())}).observe(document,{childList:true,subtree:true});
 addEventListener('DOMContentLoaded',()=>{const mk=window.makeMap;window.makeMap=function(cv,o){MM.push(GMAP());return makeCanvasMap(cv,o)}})}"""
async def run(p,maps_ms,signed,slowprofile=False,returning=False):
    b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':420,'height':860})
    pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script(INIT)
    async def maps(route):
        if maps_ms is None:await route.abort();return
        cb=re.search(r'callback=([\w$]+)',route.request.url).group(1)
        await asyncio.sleep(maps_ms/1000)
        await route.fulfill(content_type='text/javascript',body='window.google={maps:{Map:function(){}}};window.%s&&window.%s();'%(cb,cb))
    await pg.route('https://maps.googleapis.com/**',maps)
    pre=''
    if signed:pre+="const mk=makeApi;window.makeApi=()=>{const a=mk();a.sendOtp('9999900011');a.verifyOtp('123456');return a};MOCK.store.set('users/u9999900011',{name:'Priya',phone:'+919999900011'});"
    if slowprofile:pre+="MOCK.delay=3000;"
    await pg.add_init_script("if(location.pathname.endsWith('/harness_s.html'))addEventListener('DOMContentLoaded',()=>{"+pre+"})")
    if returning:await pg.add_init_script("if(location.pathname.endsWith('/cs.html'))try{localStorage.setItem('vct',JSON.stringify({lang:'ta',phone:'9999900011',name:'Priya',logged:true,uid:'u9999900011'}))}catch(e){}")
    else:await pg.add_init_script("if(location.pathname.endsWith('/cs.html'))try{localStorage.removeItem('vct')}catch(e){}")
    await pg.goto(B+'harness_s.html');await pg.wait_for_timeout(max(4500,(maps_ms or 0)+1500))
    cf=pg.frame(url=B+'cs.html')
    r=await cf.evaluate("({seen:SEEN,mm:MM,ready:typeof GMAP==='function'&&GMAP()})")
    await b.close();return r,errs
async def main():
    async with async_playwright() as p:
        r,e=await run(p,6000,False)
        check('new visitor, Maps slow (6 s): language screen within 0.8 s',r['seen'].get('lang',99999)<800,r)
        r,e=await run(p,1200,True)
        check('signed in, Maps 1.2 s: home as soon as Maps is in (≈1.2 s, under 2 s)',1100<=r['seen'].get('home',0)<2000,r)
        check('… and it is Google\'s map',r['mm'][:1]==[True],r['mm'])
        r,e=await run(p,6000,True)
        check('signed in, Maps very slow: home after at most ~3 s, free map',2900<=r['seen'].get('home',0)<3800 and r['mm'][:1]==[False],r)
        check('… Google map ready later for the next screen',r['ready'],r)
        r,e=await run(p,None,True)
        check('signed in, Maps blocked: home quickly with the free map',r['seen'].get('home',99999)<1200 and r['mm'][:1]==[False],r)
        r,e=await run(p,300,True,slowprofile=True,returning=True)
        check('returning customer, slow network (3 s per database read): home without waiting for the profile',r['seen'].get('home',99999)<1500,r)
        r,e=await run(p,300,True,slowprofile=True,returning=False)
        check('first open on this phone: profile is read first (name), then home',r['seen'].get('home',0)>=3000,r)
        check('no page errors',not e,e)
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
