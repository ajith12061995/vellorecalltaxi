# Smoke test of the REAL pages (not the mock build): every page parses and starts with no script errors.
# Served from localhost, so firebase-config.js picks STAGING (empty) → the apps start in their offline/demo mode.
import asyncio
from playwright.async_api import async_playwright
R='http://localhost:8765/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();bad=[]
        for path,vp in [('index.html',(390,844)),('driver/index.html',(390,844)),('office/index.html',(1366,800)),('driver/join/index.html',(390,844)),('privacy/index.html',(390,844))]:
            pg=await b.new_page(viewport={'width':vp[0],'height':vp[1]});errs=[]
            pg.on('pageerror',lambda e,errs=errs:errs.append(str(e)))
            await pg.goto(R+path);await pg.wait_for_timeout(3500)
            sw=await pg.evaluate("document.documentElement.scrollWidth>innerWidth+2")
            print(path,'errors:',errs[:2],'horizontal scroll:',sw)
            if errs or sw:bad.append(path)
            await pg.screenshot(path='shots/smoke_'+path.replace('/','_')+'.png');await pg.close()
        print('RESULT','PASS' if not bad else 'FAIL '+str(bad));await b.close()
asyncio.run(main())
