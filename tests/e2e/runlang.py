# Customer app opens in English the first time (English listed first and selected); the customer can switch to Tamil.
# The chosen language is saved on the customer record (users/{uid}.lang) at sign-up and on every switch —
# the server sends WhatsApp messages in that language — even when notifications were never allowed.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.add_init_script("if(location.pathname.endsWith('/c2.html'))try{localStorage.removeItem('vct')}catch(e){}")
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        cards=await cf.evaluate("[...document.querySelectorAll('.langcard')].map(b=>b.dataset.l+(b.classList.contains('sel')?'*':''))")
        check('first open: English listed first and selected',cards==['en*','ta'],cards)
        h=await cf.evaluate("document.querySelector('h1').innerText")
        check('language screen itself in English',h=='Choose your language',h)
        await pg.screenshot(path='shots/lang_first.png',clip={'x':0,'y':0,'width':400,'height':860})
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        uid=await cf.evaluate("CUID")
        u=await pg.evaluate(f"MOCK.store.get('users/{uid}')") or {}
        check('sign-up saves English on the customer record (no notifications needed)',u.get('lang')=='en' and not u.get('fcm'),u)
        await C.locator('#lg').click();await pg.wait_for_timeout(1200)
        u=await pg.evaluate(f"MOCK.store.get('users/{uid}')") or {}
        check('switch to தமிழ் on home: app in Tamil and saved',await cf.evaluate("S.lang")=='ta' and u.get('lang')=='ta',u.get('lang'))
        await cf.evaluate("profile()");await pg.wait_for_timeout(800)
        await C.locator('#lg').click();await pg.wait_for_timeout(1200)
        u=await pg.evaluate(f"MOCK.store.get('users/{uid}')") or {}
        check('switch back in Profile: English saved',await cf.evaluate("S.lang")=='en' and u.get('lang')=='en',u.get('lang'))
        check('name and phone kept',u.get('name')=='Priya' and u.get('phone')=='+919999900001',u)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
