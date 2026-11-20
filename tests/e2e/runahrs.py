# Outstation category A (short round trip): hours included in the price, extra booked hours in the quote, office Settings.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def login_c(C,pg):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
ARANI="setCustom('drop',{lat:12.6693,lon:79.2856});P.drop.ta=P.drop.en='Arani';S.dest='drop';S.mode='out';OS.type='round';OS.veh='mini';OS.leave=null;OS.ret=null;outFare2();0"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');O=pg.frame_locator('#o');cf=pg.frame(url=B+'c2.html');of=pg.frame(url=B+'o2.html')
        await login_c(C,pg)
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("settings()");await pg.wait_for_timeout(800)
        v=await of.evaluate("[document.getElementById('o_hrs').value,document.querySelector('[data-xh=mini]').value,document.querySelector('[data-xpv=mini]').textContent]")
        check('office: default hours table, ₹80 mini, Arani preview',v[0]=='30:3, 90:4, 140:5, 180:6, 200:7' and v[1]=='80' and '4' in v[2],v)
        for bad in ['90:4, 30:5','abc','30:0','','90:4, 90:5']:
            await O.locator('#o_hrs').fill(bad);await O.locator('#sv').click();await pg.wait_for_timeout(400)
            d=await pg.evaluate("((MOCK.dump()['config/app']||{}).out||{}).hrs||null")
            check(f'office: bad hours table "{bad}" not saved',d is None,d)
        await O.locator('[data-xh=mini]').fill('0');await O.locator('[data-xh=mini]').dispatch_event('input');await O.locator('#o_hrs').fill('30:3, 90:4, 140:5, 180:6, 200:7')
        await O.locator('#sv').click();await pg.wait_for_timeout(400)
        d=await pg.evaluate("((MOCK.dump()['config/app']||{}).out||{}).xh||null")
        check('office: extra hour ₹0 not saved',d is None,d)
        await O.locator('[data-xh=mini]').fill('100');await O.locator('[data-xh=mini]').dispatch_event('input')
        await O.locator('#o_hrs').fill('30:3, 90:4, 140:5, 180:6, 200:7');await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.dump()['config/app'].out")
        check('office: saved xh mini 100 + table as [{km,h}]',d['xh']['mini']==100 and d['xh']['sedan']==90 and d['hrs']==[{'km':30,'h':3},{'km':90,'h':4},{'km':140,'h':5},{'km':180,'h':6},{'km':200,'h':7}],d.get('xh'))
        pub=await pg.evaluate("(MOCK.dump()['public/prices']||{}).out||null")
        check('public prices copy has hours + xh (customer reads it)',pub and pub.get('xh',{}).get('mini')==100 and len(pub.get('hrs',[]))==5,pub and list(pub.keys()))
        await pg.wait_for_timeout(800)
        await cf.evaluate(ARANI);await pg.wait_for_timeout(900)
        q=await cf.evaluate("(()=>{const {km}=oInfo();return{km,q:oQuote('mini',km),rate:ORATE.mini,bata:oBata('mini',km),xh:AXHR.mini,pill:document.querySelector('.trip').innerText}})()")
        km=q['km'];qq=q['q']
        PH=4 if km*2<=90 else 5
        check(f'Arani ({km} km) is category A round trip, {PH} hrs included, no extra by default',qq['ph']==PH and qq['hx']==0 and qq['plan']<=PH,q)
        check('customer sees "N hrs included" pill',(f'{PH} hrs included' in q['pill']) or (f'{PH} மணி விலையில் சேர்த்து' in q['pill']),q['pill'])
        check('default price = up+down km × rate + allowance × days',qq['total']==round((km*2*q['rate']+q['bata']*qq['days'])/10)*10,qq)  # an evening trip may run past midnight = 2 days
        # customer picks a 12-hour day
        # tomorrow 8:00 → 20:00 Indian time (same day)
        await cf.evaluate("(()=>{const d=new Date(Date.now()+864e5+19800000);const t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),8,0)-19800000;OS.leave=t;OS.ret=t+12*36e5;outFare2()})();0");await pg.wait_for_timeout(600)
        q2=await cf.evaluate("(()=>{const {km}=oInfo();return oQuote('mini',km)})()")
        HX=(12-PH)*100
        check(f'same day 8am–8pm: {12-PH} extra hrs × ₹100 in the price, 1 day allowance',q2['days']==1 and q2['plan']==12 and q2['hx']==HX and q2['total']==round((km*2*q['rate']+q['bata']+HX)/10)*10,q2)
        await C.locator('#bookb').click();await pg.wait_for_timeout(600)
        rv=await cf.evaluate("[!!document.getElementById('oph'),(document.getElementById('ohx')||{}).innerText||'',document.querySelector('.modal')?document.querySelector('.modal').innerText:'']")
        check(f'review shows included time + extra time row with ₹{HX}',rv[0] and str(HX) in rv[1],rv[1])
        check('review tells the late-return rule (₹50 per half hour)',('₹50' in rv[2]),rv[2][-300:])
        await pg.screenshot(path='shots/ahrs_review.png',clip={'x':0,'y':0,'width':420,'height':880})
        await C.locator('#ocf').click();await pg.wait_for_timeout(2500)
        bk=await pg.evaluate("Object.entries(MOCK.dump()).filter(([k,v])=>k.startsWith('bookings/')&&v.kind==='outstation').map(([k,v])=>({fare:v.fare,t:v.tariff,ret:v.retAt,when:v.when})).pop()||null")
        check('booking saved with ph, xh 100, plan 12, hx and the same fare',bk and bk['t'].get('ph')==PH and bk['t'].get('xh')==100 and bk['t'].get('plan')==12 and bk['t'].get('hx')==HX and bk['fare']==q2['total'],bk)
        # bill at the end with the shared fare code: back 1 h 20 m after the booked time → 15 min free, then 3 half hours
        if bk:
            f=await cf.evaluate(f"FARE.final({{fare:{bk['fare']},tariff:{__import__('json').dumps(bk['t'])}}},{{km:{km*2},mins:12*60+80}})")
            check('final bill: 3 half hours × ₹50 extra',f['trip']==bk['fare']+150 and any(l['k']=='xhr' for l in f['lines']),f)
        # one way stays without hours (B category Tirupati)
        await cf.evaluate("setCustom('drop',{lat:13.6288,lon:79.4192});P.drop.ta=P.drop.en='Tirupati';S.dest='drop';S.mode='out';OS.type='round';OS.veh='mini';outFare2();0");await pg.wait_for_timeout(800)
        q3=await cf.evaluate("(()=>{const {km}=oInfo();return oQuote('mini',km)})()")
        check('long trips (B/C) unchanged: no hours rule',q3['ph']==0 and q3['hx']==0,q3)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
