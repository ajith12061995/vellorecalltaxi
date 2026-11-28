# Growth settings (owner 28 Nov): all off until the owner fills them in (Office → Settings → Growth).
#  - Google review link: only a 5-star customer is asked, at most once in 30 days, never without a link
#  - Station fixed fares: Katpadi Junction ↔ CMC auto ₹120 both ways; the customer sees and books that price, guests too
#  - Driver daily bonus: the driver sees today's progress; the office pays once per driver per day with a tap
#  - Customer referral: invite link under "Me"; a credit shows "₹30 off" on the fare screen, the booking asks for it,
#    and once the server has held it the customer and the driver both see ₹30 less to pay / collect
import asyncio,re
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
KAT=(12.9716,79.1376);CMC=(12.9246,79.1356)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100,fares:{mini:{base:110,per:20},sedan:{base:130,per:19}}})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        # ---- Office: Growth panel
        await of.evaluate("S.lang='en';S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        check('Settings has the Growth panel, everything off',await O.locator('#growp').count()==1 and not await O.locator('#g_bon').is_checked() and not await O.locator('#g_ron').is_checked() and await O.locator('#sttbl .strow').count()==0)
        await O.locator('#g_rv').fill('http://example.com/x');await O.locator('#g_sv').click();await pg.wait_for_timeout(500)
        g=(await pg.evaluate("MOCK.store.get('config/app')")).get('grow')
        check('a link that is not Google is refused (nothing saved)',g is None,g)
        await O.locator('#g_rv').fill('https://g.page/r/CVellTaxi123/review')
        await O.locator('#g_sadd').click();await pg.wait_for_timeout(200)
        row=O.locator('#sttbl .strow').first
        await row.locator('[data-sa]').select_option('katpadi');await row.locator('[data-sb]').select_option('cmc');await row.locator('[data-sv]').select_option('auto');await row.locator('[data-sf]').fill('120')
        await O.locator('#g_sadd').click();await pg.wait_for_timeout(200)
        r2=O.locator('#sttbl .strow').nth(1)
        await r2.locator('[data-sa]').select_option('cmc');await r2.locator('[data-sb]').select_option('cmc');await r2.locator('[data-sf]').fill('90')
        await O.locator('#g_sv').click();await pg.wait_for_timeout(500)
        check('same place on both sides is refused',(await pg.evaluate("MOCK.store.get('config/app')")).get('grow') is None)
        await r2.locator('[data-sx]').click()
        await O.locator('#g_bon').check();await O.locator('#g_br').fill('2');await O.locator('#g_ba').fill('50')
        await O.locator('#g_ron').check();await O.locator('#g_ra').fill('30')
        await O.locator('#g_sv').click();await pg.wait_for_timeout(1200)
        g=(await pg.evaluate("MOCK.store.get('config/app')")).get('grow') or {}
        st=(g.get('stf') or [{}])[0]
        check('saved: review link, 1 station fare, bonus 2 rides ₹50, referral ₹30',g.get('review','').startswith('https://g.page/') and len(g.get('stf',[]))==1 and st.get('veh')=='auto' and st.get('fare')==120 and st.get('both') is True and st['a']['k']=='katpadi' and abs(st['b']['lat']-CMC[0])<1e-6 and g.get('bonus')=={'on':True,'rides':2,'amt':50} and g.get('ref')=={'on':True,'amt':30},g)
        # the office is opened again (another day / another computer): the saved Growth values come from Firebase
        await of.evaluate("DB.cfg.grow=null");await pg.evaluate("MOCK.fs.updateDoc({path:'config/app'},{upi:''})");await pg.wait_for_timeout(800)
        await of.evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(500);await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        check('the Growth values are read back from Firebase (office reopened)',(await O.locator('#g_rv').input_value()).startswith('https://g.page/') and await O.locator('#sttbl .strow').count()==1 and await O.locator('#g_bon').is_checked() and await O.locator('#g_ron').is_checked() and await O.locator('#g_ra').input_value()=='30')
        pub=await pg.evaluate("MOCK.store.get('public/prices')") or {}
        check('the station fare is copied to the public price list (guests see it too)',len(pub.get('stf') or [])==1 and 'grow' not in pub and 'comm' not in pub,list(pub.keys()))
        # ---- Driver signs in
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        await df.evaluate("S.lang='en';home()");await pg.wait_for_timeout(800)
        bc=' '.join((await D.locator('#bonuscard').inner_text()).split()) if await D.locator('#bonuscard').count() else ''
        check('driver home: "Today 0/2 rides · ₹50 bonus at 2"','0/2' in bc and '₹50' in bc,bc)
        # ---- Customer signs in
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800)
        if await C.locator('#nm').count():await C.locator('#nm').fill('Priya');await C.locator('#go').click()
        await pg.wait_for_timeout(2000)
        await cf.evaluate("S.lang='en'")
        # station fare: Katpadi Junction → CMC auto ₹120 (meter would be more), and the reverse
        await cf.evaluate("S.from='katpadi';S.dest='cmc';S.veh='auto';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        meter=await cf.evaluate("FARE.withNightV('auto',fare0(VEH.find(v=>v.id==='auto'),route('katpadi','cmc').km),nightV(VEH.find(v=>v.id==='auto')))")
        row=' '.join((await C.locator('.veh[data-v=auto]').inner_text()).split())
        check(f'fare screen: Auto ₹120 "Fixed fare" (meter would be ₹{meter})','₹120' in row and 'Fixed fare' in row and meter!=120,row)
        mrow=' '.join((await C.locator('.veh[data-v=mini]').inner_text()).split())
        check('other vehicles keep the meter fare, no tag','Fixed fare' not in mrow,mrow)
        await cf.evaluate("S.from='cmc';S.dest='katpadi';fareScreen()");await pg.wait_for_timeout(800)
        check('reverse direction (both ways) also ₹120','₹120' in await C.locator('.veh[data-v=auto]').inner_text())
        await cf.evaluate("S.from='katpadi';S.dest='cmc';fareScreen()");await pg.wait_for_timeout(800)
        # referral: invite card under Me
        await cf.evaluate("profile()");await pg.wait_for_timeout(700)
        href=await C.locator('#refwa').get_attribute('href') if await C.locator('#refwa').count() else ''
        code=await cf.evaluate("VCTREF.code('9999900001')")
        check('Me: invite card with a WhatsApp link carrying my code and ₹30',('r%3D'+code) in href and '30' in (await C.locator('#refcard').inner_text()),href[:120])
        # a credit of ₹30 → fare screen says so and the booking asks for it
        await pg.evaluate("MOCK.fs.setDoc({path:'credits/+919999900001'},{bal:30})");await pg.wait_for_timeout(800)
        await cf.evaluate("fareScreen()");await pg.wait_for_timeout(1000)
        cl=await C.locator('#credline').inner_text() if await C.locator('#credline').count() else ''
        check('fare screen: "Friend referral: ₹30 off this ride"','₹30 off' in cl,cl)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        bid=await cf.evaluate("R&&R.id")
        bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('booking: fixed ₹120, tariff marked fixed, no night, asks ₹30 discount',bk['fare']==120 and bk['tariff'].get('fixed') is True and not bk['tariff'].get('night') and bk.get('disc')==30,{k:bk.get(k) for k in ['fare','disc','tariff']})
        # the server holds it (simulated), a driver takes the ride and finishes
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{discHeld:true,disc:30}})");await pg.wait_for_timeout(400)
        # the driver app must be an auto for this ride
        await pg.evaluate("(()=>{const d=MOCK.store.get('drivers/+919999900002');MOCK.fs.setDoc({path:'drivers/+919999900002'},{...d,veh:'auto'})})()");await pg.wait_for_timeout(800)
        if await D.locator('#ons').count():await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        if await D.locator('#acc').count():await D.locator('#acc').click()
        else:await df.evaluate(f"(async()=>{{const s=await F().getDoc(F().doc(CL.db,'bookings','{bid}'));incoming(buildJ?buildJ({{id:'{bid}',...s.data()}}):null)}})()")
        await pg.wait_for_timeout(2000)
        if await D.locator('#acc').count():await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        now=await pg.evaluate("Date.now()")
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{arrivedAt:{{toMillis(){{return {now-2*60e3}}}}},startedAt:{{toMillis(){{return {now-60e3}}}}},status:'ontrip'}})");await pg.wait_for_timeout(1500)
        jok=await df.evaluate(f"!!(J&&J.id==='{bid}')")
        check('driver has the ride',jok)
        await df.evaluate("collect()");await pg.wait_for_timeout(700)
        tot=' '.join((await D.locator('.bill').inner_text()).split())
        check('driver bill: discount line, collect ₹90 (₹120 − ₹30), says the office adds it to the wallet','−₹30' in tot and 'wallet' in tot and re.search(r'Collect from customer\s*₹90',tot) is not None,tot)
        await D.locator('#got').click();await pg.wait_for_timeout(1500)
        b2=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('ride closed with the full bill kept (₹120) for reports',b2['status']=='done' and b2.get('fareFinal')==120,{k:b2.get(k) for k in ['status','fareFinal','disc']})
        await pg.wait_for_timeout(1500)
        pay=' '.join((await C.locator('.bill').inner_text()).split()) if await C.locator('.bill').count() else ''
        check('customer done screen: discount line and total ₹90','−₹30' in pay and re.search(r'Total\s*₹90',pay) is not None,pay)
        # review: 5 stars → asked once with the Google link
        await C.locator('#paid').click();await pg.wait_for_timeout(600)
        await cf.evaluate("document.getElementById('rate').hidden=false");await C.locator('#rate [data-s="5"]').click();await C.locator('#sub').click()
        await pg.wait_for_timeout(1500)
        h=await C.locator('#rvgo').get_attribute('href') if await C.locator('#rvgo').count() else ''
        check('5 stars → "Would you review us on Google?" with the office link',h=='https://g.page/r/CVellTaxi123/review',h)
        await C.locator('#rvno').click();await pg.wait_for_timeout(300)
        await cf.evaluate("reviewAsk()");await pg.wait_for_timeout(400)
        check('not asked again within 30 days',await C.locator('#rvgo').count()==0)
        await cf.evaluate("localStorage.removeItem('vct-rv');CFG.grow={...CFG.grow,review:''};reviewAsk()");await pg.wait_for_timeout(300)
        check('no link → never asked',await C.locator('#rvgo').count()==0)
        # ---- bonus: 2 done rides today for this driver → office lists, pays once
        await pg.evaluate("""(()=>{const t=Date.now();MOCK.fs.setDoc({path:'bookings/bx1'},{status:'done',driverPhone:'+919999900002',driverName:'D',fare:100,fareFinal:100,veh:'auto',kind:'ride',src:'app',customerUid:'u-x',from:{lat:12.95,lon:79.14,en:'A',ta:'A'},to:{lat:12.93,lon:79.13,en:'B',ta:'B'},doneAt:{__ms:t-3600e3},createdAt:{__ms:t-4000e3},when:t-4000e3})})()""")
        await pg.wait_for_timeout(1500)
        await df.evaluate("home()");await pg.wait_for_timeout(600)
        bc=' '.join((await D.locator('#bonuscard').inner_text()).split()) if await D.locator('#bonuscard').count() else ''
        check('driver: target reached message','Target reached' in bc,bc)
        await of.evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(1500)
        bp=' '.join((await O.locator('#bonusp').inner_text()).split()) if await O.locator('#bonusp').count() else ''
        check('office Home: today\'s bonus list with the driver and a Pay button','2 rides' in bp and await O.locator('[data-bpay="+919999900002"]').count()==1,bp)
        w0=(await pg.evaluate("MOCK.store.get('drivers/+919999900002')"))['wallet']
        await O.locator('[data-bpay="+919999900002"]').click();await pg.wait_for_timeout(300);await O.locator('#bpy').click();await pg.wait_for_timeout(1200)
        d=await pg.evaluate("MOCK.store.get('drivers/+919999900002')")
        check('Pay: wallet +₹50, marked paid for today',d['wallet']==w0+50 and len(d.get('bonusPaid',''))==10,{k:d.get(k) for k in ['wallet','bonusPaid']})
        # a second tap (e.g. another office screen) never pays twice
        await of.evaluate("(()=>{const d=drvById('+919999900002');d.bonusPaid='';})()")
        await of.evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(800)
        if await O.locator('[data-bpay="+919999900002"]').count():
            await O.locator('[data-bpay="+919999900002"]').click();await pg.wait_for_timeout(300);await O.locator('#bpy').click();await pg.wait_for_timeout(1200)
        d=await pg.evaluate("MOCK.store.get('drivers/+919999900002')")
        check('never paid twice on the same day',d['wallet']==w0+50,d['wallet'])
        await df.evaluate("home()");await pg.wait_for_timeout(800)
        bc=' '.join((await D.locator('#bonuscard').inner_text()).split()) if await D.locator('#bonuscard').count() else ''
        check('driver: "₹50 bonus added to your wallet"','added to your wallet' in bc,bc)
        # ---- guest (not signed in) sees the fixed fare from the public price list
        ctx2=await b.new_context(viewport={'width':1900,'height':880});g2=await ctx2.new_page();await g2.goto(B+'harness_x.html');await g2.wait_for_timeout(2500)
        await g2.evaluate("MOCK.fs.setDoc({path:'public/prices'},"+__import__('json').dumps({k:v for k,v in pub.items() if k!='updatedAt'})+")")
        gcf=g2.frame(url=B+'c2.html')
        await gcf.evaluate("watchPublic&&watchPublic()");await g2.wait_for_timeout(1000)
        await gcf.evaluate("S.lang='en';S.from='katpadi';S.dest='cmc';S.veh='auto';fareScreen()");await g2.wait_for_timeout(1000)
        gt=' '.join((await g2.frame_locator('#c').locator('.veh[data-v=auto]').inner_text()).split())+' logged='+str(await gcf.evaluate("S.logged"))
        check('guest sees the same fixed ₹120','₹120' in gt,gt)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}')
asyncio.run(main())
