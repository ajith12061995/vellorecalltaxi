# Server driver watch (27 Nov): after 3 h of silence the server switches a driver OFF (autoOff == updatedAt).
# The driver app goes back ON by itself — while open (signal came back) and when reopened. An office OFF is not undone.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9165,'longitude':79.1325},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        D=pg.frame_locator('#d');dfr=lambda:pg.frame(url=B+'d2.html')
        drv="MOCK.store.get('drivers/+919999900002')"
        async def login():
            await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
            for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
            await pg.wait_for_timeout(3000)
        await login()
        await D.locator('#ons').click();await pg.wait_for_timeout(2500)
        check('driver ON',(await pg.evaluate(drv)).get('online')==True)
        # the server switches the driver OFF (as housekeeping does: autoOff and updatedAt the same server time)
        pause="(()=>{const t={__ms:Date.now()};MOCK.fs.setDoc({path:'drivers/+919999900002'},{...MOCK.store.get('drivers/+919999900002'),online:false,autoOff:t,updatedAt:t})})()"
        await pg.evaluate(pause);await pg.wait_for_timeout(2500)
        d=await pg.evaluate(drv)
        check('app open when the server pauses → back ON by itself',d.get('online')==True and await dfr().evaluate("S.online===true"),d.get('online'))
        check('…and tells the driver',await dfr().evaluate("document.body.innerText.includes('Signal திரும்ப வந்தது')||document.body.innerText.includes('Signal is back')"))
        # an office OFF (no autoOff) is respected: the app does not switch itself back ON
        await pg.evaluate("MOCK.fs.setDoc({path:'drivers/+919999900002'},{...MOCK.store.get('drivers/+919999900002'),online:false,updatedAt:{__ms:Date.now()+5}})")
        await pg.wait_for_timeout(2500)
        check('office OFF with an old autoOff on the record → stays OFF',(await pg.evaluate(drv)).get('online')==False)
        # back ON, then paused while the app is closed; reopening goes ON (the driver's own switch was ON)
        await pg.evaluate("MOCK.fs.setDoc({path:'drivers/+919999900002'},{...MOCK.store.get('drivers/+919999900002'),online:true,updatedAt:{__ms:Date.now()}})");await pg.wait_for_timeout(1500)
        await dfr().evaluate("UNS.forEach(u=>{try{u()}catch(e){}});UNS.length=0")  # the app is gone (no listeners)
        await pg.evaluate(pause);await pg.wait_for_timeout(800)
        check('closed app: server pause stays',(await pg.evaluate(drv)).get('online')==False)
        await dfr().evaluate("location.reload()");await pg.wait_for_timeout(2500)
        if await D.locator('#ph').count():await login()
        check('reopening the app → ON again',(await pg.evaluate(drv)).get('online')==True and await D.locator('#offs').count()==1)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
