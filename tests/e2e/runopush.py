# Owner alerts on the owner's phone (27 Nov): the Office asks once, saves the push token in staff/{phone}/private/push,
# then hides the button. Staff logins never see it. Without the push key in Settings it is not offered.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1500,'height':1000},permissions=['notifications'])
        await ctx.add_init_script("try{Object.defineProperty(Notification,'permission',{configurable:true,get:()=>window.__np||'default'});Notification.requestPermission=async()=>(window.__np=window.__npAns||'granted')}catch(e){}")
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        O=pg.frame_locator('#o');of=lambda:pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2500)
        await of().evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(800)
        check('no push key in Settings → not offered',await O.locator('#opush').count()==0)
        await pg.evaluate("MOCK.fs.setDoc({path:'config/app'},{...(MOCK.store.get('config/app')||{}),push:{vapid:'BKx'+'a'.repeat(80)}})");await pg.wait_for_timeout(1500)
        await of().evaluate("show()");await pg.wait_for_timeout(600)
        check('owner sees "alerts on this phone"',await O.locator('#opush').count()==1,await of().evaluate("S.role"))
        await of().evaluate("window.__npAns='denied'");await O.locator('#opush').click();await pg.wait_for_timeout(800)
        check('owner says no → nothing saved, button stays',await pg.evaluate("!MOCK.store.get('staff/+918220201462/private/push')") and await O.locator('#opush').count()==1)
        await of().evaluate("window.__np='denied';show()");await pg.wait_for_timeout(300)
        check('blocked in the browser → says how to allow it',await O.locator('#opush[disabled]').count()==1 and 'Site settings' in await O.locator('#opush').inner_text())
        await of().evaluate("window.__np='default';window.__npAns='granted';show()");await pg.wait_for_timeout(300)
        await O.locator('#opush').click();await pg.wait_for_timeout(1500)
        doc=await pg.evaluate("MOCK.store.get('staff/+918220201462/private/push')")
        check('token saved for the owner',bool(doc) and str(doc.get('fcm','')).startswith('tok-'),doc)
        check('office service worker used',await pg.evaluate("(window.__pushReg||[]).includes('./fcm-sw.js|./fcm/')"))
        check('button gone after Allow',await O.locator('#opush').count()==0)
        await of().evaluate("S.role='staff';show()");await pg.wait_for_timeout(500)
        await of().evaluate("localStorage.removeItem('vcto_fcm');show()");await pg.wait_for_timeout(500)
        check('a staff login never sees it',await O.locator('#opush').count()==0)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
