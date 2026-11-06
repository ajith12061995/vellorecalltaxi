# Local area (18 km from Vellore centre) → outstation prompt; auto allowed to 25 km; Tamil Nadu Government 2026 auto fare + notices.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def login_c(C,pg):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await login_c(C,pg)
        # inside the local area: no question, auto at the Government fare
        await cf.evaluate("S.mode='';S.dest='cmc';S.veh='auto';fareScreen();0");await pg.wait_for_timeout(1000)
        q=await cf.evaluate("({modal:!!document.querySelector('#aout'),km:route(S.from,S.dest).km,auto:[...document.querySelectorAll('.veh')].find(x=>x.dataset.v==='auto').querySelector('.price').textContent,note:getComputedStyle(document.getElementById('autonote')).display,txt:document.getElementById('autonote').textContent})")
        want=round(50+25*max(0,q['km']-1.8))
        check('local trip: no outstation question',not q['modal'])
        check('auto price = Govt ₹50 + ₹25/km after 1.8 km',q['auto']=='₹%d'%want,(q['auto'],want,q['km']))
        check('customer sees "Tamil Nadu Government 2026" auto note',q['note']!='none' and '2026' in q['txt'] and ('அரசு' in q['txt'] or 'Government' in q['txt']),q['txt'][:80])
        await C.locator('.veh[data-v="sedan"]').click();await pg.wait_for_timeout(200)
        check('note hidden for cars',await cf.evaluate("getComputedStyle(document.getElementById('autonote')).display")=='none')
        # Arcot (~20 km from centre): question with outstation + auto
        await cf.evaluate("setCustom('drop',{lat:12.9063,lon:79.3189});P.drop.ta=P.drop.en='Arcot';S.dest='drop';S.mode='';S.autoFor='';fareScreen();0");await pg.wait_for_timeout(600)
        m=await cf.evaluate("({out:!!document.querySelector('#aout'),auto:!!document.querySelector('#aauto'),t:(document.querySelector('.modal')||{}).textContent||''})")
        check('outside 18 km: asks "Continue with Outstation"',m['out'] and ('Outstation' in m['t']),m['t'][:90])
        check('within 25 km: auto option offered',m['auto'])
        await C.locator('#aauto').click();await pg.wait_for_timeout(900)
        v=await cf.evaluate("[...document.querySelectorAll('.veh')].map(x=>x.dataset.v)")
        check('auto option: only auto listed',v==['auto'],v)
        # book it: tariff carries Govt waiting ₹1/min
        await cf.evaluate("S.pay='cash';cloudBook();0");await pg.wait_for_timeout(3000)
        bid=await cf.evaluate("R&&R.id");bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']") if bid else None
        km=bk and bk['km']
        check('auto booking saved with Govt fare + waiting ₹1/min',bk and bk['veh']=='auto' and bk['tariff']['wait']==1 and bk['fare']==round(50+25*max(0,km-1.8)),bk and (bk['fare'],bk['km'],bk['tariff']))
        await cf.evaluate("(async()=>{try{await cancelRide&&cancelRide('test')}catch(e){}})();0")
        # Continue with Outstation
        await cf.evaluate("forgetRide&&forgetRide();R=null;S.mode='';S.autoFor='';fareScreen();0");await pg.wait_for_timeout(600)
        await C.locator('#aout').click();await pg.wait_for_timeout(900)
        check('Continue with Outstation opens the outstation screen',await cf.evaluate("S.mode==='out'&&!!document.querySelector('[data-t=\"one\"]')"))
        check('outstation screen offers auto (≤25 km)',await cf.evaluate("!!document.getElementById('goauto')"))
        # beyond 25 km: no auto
        await cf.evaluate("setCustom('drop',{lat:12.79,lon:79.37});P.drop.ta=P.drop.en='Far';S.dest='drop';S.mode='';S.autoFor='';fareScreen();0");await pg.wait_for_timeout(600)
        m=await cf.evaluate("({out:!!document.querySelector('#aout'),auto:!!document.querySelector('#aauto')})")
        check('beyond 25 km: outstation only, no auto',m['out'] and not m['auto'],m)
        await pg.screenshot(path='shots/area_ask.png',clip={'x':0,'y':0,'width':400,'height':860})
        # driver: offer card for an auto ride shows the Government fare note
        bk2="{id:'A1',customerUid:'u1',custName:'Priya',kind:'ride',veh:'auto',km:4,fare:105,pay:'cash',status:'searching',created:Date.now(),from:{key:null,ta:'A',en:'A',lat:12.95,lon:79.13},to:{key:null,ta:'B',en:'B',lat:12.97,lon:79.15}}"
        await df.evaluate(f"(()=>{{incoming(buildJ({bk2},'A1'))}})()");await pg.wait_for_timeout(600)
        t=await df.evaluate("document.body.innerText")
        check('driver offer shows "Tamil Nadu Government 2026" auto fare',('2026' in t) and ('அரசு' in t or 'Government' in t))
        await pg.screenshot(path='shots/area_driver.png',clip={'x':400,'y':0,'width':400,'height':860})
        # office: auto price = Government fare, not editable
        o=await of.evaluate("fareO('auto',5)")
        check('office auto 5 km = ₹130',o==130,o)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
