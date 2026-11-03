# Error monitoring: a script error on a phone is saved to the errors collection (max 5 per visit, duplicates once).
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();pg=await b.new_page(viewport={'width':1900,'height':880})
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2000)
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        for i in range(3):await cf.evaluate("setTimeout(()=>{throw new Error('test boom')},0)")
        for i in range(8):await df.evaluate(f"setTimeout(()=>{{throw new Error('drv boom {i}')}},0)")
        await pg.wait_for_timeout(1500)
        errs=await pg.evaluate("Object.entries(MOCK.dump()).filter(([k])=>k.startsWith('errors/')).map(([k,v])=>v.app+':'+v.msg)")
        c=[e for e in errs if 'test boom' in e];d=[e for e in errs if 'drv boom' in e]  # app name comes from the URL path, test pages are not under /driver/
        print('saved',len(errs),errs[:3])
        ok=len(c)==1 and len(d)==5
        print('RESULT','PASS' if ok else 'FAIL','(customer duplicates saved once, driver capped at 5)');await b.close()
asyncio.run(main())
