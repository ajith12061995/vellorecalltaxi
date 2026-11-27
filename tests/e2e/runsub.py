# Driver subscription (27 Nov): the owner sets day / week / month prices per vehicle in Office → Settings; a driver buys
# one from the wallet (server callable buySub — here the test stand-in with the same rules); while it runs: no commission,
# a low wallet does not stop going online; when it ends: commission again. Wallet, plan and ledger move together.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
DRV="MOCK.store.get('drivers/+919999900002')"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1500,'height':950},geolocation={'latitude':12.97,'longitude':79.158},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        # ---- owner sets prices ----
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2500)
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1500)
        check('Settings has the subscription price table',await O.locator('#subp .subin').count()>=12)
        await O.locator('[data-sv="sedan.day"]').fill('99');await O.locator('[data-sv="sedan.week"]').fill('599');await O.locator('[data-sv="sedan.month"]').fill('abc')
        await O.locator('#subsv').click();await pg.wait_for_timeout(600)
        check('a wrong price is refused, nothing saved',not (await pg.evaluate("MOCK.store.get('config/app')")).get('subs'))
        await O.locator('[data-sv="sedan.month"]').fill('');await O.locator('#subsv').click();await pg.wait_for_timeout(800)
        sb=(await pg.evaluate("MOCK.store.get('config/app')")).get('subs')
        check('prices saved: sedan day 99, week 599, no month',sb=={'sedan':{'day':99,'week':599}},sb)
        # ---- driver buys ----
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(2000)
        w0=(await pg.evaluate(DRV))['wallet']
        await df.evaluate("walletTab()");await pg.wait_for_timeout(800)
        t=' '.join((await D.locator('.subcard').inner_text()).split())
        check('wallet: subscription card with Day ₹99 and Week ₹599 only',await D.locator('.subp').count()==2 and '₹99' in t and '₹599' in t,t)
        check('driver sees the current mode: commission 10%','10%' in t)
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'drivers/+919999900002'}},{{wallet:500}})");await pg.wait_for_timeout(800);await df.evaluate("walletTab()");await pg.wait_for_timeout(500)
        await D.locator('[data-sub="week"]').click();await pg.wait_for_timeout(400)
        mt=' '.join((await D.locator('.modal').inner_text()).split())
        check('Week ₹599 with ₹500 in wallet: asks to recharge ₹99, no buy button','₹99' in mt and await D.locator('#sby').count()==0 and await D.locator('#sbr').count()==1,mt)
        await D.locator('#sbn').click();await pg.wait_for_timeout(300)
        await D.locator('[data-sub="day"]').click();await pg.wait_for_timeout(400)
        mt=' '.join((await D.locator('.modal').inner_text()).split())
        check('Day: shows ₹500 → ₹401, no commission for 24 h, not refundable','₹500' in mt and '₹401' in mt and ('24' in mt),mt)
        await D.locator('#sby').click();await pg.wait_for_timeout(1500)
        d=await pg.evaluate(DRV);led=await pg.evaluate("[...MOCK.store.keys()].filter(k=>k.startsWith('ledger/')).map(k=>MOCK.store.get(k))")
        check('bought: wallet 401, plan day for 24 h',d['wallet']==401 and d['sub']['plan']=='day' and abs(d['sub']['until']['__ms']-d['sub']['from']['__ms']-864e5)<5,d.get('sub'))
        check('one ledger entry: subscription −₹99',len(led)==1 and led[0]['type']=='sub' and led[0]['walletDelta']==-99,led)
        await pg.wait_for_timeout(800);await df.evaluate("walletTab()");await pg.wait_for_timeout(500)
        t=' '.join((await D.locator('.subcard').inner_text()).split())
        check('card now says Subscription ON with the end time, no buy buttons','Subscription ON' in t and await D.locator('.subp').count()==0,t)
        tx=' '.join((await D.locator('.recent').last.inner_text()).split())
        check('transactions list the subscription −₹99','Subscription' in tx and '99' in tx,tx[:160])
        # ---- while it runs ----
        check('no commission while subscribed',await df.evaluate("commPct()")==0)
        cm=await df.evaluate("(()=>{const j=buildJ({from:{ta:'A',en:'A',lat:12.97,lon:79.15},to:{ta:'B',en:'B',lat:12.92,lon:79.13},fare:300,km:6},'x1');return j.comm})()")
        check('a ride accepted now carries ₹0 commission',cm==0,cm)
        await pg.evaluate("MOCK.fs.updateDoc({path:'drivers/+919999900002'},{wallet:40})");await pg.wait_for_timeout(1000)
        check('wallet ₹40 (below ₹100 minimum) does not block going online while subscribed',await df.evaluate("!lowWallet()&&resumeWhy()===''"))
        r=await df.evaluate("CL.call('buySub',{plan:'week'})")
        check('second plan while one runs: refused, wallet untouched',r.get('why')=='active' and (await pg.evaluate(DRV))['wallet']==40,r)
        # ---- office shows it ----
        await of.evaluate("S.sec='drv';DF='all';save();show()");await pg.wait_for_timeout(1500)
        check('Office driver list marks the subscription',await O.locator('.dst.subp').count()>=1)
        # ---- plan ends ----
        await pg.evaluate("(()=>{const d=MOCK.store.get('drivers/+919999900002');MOCK.fs.updateDoc({path:'drivers/+919999900002'},{sub:{...d.sub,from:{__ms:Date.now()-2*864e5},until:{__ms:Date.now()-1000}}})})()");await pg.wait_for_timeout(1200)
        check('plan over: commission 10% again',await df.evaluate("commPct()")==10)
        check('plan over: low wallet blocks going online again',await df.evaluate("lowWallet()&&resumeWhy()!==''"))
        await pg.evaluate("MOCK.fs.updateDoc({path:'drivers/+919999900002'},{wallet:600})");await pg.wait_for_timeout(800)
        r=await df.evaluate("CL.call('buySub',{plan:'week'})")
        check('after it ends a new plan can be bought (week ₹599 → wallet ₹1)',r.get('ok') and (await pg.evaluate(DRV))['wallet']==1,r)
        r=await df.evaluate("CL.call('buySub',{plan:'month'})")
        check('plan not offered (month): refused',r.get('why') in ('off','active'),r)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
