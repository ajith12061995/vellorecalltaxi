# Coupons + peak hours (owner 28 Nov). Coupons: the owner adds codes in Office → Settings → Coupons; the customer types a
# code on the fare screen and sees the discount; the booking asks for it; the server's answer (held / why not) reaches
# the customer. Peak: office slots, the customer sees "Peak hours +x%", car fares go up, the auto does not, the bill says Peak.
import asyncio,re,json,datetime
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
        C=pg.frame_locator('#c');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.lang='en';S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        # ---- office: coupons
        check('Settings has Coupons and Peak panels',await O.locator('#cpnp').count()==1 and await O.locator('#peakp').count()==1)
        await O.locator('#cp_code').fill('ab');await O.locator('#cp_val').fill('50');await O.locator('#cp_add').click();await pg.wait_for_timeout(300)
        check('bad code refused',await pg.evaluate("![...MOCK.store.keys()].some(k=>k.startsWith('coupons/'))"))
        await O.locator('#cp_code').fill('vellore50');await O.locator('#cp_val').fill('50');await O.locator('#cp_min').fill('100');await O.locator('#cp_lim').fill('100')
        await O.locator('#cp_add').click();await pg.wait_for_timeout(1200)
        cp=await pg.evaluate("MOCK.store.get('coupons/VELLORE50')")
        check('VELLORE50 saved: ₹50, min ₹100, 100 uses, on, used 0',cp and cp['type']=='amt' and cp['val']==50 and cp['min']==100 and cp['limit']==100 and cp['on'] is True and cp['used']==0,cp)
        await O.locator('#cp_code').fill('TEN10');await O.locator('#cp_type').select_option('pct');await O.locator('#cp_val').fill('10');await O.locator('#cp_max').fill('');await O.locator('#cp_add').click();await pg.wait_for_timeout(400)
        check('% coupon without a ₹ cap refused',await pg.evaluate("!MOCK.store.get('coupons/TEN10')"))
        await O.locator('#cp_max').fill('30');await O.locator('#cp_add').click();await pg.wait_for_timeout(1000)
        lst=' '.join((await O.locator('#cp_list').inner_text()).split())
        check('coupon list shows both with use counts and an OFF button','VELLORE50' in lst and 'TEN10' in lst and 'Used 0/100' in lst and 'Turn off' in lst,lst[:200])
        # ---- office: peak slot that covers now (IST)
        ist=datetime.datetime.utcnow()+datetime.timedelta(hours=5,minutes=30);h=ist.hour
        f='%02d:00'%h;t='%02d:00'%((h+1)%24)
        await O.locator('#pk_on').check();await O.locator('[data-pkf="0"]').fill(f);await O.locator('[data-pkt="0"]').fill(t);await O.locator('[data-pkp="0"]').fill('80');await O.locator('#pk_sv').click();await pg.wait_for_timeout(300)
        check('peak over 50 % refused',(await pg.evaluate("MOCK.store.get('config/app')")).get('peak') is None)
        await O.locator('[data-pkp="0"]').fill('20');await O.locator('#pk_sv').click();await pg.wait_for_timeout(1000)
        pk=(await pg.evaluate("MOCK.store.get('config/app')")).get('peak')
        check('peak saved and copied to the public price list',pk=={'on':True,'slots':[{'from':f,'to':t,'pct':20}]} and (await pg.evaluate("MOCK.store.get('public/prices')") or {}).get('peak')==pk,pk)
        # ---- customer
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800)
        await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}")
        await pg.wait_for_timeout(2000);await cf.evaluate("S.lang='en';CFG.peak="+json.dumps(pk))
        await cf.evaluate("S.from='katpadi';S.dest='cmc';S.veh='mini';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1000)
        nn=await C.locator('#nightnote').inner_text() if await C.locator('#nightnote').count() else ''
        check('fare screen: "Peak hours: +20% included (not on autos)"','Peak hours: +20%' in nn,nn)
        km=await cf.evaluate("route('katpadi','cmc').km")
        mini=await cf.evaluate(f"FARE.withNight(FARE.cityFare(VEH.find(v=>v.id==='mini'),{km}),20)")
        row=' '.join((await C.locator('.veh[data-v=mini]').inner_text()).split())
        check(f'mini fare includes peak (₹{mini})',f'₹{mini}' in row,row)
        auto=await cf.evaluate(f"FARE.withNightV('auto',FARE.cityFare({{id:'auto'}},{km}),FARE.nightFor('auto',null,Date.now()))")
        arow=' '.join((await C.locator('.veh[data-v=auto]').inner_text()).split())
        check(f'auto keeps the Government fare, no peak (₹{auto})',f'₹{auto}' in arow,arow)
        # coupon
        await C.locator('#cpn').click();await pg.wait_for_timeout(300)
        await C.locator('#cpi').fill('nope1');await C.locator('#cpok').click();await pg.wait_for_timeout(800)
        check('unknown code: "This coupon does not exist"','does not exist' in await C.locator('#cpm').inner_text())
        await C.locator('#cpi').fill('vellore50');await C.locator('#cpok').click();await pg.wait_for_timeout(1200)
        cl=await C.locator('#credline').inner_text() if await C.locator('#credline').count() else ''
        check('coupon applied: "Coupon VELLORE50: ₹50 off this ride"','VELLORE50' in cl and '₹50 off' in cl,cl)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        bid=await cf.evaluate("R.id");bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('booking asks for the coupon and ₹50; peak marked in the tariff',bk.get('coupon')=='VELLORE50' and bk.get('disc')==50 and bk['tariff'].get('sur')=='peak' and bk['tariff'].get('night')==20 and bk['fare']==mini,{k:bk.get(k) for k in ['coupon','disc','fare','tariff']})
        check('the coupon is cleared after booking (not reused by mistake)',await cf.evaluate("CPN===null"))
        # the server refuses (e.g. already used) → the customer is told
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{disc:0,discHeld:false,couponWhy:'used'}})");await pg.wait_for_timeout(1200)
        tt=await cf.evaluate("[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')")
        check('server said no: "Coupon not applied: You have already used this coupon"','already used this coupon' in tt,tt)
        # bill line
        r=await cf.evaluate("FARE.final({fare:%d,tariff:R.b.tariff},{}).lines.map(l=>l.en)"%mini)
        check('bill shows "Peak hours +20%"','Peak hours +20%' in r,r)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}')
asyncio.run(main())
