# Phone with the browser's "Desktop site" on (page drawn at laptop width): a notice explains how to turn it off.
# Normal phone, real laptop and touch laptop: no notice, nothing changes.
import asyncio, os
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
O=os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')
# stand-alone copies of the test pages (mock Firebase inside the page), so the page is the top window like on a phone
for a in 'cdj':open(os.path.join(O,a+'k.html'),'w').write(open(os.path.join(O,a+'2.html')).read().replace('<head>','<head><script src="../mockfb.js"></script>',1))
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def run(p,page,vw,vh,sw,sh,touch):
    b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':vw,'height':vh},screen={'width':sw,'height':sh},has_touch=touch)
    pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(B+page);await pg.wait_for_timeout(2500)
    f=pg
    r=await f.evaluate("""()=>{const e=document.getElementById('vct-deskmode');if(!e)return{on:false,is:VCTDESK.is()};const b=e.getBoundingClientRect();
      return{on:true,is:VCTDESK.is(),w:b.width,font:parseFloat(getComputedStyle(e).fontSize),txt:e.innerText}}""")
    if r['on']:
        await f.evaluate("document.querySelector('#vct-deskmode button').click()");r['closed']=await f.evaluate("!document.getElementById('vct-deskmode')")
    await b.close();return r,errs
async def main():
    async with async_playwright() as p:
        # Desktop-site mode: page 980 px wide on a 412 px phone screen
        r,e=await run(p,'ck.html',980,2176,412,915,True)
        check('customer, phone in Desktop-site mode: notice shown',r['on'] and 'Desktop site' in r['txt'],r)
        check('… text large enough to read on the real screen (≥ 15 px × page/screen)',r['on'] and r['font']>=15*1.5,r.get('font'))
        check('… can be closed',r.get('closed'))
        check('no page errors',not e,e)
        r,e=await run(p,'dk.html',980,2176,412,915,True)
        check('driver, phone in Desktop-site mode: notice shown',r['on'],r)
        r,e=await run(p,'jk.html',980,2176,412,915,True)
        check('driver join, phone in Desktop-site mode: notice shown',r['on'],r)
        r,e=await run(p,'ck.html',1500,900,1920,1080,False)
        check('laptop: no notice',not r['on'] and not r['is'],r)
        r,e=await run(p,'ck.html',1300,700,1366,768,True)
        check('touch laptop / tablet: no notice',not r['on'],r)
        r,e=await run(p,'ck.html',915,412,915,412,True)
        check('normal phone held sideways: no notice',not r['on'] and not r['is'],r)
        b=await p.chromium.launch();ctx=await b.new_context(**p.devices['Pixel 7']);pg=await ctx.new_page()
        await pg.goto(B+'c2.html');await pg.wait_for_timeout(800)
        check('normal phone (page at phone width): no notice',await pg.evaluate("!document.getElementById('vct-deskmode')&&!VCTDESK.is()&&innerWidth<520"))
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
