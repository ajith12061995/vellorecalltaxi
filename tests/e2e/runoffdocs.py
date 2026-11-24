# Office uploads a driver's documents for them (24 Nov): drivers who cannot use the join form send photos on WhatsApp.
# Owner: "+ Driver" → save → upload sheet; each photo saves to driverApps/{phone}/files/{slot}; "View documents" shows them.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='drv';save();show()");await pg.wait_for_timeout(800)
        st=lambda k:pg.evaluate(f"MOCK.store.get('{k}')||null")
        # ---- add a new driver, then the upload sheet opens by itself
        await O.locator('#ad').click();await pg.wait_for_timeout(300)
        await O.locator('#an').fill('Mani');await O.locator('#ap').fill('9777700001');await O.locator('#apl').fill('TN23AB1234')
        await O.locator('#as').click();await pg.wait_for_timeout(1200)
        d=await st('drivers/+919777700001')
        check('driver saved (can log in with OTP)',d and d.get('name')=='Mani' and d.get('veh')=='auto' and d.get('blocked') is False,d)
        check('upload sheet opens with 11 slots',await O.locator('.uptile').count()==11,await O.locator('.uptile').count())
        check('no office record before the first photo',await st('driverApps/+919777700001') is None)
        for k in ['photo','dlF','dlB']:
            await O.locator(f'[data-uf="{k}"]').set_input_files('fixtures/doc.jpg');await pg.wait_for_timeout(900)
        a=await st('driverApps/+919777700001')
        check('office record: approved, marked office, lists the 3 photos',a and a.get('status')=='approved' and a.get('src')=='office' and sorted(a.get('files',[]))==['dlB','dlF','photo'] and a.get('name')=='Mani',a)
        f=await st('driverApps/+919777700001/files/dlF')
        check('photo stored as a shrunk JPEG under 1 MB',f and f.get('data','').startswith('data:image/jpeg;base64,') and len(f['data'])<1000000,f and len(f.get('data','')))
        check('3 tiles marked saved with a thumbnail',await O.locator('.uptile.has').count()==3 and await O.locator('.uptile.has img').count()==3)
        # a non-photo file is refused, nothing saved
        await O.locator('[data-uf="rcF"]').set_input_files({'name':'x.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4'});await pg.wait_for_timeout(500)
        check('non-photo refused with a message',(await O.locator('#ue').inner_text()).strip()!='' and await st('driverApps/+919777700001/files/rcF') is None)
        await O.locator('#ud').click();await pg.wait_for_timeout(600)
        # ---- "View documents" shows them
        await O.locator('[data-dph="+919777700001"]').click();await pg.wait_for_timeout(1200)
        check('View documents shows the 3 photos',await O.locator('[id^="dp_"] img').count()==3,await O.locator('[id^="dp_"]').count())
        await of.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove())");await pg.wait_for_timeout(300)
        # ---- later: add more for the same driver; the record is updated, not replaced
        await of.evaluate("show()");await pg.wait_for_timeout(600)
        await O.locator('[data-dup="+919777700001"]').click();await pg.wait_for_timeout(500)
        check('reopened sheet remembers the 3 saved slots',await O.locator('.uptile.has').count()==3)
        await O.locator('[data-uf="permitB"]').set_input_files('fixtures/doc.jpg');await pg.wait_for_timeout(900)
        a=await st('driverApps/+919777700001')
        check('4th photo added to the same record',sorted(a.get('files',[]))==['dlB','dlF','permitB','photo'] and a.get('status')=='approved' and a.get('name')=='Mani',a)
        await O.locator('#ud').click();await pg.wait_for_timeout(400)
        # ---- a driver who applied through the join form (pending): office upload must not approve it by accident
        await pg.evaluate("MOCK.store.set('drivers/+919777700002',{name:'Ravi',veh:'sedan',plate:'TN23X1',model:'Dzire',wallet:0,rating:5,online:false,blocked:false,docs:{}});MOCK.store.set('driverApps/+919777700002',{name:'Ravi',phone:'+919777700002',status:'pending',files:['photo'],veh:'sedan'});MOCK.fire&&MOCK.fire()")
        await pg.wait_for_timeout(300);await of.evaluate("location.reload()");await pg.wait_for_timeout(2500)
        if await O.locator('#ph').count():
            await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300);await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='drv';save();show()");await pg.wait_for_timeout(800)
        if await O.locator('[data-dup="+919777700002"]').count():
            await O.locator('[data-dup="+919777700002"]').click();await pg.wait_for_timeout(500)
            await O.locator('[data-uf="rcF"]').set_input_files('fixtures/doc.jpg');await pg.wait_for_timeout(900)
            a=await st('driverApps/+919777700002')
            check('existing join application stays pending; photo list grows',a.get('status')=='pending' and sorted(a.get('files',[]))==['photo','rcF'] and 'src' not in a,a)
        else:check('second driver visible for upload',False,'no button')
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
