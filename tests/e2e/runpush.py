# Push notifications: with the web-push key set in Office → Settings, the customer is asked once on the
# "finding your driver" screen and the device token is saved on users/{uid} (with the language); a driver who
# has allowed notifications gets a token saved when going online. Without the key, nothing is asked.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
NOTIF="""(p)=>{window.__asked=0;Object.defineProperty(window,'Notification',{configurable:true,value:{permission:p,requestPermission:async()=>{__asked++;window.Notification.permission='granted';return 'granted'}}})}"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate(NOTIF,'default');await df.evaluate(NOTIF,'granted')
        # 1) no key yet → no question, no token
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        check('without the key: customer is not asked',not await cf.evaluate("!!document.getElementById('pushask')"))
        check('without the key: driver token not asked for',not await pg.evaluate("(window.__pushReg||[]).length"))
        await pg.evaluate("(()=>{const k=[...MOCK.store.keys()].filter(x=>/^bookings\\/[^/]+$/.test(x));k.forEach(x=>MOCK.fs.updateDoc({path:x},{status:'cancelled',cancelReason:'customer'}))})()");await pg.wait_for_timeout(2000)
        # 2) owner adds the key
        await pg.evaluate("MOCK.fs.setDoc({path:'config/app'},{comm:10,minbal:100,push:{vapid:'BTESTKEY'}})");await pg.wait_for_timeout(1500)
        await df.evaluate("goLive(true)");await pg.wait_for_timeout(1500)
        reg=await pg.evaluate("window.__pushReg||[]")
        dt=await pg.evaluate("(MOCK.store.get('drivers/+919999900002')||MOCK.store.get('drivers/9999900002')||{}).fcm")
        check('driver going online (already allowed) saves the token, own service worker',dt and dt.startswith('tok-') and './fcm-sw.js|./fcm/' in reg,(dt,reg))
        await cf.evaluate("home()");await pg.wait_for_timeout(800)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(2500)
        check('customer is asked on the "finding your driver" screen',await cf.evaluate("!!document.getElementById('pushask')"))
        await pg.screenshot(path='shots/push_ask.png',clip={'x':0,'y':0,'width':400,'height':860})
        uid=await cf.evaluate("CUID")
        check('nothing saved before the customer says yes',not await pg.evaluate(f"(MOCK.store.get('users/{uid}')||{{}}).fcm"))
        await C.locator('#pushon').click();await pg.wait_for_timeout(1200)
        u=await pg.evaluate(f"MOCK.store.get('users/{uid}')||{{}}")
        check('"Yes" asks the phone once and saves token + language on the customer record',await cf.evaluate("__asked")==1 and str(u.get('fcm','')).startswith('tok-') and u.get('lang')=='ta',(u.get('fcm'),u.get('lang')))
        check('question disappears after yes',not await cf.evaluate("!!document.getElementById('pushask')"))
        check('customer service worker is the customer one (./fcm-sw.js at the app root)',len([x for x in await pg.evaluate("window.__pushReg||[]") if x=='./fcm-sw.js|./fcm/'])>=2)
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        check('ride still works normally after enabling alerts',await cf.evaluate("R&&R.phase")!='search')
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
