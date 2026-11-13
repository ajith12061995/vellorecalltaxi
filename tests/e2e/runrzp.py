# Driver wallet recharge through Razorpay (Office switch). Razorpay Checkout is replaced by a stub; the server
# decisions (order, signature check, single credit) are mirrored in mockfb.js and tested for real in functions/test/rzp-fn.test.js.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
STUB="""window.__rzpMode='pay';window.Razorpay=function(o){this.o=o;this.h={};window.__rzpOpts=o};
window.Razorpay.prototype.on=function(e,f){this.h[e]=f};
window.Razorpay.prototype.open=function(){const o=this.o;window.__rzpOpened=(window.__rzpOpened||0)+1;
  if(window.__rzpMode==='dismiss')return setTimeout(()=>o.modal.ondismiss(),50);
  if(window.__rzpMode==='forged')return setTimeout(()=>o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:'pay_X',razorpay_signature:'forged'}),50);
  setTimeout(()=>o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:'pay_E1',razorpay_signature:'sig_ok'}),50)};0"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)+' @ '+str(getattr(e,'stack',''))[:400]))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,driverHelp:'9344039933',upi:'office@upi'})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1800)
        await df.evaluate(STUB)
        w0=await pg.evaluate("MOCK.store.get('drivers/+919999900002').wallet")
        # switch OFF → only the UTR way
        await df.evaluate("S.tab='wallet';walletTab()");await pg.wait_for_timeout(500)
        await D.locator('#rc').click();await pg.wait_for_timeout(500)
        check('switch off: no Razorpay button, UTR form still there',await D.locator('#rzp').count()==0 and await D.locator('#utr').count()==1)
        await df.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove()")
        # Office turns it on
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        await of.evaluate("document.getElementById('srz').scrollIntoView()")
        await O.locator('#srz').check();await O.locator('#srzt').fill('9876500009');await O.locator('#ssv').click();await pg.wait_for_timeout(1200)
        ca=await pg.evaluate("MOCK.store.get('config/app')")
        check('Office switch saves config/app.rzp + test drivers',ca.get('rzp') is True and ca.get('rzpTesters')==['+919876500009'],ca.get('rzpTesters'))
        await pg.wait_for_timeout(800)
        await df.evaluate("S.tab='wallet';walletTab()");await pg.wait_for_timeout(500)
        await D.locator('#rc').click();await pg.wait_for_timeout(500)
        check('test mode: a driver not in the tester list does not see Razorpay',await D.locator('#rzp').count()==0)
        await df.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove()")
        await O.locator('#srzt').fill('12345');await O.locator('#ssv').click();await pg.wait_for_timeout(800)
        check('bad tester number refused',(await pg.evaluate("MOCK.store.get('config/app')")).get('rzpTesters')==['+919876500009'])
        await O.locator('#srzt').fill('9876500009, +91 99999 00002');await O.locator('#ssv').click();await pg.wait_for_timeout(1500)
        await df.evaluate("S.tab='wallet';walletTab()");await pg.wait_for_timeout(500)
        await D.locator('#rc').click();await pg.wait_for_timeout(500)
        check('switch on: Razorpay button + UTR way below',await D.locator('#rzp').count()==1 and await D.locator('#utr').count()==1)
        await pg.screenshot(path='shots/rzp_recharge.png',clip={'x':400,'y':0,'width':400,'height':860})
        # dismiss → nothing credited, button usable again
        await df.evaluate("window.__rzpMode='dismiss'")
        await D.locator('[data-za="1000"]').click();await D.locator('#rzp').click();await pg.wait_for_timeout(900)
        w1=await pg.evaluate("MOCK.store.get('drivers/+919999900002').wallet")
        opts=await df.evaluate("({k:window.__rzpOpts.key,a:window.__rzpOpts.amount,n:window.__rzpOpts.name,c:window.__rzpOpts.prefill.contact})")
        check('checkout opened with server order: ₹1000, VELLORE CALL TAXI, driver number',opts=={'k':'rzp_test_E2E','a':100000,'n':'VELLORE CALL TAXI','c':'9999900002'},opts)
        check('closed without paying: wallet unchanged, button enabled',w1==w0 and not await D.locator('#rzp').is_disabled())
        # forged signature → refused, no credit, clear message
        await df.evaluate("window.__rzpMode='forged'");await D.locator('#rzp').click();await pg.wait_for_timeout(1200)
        w2=await pg.evaluate("MOCK.store.get('drivers/+919999900002').wallet")
        check('forged payment proof: not credited, told not to pay again',w2==w0 and 'Do not pay again' in await D.locator('#rze').inner_text() or 'மறுபடி கட்ட வேண்டாம்' in await D.locator('#rze').inner_text(),w2)
        # real (stub) payment
        await df.evaluate("window.__rzpMode='pay'");await D.locator('[data-za="500"]').click();await D.locator('#rzp').click();await pg.wait_for_timeout(1800)
        w3=await pg.evaluate("MOCK.store.get('drivers/+919999900002').wallet")
        check('paid: wallet +₹500 on the server record',w3==w0+500,(w0,w3))
        check('modal closed, wallet screen shows new balance',await D.locator('#rzp').count()==0 and str(w0+500) in (await df.evaluate("document.querySelector('.walcard b').innerText")).replace(',',''),await df.evaluate("document.querySelector('.walcard b').innerText"))
        await pg.wait_for_timeout(600)
        tx=await df.evaluate("document.body.innerText")
        check('history says Recharge (Razorpay)','Recharge (Razorpay)' in tx)
        rc=await pg.evaluate("[...MOCK.store.keys()].filter(k=>k.startsWith('recharges/rzp_')).length")
        check('one recharge record, approved by Razorpay',rc==1)
        await of.evaluate("S.sec='appr';save();show()");await pg.wait_for_timeout(1000)
        ot=await of.evaluate("(main().innerText||'')+' | rch='+JSON.stringify(DB.rch.map(r=>[r.method,r.status]))")
        check('Office: shows Razorpay payment as paid online',('Paid online' in ot) or ('தானா வந்தது' in ot),ot[-500:].replace('\n',' ¦ '))
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
