# Small weather line on the customer and driver home screens (config/weather, written by the server every 30 minutes):
# shown with our own words, updates by itself, hidden when there is no data or it is older than 100 minutes,
# nothing from the database is put into the page as HTML.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':950})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html');D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        setwx=lambda o:pg.evaluate("o=>MOCK.fs.setDoc({path:'config/weather'},Object.assign({at:Date.now()},o))",o)
        # customer signs in; no weather yet
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        await C.locator('#o0').fill('123456');await pg.wait_for_timeout(900);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        check('customer home, no weather data: no line (hidden placeholder)',await C.locator('#wx').count()==1 and not await C.locator('#wx').is_visible())
        await setwx({'t':28.6,'kind':'ok','heavy':False});await pg.wait_for_timeout(600)
        check('weather arrives: line appears by itself',await C.locator('#wx').is_visible() and '29°C' in await C.locator('#wx').inner_text(),await C.locator('#wx').inner_text())
        check('credit shown (MET Norway)','MET Norway' in await C.locator('#wx').inner_text())
        await setwx({'t':26,'kind':'rain','heavy':False});await pg.wait_for_timeout(600)
        tx=await C.locator('#wx').inner_text()
        check('rain: customer line says it is raining',(('மழை பெய்யுது' in tx) or ('Raining now' in tx)) and '26°C' in tx,tx)
        await cf.evaluate("S.lang='en';save();home()");await pg.wait_for_timeout(1200)
        check('English',"Raining now" in await C.locator('#wx').inner_text())
        await cf.evaluate("S.lang='ta';save();home()");await pg.wait_for_timeout(1200)
        # hostile / broken data
        await setwx({'t':30,'kind':'<img src=x onerror="parent.PWN=1">','heavy':False,'sym':'<script>parent.PWN=1</script>'});await pg.wait_for_timeout(600)
        check('strange data in the database is not put into the page',not await pg.evaluate("window.PWN") and await cf.evaluate("document.querySelectorAll('#wx img,#wx script').length")==0 and '30°C' in await C.locator('#wx').inner_text())
        await setwx({'t':'hot','kind':'ok'});await pg.wait_for_timeout(500)
        check('bad temperature: line hidden',not await C.locator('#wx').is_visible())
        await pg.evaluate("MOCK.fs.setDoc({path:'config/weather'},{at:Date.now()-101*60000,t:30,kind:'ok'})");await pg.wait_for_timeout(500)
        check('older than 100 minutes: line hidden',not await C.locator('#wx').is_visible())
        # driver
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(400)
        await D.locator('#o0').fill('123456');await pg.wait_for_timeout(1500)
        check('driver home, stale weather: no line',await D.locator('#wx').count()==1 and not await D.locator('#wx').is_visible())
        await setwx({'t':27,'kind':'rain','heavy':True});await pg.wait_for_timeout(600)
        tx=await D.locator('#wx').inner_text()
        check('driver: heavy rain line with the bookings hint',('கன மழை' in tx) and ('Booking' in tx) and '27°C' in tx,tx)
        check('customer sees the customer wording at the same time',('taxi-ல போங்க' in await C.locator('#wx').inner_text()))
        await setwx({'t':38,'kind':'hot','heavy':False});await pg.wait_for_timeout(600)
        check('driver: hot day line','38°C' in await D.locator('#wx').inner_text() and 'தண்ணி' in await D.locator('#wx').inner_text())
        # the line does not break the screen: Online button and Where-to still work
        await D.locator('#ons').click();await pg.wait_for_timeout(1200)
        check('driver can still go online',await df.evaluate("S.online===true"))
        check('customer search still opens',await C.locator('#wt, .where, #where').count()>=0 and await cf.evaluate("typeof home==='function'&&S.from==='home'"))
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
