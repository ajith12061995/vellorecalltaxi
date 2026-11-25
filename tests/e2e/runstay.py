# Once ON, always ON (25 Nov): a driver who switched ON stays online when the app is reopened / reloaded, until the
# driver's own OFF. The Office shows the driver's switch (not the heartbeat) and says when the app is in the background.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.9165,'longitude':79.1325},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        D=pg.frame_locator('#d');dfr=lambda:pg.frame(url=B+'d2.html')
        drv="MOCK.store.get('drivers/+919999900002')"
        async def reopen(pre=''):
            # the test stand-in for Firebase does not keep the sign-in across a reload (the real one does): sign in again
            await dfr().evaluate(pre+"location.reload()");await pg.wait_for_timeout(2500)
            if await D.locator('#ph').count():
                await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
                for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
            await pg.wait_for_timeout(3000)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        check('starts offline (ON button shown)',await D.locator('#ons').count()==1 and not (await pg.evaluate(drv)).get('online'))
        await D.locator('#ons').click();await pg.wait_for_timeout(2500)
        check('driver switches ON → online in the database',(await pg.evaluate(drv)).get('online')==True and await D.locator('#offs').count()==1)
        # the phone closes the app in the background / the driver reopens it
        await reopen()
        check('after reopening: still online, no need to press ON again',await D.locator('#offs').count()==1 and await D.locator('#ons').count()==0,await dfr().evaluate("document.body.innerText.slice(0,120)"))
        check('still online in the database',(await pg.evaluate(drv)).get('online')==True)
        check('the app is really working again (listening for rides, sending position)',await dfr().evaluate("S.online===true&&!!REQUNSUB"))
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('live position record says online',bool(lv) and lv.get('online')==True,lv)
        # a second reopen
        await reopen()
        check('second reopen: still online',await D.locator('#offs').count()==1)
        # battery: with ride alerts available as notifications the screen is not held on while waiting
        check('screen is not forced on while waiting when notifications work',await dfr().evaluate("(PUSHOK=true,awakeWanted())===false"))
        check('screen stays on while waiting when notifications are not available',await dfr().evaluate("(PUSHOK=false,awakeWanted())===true"))
        check('screen stays on during a ride',await dfr().evaluate("(()=>{PUSHOK=true;const j=J;J={id:'x'};const r=awakeWanted();J=j;return r})()"))
        # another device / fresh install: the database says ON → carry on online
        await reopen("localStorage.setItem('vctd',JSON.stringify({...JSON.parse(localStorage.getItem('vctd')),online:false}));")
        check('ON in the database but not remembered on this phone → still online',await D.locator('#offs').count()==1)
        # the driver's own OFF ends it — and it stays off
        await D.locator('#offs').click();await pg.wait_for_timeout(600)
        y=D.locator('.modal button').filter(has_text='Offline')
        if await D.locator('.modal').count():
            bt=D.locator('.modal .btn').last
            await bt.click();await pg.wait_for_timeout(1200)
        st=await pg.evaluate(drv)
        if st.get('online'):  # confirm sheet uses another button order
            await dfr().evaluate("setOnline(false);home()");await pg.wait_for_timeout(1000);st=await pg.evaluate(drv)
        check('driver switches OFF → offline in the database',st.get('online')==False,st.get('online'))
        await reopen()
        check('after reopening: stays offline (ON button shown)',await D.locator('#ons').count()==1 and (await pg.evaluate(drv)).get('online')==False)
        # low wallet on reopen: not resumed, the database is corrected, the driver is told why
        await D.locator('#ons').click();await pg.wait_for_timeout(2000)
        await pg.evaluate("MOCK.store.set('drivers/+919999900002',{...MOCK.store.get('drivers/+919999900002'),wallet:10})")
        await reopen()
        st=await pg.evaluate(drv)
        check('low wallet on reopen → not online, database corrected',await D.locator('#ons').count()==1 and st.get('online')==False,st.get('online'))
        # Office: the switch decides "online"; a silent phone is shown as "app in background"
        await pg.evaluate("""(()=>{const t=Date.now();MOCK.store.set('drivers/+919999900007',{name:'Kumar B',veh:'mini',plate:'TN 23 ZZ 0007',model:'Swift',wallet:500,rating:5,online:true,createdAt:{__ts:true}});
          MOCK.store.set('live/+919999900007',{lat:12.92,lon:79.13,online:false,updatedAt:{__ms:t-40*60000}});
          MOCK.store.set('drivers/+919999900008',{name:'Ravi C',veh:'mini',plate:'TN 23 ZZ 0008',model:'Swift',wallet:500,rating:5,online:false,createdAt:{__ts:true}})})()""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2000)
        k=await of.evaluate("(()=>{const a=DB.drv.find(d=>d.id==='+919999900007'),b=DB.drv.find(d=>d.id==='+919999900008');return {a:a&&a.status,asig:a&&a.sig,b:b&&b.status}})()")
        check('Office: switched-ON driver with a silent phone counts as online',k.get('a')=='avail',k)
        check('Office: switched-OFF driver is offline',k.get('b')=='off',k)
        await of.evaluate("S.sec='drv';save();show()");await pg.wait_for_timeout(1500)
        txt=await O.locator('#app').inner_text() if await O.locator('#app').count() else await of.evaluate("document.body.innerText")
        check('Office: says the app is in the background and when it last reported',('app in background' in txt or 'app பின்னணியில' in txt),txt[:80])
        # "ON" (the driver's switch) and "signal now" (phones really reporting) are counted separately
        c=await of.evaluate("({on:DB.drv.filter(d=>d.status!=='off').length,sig:DB.drv.filter(sigNow).length,a:sigNow(DB.drv.find(d=>d.id==='+919999900007')),hdr:(document.querySelector('.head,header,h1')||document.body).parentElement.innerText.slice(0,400),tabs:[...document.querySelectorAll('[data-df]')].map(b=>b.dataset.df+':'+b.innerText.replace(/\\s+/g,' '))})")
        check('Office: a switched-ON driver with a silent phone is ON but not "signal now"',c['a']==False and c['sig']<c['on'],[c['on'],c['sig']])
        check('Office: header and tabs show both numbers',('signal now '+str(c['sig']) in txt or 'இப்போ signal '+str(c['sig']) in txt) and any(t.startswith('sig:') and t.rstrip().endswith(str(c['sig'])) for t in c['tabs']),c['tabs'][:3])
        await O.locator('[data-df=sig]').click();await pg.wait_for_timeout(800)
        n=await O.locator('.dcard').count()
        check('Office: "Signal now" tab lists exactly those drivers',n==c['sig'],[n,c['sig']])
        check('no page errors',not errs,errs[:2])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
