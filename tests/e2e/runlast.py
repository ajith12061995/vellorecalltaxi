# Office → Drivers: "last online" line on every driver card + "Never online" / "Away 3+ days" tabs (from live/{phone}.updatedAt).
# A real driver going online in the driver app must move from "never" to "online now", then to "last online: just now" after going offline.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,'' if c else i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        await pg.evaluate("""(()=>{const now=Date.now();[['+919000000001','Ravi'],['+919000000002','Kumar'],['+919000000003','Mani'],['+919000000004','Bala']].forEach(([ph,n],i)=>MOCK.store.set('drivers/'+ph,{name:n,veh:'sedan',plate:'TN 23 X '+i,model:'Dzire',wallet:300,rating:5,online:false,blocked:i===3,docs:{}}));
          MOCK.store.set('live/+919000000001',{online:false,updatedAt:now-5*3600e3,lat:12.95,lon:79.13});
          MOCK.store.set('live/+919000000002',{online:false,updatedAt:now-5*864e5,lat:12.95,lon:79.13});})()""")
        D=pg.frame_locator('#d');O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='drv';DF='all';save();show()");await pg.wait_for_timeout(1500)
        card=lambda name:of.evaluate(f"(()=>{{const c=[...document.querySelectorAll('.dcard')].find(x=>x.innerText.includes('{name}'));return c?(c.querySelector('.lastln')||{{}}).innerText||'':null}})()")
        r=await card('Ravi');check('Ravi: last online 5 hrs ago',r and ('5 hrs ago' in r or '5 மணி முன்' in r),r)
        k=await card('Kumar');check('Kumar: last online 5 days ago (marked old)',k and ('5 days ago' in k or '5 நாள் முன்' in k) and await of.evaluate("!![...document.querySelectorAll('.lastln.old')].length"),k)
        m=await card('Mani');check('Mani: never online',m and ('Never' in m or 'இதுவரை' in m),m)
        bl=await card('Bala');check('blocked driver: no last-online line',bl=='',bl)
        tabs=await of.evaluate("Object.fromEntries([...document.querySelectorAll('[data-df]')].map(b=>[b.dataset.df,+(b.querySelector('em')||{}).textContent]))")
        nev0=tabs.get('nev');check('tabs: Away 3+ days = 1 (Kumar)',tabs.get('away')==1,tabs)
        await O.locator('[data-df=nev]').click();await pg.wait_for_timeout(500)
        names=await of.evaluate("[...document.querySelectorAll('.dcard b')].map(x=>x.innerText).join('|')")
        check('Never-online tab lists Mani, not Ravi/Kumar/Bala','Mani' in names and not any(x in names for x in ['Ravi','Kumar','Bala']),names)
        # a real driver (9999900002, harness default) goes online in the driver app
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        did=await of.evaluate("(DB.drv.find(d=>d.phone&&String(d.phone).endsWith('9999900002'))||{}).id||''")
        before=await of.evaluate(f"lastOnMs('{did}')")
        await D.locator('#ons').click();await pg.wait_for_timeout(3000)
        await of.evaluate("S.sec='drv';DF='all';save();show()");await pg.wait_for_timeout(1200)
        on=await of.evaluate(f"(()=>{{const d=DB.drv.find(x=>x.id==='{did}');return d?lastOnLine(d):''}})()")
        check('driver online in the app → office card says "Online now"',('Ready' in on or 'ரெடி' in on) and 'class="lastln on"' in on,on)
        df=pg.frame(url=B+'d2.html');await df.evaluate("setOnline(false);home&&home()");await pg.wait_for_timeout(3000)
        await of.evaluate("show()");await pg.wait_for_timeout(1000)
        off=await of.evaluate(f"(()=>{{const d=DB.drv.find(x=>x.id==='{did}');return d?lastOnLine(d):''}})()")
        check('after going offline → "Last online: just now"',('just now' in off or 'இப்போ' in off) and ('Last online' in off or 'கடைசியா' in off),(before,off))
        await pg.screenshot(path='shots/last_office.png',clip={'x':800,'y':0,'width':1100,'height':860})
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
