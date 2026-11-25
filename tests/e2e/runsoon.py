# "Free soon" (25 Nov): when no vehicle of a type is free near the pickup, show the time a vehicle that is finishing a trip
# within 3 km can reach the customer ("available after about 7:30"). Driver app publishes the estimate only during a local trip.
import asyncio,json
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
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(1500)
        pu=json.loads(await cf.evaluate("JSON.stringify({lat:(P[S.from]||P.home).lat,lon:(P[S.from]||P.home).lon})"))
        async def cars(js):
            await pg.evaluate("()=>{[...MOCK.store.keys()].filter(k=>k.startsWith('cars/')).forEach(k=>MOCK.store.delete(k))}")
            await pg.evaluate("""([pu,js])=>{const t=Date.now(),G=(a,b)=>document.getElementById('c').contentWindow.eval('VGEO').gh(a,b);
              const c=(id,o)=>{const d={lat:pu.lat+0.05,lon:pu.lon+0.05,gh:G(pu.lat+0.05,pu.lon+0.05),online:true,on:true,busy:true,veh:'sedan',updatedAt:{__ms:t-20000},...o};
                if(d.flat!=null)d.fgh=G(d.flat,d.flon);MOCK.store.set('cars/'+id,d)};
              new Function('c','t','pu',js)(c,t,pu);MOCK.notify&&MOCK.notify()}""",[pu,js])
            await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(1200)
        soon=lambda v:cf.evaluate(f"soonAt('{v}')")
        now=lambda:cf.evaluate("Date.now()")
        # 1. one sedan finishing a trip 1 km from the pickup, free in 10 min
        await cars("c('s1',{fAt:t+10*6e4,flat:pu.lat+0.009,flon:pu.lon})")
        n=await now();so=await soon('sedan')
        check('busy vehicle with a drop nearby is found although the vehicle itself is far',so>0,so)
        mins=(so-n)/6e4
        check('time = free time + drop→pickup + 3 min, rounded up to 5 min (16.. → 20)',15<mins<=20 and so%300000==0,round(mins,1))
        check('other vehicle types get no promise',await soon('auto')==0)
        # 2. limits
        await cars("c('far',{fAt:t+5*6e4,flat:pu.lat+0.04,flon:pu.lon})")
        check('drop more than 3 km from the pickup → not offered',await soon('sedan')==0)
        await cars("c('late',{fAt:t+50*6e4,flat:pu.lat+0.005,flon:pu.lon})")
        check('more than 45 min away → not offered',await soon('sedan')==0)
        await cars("c('quiet',{fAt:t+5*6e4,flat:pu.lat+0.005,flon:pu.lon,updatedAt:{__ms:t-10*6e4}})")
        check('phone quiet for 10 min → estimate not trusted',await soon('sedan')==0)
        await cars("c('old',{fAt:t-20*6e4,flat:pu.lat+0.005,flon:pu.lon})")
        check('estimate that passed 20 min ago → not offered',await soon('sedan')==0)
        await cars("c('free',{busy:false,fAt:t+5*6e4,flat:pu.lat+0.005,flon:pu.lon})")
        check('a vehicle that is not on a trip is never a "free soon" one',await soon('sedan')==0)
        await cars("c('a',{fAt:t+25*6e4,flat:pu.lat+0.005,flon:pu.lon});c('b',{fAt:t+8*6e4,flat:pu.lat+0.01,flon:pu.lon})")
        n=await now();so=await soon('sedan');check('earliest of several vehicles wins',(so-n)/6e4<=20,round((so-n)/6e4,1))
        # 3. fare screen row
        await cf.evaluate("S.logged=true;S.dest=Object.keys(P).find(k=>k!==S.from&&P[k].lat!=null&&hav(P[k],P[S.from])>1&&hav(P[k],P[S.from])<8);S.veh='sedan';S.when=null;fareScreen()")
        await pg.wait_for_timeout(1500);await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(5500)
        row=C.locator('[data-soon="sedan"]')
        txt=await row.inner_text() if await row.count() else ''
        check('fare list shows "free after about HH:MM" on the sedan row',':' in txt and ('after about' in txt or 'மேல' in txt),txt)
        check('rows of other types keep the normal line',await C.locator('[data-soon="auto"]').count()==0)
        check('Book button stays usable',not await C.locator('#bookb').is_disabled())
        # a free sedan appears near the pickup → the line goes away
        await pg.evaluate("""(pu)=>{const G=document.getElementById('c').contentWindow.eval('VGEO').gh;MOCK.store.set('cars/free1',{lat:pu.lat+0.002,lon:pu.lon,gh:G(pu.lat+0.002,pu.lon),online:true,on:true,busy:false,veh:'sedan',updatedAt:{__ms:Date.now()}});MOCK.notify&&MOCK.notify()}""",pu)
        await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(5500)
        dbg=await cf.evaluate("JSON.stringify({near:NEAR,free:freeNear('sedan'),av:vAvail(VEH.find(v=>v.id==='sedan')),from:S.from,modal:!!document.querySelector('.modal')})")
        check('line disappears as soon as a free sedan is nearby',await C.locator('[data-soon="sedan"]').count()==0,dbg)
        await pg.evaluate("()=>{MOCK.store.delete('cars/free1');MOCK.notify&&MOCK.notify()}");await cf.evaluate("NEARKEY='';watchNear()");await pg.wait_for_timeout(1200)
        # 4. no-vehicle sheet
        await cf.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove());NODRV={from:S.from,dest:S.dest,veh:'sedan',tip:0};sorrySheet('nodriver')")
        await pg.wait_for_timeout(600)
        st=await C.locator('#sorrysoon').inner_text() if await C.locator('#sorrysoon').count() else ''
        check('no-vehicle sheet tells when to try again',':' in st,st)
        await cf.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove());NODRV={from:S.from,dest:S.dest,veh:'auto',tip:0};sorrySheet('nodriver')")
        await pg.wait_for_timeout(600)
        check('no promise on the sheet when nothing is finishing nearby',await C.locator('#sorrysoon').count()==0)
        # 5. driver app estimate
        r=await df.evaluate("""()=>{const o={};const keep={J,S_on:S.online,drop:P.drop,POS:{...POS},GF:GOTFIX};
          const set=(st,kind)=>{J={id:'x1',b:{status:st,kind}};S.online=true;GOTFIX=true;POS={lat:12.92,lon:79.13};P.drop={lat:12.94567,lon:79.13456}};
          const now=Date.now();
          set('ontrip','ride');o.trip=freeSoon(now);
          set('assigned','ride');o.pick=freeSoon(now);
          set('ontrip','rental');o.rent=freeSoon(now);
          set('ontrip','outstation');o.out=freeSoon(now);
          set('ontrip','ride');S.online=false;o.off=freeSoon(now);
          J=null;S.online=true;o.idle=freeSoon(now);
          J=keep.J;S.online=keep.S_on;P.drop=keep.drop;POS=keep.POS;GOTFIX=keep.GF;o.now=now;return o}""")
        t=r['trip']
        check('driver app: estimate published during a local trip',t.get('fAt',0)>r['now'] and 'fgh' in t,t)
        km=2.9*1.3;exp=(km*3+2)
        check('driver app: time left = road km x 3 min + 2 min',abs((t['fAt']-r['now'])/6e4-exp)<1.5,round((t['fAt']-r['now'])/6e4,1))
        check('driver app: only the drop AREA goes out (2 decimals ≈ 1 km)',t['flat']==12.95 and t['flon']==79.13,[t.get('flat'),t.get('flon')])
        check('driver app: nothing published before pickup, for rental / outstation, when OFF, or idle',all(r[k]=={} for k in ['pick','rent','out','off','idle']),{k:r[k] for k in ['pick','rent','out','off','idle']})
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
