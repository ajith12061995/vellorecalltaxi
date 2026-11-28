# Driver ↔ owner money (owner 28 Nov: "payment features at pro level").
#  Driver: recharge with any amount, UPI app link with the amount filled in, 12-digit UTR, payment screenshot;
#          the same UTR cannot be sent twice; passbook shows bonus / office adjustments / discounts the company paid.
#  Office: approval through the server (walletOp) — wallet + ledger line + UTR lock in one go; a repeated UTR is
#          flagged and rejected by itself; screenshot viewer; manual +/− needs a reason; Money page adds up the ledger.
import asyncio,os
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
SHOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'fixtures','payshot.png')
DP='+919999900002'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'],accept_downloads=True)
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100,upi:'office@upi',grow:{bonus:{on:true,rides:1,amt:40}}})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html');O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1800)
        w0=await pg.evaluate(f"MOCK.store.get('drivers/{DP}').wallet")
        # ---- driver: recharge form
        await df.evaluate("S.lang='en';S.tab='wallet';walletTab()");await pg.wait_for_timeout(500)
        await D.locator('#rc').click();await pg.wait_for_timeout(500)
        await D.locator('#ramt').fill('750');await pg.wait_for_timeout(100)
        href=await D.locator('#upay').get_attribute('href')
        check('"Pay ₹750 in UPI app" opens the owner UPI with the amount filled in',href.startswith('upi://pay?pa=office%40upi') and '&am=750&' in href and 'Pay ₹750' in await D.locator('#upay').inner_text(),href)
        await D.locator('#ramt').fill('20');await D.locator('#utr').fill('401234567890');await D.locator('#rs').click();await pg.wait_for_timeout(300)
        check('₹20 refused (₹50 to ₹50,000)','₹50' in await D.locator('#re').inner_text())
        await D.locator('#ramt').fill('750');await D.locator('#utr').fill('40123');await D.locator('#rs').click();await pg.wait_for_timeout(300)
        check('short UTR refused','12-digit' in await D.locator('#re').inner_text())
        await D.locator('#pf').set_input_files(SHOT);await pg.wait_for_timeout(1500)
        src=await D.locator('#pfi').get_attribute('src') or ''
        check('screenshot shrunk to a small JPEG preview',src.startswith('data:image/jpeg;base64,') and len(src)<=440000,len(src))
        await D.locator('#utr').fill('401234567890');await D.locator('#rs').click();await pg.wait_for_timeout(1200)
        r=await pg.evaluate("MOCK.store.get('recharges/u_401234567890')");pf=await pg.evaluate("MOCK.store.get('recharges/u_401234567890/proof/img')")
        check('request saved as recharges/u_<UTR>, ₹750, pending, with the screenshot',r and r['amt']==750 and r['status']=='pending' and r.get('proof') is True and r['driverPhone']==DP and pf and pf['img']==src,r)
        wt=' '.join((await D.locator('body').inner_text()).split())
        check('wallet: "₹750 · UTR 401234567890 … Screenshot attached"','₹750 · UTR 401234567890' in wt and 'Screenshot attached' in wt)
        # the same UTR again (already in the list) → stopped on the phone
        await D.locator('#rc').click();await pg.wait_for_timeout(400);await D.locator('#utr').fill('401234567890');await D.locator('#rs').click();await pg.wait_for_timeout(500)
        check('same UTR again: "This UTR was already sent"','already sent' in await D.locator('#re').inner_text())
        # a UTR someone else already sent (not in this driver's list) → refused by the rules
        await pg.evaluate("MOCK.store.set('recharges/u_555555555555',{driverPhone:'+919999900009',amt:100,utr:'555555555555',status:'rejected'})")
        await D.locator('#utr').fill('555555555555');await D.locator('#rs').click();await pg.wait_for_timeout(800)
        check('UTR used by another request: refused, nothing changed','already sent' in await D.locator('#re').inner_text() and (await pg.evaluate("MOCK.store.get('recharges/u_555555555555')"))['driverPhone']=='+919999900009')
        await df.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove()")
        # an older request (made before v153, random id) with the SAME UTR
        await pg.evaluate(f"MOCK.store.set('recharges/oldA',{{driverPhone:'{DP}',driverName:'T',amt:750,utr:'401234567890',status:'pending',date:Date.now()-60000}})")
        # ---- office
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.lang='en';S.sec='appr';save();show()");await pg.wait_for_timeout(1200)
        at=' '.join((await O.locator('#main').inner_text()).split())
        check('approvals: both requests flagged "same UTR is on another request"',at.count('The same UTR is on another request')==2,at[:300])
        check('one has a screenshot button, the old one says no screenshot',await O.locator('[data-pv="u_401234567890"]').count()==1 and 'No screenshot' in at)
        await O.locator('[data-pv="u_401234567890"]').click();await pg.wait_for_timeout(800)
        im=await O.locator('#pvb img').get_attribute('src') if await O.locator('#pvb img').count() else ''
        check('screenshot opens in the office',im==src)
        await O.locator('#pvc').click()
        await O.locator('[data-ok="u_401234567890"]').click();await pg.wait_for_timeout(1500)
        w1=await pg.evaluate(f"MOCK.store.get('drivers/{DP}').wallet");led=await pg.evaluate("MOCK.store.get('ledger/rch_u_401234567890')")
        check(f'approved on the server: wallet {w0} → {w0+750}, ledger line, UTR locked',w1==w0+750 and led and led['type']=='recharge' and led['amt']==750 and led['utr']=='401234567890' and await pg.evaluate("!!MOCK.store.get('utrs/401234567890')"),(w1,led))
        check('request marked approved with the ledger id',(await pg.evaluate("MOCK.store.get('recharges/u_401234567890')")).get('ledgerId')=='rch_u_401234567890')
        await of.evaluate("show()");await pg.wait_for_timeout(600)
        await O.locator('[data-ok="oldA"]').click();await pg.wait_for_timeout(1500)
        oa=await pg.evaluate("MOCK.store.get('recharges/oldA')");w2=await pg.evaluate(f"MOCK.store.get('drivers/{DP}').wallet")
        check('the same UTR a second time: not credited, rejected by itself (why dup-utr)',w2==w1 and oa['status']=='rejected' and oa.get('why')=='dup-utr',oa)
        # double tap protection: approving again does nothing
        r2=await of.evaluate("CL.call('walletOp',{kind:'recharge',rechargeId:'u_401234567890'})")
        check('approving the same request again: "done", no second credit',r2.get('why')=='done' and await pg.evaluate(f"MOCK.store.get('drivers/{DP}').wallet")==w1)
        # ---- manual wallet change needs a reason
        await of.evaluate("S.sec='drv';save();show()");await pg.wait_for_timeout(1200)
        await O.locator(f'[data-dw="{DP}"]').first.click();await pg.wait_for_timeout(400)
        await O.locator('#wa').fill('50');await O.locator('#wm').click();await pg.wait_for_timeout(500)
        check('− without a reason refused','reason' in (await O.locator('#we').inner_text()).lower())
        await O.locator('#wr').fill('Toll refund wrong');await O.locator('#wm').click();await pg.wait_for_timeout(1200)
        w3=await pg.evaluate(f"MOCK.store.get('drivers/{DP}').wallet");adj=await pg.evaluate("[...MOCK.store.keys()].filter(k=>k.startsWith('ledger/adj')).map(k=>MOCK.store.get(k))")
        check('− ₹50 with a reason: wallet down 50, ledger line with the reason',w3==w1-50 and len(adj)==1 and adj[0]['amt']==-50 and adj[0]['reason']=='Toll refund wrong',adj)
        # bonus through the server, once a day
        b1=await of.evaluate(f"CL.call('walletOp',{{kind:'bonus',driverPhone:'{DP}'}})");b2=await of.evaluate(f"CL.call('walletOp',{{kind:'bonus',driverPhone:'{DP}'}})")
        check('bonus ₹40 from the settings, once a day',b1.get('ok') and b1.get('amt')==40 and b2.get('why')=='paid-today' and await pg.evaluate(f"MOCK.store.get('drivers/{DP}').wallet")==w3+40,(b1,b2))
        # ---- driver passbook
        await pg.evaluate(f"""(()=>{{const t=Date.now();MOCK.store.set('ledger/disc_bk9',{{bookingId:'bk9',driverPhone:'{DP}',disc:30,kind:'coupon-discount',coupon:'VELLORE30',at:{{toMillis:()=>t}}}});
          MOCK.store.set('ledger/bk9',{{bookingId:'bk9',driverPhone:'{DP}',trip:300,comm:30,walletDelta:-30,at:{{toMillis:()=>t}}}});
          MOCK.store.set('ledger/s1',{{type:'sub',driverPhone:'{DP}',plan:'day',price:99,walletDelta:-99,at:{{toMillis:()=>t}}}});
          MOCK.fs.setDoc({{path:'zz/x'}},{{}})}})()""");await pg.wait_for_timeout(1200)
        await df.evaluate("S.tab='wallet';walletTab()");await pg.wait_for_timeout(600)
        wt=' '.join((await D.locator('body').inner_text()).split())
        check('driver passbook: recharge, office adjustment with reason, bonus, coupon discount paid by the company',all(x in wt for x in ['Recharge (approved)','Office adjustment · Toll refund wrong','Daily bonus (office)','Coupon discount paid by the company · VELLORE30']),wt[:600])
        check('driver sees the rejected duplicate with the reason','this UTR was already used' in wt)
        # ---- Money page
        await of.evaluate("S.sec='money';save();show()");await pg.wait_for_timeout(1800)
        mt=' '.join((await O.locator('#main').inner_text()).split())
        check('Money: reached your account ₹750 (1 UPI)','Reached your account ₹750 1 UPI' in mt,mt[:400])
        check('Money: earned ₹129 (commission 30 + subscription 99), paid out ₹70 (coupon 30 + bonus 40), net ₹59','Company earned ₹129' in mt and 'Company paid out ₹70' in mt and 'Net ₹59' in mt)
        check('Money: office adjustment shown apart from Net','Office deducted −₹50' in mt)
        tot=await of.evaluate("DB.drv.reduce((x,d)=>x+(+d.wallet||0),0)");n=await of.evaluate("DB.drv.length")
        check('Money: driver wallets total and waiting approvals',f"Total balance ({n} driver{'' if n==1 else 's'}) ₹{tot:,}" in mt and 'Waiting for approval (0) ₹0' in mt,mt[-500:])
        async with pg.expect_download() as dl:
            await O.locator('#mcsv').click()
        path=await (await dl.value).path();csv=open(path,encoding='utf-8-sig').read()
        check('CSV for the accountant: one row per entry with the UTR and reason','Wallet recharge,750,750,,UTR 401234567890' in csv and 'Office adjustment,-50,-50,,Toll refund wrong' in csv and 'Ride commission,30,-30,300,bk9' in csv,csv[:500])
        await O.locator('[data-mp="yday"]').click();await pg.wait_for_timeout(1200)
        check('yesterday: nothing','Nothing in this period' in await O.locator('#main').inner_text())
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}')
asyncio.run(main())
