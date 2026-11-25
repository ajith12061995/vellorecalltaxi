# Customer map (25 Nov): a vehicle shows while its driver's switch is ON (cars.on), even when the phone has gone quiet;
# visitors who have not signed in see the vehicles too; "x min away" still uses only phones that reported in the last 5 min.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9165,'longitude':79.1325},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(1500)   # guest home (not signed in)
        gh=await cf.evaluate("VGEO.gh((P[S.from]||P.home).lat,(P[S.from]||P.home).lon)")
        c=await cf.evaluate("JSON.stringify(P[S.from]||P.home)")
        await pg.evaluate("""(g)=>{const t=Date.now();const c=(id,o)=>MOCK.store.set('cars/'+id,{lat:12.9165,lon:79.1330,gh:g,busy:false,veh:'sedan',...o});
          c('a',{online:true,on:true,updatedAt:{__ms:t-20000}});               // switch ON, phone reporting
          c('b',{online:false,on:true,veh:'auto',updatedAt:{__ms:t-3*3600e3}});   // switch ON, phone quiet for 3 hours (server cleared "online")
          c('c',{online:false,on:false,updatedAt:{__ms:t-60000}});            // driver switched OFF
          c('d',{online:true,updatedAt:{__ms:t-30000}});                      // older driver app (no "on" field), reporting
          c('e',{online:true,updatedAt:{__ms:t-20*60e3}});                    // older driver app, quiet for 20 min
          c('f',{online:true,on:true,busy:true,updatedAt:{__ms:t-10000}});    // on a ride
          MOCK.notify&&MOCK.notify()}""",gh)
        await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(1500)
        ids=sorted(await cf.evaluate("NEAR.map(n=>n.id)"))
        check('visitor who has not signed in sees the vehicles',len(ids)>0,ids)
        check('shown: switch ON (reporting), switch ON (quiet 3 h), older app reporting',ids==['a','b','d'],ids)
        check('not shown: switched OFF, older app gone quiet, on a ride',not any(x in ids for x in ['c','e','f']),ids)
        fr=await cf.evaluate("Object.fromEntries(NEAR.map(n=>[n.id,n.fresh]))")
        check('"fresh" only for phones that reported in the last 5 minutes',fr=={'a':True,'b':False,'d':True},fr)
        nb=await C.locator('#nbc').inner_text() if await C.locator('#nbc').count() else ''
        check('the "nearby" count includes all three',nb.strip().startswith('3'),nb)
        vt=await cf.evaluate("NEAR.find(n=>n.id==='b').veh")
        check('vehicle type kept for the map icon (auto)',vt=='auto',vt)
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
