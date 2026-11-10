# OTP in all four pages (customer, driver, driver join, office):
#  - the phone keyboard's OTP suggestion puts the whole code in ONE box → all boxes fill and sign-in happens by itself
#  - pasting the SMS text works; typing digit by digit still works; a wrong code clears the boxes, no double sign-in
#  - the security check is prepared when the login screen opens (prepOtp), so "Send OTP" goes out at once
#  - Android app: the SMS is read after "Allow" (native SmsOtp plugin) → code filled → signed in; older app (no plugin) → nothing breaks
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
FAKECAP="""([code,delay,ok])=>{window.__nat=[];window.Capacitor={isNativePlatform:()=>true,nativePromise:(p,m,o)=>{window.__nat.push(p+'.'+m);
  if(p!=='SmsOtp')return Promise.resolve({});if(!ok)return Promise.reject(new Error('not implemented'));
  if(m==='stop')return Promise.resolve({});return new Promise(r=>setTimeout(()=>r({code}),delay))}}}"""
async def custLogin(pg,C,cf,phone):
    await cf.evaluate("S.logged=false;S.name='';save();login()");await pg.wait_for_timeout(400)
    await C.locator('#ph').fill(phone);await C.locator('#go').click();await pg.wait_for_timeout(500)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':900})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)+' @'+str(getattr(e,'stack',''))[:300]))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html');D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html');O=pg.frame_locator('#o')
        # ---- customer: keyboard suggestion into the first box
        await cf.evaluate("S.logged=false;S.name='';save();login()");await pg.wait_for_timeout(400)
        check('customer: security check prepared on the login screen',await pg.evaluate("window.PREP||0")>=1)
        await C.locator('#ph').fill('9999900011');await C.locator('#go').click();await pg.wait_for_timeout(500)
        await C.locator('#o0').fill('123456');await pg.wait_for_timeout(1200)
        check('customer: whole code in one box → all six filled, signed in by itself (name screen)',await C.locator('#nm').count()==1,await C.locator('body').inner_text())
        await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        check('customer: home opens',await cf.evaluate("S.logged&&S.from==='home'"))
        # ---- customer: paste of the whole SMS into box 3
        await custLogin(pg,C,cf,'9999900011')
        await C.locator('#o2').focus()
        await cf.evaluate("""()=>{const dt=new DataTransfer();dt.setData('text','123456 is your verification code for velloretaxi.app.');
          document.getElementById('o2').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))}""")
        await pg.wait_for_timeout(1500)
        check('customer: pasting the SMS text signs in',await cf.evaluate("S.logged&&!document.getElementById('o0')"),await C.locator('body').inner_text())
        # ---- customer: wrong code → cleared, error, no sign-in; then digit by digit
        await custLogin(pg,C,cf,'9999900011')
        await C.locator('#o0').fill('654321');await pg.wait_for_timeout(800)
        vals=await cf.evaluate("[...document.querySelectorAll('.otp input')].map(i=>i.value).join('')")
        check('customer: wrong code → boxes cleared, message shown, still on OTP',vals=='' and await C.locator('#o0').count()==1 and len(await C.locator('#e').inner_text())>3)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        check('customer: typing digit by digit still signs in by itself',await cf.evaluate("S.logged&&!document.getElementById('o0')"))
        # ---- customer: Android app reads the SMS (after Allow)
        await cf.evaluate(FAKECAP,['123456',700,True])
        n0=await pg.evaluate("(window.SENT||[]).length")
        await custLogin(pg,C,cf,'9999900011');await pg.wait_for_timeout(1500)
        nat=await cf.evaluate("window.__nat")
        check('app: SMS reader started before the SMS was sent, code filled, signed in',nat[:1]==['SmsOtp.start'] and await cf.evaluate("S.logged&&!document.getElementById('o0')") and await pg.evaluate("(window.SENT||[]).length")==n0+1,[nat,await cf.evaluate("({l:S.logged,o:!!document.getElementById('o0'),b:document.body.innerText.slice(0,80)})"),n0,await pg.evaluate("(window.SENT||[]).length")])
        # older app without the plugin: OTP screen works as before
        await cf.evaluate(FAKECAP,['',0,False])
        await custLogin(pg,C,cf,'9999900011');await pg.wait_for_timeout(600)
        check('older app (no SMS reader): OTP screen stays, no error',await C.locator('#o0').count()==1 and await C.locator('#e').inner_text()=='')
        await C.locator('#o0').fill('123456');await pg.wait_for_timeout(1500)
        check('older app: typed code signs in',await cf.evaluate("S.logged&&!document.getElementById('o0')"))
        # the reader brings a code after the person already typed one → left alone, no second sign-in
        await cf.evaluate(FAKECAP,['111111',1200,True])
        await custLogin(pg,C,cf,'9999900011');await C.locator('#o0').fill('123456');await pg.wait_for_timeout(2000)
        check('a late SMS code does not disturb a finished sign-in',await cf.evaluate("S.logged&&!document.getElementById('o0')"))
        await cf.evaluate("delete window.Capacitor")
        # ---- driver: suggestion into box 1 → signed in by itself
        await df.evaluate("S.logged=false;save();login()");await pg.wait_for_timeout(400)
        p0=await pg.evaluate("window.PREP||0")
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(500)
        check('driver: security check prepared on the login screen',p0>=2)
        await D.locator('#o0').fill('123456');await pg.wait_for_timeout(1500)
        check('driver: whole code in one box → signed in by itself',await D.locator('#o0').count()==0,(await D.locator('body').inner_text())[:200])
        # driver: wrong code
        await df.evaluate("S.logged=false;save();login()");await pg.wait_for_timeout(400)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(500)
        await D.locator('#o0').fill('000000');await pg.wait_for_timeout(800)
        check('driver: wrong code → cleared, message, Verify disabled',await df.evaluate("[...document.querySelectorAll('.otp input')].map(i=>i.value).join('')")=='' and await D.locator('#go').is_disabled() and len(await D.locator('#e').inner_text())>3)
        # driver app reads the SMS
        await df.evaluate(FAKECAP,['123456',600,True])
        await D.locator('#o0').focus()
        await df.evaluate("S.logged=false;save();login()");await pg.wait_for_timeout(400)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(1800)
        check('driver app: SMS read after Allow → signed in',await D.locator('#o0').count()==0 and (await df.evaluate("window.__nat"))[:1]==['SmsOtp.start'])
        await df.evaluate("delete window.Capacitor")
        # ---- office: one box, SMS pasted
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(400)
        await O.locator('#otp').fill('123456 is your verification code for velloretaxi.app.');await pg.wait_for_timeout(1500)
        check('office: pasting the SMS text → code taken, signed in',await O.locator('#otp').count()==0)
        # ---- join page
        await pg.goto(B+'harness_j.html');await pg.wait_for_timeout(2500)
        J=pg.frame_locator('#c');jf=pg.frame(url=B+'j2.html')
        check('join: security check prepared on the number screen',await pg.evaluate("window.PREP||0")>=1)
        await jf.evaluate(FAKECAP,['123456',600,True])
        await J.locator('#ph').fill('9999900077');await J.locator('#go').click();await pg.wait_for_timeout(2000)
        check('join (app): SMS read after Allow → signed in to the form',await J.locator('#o0').count()==0 and 'SmsOtp.start' in (await jf.evaluate("window.__nat")),(await J.locator('body').inner_text())[:200])
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
