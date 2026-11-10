# Security test: every text a customer / applicant / driver can type is seeded with an HTML/JS payload.
# Then every office page, every booking sheet, the driver request + trip screens and the customer ride screen are opened.
# PASS = no payload ever executes (top.__X stays empty).
import asyncio,json,sys
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
def P(f):return f'x"\'><img src=x data-f="{f}" onerror="top.__X=(top.__X||[]).concat(location.pathname.split(\'/\').pop()+\':{f}\')">'
SEED=r'''
(async()=>{const fs=MOCK.fs,now=Date.now(),T=v=>({toMillis(){return v}});const P=%s;
const pl=(f,lat,lon)=>({key:null,ta:P(f+'.ta'),en:P(f+'.en'),lat,lon});
const base=(id,o)=>fs.setDoc({path:'bookings/'+id},Object.assign({customerUid:'u9999900001',custName:P('custName'),custPhone:'+91'+P('custPhone'),src:'app',kind:'ride',
  from:pl('from',12.956,79.139),to:pl('to',12.93,79.13),path:[],veh:'sedan',vehTa:'Sedan',vehEn:'Sedan',km:4.2,base:60,fare:190,pay:'cash',tip:0,
  rider:{name:P('rider.name'),phone:P('rider.phone')},note:P('note'),when:now,createdAt:T(now-5000),updatedAt:T(now-4000)},o));
await base('b1',{status:'searching'});
await base('b2',{status:'assigned',driverPhone:'+919999900077',driverName:P('driverName'),plate:P('plate'),vehModel:P('vehModel'),assignedAt:T(now)});
await base('b3',{status:'done',driverPhone:'+919999900002',driverName:'Test Driver',rating:2,doneAt:T(now-1000),cancelReason:null});
await base('b4',{status:'cancelled',cancelReason:'nodriver',when:now-100e3,createdAt:T(now-100e3),updatedAt:T(now-90e3)});
await base('b5',{status:'searching',kind:'outstation',otype:'one',dispatch:{review:true,reviewUntil:now+6e5,gap:10,fall:true},when:now+864e5});
await base('b6',{status:'cancelled',cancelReason:'driver: '+P('cancelReason'),driverPhone:'+919999900002',when:now-60e3,createdAt:T(now-60e3),updatedAt:T(now-50e3)});
await fs.setDoc({path:'users/u9999900001'},{name:P('user.name'),phone:'+91'+P('user.phone'),ec:[{name:P('ec.name'),phone:P('ec.phone')}],joinedAt:T(now-864e5)});
await fs.setDoc({path:'tickets/t1'},{uid:'u9999900001',type:'complaint',status:'open',title:{ta:P('t.title.ta'),en:P('t.title.en')},cust:P('t.cust'),phone:P('t.phone'),note:P('t.note'),trip:P('t.trip'),lat:P('t.lat'),lon:P('t.lon'),date:now,createdAt:T(now)});
await fs.setDoc({path:'tickets/t2'},{uid:'u9999900001',type:'sos',status:'open',title:{ta:'SOS',en:'SOS'},cust:P('sos.cust'),phone:P('sos.phone'),lat:P('sos.lat'),lon:P('sos.lon'),date:now,createdAt:T(now)});
await fs.setDoc({path:'recharges/r1'},{driverPhone:'+919999900002',driverName:P('r.driverName'),amt:200,utr:P('r.utr'),status:'pending',date:now,createdAt:T(now)});
await fs.setDoc({path:'driverApps/+919876500000'},{status:'pending',name:P('app.name'),veh:'sedan',plate:P('app.plate'),model:P('app.model'),year:2022,upi:P('app.upi'),addr:P('app.addr'),area:P('app.area'),ec:[{name:P('app.ec'),phone:P('app.ecph')}],submittedAt:T(now),docs:{dl:now+3e10}});
})()
'''
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2000)
        await pg.evaluate(SEED%("f=>"+json.dumps(P('FIELD')).replace('FIELD','"+f+"')))
        await pg.wait_for_timeout(500)
        O=pg.frame_locator('#o');D=pg.frame_locator('#d');C=pg.frame_locator('#c')
        of=pg.frame(url=B+'o2.html');df=pg.frame(url=B+'d2.html');cf=pg.frame(url=B+'c2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2000)
        seen=[]
        for sec in ['dash','book','drv','cust','sup','appr','rep','set']:
            await of.evaluate(f"S.sec='{sec}';show()");await pg.wait_for_timeout(700);seen.append(sec)
            if sec=='book':
                for bt in ['live','sched','done','cx','all']:
                    try:await of.evaluate(f"BT='{bt}';show()");await pg.wait_for_timeout(300)
                    except Exception as e:pass
        sheets=["bookSheet(DB.bk.find(x=>x._id==='{i}'))".format(i=i) for i in ['b1','b2','b3','b4','b5','b6']]
        sheets+=["noDrvSheet(DB.bk.find(x=>x._id==='b4'))","reopenSheet(DB.bk.find(x=>x._id==='b6'))","cancelSheet(DB.bk.find(x=>x._id==='b1'))",
                 "reviewSheet(DB.bk.find(x=>x._id==='b5'))","assignSheet(DB.bk.find(x=>x._id==='b1'))","driverDetail(DB.drv[0])"]
        for s in sheets:
            try:
                await of.evaluate(s);await pg.wait_for_timeout(500)
                await of.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove())")
            except Exception as e:print('sheet fail',s,str(e)[:120])
        try:
            await of.evaluate("S.sec='cust';show()");await pg.wait_for_timeout(500)
            await of.evaluate("(()=>{const r=document.querySelector('[data-cu]')||document.querySelector('.tr[data-c],[data-cid]');if(r)r.click()})()");await pg.wait_for_timeout(600)
        except Exception as e:print('cust detail',str(e)[:100])
        # driver: login, go online, see request b1, accept, pickup screens
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200)
        if await df.evaluate("!!document.getElementById('ons')"):await D.locator('#ons').click()
        await pg.wait_for_timeout(3000)
        req=await df.evaluate("!!document.getElementById('acc')")
        if req:
            await D.locator('#acc').click();await pg.wait_for_timeout(2500)
            for fn in ['toPickup()','atPickup()']:
                try:await df.evaluate(fn);await pg.wait_for_timeout(700)
                except Exception as e:print('drv',fn,str(e)[:80])
        # customer app: login as the booking's customer to see the assigned ride b2 / history
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(2500)
        X=await pg.evaluate("top.__X||[]")
        print('driver request shown:',req)
        print('office sections opened:',seen)
        print('EXECUTED PAYLOADS:',len(X));[print('  ',x) for x in sorted(set(X))]
        await pg.screenshot(path='shots/xss.png')
        print('ERR',errs[:5]);await b.close()
        print('RESULT','PASS' if not X else 'FAIL')
asyncio.run(main())
