# Driver scorecard (27 Nov): Office → Reports shows, per driver, time ON, Signal % and Auto-OFF from the server's
# 2-minute samples (stats/d<YYYYMMDD>), next to rides / fares / cancels / rating. Drivers with ON time but no ride show too.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1500,'height':1000})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("""(()=>{const k=ms=>{const d=new Date(ms+330*60e3);return 'd'+d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0')};
          MOCK.store.set('drivers/+919999900031',{name:'Score Selvam',veh:'mini',plate:'TN 23 SC 3101',model:'x',wallet:500,rating:5,online:true,createdAt:{__ts:true}});
          MOCK.store.set('drivers/+919999900032',{name:'Score Babu',veh:'mini',plate:'TN 23 SC 3202',model:'x',wallet:500,rating:5,online:false,createdAt:{__ts:true}});
          MOCK.store.set('stats/'+k(Date.now()),{'+919999900031':{on:300,act:285,job:60},'+919999900032':{on:200,act:100,job:0,off:2}});
          MOCK.store.set('stats/'+k(Date.now()-864e5),{'+919999900031':{on:100,act:95,job:20}});
          MOCK.store.set('stats/'+k(Date.now()-10*864e5),{'+919999900031':{on:999,act:0,job:0}});})()""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2500)
        await of.evaluate("S.sec='rep';save();show()");await pg.wait_for_timeout(2500)
        rows={}
        for r in await O.locator('.tr.t10').all():
            t=' '.join((await r.inner_text()).split())
            for n in ['Score Selvam','Score Babu']:
                if n in t:rows[n]=t
        check('header has Time ON / Signal / Auto-OFF',await O.locator('.tr.th.t10').count()==1 and 'auto-off' in (await O.locator('.tr.th.t10').inner_text()).lower())
        check('Selvam (7 days): 400 min = 6h 40m, signal 95%',('Selvam' in rows['Score Selvam']) and ('6ம 40நி' in rows['Score Selvam'] or '6h 40m' in rows['Score Selvam']) and '95%' in rows['Score Selvam'],rows.get('Score Selvam'))
        check('a day older than 7 days is not counted',' 16' not in rows['Score Selvam'].split('95%')[0][-6:])
        check('Babu (no rides, ON 3h 20m): shown, signal 50% in red, Auto-OFF 2','Score Babu' in rows and '50%' in rows['Score Babu'] and await O.locator('.tr.t10:has-text("Score Babu") .scsig.neg').count()==1 and await O.locator('.tr.t10:has-text("Score Babu") .neg').count()>=2,rows.get('Score Babu'))
        check('explains where the numbers come from',await O.locator('.scnote').count()==1 and '2' in await O.locator('.scnote').inner_text())
        await O.locator('[data-rd="30"]').click();await pg.wait_for_timeout(2000)
        t=' '.join((await O.locator('.tr.t10:has-text("Score Selvam")').inner_text()).split())
        check('30 days: the older day is added (1399 min = 23h 19m)','23ம 19நி' in t or '23h 19m' in t,t)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
