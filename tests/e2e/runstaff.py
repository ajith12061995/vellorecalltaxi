# Office staff: owner adds a staff member (duty hours, details, file), sends the office link, turns the login off/on;
# a staff member on duty sees no owner screens, cannot change a fare but asks the owner; the owner gets an alert,
# approves (fare changes) and sees the activity log; a staff member off duty or turned off is shown the reason.
import asyncio,base64,os
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
IST="(()=>{const d=new Date(Date.now()+330*60e3);return d.getUTCHours()*60+d.getUTCMinutes()})()"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:asyncio.ensure_future(d.accept('fare too high')))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("""MOCK.fs.setDoc(MOCK.fs.doc(null,'bookings','bkS1'),{status:'searching',kind:'ride',veh:'mini',custName:'Ravi',custPhone:'+919876500001',
          from:{key:'katpadi'},to:{key:'cmc'},fare:150,when:Date.now(),createdAt:Date.now(),updatedAt:Date.now()})""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        async def login(ph):
            await O.locator('#ph').fill(ph);await O.locator('#lgn').click();await pg.wait_for_timeout(300)
            await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1800)
        await login('8220201462')
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(900)
        await of.evaluate("document.getElementById('as').scrollIntoView()");await O.locator('#as').click();await pg.wait_for_timeout(500)
        await O.locator('#sn').fill('Kavya');await O.locator('#sp').fill('9000000009')
        await O.locator('#sf').fill('09:00');await O.locator('#st2').fill('18:00')
        await O.locator('#sad').fill('Katpadi');await O.locator('#sem').fill('Amma 9000000001')
        fp='/tmp/claude-0/resume.pdf';open(fp,'wb').write(b'%PDF-1.4\n%test\n')
        await O.locator('#f_resume').set_input_files(fp)
        await O.locator('#ss').click();await pg.wait_for_timeout(1200)
        st=await pg.evaluate("MOCK.store.get('staff/+919000000009')") or {}
        pr=await pg.evaluate("MOCK.store.get('staff/+919000000009/private/profile')") or {}
        fl=await pg.evaluate("MOCK.store.get('staff/+919000000009/private/f_resume')") or {}
        check('staff saved: name, role staff, active, duty 09:00–18:00',st.get('name')=='Kavya' and st.get('role')=='staff' and st.get('active') is True and st.get('shift')=={'from':540,'to':1080},st)
        check('details + resume kept privately (owner-only path)',pr.get('address')=='Katpadi' and pr.get('emergency')=='Amma 9000000001' and str(fl.get('data','')).startswith('data:application/pdf'),list(pr))
        await pg.wait_for_timeout(600)
        href=await O.locator('[data-sl="0"]').get_attribute('href')
        check('"Send link" opens WhatsApp to the staff number with the office link and hours','wa.me/919000000009' in href and 'velloretaxi.app%2Foffice' in href and '09%3A00' in href,href[:120])
        await O.locator('[data-sa="0"]').click();await pg.wait_for_timeout(700)
        check('turn off → active false',(await pg.evaluate("MOCK.store.get('staff/+919000000009')")).get('active') is False)
        await O.locator('[data-sa="0"]').click();await pg.wait_for_timeout(700)
        check('turn on again',(await pg.evaluate("MOCK.store.get('staff/+919000000009')")).get('active') is True)
        # staff on duty
        await pg.evaluate(f"MOCK.store.set('staff/+919000000009',{{...MOCK.store.get('staff/+919000000009'),shift:{{from:({IST}+1380)%1440,to:({IST}+60)%1440}}}})")
        await of.evaluate("logout()");await pg.wait_for_timeout(600);await login('9000000009')
        nav=await of.evaluate("[...document.querySelectorAll('.snav [data-sec]')].map(b=>b.dataset.sec)")
        check('staff on duty: in, no Approvals / Reports / Settings',await of.evaluate("S.logged&&S.role")=='staff' and not any(x in nav for x in ('appr','rep','set')),nav)
        await of.evaluate("bookSheet(DB.bk.find(b=>b._id==='bkS1'))");await pg.wait_for_timeout(500)
        check('booking: staff sees "ask the owner", not the bill-reviewed button',await O.locator('#bsq').count()==1 and await O.locator('#bbok').count()==0)
        await O.locator('#bsq').click();await pg.wait_for_timeout(500)
        await O.locator('#rqa').fill('210');await O.locator('#rqs').click();await pg.wait_for_timeout(500)
        check('reason is required',await O.locator('#rqe').inner_text()!='')
        await O.locator('#rqy').fill('Customer extra 8 km poganum');await O.locator('#rqs').click();await pg.wait_for_timeout(900)
        rq=[v for k,v in (await pg.evaluate("MOCK.dump()")).items() if k.startswith('staffReq/')]
        check('request saved: fare 150 → 210, by Kavya, pending',len(rq)==1 and rq[0].get('kind')=='fare' and rq[0].get('want')==210 and rq[0].get('cur')==150 and rq[0].get('by')=='+919000000009' and rq[0].get('status')=='pending',rq)
        check('fare not changed by staff',(await pg.evaluate("MOCK.store.get('bookings/bkS1')")).get('fare')==150)
        await pg.wait_for_timeout(400)
        check('staff dashboard lists "my requests" as waiting',await of.evaluate("S.sec='dash';save();show();document.body.innerText.includes('Kavya')||1") and ('காத்திருக்கு' in await of.evaluate("document.body.innerText") or 'Waiting' in await of.evaluate("document.body.innerText")))
        await of.evaluate("reviewSheet(DB.bk.find(b=>b._id==='bkS1'))");await pg.wait_for_timeout(400)
        check('outstation review: fare box read-only for staff',await O.locator('#rvf').get_attribute('readonly') is not None and await O.locator('#rvrq').count()==1)
        await of.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove())")
        # off duty → explained, nothing loads
        await pg.evaluate(f"MOCK.store.set('staff/+919000000009',{{...MOCK.store.get('staff/+919000000009'),shift:{{from:({IST}+120)%1440,to:({IST}+240)%1440}}}})")
        await of.evaluate("logout()");await pg.wait_for_timeout(600);await login('9000000009')
        t=await of.evaluate("document.body.innerText")
        check('off duty: told the duty hours, not logged in',('duty' in t.lower()) and not await of.evaluate("S.logged"),t[:200])
        # owner decides
        await of.evaluate("location.reload()");await pg.wait_for_timeout(2500);of=pg.frame(url=B+'o2.html')
        if await of.evaluate("S.logged"):await of.evaluate("logout()");await pg.wait_for_timeout(500)
        await login('8220201462')
        check('owner: Approvals badge counts the request',await of.evaluate("badge('appr')")>=1)
        await of.evaluate("S.sec='appr';save();show()");await pg.wait_for_timeout(800)
        check('owner sees the request with reason and amounts','Customer extra 8 km' in await of.evaluate("main().innerText") and '210' in await of.evaluate("main().innerText"))
        await O.locator('[data-rqok]').first.click();await pg.wait_for_timeout(1000)
        rq=[v for k,v in (await pg.evaluate("MOCK.dump()")).items() if k.startswith('staffReq/')][0]
        check('approve → fare 210 on the booking, request approved by owner',(await pg.evaluate("MOCK.store.get('bookings/bkS1')")).get('fare')==210 and rq.get('status')=='approved' and rq.get('decidedBy')=='+918220201462',rq.get('status'))
        await of.evaluate("S.sec='rep';save();show()");await pg.wait_for_timeout(2500)
        t=await of.evaluate("main().innerText")
        check('activity log shows who asked and who approved','Kavya' in t and ('Approve' in t) and ('Owner-கிட்ட கேட்டது' in t or 'Asked the owner' in t),t[-400:].replace('\n',' | '))
        await pg.screenshot(path='shots/staff_log.png',clip={'x':800,'y':0,'width':1100,'height':880})
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
