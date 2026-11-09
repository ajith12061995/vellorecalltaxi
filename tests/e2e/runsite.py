# Public Vellore page (velloretaxi.app/vellore/): loads with no errors, Tamil by default, English switch is
# remembered, every booking/driver/call link points to the right place, fares board, SEO data, phones fit.
import asyncio, json
from playwright.async_api import async_playwright
U='http://localhost:8765/vellore/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1366,'height':900})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(U);await pg.wait_for_timeout(1200)
        check('Tamil by default',await pg.evaluate("document.documentElement.dataset.l")=='ta' and await pg.locator('h1 .ta').is_visible() and not await pg.locator('h1 .en').is_visible())
        rows=await pg.locator('#board .row').count()
        check('fare board: 6 vehicles',rows==6,rows)
        bt=await pg.locator('#board').inner_text()
        check('Mini ₹105 + ₹16/km and Government auto ₹50 shown','₹105' in bt and '₹16' in bt and '₹50' in bt and '1.8' in bt,bt[:120])
        imgs=await pg.evaluate("Promise.all([...document.querySelectorAll('#board img')].map(i=>i.decode().then(()=>i.naturalWidth>0).catch(()=>false)))")
        check('vehicle pictures load',all(imgs),imgs)
        hrefs=await pg.evaluate("[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))")
        check('book buttons open the app','/' in hrefs)
        check('driver link is /driver/ (not the form)','/driver/' in hrefs and not any('join' in (h or '') for h in hrefs))
        check('call links use the customer number',all(h in ('tel:+917200730416','tel:+919944039933') for h in hrefs if h and h.startswith('tel:')) and 'tel:+917200730416' in hrefs)
        check('privacy page linked','/privacy/' in hrefs)
        ld=await pg.evaluate("JSON.parse(document.querySelector('script[type=\"application/ld+json\"]').textContent)")
        check('search data (TaxiService, Vellore, phone)',ld['@type']=='TaxiService' and ld['areaServed']['name']=='Vellore' and ld['telephone']=='+91-72007-30416')
        check('title, description, canonical',await pg.title()!='' and await pg.locator('meta[name=description]').count()==1 and await pg.locator('link[rel=canonical][href="https://velloretaxi.app/vellore/"]').count()==1)
        await pg.click('#lang');await pg.wait_for_timeout(200)
        check('English switch',await pg.locator('h1 .en').is_visible() and not await pg.locator('h1 .ta').is_visible())
        await pg.reload();await pg.wait_for_timeout(800)
        check('English remembered after reload',await pg.evaluate("document.documentElement.dataset.l")=='en')
        await pg.click('#lang')
        await pg.locator('details summary').first.click();await pg.wait_for_timeout(200)
        check('FAQ opens',await pg.locator('details').first.evaluate('d=>d.open'))
        check('no page errors',not errs,errs)
        for w in (360,390,768):
            m=await b.new_page(viewport={'width':w,'height':800});await m.goto(U);await m.wait_for_timeout(600)
            check(f'no sideways scroll at {w}px',not await m.evaluate("document.documentElement.scrollWidth>innerWidth"))
            await m.close()
        # storage blocked (private mode) → page still works in Tamil
        c2=await b.new_context();await c2.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
        q=await c2.new_page();e2=[];q.on('pageerror',lambda e:e2.append(str(e)))
        await q.goto(U);await q.wait_for_timeout(600);await q.click('#lang')
        check('works with storage blocked',not e2 and await q.evaluate("document.documentElement.dataset.l")=='en',e2)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
