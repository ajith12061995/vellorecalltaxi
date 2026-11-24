# Booking funnel (24 Nov): the customer app writes one anonymous row per step of a visit to `events`
# (no name / phone / uid); Office → Reports shows how many visits reached each step and where they came from.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        ev="(()=>[...MOCK.store.entries()].filter(([k])=>k.startsWith('events/')).map(([k,v])=>v))()"
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        e=await pg.evaluate(ev)
        check('opening the app writes one "open" row',[x['step'] for x in e]==['open'],e)
        r=e[0] if e else {}
        check('row has only step, visit id, source, version, time',sorted(r.keys())==['app','at','sid','src','step','v'] and r.get('app')=='customer' and 6<=len(r.get('sid',''))<=24,r)
        await C.locator('#go').click();await pg.wait_for_timeout(500)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        steps=[x['step'] for x in await pg.evaluate(ev)]
        check('home and login steps recorded once each',steps.count('home')==1 and steps.count('login')==1 and steps.count('open')==1,steps)
        await cf.evaluate("home()");await pg.wait_for_timeout(400);await cf.evaluate("home()");await pg.wait_for_timeout(400)
        steps=[x['step'] for x in await pg.evaluate(ev)]
        check('a step is never written twice in one visit',len(steps)==len(set(steps)),steps)
        await cf.evaluate("S.dest='cmc';fareScreen()");await pg.wait_for_timeout(900)
        steps=[x['step'] for x in await pg.evaluate(ev)]
        check('fare screen recorded',steps.count('fare')==1,steps)
        e=await pg.evaluate(ev)
        check('no phone, name or uid in any row',not any(('9999900001' in str(x)) or ('Priya' in str(x)) or ('uid' in x) for x in e),e[:2])
        check('all rows share one visit id',len(set(x['sid'] for x in e))==1)
        await cf.evaluate("VCTF('hack');VCTF('')");await pg.wait_for_timeout(300)
        check('unknown step names are ignored',len(await pg.evaluate(ev))==len(e))
        # office report: add a few other visits, then open Reports
        await pg.evaluate("""(()=>{const t=Date.now();const add=(sid,src,steps)=>steps.forEach((s,i)=>MOCK.store.set('events/t'+sid+i,{app:'customer',v:'1',step:s,sid,src,at:t-1000*i}));
          add('aaaaaaa1','facebook',['open','home']);add('aaaaaaa2','facebook',['open','home','fare','book','booked','driver','done']);add('aaaaaaa3','google',['open']);
          MOCK.store.set('events/old1',{app:'customer',v:'1',step:'open',sid:'oldoldold',src:'direct',at:t-3*864e5})})()""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1800)
        await of.evaluate("S.sec='rep';save();show()");await pg.wait_for_timeout(2500)
        check('Reports shows the funnel panel',await O.locator('#funp').count()==1)
        num=lambda k:of.evaluate(f"(()=>{{const r=document.querySelector('#funp [data-fs=\"{k}\"]');return r?parseInt(r.querySelector(':scope > div:last-child b').textContent):-1}})()")
        check('today: 4 visits opened',await num('open')==4,await num('open'))
        check('today: 3 reached home, 2 saw a fare, 1 booked, 1 done',[await num('home'),await num('fare'),await num('booked'),await num('done')]==[3,2,1,1],[await num('home'),await num('fare'),await num('booked'),await num('done')])
        st=await O.locator('#funsrc').inner_text() if await O.locator('#funsrc').count() else ''
        check('sources listed (facebook 2, google 1)',('facebook 2' in st.replace('\n',' ')) and ('google 1' in st.replace('\n',' ')),st)
        await O.locator('#funp [data-fnd="7"]').click();await pg.wait_for_timeout(1200)
        check('7 days: the older visit is included',await num('open')==5,await num('open'))
        txt=await O.locator('#funp').inner_text()
        check('panel shows no code or raw ids',("X('" not in txt) and ('aaaaaaa' not in txt),txt[:100])
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
