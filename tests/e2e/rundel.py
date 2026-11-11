# Account deletion (Play Store rule). Customer: Profile → "Delete my account" → refused while a ride is active;
# after the ride: profile + login gone, old bookings keep the fare but lose the name and number, app back at login.
# Driver: Profile → "Request account deletion" → request for the office; office Approvals lists it and marks it done.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        uid=await cf.evaluate("CUID")
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1000)
        await C.locator('#bookb').click()
        # wait until the booking really exists (a fixed pause was too short when the machine is busy: the ride screen
        # then drew over the profile and the Delete button was "missing")
        await cf.wait_for_function("typeof R==='object'&&R&&R.id",timeout=15000);await pg.wait_for_timeout(1200);bid=await cf.evaluate("R.id")
        # 1) active ride → refused
        await cf.evaluate("profile()")
        try:await C.locator('#delacc').wait_for(timeout=6000)
        except Exception:pass
        check('customer profile has "Delete my account"',await cf.evaluate("!!document.getElementById('delacc')"),await cf.evaluate("({from:S.from,rid:typeof R==='object'&&R?R.id:null,st:typeof R==='object'&&R?R.status:null,txt:document.body.innerText.slice(0,160)})"))
        await C.locator('#delacc').click();await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/delete_confirm.png',clip={'x':0,'y':0,'width':400,'height':860})
        await C.locator('#dyes').click();await pg.wait_for_timeout(800)
        t=await cf.evaluate("document.body.innerText")
        check('refused while a ride is active (nothing deleted)',('நடந்துட்டு இருக்கு' in t or 'ongoing' in t) and await pg.evaluate(f"!!MOCK.store.get('users/{uid}')"))
        # finish the ride (cancel), then delete
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{status:'cancelled',cancelReason:'customer'}})");await pg.wait_for_timeout(1500)
        await cf.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove());profile()");await pg.wait_for_timeout(500)
        await C.locator('#delacc').click();await pg.wait_for_timeout(300);await C.locator('#dyes').click();await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')")
        check('profile deleted',not await pg.evaluate(f"!!MOCK.store.get('users/{uid}')"))
        check('booking kept for accounts, name and number removed',bk and bk.get('fare') and bk.get('custName')=='Deleted user' and 'custPhone' not in bk,(bk.get('custName'),bk.get('fare')))
        check('app back at the login screen',await cf.evaluate("!!document.getElementById('ph')"))
        # 2) driver request
        await df.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove());profileTab()");await pg.wait_for_timeout(600)
        check('driver profile has "Request account deletion"',await df.evaluate("!!document.getElementById('delacc')"))
        await D.locator('#delacc').click();await pg.wait_for_timeout(300);await D.locator('#dyes').click();await pg.wait_for_timeout(1000)
        rq=await pg.evaluate("MOCK.store.get('deletionRequests/+919999900002')")
        check('driver request saved for the office',rq and rq.get('status')=='pending',rq)
        await of.evaluate("S.sec='appr';show()");await pg.wait_for_timeout(1200)
        t=await of.evaluate("(document.getElementById('delreq')||{}).innerText||''")
        check('office Approvals lists the request',('நீக்க கோரிக்கை' in t or 'deletion request' in t) and '9999900002' in t,t[:80].replace('\n',' '))
        await pg.screenshot(path='shots/delete_office.png',clip={'x':1100,'y':0,'width':800,'height':860})
        await O.locator('[data-drd]').first.click();await pg.wait_for_timeout(1000)
        check('office marks it done',(await pg.evaluate("MOCK.store.get('deletionRequests/+919999900002')"))['status']=='done')
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
