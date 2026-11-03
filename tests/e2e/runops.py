# Office housekeeping: scheduled ride auto-dispatch, stale search closed + "call customer" ring, schedule ring,
# recharge approved only once on a double tap, old public blocked list moved to the private list.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
SEED='''()=>{const now=Date.now(),T=v=>({toMillis(){return v}}),fs=MOCK.fs;
 const bk=(id,o)=>MOCK.store.set('bookings/'+id,Object.assign({customerUid:'u9999900001',custName:'Priya',custPhone:'+919999900001',src:'app',from:{key:null,ta:'A',en:'A',lat:12.95,lon:79.13},to:{key:null,ta:'B',en:'B',lat:12.93,lon:79.13},veh:'sedan',fare:150,pay:'cash'},o));
 bk('sch20',{kind:'schedule',status:'scheduled',when:now+20*60e3,createdAt:T(now-864e5),updatedAt:T(now-864e5)});
 bk('sch50',{kind:'schedule',status:'scheduled',when:now+50*60e3,createdAt:T(now-864e5),updatedAt:T(now-864e5)});
 bk('sch5h',{kind:'schedule',status:'scheduled',when:now+5*36e5,createdAt:T(now-864e5),updatedAt:T(now-864e5)});
 bk('stale',{kind:'ride',status:'searching',when:now-16*60e3,createdAt:T(now-16*60e3),updatedAt:T(now-16*60e3)});
 MOCK.store.set('recharges/r1',{driverPhone:'+919999900002',driverName:'Test',amt:300,utr:'123456789012',status:'pending',date:now,createdAt:T(now)});
 MOCK.store.set('config/app',{dispatch:{win:10,gap:10,fall:true},comm:10,blocked:['+919000000001','+919000000002']});}'''
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(800);await pg.evaluate(SEED)
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2500)
        bar=await of.evaluate("(document.getElementById('ringbar')||{}).innerText||''")
        check('ring: scheduled pickup within the hour without driver',('pickup' in bar or 'நிமி-ல pickup' in bar),bar.replace('\n',' | ')[:200])
        await of.evaluate("autoOps()");await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.dump()")
        check('scheduled ride 20 min ahead sent to drivers',d['bookings/sch20']['status']=='searching' and d['bookings/sch20'].get('dispatchedBy')=='office-auto')
        check('scheduled ride 50 min ahead not yet',d['bookings/sch50']['status']=='scheduled')
        check('scheduled ride 5 h ahead untouched',d['bookings/sch5h']['status']=='scheduled')
        check('stale 16-min search closed as no driver',d['bookings/stale']['status']=='cancelled' and d['bookings/stale']['cancelReason']=='nodriver')
        await pg.wait_for_timeout(1500)
        bar=await of.evaluate("(document.getElementById('ringbar')||{}).innerText||''")
        check('ring: call the customer for the stale one',('customer' in bar.lower()),bar.replace('\n',' | ')[:200])
        check('old public blocked list moved to private list',d.get('blocked/+919000000001') and d.get('blocked/+919000000002') and not d['config/app'].get('blocked'),d['config/app'].get('blocked'))
        # recharge: double tap
        await of.evaluate("S.sec='appr';show()");await pg.wait_for_timeout(800)
        w0=d['drivers/+919999900002']['wallet']
        await of.evaluate("(()=>{const b=document.querySelector('[data-ok]');b.click();b.click()})()");await pg.wait_for_timeout(1500)
        await of.evaluate("(()=>{const b=document.querySelector('[data-ok]');if(b)b.click()})()");await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.dump()")
        check('recharge credited exactly once on double tap',d['drivers/+919999900002']['wallet']-w0==300,(w0,d['drivers/+919999900002']['wallet']))
        check('no page errors',not errs,errs[:3])
        await pg.screenshot(path='shots/ops.png');await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
