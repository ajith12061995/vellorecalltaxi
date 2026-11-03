# Final bill: local ride with toll + waiting charge; rental with extra km/time; owner bill correction; wallet = commission on trip only.
import asyncio,json
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(name,cond,info=''):res.append((name,bool(cond)));print(('PASS ' if cond else 'FAIL ')+name,info)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        await pg.evaluate("MOCK.store.set('config/app',{dispatch:{win:10,gap:10,fall:true},comm:10,minbal:100,wait:{rate:2,free:3}})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1200)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200)
        await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        # ---- 1. local ride
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3500)
        bid=await cf.evaluate("R.id");bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']")
        check('booking saves local tariff',bk.get('tariff')=={'t':'local','wait':2,'free':3},bk.get('tariff'))
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        now=await pg.evaluate("Date.now()")
        # driver arrived 10 min before start, trip started (customer verified PIN) 
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{arrivedAt:{{toMillis(){{return {now-11*60e3}}}}},startedAt:{{toMillis(){{return {now-60e3}}}}},status:'ontrip'}})");await pg.wait_for_timeout(1500)
        w0=(await pg.evaluate("MOCK.dump()['drivers/+919999900002']"))['wallet']
        await df.evaluate("collect()");await pg.wait_for_timeout(600)
        bill=await df.evaluate("document.querySelector('.bill').innerText.replace(/\\s+/g,' ')")
        check('local bill shows waiting 7 min x Rs2',('14' in bill and ('Waiting' in bill or 'காத்திருப்பு' in bill)),bill)
        await D.locator('#adj').click();await pg.wait_for_timeout(400)
        await D.locator('#ttl').fill('50');await D.locator('#ttl').dispatch_event('input');await D.locator('#tpk').fill('20');await D.locator('#tpk').dispatch_event('input');await pg.wait_for_timeout(200)
        await D.locator('#tok').click();await pg.wait_for_timeout(600)
        tot=await df.evaluate("document.querySelector('.tot').innerText.replace(/\\s+/g,' ')")
        fare=bk['fare'];exp=fare+14+70
        check('collect total = fare + waiting + toll + parking',str(exp) in tot.replace(',',''),tot)
        await pg.screenshot(path='shots/fare_local_driver.png',clip={'x':400,'y':0,'width':400,'height':860})
        await D.locator('#got').click();await pg.wait_for_timeout(1500)
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']");w1=(await pg.evaluate("MOCK.dump()['drivers/+919999900002']"))['wallet']
        check('fareFinal saved',bk.get('fareFinal')==exp,bk.get('fareFinal'))
        check('commission on trip only (not toll/parking)',bk.get('comm')==int((fare+14)*0.10+0.5),(bk.get('comm'),fare+14))
        check('wallet reduced by exactly the commission',w0-w1==bk.get('comm'),(w0,w1))
        check('fx stored with lines',bk.get('fx') and len(bk['fx']['lines'])==4,bk.get('fx',{}).get('lines'))
        await pg.wait_for_timeout(1000)
        cb=await cf.evaluate("(document.querySelector('.bill')||{}).innerText||''")
        check('customer bill shows toll and final total',('Toll' in cb and str(exp) in cb.replace(',','')),cb.replace('\n',' | '))
        await pg.screenshot(path='shots/fare_local_customer.png',clip={'x':0,'y':0,'width':400,'height':860})
        # office: booking sheet + owner correction
        await of.evaluate(f"bookSheet(DB.bk.find(x=>x._id==='{bid}'))");await pg.wait_for_timeout(500)
        sh=await of.evaluate("document.querySelector('.modal').innerText")
        check('office sheet shows bill lines + commission',('Toll' in sh and 'Commission' in sh),'')
        await O.locator('#bse').click();await pg.wait_for_timeout(400)
        await O.locator('#bnew').fill(str(exp-34));await O.locator('#bnew').dispatch_event('input');await O.locator('#bwhy').fill('waiting waived');await O.locator('#bok').click();await pg.wait_for_timeout(1200)
        bk2=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']");w2=(await pg.evaluate("MOCK.dump()['drivers/+919999900002']"))['wallet']
        newc=int((exp-34-70)*0.10+0.5)
        check('owner correction: new total + commission',bk2['fareFinal']==exp-34 and bk2['comm']==newc,(bk2['fareFinal'],bk2['comm']))
        check('owner correction: wallet refunded the difference',w2-w1==bk['comm']-newc,(w1,w2))
        await pg.screenshot(path='shots/fare_office.png',clip={'x':800,'y':0,'width':1100,'height':860})
        await of.evaluate("document.querySelectorAll('.modal').forEach(m=>m.remove())")
        # ---- 2. rental: 4 hr / 40 km package, ran 62 km in 5 hr
        t=f"{{toMillis(){{return {now-300*60e3}}}}}"
        await pg.evaluate(f"""MOCK.fs.setDoc({{path:'bookings/rent1'}},{{customerUid:'u9999900001',custName:'Priya',custPhone:'+919999900001',src:'app',kind:'rental',hrs:4,km:40,
          from:{{key:null,ta:'Katpadi',en:'Katpadi',lat:12.956,lon:79.139}},to:{{key:null,ta:'4 hr',en:'4 hr',lat:null,lon:null}},path:[],veh:'sedan',fare:1149,pay:'cash',tip:0,
          tariff:{{t:'rent',h:4,km:40,price:1149,xkm:13,xhr:170}},status:'ontrip',driverPhone:'+919999900002',driverName:'Test Driver',arrivedAt:{t},startedAt:{t},when:{now-300*60e3},createdAt:{t},updatedAt:{t}}})""")
        await df.evaluate("stopJob();J=null;home()");await pg.wait_for_timeout(300)
        await df.evaluate("adoptJob({...MOCK_B=(parent.MOCK.dump()['bookings/rent1']),id:'rent1'})".replace("MOCK_B=",""));await pg.wait_for_timeout(1200)
        await df.evaluate("tripEndSheet(collect)");await pg.wait_for_timeout(500)
        await D.locator('#tkm').fill('62');await D.locator('#tkm').dispatch_event('input');await pg.wait_for_timeout(200)
        sheet=await df.evaluate("document.getElementById('tfb').innerText.replace(/\\s+/g,' ')")
        await pg.screenshot(path='shots/fare_rental_sheet.png',clip={'x':400,'y':0,'width':400,'height':860})
        exp_r=1149+22*13+2*85
        check('rental sheet: extra 22 km + 60 min',str(exp_r) in sheet.replace(',',''),sheet)
        await D.locator('#tok').click();await pg.wait_for_timeout(500);await D.locator('#got').click();await pg.wait_for_timeout(1200)
        rb=await pg.evaluate("MOCK.dump()['bookings/rent1']")
        check('rental fareFinal + commission',rb.get('fareFinal')==exp_r and rb.get('comm')==int(exp_r*0.1+0.5),(rb.get('fareFinal'),rb.get('comm')))
        # reports use the real bill
        await of.evaluate("S.sec='rep';show()");await pg.wait_for_timeout(1500)
        print('ERR',errs[:5])
        check('no page errors',not errs)
        await b.close()
    print('RESULT','PASS' if all(x[1] for x in res) else 'FAIL',f"{sum(x[1] for x in res)}/{len(res)}")
asyncio.run(main())
