import asyncio
from playwright.async_api import async_playwright
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1900,'height':880}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'TUNNEL' not in m.text and 'fonts' not in m.text and '404' not in m.text else None)
        await pg.goto('http://localhost:8765/tests/e2e/out/harness_j.html'); await pg.wait_for_timeout(2500)
        J=pg.frame_locator('#c'); O=pg.frame_locator('#o'); D=pg.frame_locator('#d')
        jf=pg.frame(url='http://localhost:8765/tests/e2e/out/j2.html'); of=pg.frame(url='http://localhost:8765/tests/e2e/out/o2.html')
        await O.locator('#ph').fill('8220201462'); await O.locator('#lgn').click(); await pg.wait_for_timeout(300); await O.locator('#otp').fill('123456'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/j0.png')
        await J.locator('#ph').fill('9876512345'); await J.locator('#ph').dispatch_event('input'); await J.locator('#go').click(); await pg.wait_for_timeout(400)
        await J.locator('#o0').fill('123456'); await pg.wait_for_timeout(800)
        # ---- short join form (24 Nov 2026): name, family number, vehicle type, plate, 7 photos, agreement tick. Nothing else to type.
        e=lambda: jf.evaluate("document.getElementById('e').textContent")
        check('short form: no licence number / brand / year / date / UPI / signature boxes',await jf.evaluate("document.querySelectorAll('#dln,#br,#mo,#yr,#exp,#area,#ecn,#upi,#sig,#own,input[type=date]').length")==0)
        check('short form: 9 photo boxes (7 needed + insurance, permit)',await J.locator('[data-f]').count()==9,await J.locator('[data-f]').count())
        await J.locator('#nm').fill('Murugan K'); await J.locator('#ecp').fill('9840011122')
        await J.locator('[data-v=sedan]').click(); await pg.wait_for_timeout(200)
        await J.locator('#pl').fill('TN 23 CK 4455')
        await J.locator('#sb').click(); await pg.wait_for_timeout(300)
        t=await e(); check('photos are asked for before sending',('Missing' in t or 'இது இல்லை' in t) and await pg.evaluate("!MOCK.dump()['driverApps/+919876512345']"),t)
        for k in ['photo','dlF','dlB','rcF','rcB','aadhaarF','aadhaarB']:
            await J.locator(f'[data-f={k}]').set_input_files('fixtures/doc.jpg'); await pg.wait_for_timeout(500)
        check('typed values survive adding photos',await J.locator('#nm').input_value()=='Murugan K' and await J.locator('#pl').input_value()=='TN 23 CK 4455' and await J.locator('#ecp').input_value()=='9840011122')
        await pg.screenshot(path='shots/j1.png')
        await J.locator('#sb').click(); await pg.wait_for_timeout(400)
        check('agreement tick is required',(await e()).strip()!='' and await pg.evaluate("!MOCK.dump()['driverApps/+919876512345']"),await e())
        await J.locator('#agree').check()
        await J.locator('#ecp').fill('9876512345'); await J.locator('#sb').click(); await pg.wait_for_timeout(400)
        check('own number as the family number is refused',(await e()).strip()!='' and await pg.evaluate("!MOCK.dump()['driverApps/+919876512345']"),await e())
        await J.locator('#ecp').fill('9840011122'); await J.locator('#pl').fill('TN23XX'); await J.locator('#sb').click(); await pg.wait_for_timeout(400)
        check('a wrong number plate is refused',(await e()).strip()!='' and await pg.evaluate("!MOCK.dump()['driverApps/+919876512345']"),await e())
        await J.locator('#pl').fill('TN 23 CK 4455'); await J.locator('#sb').click(); await pg.wait_for_timeout(3000)
        await pg.screenshot(path='shots/j2.png')
        a=(await pg.evaluate('MOCK.dump()')).get('driverApps/+919876512345') or {}
        check('application sent: pending, 7 photos, agreement recorded with the name',a.get('status')=='pending' and sorted(a.get('files',[]))==sorted(['photo','dlF','dlB','rcF','rcB','aadhaarF','aadhaarB']) and (a.get('consent') or {}).get('name')=='Murugan K' and a.get('veh')=='sedan' and a.get('plate')=='TN 23 CK 4455' and a.get('ecPhone')=='+919840011122',a)
        check('no undefined / junk fields: untyped ones are empty',a.get('dlNo')=='' and a.get('brand')=='' and a.get('year') is None and a.get('exp')=={} and a.get('upi')=='',{k:a.get(k) for k in ('dlNo','brand','year','exp','upi')})
        await of.evaluate("S.sec='appr';show()"); await pg.wait_for_timeout(600)
        badge=await of.evaluate("(document.querySelector('.chkbadge')||{}).textContent")
        check('office: application shows with nothing to fix (only notes)',await of.evaluate("badge('appr')")>=1 and '⛔' not in (badge or ''),badge)
        await O.locator('[data-av]').first.click(); await pg.wait_for_timeout(1200); await pg.screenshot(path='shots/j3.png')
        cl=await of.evaluate("[...document.querySelectorAll('.chklist div')].map(d=>d.className+':'+d.textContent).join(' | ')")
        check('office checklist: no blockers; reminds to enter dates from the photos',('bad:' not in cl) and ('Document' in cl),cl)
        check('office shows the 7 photos',await O.locator('[id^="im_"]').count()==7)
        await O.locator('#apok').click(); await pg.wait_for_timeout(1200)
        dump=await pg.evaluate('MOCK.dump()'); d=dump.get('drivers/+919876512345') or {}
        check('approve creates the driver (vehicle name as model, no dates yet, agreement kept)',d.get('name')=='Murugan K' and d.get('veh')=='sedan' and d.get('plate')=='TN 23 CK 4455' and bool(d.get('model')) and d.get('docs')=={'dl':None,'ins':None,'permit':None,'fc':None} and (d.get('consent') or {}).get('name')=='Murugan K' and dump['driverApps/+919876512345']['status']=='approved',d)
        st=await jf.evaluate("(document.querySelector('.status')||{}).textContent||''")
        check('join page shows the approved screen',bool(st.strip()),st[:80])
        errs=[x for x in errs if 'favicon' not in x]
        check('no page errors',not errs,errs[:3])
        print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
        await b.close()
asyncio.run(main())
