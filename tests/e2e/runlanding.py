# velloretaxi.app on a computer (first visit) opens the website /vellore/; the app stays for phones, the installed app,
# returning customers, website "Book" links (#book=), ad / QR links (?utm_…) and "Open the app" (?app=1, kept for the visit).
import asyncio
from playwright.async_api import async_playwright
U='http://localhost:8765/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def at(b,url,init=None,**kw):
    ctx=await b.new_context(**kw)
    if init:await ctx.add_init_script(init)
    pg=await ctx.new_page();await pg.goto(url);await pg.wait_for_timeout(1500);u=pg.url;return ctx,pg,u
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();D={'viewport':{'width':1440,'height':900}}
        ctx,pg,u=await at(b,U,**D);check('computer, first visit → website',u.endswith('/vellore/'),u)
        check('website shows its booking box',await pg.locator('#book [role=tab]').count()==3);await ctx.close()
        ctx,pg,u=await at(b,U+'?app=1',**D);check('"Open the app" link (?app=1) → app',u==U+'?app=1',u)
        await pg.goto(U);await pg.wait_for_timeout(1200);check('…and the app stays for the rest of the visit',pg.url==U,pg.url);await ctx.close()
        ctx,pg,u=await at(b,U,"try{localStorage.setItem('vct','{\"lang\":\"ta\"}')}catch(e){}",**D);check('returning customer (saved settings) → app',u==U,u);await ctx.close()
        ctx,pg,u=await at(b,U+'#book=abcdefghijklmnop',**D);check('website Book link (#book=) → app',u.startswith(U+'#book') or u==U,u);await ctx.close()
        ctx,pg,u=await at(b,U+'?utm_source=fb',**D);check('ad / QR link (?utm_source) → app as before',u==U+'?utm_source=fb',u);await ctx.close()
        ctx,pg,u=await at(b,U,viewport={'width':390,'height':844},is_mobile=True,has_touch=True);check('phone → app',u==U,u);await ctx.close()
        ctx,pg,u=await at(b,U,viewport={'width':1100,'height':800},is_mobile=True,has_touch=True);check('phone in "desktop site" mode (touch) → app',u==U,u);await ctx.close()
        ctx,pg,u=await at(b,U+'vellore/',**D)
        hrefs=await pg.evaluate("[...document.querySelectorAll('.login,#apps .btn.y')].map(a=>a.getAttribute('href'))")
        check('website "Login" / "Open the app" go to the app with ?app=1',hrefs==['/?app=1','/?app=1'],hrefs);await ctx.close()
        ctx,pg,u=await at(b,U+'vellore-next/',**D);check('old test address forwards to /vellore/',u.endswith('/vellore/'),u);await ctx.close()
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
