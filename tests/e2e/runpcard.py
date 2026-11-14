# Home screen: one-tap popular place cards (photo where licensed, illustrated otherwise) open the fare screen.
import asyncio
from playwright.async_api import async_playwright
res=[]
def check(nm,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+nm,i)
B='http://localhost:8765/tests/e2e/out/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2500)
        n=await cf.evaluate("document.querySelectorAll('.pcard').length")
        imgs=await cf.evaluate("[...document.querySelectorAll('.pcard img')].map(i=>i.naturalWidth)")
        await cf.evaluate("document.querySelector('.pcards').scrollIntoView()")
        await pg.screenshot(path='shots/pcard1.png',clip={'x':0,'y':0,'width':400,'height':860})
        await C.locator('.pcard[data-p="katpadi"]').click();await pg.wait_for_timeout(1500)
        dest=await cf.evaluate("S.dest")
        await pg.screenshot(path='shots/pcard2.png',clip={'x':0,'y':0,'width':400,'height':860})
        await cf.evaluate("S.lang='ta';home()");await pg.wait_for_timeout(800)
        await cf.evaluate("document.querySelector('.pcards').scrollIntoView()")
        await pg.screenshot(path='shots/pcard3.png',clip={'x':0,'y':0,'width':400,'height':860})
        check('6 place cards on home',n==6,n);check('6 photos load',imgs==[300]*6,imgs);check('one tap on Katpadi card opens the fare screen',dest=='katpadi',dest);check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
