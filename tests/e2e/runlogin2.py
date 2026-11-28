# 2-tap login (owner 28 Nov, "Rapido level") in the Play Store apps — the native VctAuth plugin is stubbed here
# (its Java is compiled by the android workflow; Google's popup / SMS reading need a real phone, see the checklist).
#  Customer: popup opens by itself → number picked → OTP sent at once → SMS auto-read → home. No taps, no name asked.
#            Name asked once at the first booking. Wrong code: shake, tries left; 5 wrong → 10 min wait. Instant sign-in.
#  Driver:   unregistered → no OTP, call office / apply; blocked → reason; registered → home with greeting;
#            a login on another phone logs this one out.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
STUB="""(ph,mode)=>{window.NAT={hints:0,sends:[],ls:{},mode};window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:n=>n==='VctAuth',Plugins:{VctAuth:{
  hint:()=>{NAT.hints++;NAT.hintAt=Date.now();return Promise.resolve(NAT.mode==='cancel'?{cancelled:true}:{phone:ph})},
  send:o=>{NAT.sends.push(o);return Promise.resolve(NAT.mode==='instant'?{instant:true}:{vid:'vid-'+o.phone})},
  addListener:(e,cb)=>{NAT.ls[e]=cb;return Promise.resolve({remove:()=>{if(NAT.ls[e]===cb)delete NAT.ls[e]}})},
  signOut:()=>Promise.resolve(),appCheck:()=>Promise.reject('x')}}}}"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100,fares:{mini:{base:110,per:20}}})")
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html');D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        # ---------- customer: 0 taps inside the app
        await cf.evaluate(STUB,'+91 99999 00011');await cf.evaluate("S.lang='en';login()");await pg.wait_for_timeout(1500)
        n=await cf.evaluate("({h:NAT.hints,s:NAT.sends,v:window.NATVID||(parent.NATVID)})")
        lc=await pg.evaluate("window.LCHK||[]")
        check('number popup opened by itself; picked number sent at once (server check first, device id)',n['h']==1 and n['s']==[{'phone':'9999900011','resend':False}] and lc and lc[-1]['p10']=='9999900011' and lc[-1]['app']=='customer' and len(lc[-1]['dev'])==16,(n,lc[-1:]))
        t=' '.join((await C.locator('body').inner_text()).split())
        check('OTP screen: "Enter verification code — Sent to 99XXXXXX11", resend countdown, no Next/Verify button','Enter verification code' in t and 'Sent to 99XXXXXX11' in t and 'Resend in' in t and await C.locator('#go').count()==0,t[:200])
        await cf.evaluate("NAT.ls.code({code:'123456',vid:'vid-9999900011'})");await pg.wait_for_timeout(2500)
        u=await pg.evaluate("MOCK.store.get('users/u9999900011')")
        check('SMS read by the phone → signed in → home; users doc made silently, no name asked',await cf.evaluate("S.logged===true")and u and u.get('phone')=='+919999900011' and 'lastLogin' in u and not u.get('name') and await C.locator('#nm').count()==0,u)
        mk=await cf.evaluate("VCTLOGIN.marks()")
        check('timings recorded: phone screen, popup, OTP sent, auto-filled, verified, home ready',all(k in mk for k in ['phone-screen','popup-asked','otp-sent','otp-autofilled','verified','home-ready']),mk)
        # first booking asks the name once
        await cf.evaluate("S.from='katpadi';S.dest='cmc';S.veh='mini';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1000)
        await C.locator('#bookb').click();await pg.wait_for_timeout(500)
        check('first booking: "Your name?" asked',await C.locator('#nm').count()==1)
        await C.locator('#nm').fill('Priya');await C.locator('#nmok').click();await pg.wait_for_timeout(2500)
        bid=await cf.evaluate("R.id");bk=await pg.evaluate(f"MOCK.store.get('bookings/{bid}')") if bid else None
        check('name saved and the ride booked with it',bk and bk.get('custName')=='Priya' and (await pg.evaluate("MOCK.store.get('users/u9999900011')")).get('name')=='Priya',bk and bk.get('custName'))
        # ---------- popup closed → keypad, auto-send at the 10th digit; wrong codes
        await cf.evaluate("CL.logout();S.logged=false;S.phone='';save()");await cf.evaluate(STUB,'+919999900012');await cf.evaluate("NAT.mode='cancel';login()");await pg.wait_for_timeout(800)
        check('popup closed: keypad, no OTP sent yet',await cf.evaluate("NAT.sends.length")==0 and await C.locator('#ph').count()==1)
        await C.locator('#ph').type('9999900012',delay=20);await pg.wait_for_timeout(1200)
        check('10th digit typed → OTP sent, no button',await cf.evaluate("NAT.sends.length")==1 and 'Enter verification code' in await C.locator('body').inner_text())
        for i in range(4):
            for j,d in enumerate('111111'):await C.locator(f'#o{j}').fill(d)
            await pg.wait_for_timeout(500)
        e=await C.locator('#e').inner_text();sh=await C.locator('#l2otp').get_attribute('class')
        check('wrong code: shake, boxes cleared, "Wrong code. 1 tries left"','1 tries left' in e and 'l2shake' in (sh or '') and await C.locator('#o0').input_value()=='',e)
        for j,d in enumerate('222222'):await C.locator(f'#o{j}').fill(d)
        await pg.wait_for_timeout(800)
        t=await C.locator('body').inner_text()
        check('5th wrong code: back to the number, "Try again in 10 minutes"','10 minutes' in t and await C.locator('#ph').count()==1,t[:200])
        await C.locator('#ph').fill('');await C.locator('#ph').type('9999900012',delay=10);await pg.wait_for_timeout(600)
        check('locked number: no new OTP for 10 minutes',await cf.evaluate("NAT.sends.length")==1 and 'min' in await C.locator('#e').inner_text())
        # ---------- instant verification (no SMS)
        await cf.evaluate(STUB,'+919999900013');await cf.evaluate("NAT.mode='instant';login()");await pg.wait_for_timeout(1000)
        await cf.evaluate("NAT.ls.instant&&NAT.ls.instant({idToken:'idt-9999900013'})");await pg.wait_for_timeout(2000)
        check('instant verification: server swap → signed in',await cf.evaluate("S.logged===true&&CUID==='u9999900013'"))
        # ---------- rate limit: 5 OTPs an hour
        await cf.evaluate("CL.logout();S.logged=false;save()");await pg.evaluate("window.OTPRATE={'+919999900014':[Date.now()-1e3,Date.now()-2e3,Date.now()-3e3,Date.now()-4e3,Date.now()-5e3]}")
        await cf.evaluate(STUB,'+919999900014');await cf.evaluate("login()");await pg.wait_for_timeout(1000)
        check('6th OTP in an hour refused before sending','Only 5 OTPs an hour' in await C.locator('#e').inner_text() and await cf.evaluate("NAT.sends.length")==0)
        # ---------- driver
        await df.evaluate(STUB,'+919999900077');await df.evaluate("S.lang='en';login()");await pg.wait_for_timeout(1500)
        t=' '.join((await D.locator('body').inner_text()).split())
        check('driver: unregistered number → no OTP, "This number is not registered", call office + apply',await df.evaluate("NAT.sends.length")==0 and 'This number is not registered' in t and await D.locator('#l2call').get_attribute('href')=='tel:+919344039933' and await D.locator('#l2join').count()==1,t[:200])
        await pg.evaluate("(()=>{const d=MOCK.store.get('drivers/+919999900002');d.blocked=true;d.blockWhy='Insurance expired';MOCK.store.set('drivers/+919999900002',d)})()")
        await df.evaluate(STUB,'+919999900002');await df.evaluate("login()");await pg.wait_for_timeout(1200)
        t=' '.join((await D.locator('body').inner_text()).split())
        check('driver: blocked → "Your account is on hold — Reason: Insurance expired", no OTP','Your account is on hold' in t and 'Reason: Insurance expired' in t and await df.evaluate("NAT.sends.length")==0,t[:200])
        await pg.evaluate("(()=>{const d=MOCK.store.get('drivers/+919999900002');d.blocked=false;d.blockWhy='';MOCK.store.set('drivers/+919999900002',d)})()")
        await df.evaluate(STUB,'+919999900002');await df.evaluate("login()");await pg.wait_for_timeout(1000)
        t=' '.join((await D.locator('body').inner_text()).split())
        check('driver OTP screen (title on the number screen was "Enter your Phone Number to Drive")','Sent to 99XXXXXX02' in t)
        await df.evaluate("NAT.ls.code({code:'123456',vid:'vid-9999900002'})");await pg.wait_for_timeout(3000)
        ht=' '.join((await D.locator('body').inner_text()).split());sess=(await pg.evaluate("MOCK.store.get('drivers/+919999900002')")).get('sess')
        check('driver home: "Hi! Good …, Test", session claimed for this phone','Hi! Good' in ht and sess and len(sess)>=8 and sess==await df.evaluate("MYSESS"),(ht[:160],sess))
        await pg.evaluate("MOCK.fs.updateDoc({path:'drivers/+919999900002'},{sess:'otherphone12345'})");await pg.wait_for_timeout(1500)
        t=' '.join((await D.locator('body').inner_text()).split())
        check('login on another phone → this one logs out with a message',await df.evaluate("S.logged===false") and 'You logged in on another phone' in t,t[:200])
        await df.evaluate("NAT.mode='cancel';login()");await pg.wait_for_timeout(500)
        check('number screen: "Enter your Phone Number to Drive" + "Change registered number" (WhatsApp office)','Enter your Phone Number to Drive' in await D.locator('body').inner_text() and (await D.locator('#chreg').get_attribute('href')).startswith('https://wa.me/919344039933'))
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}')
asyncio.run(main())
