# Server PIN check (config/app.serverPin): booking has no PIN hash, the driver app asks verifyPin,
# wrong PIN refused, 5 wrong tries lock, server unreachable gives a clear message, customer ignores pinTry.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def enter(df,pin):
    await df.evaluate(f"(()=>{{const ins=[...document.querySelectorAll('#pinb input')];'{pin}'.split('').forEach((d,i)=>ins[i].value=d);cloudStart(ins)}})()")
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,serverPin:true,serverComm:true})")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        # auto sign-in when the 6th digit is in
        await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3000);bid=await cf.evaluate("R.id")
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']");pin=(await pg.evaluate(f"MOCK.dump()['bookings/{bid}/private/pin']"))['pin']
        check('booking carries no PIN hash',not bk.get('pinHash') and not bk.get('pinSalt'))
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        await df.evaluate("atPickup()");await pg.wait_for_timeout(800)
        # a PIN written into the booking is NOT confirmed by the customer app any more
        await pg.evaluate(f"MOCK.fs.updateDoc({{path:'bookings/{bid}'}},{{pinTry:'{pin}'}})");await pg.wait_for_timeout(1500)
        check('customer app ignores pinTry',(await pg.evaluate(f"MOCK.dump()['bookings/{bid}']"))['status']=='assigned')
        wrong=str((int(pin)+1)%10000).zfill(4)
        await enter(df,wrong);await pg.wait_for_timeout(1200)
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']");pe=await df.evaluate("document.getElementById('pe').textContent")
        check('wrong PIN refused by the server',bk['status']=='assigned' and bk.get('pinFails')==1 and ('தப்பு' in pe or 'Wrong' in pe),pe)
        await pg.evaluate("MOCK.fnDown=true");await enter(df,pin);await pg.wait_for_timeout(1200)
        pe=await df.evaluate("document.getElementById('pe').textContent")
        check('server unreachable: clear message, trip not started',(await pg.evaluate(f"MOCK.dump()['bookings/{bid}']"))['status']=='assigned' and ('Server' in pe),pe)
        await pg.evaluate("MOCK.fnDown=false");await enter(df,pin);await pg.wait_for_timeout(2500)
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']")
        check('right PIN: server starts the trip',bk['status']=='ontrip' and bk.get('pinOk')==True,bk['status'])
        onscreen=await df.evaluate("!!document.getElementById('end')||document.body.innerText.includes('பயணத்தில்')")
        check('driver on trip screen',onscreen)
        await pg.screenshot(path='shots/spin.png',clip={'x':0,'y':0,'width':800,'height':860})
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='book';BT='live';show()");await pg.wait_for_timeout(600)
        await O.locator(f'[data-ob="{bid}"] .tid').click();await pg.wait_for_timeout(600)
        sheet=await of.evaluate("document.querySelector('.modal').innerText")
        check('office booking sheet shows: PIN checked by the server, 1 wrong','Server சரிபார்த்தது' in sheet and '1 தடவை தப்பு' in sheet,[l for l in sheet.split('\n') if 'PIN' in l or 'சரிபார்' in l][:2])
        await of.evaluate("document.querySelector('.modal').remove()")
        # lock after 5 wrong tries (second booking)
        await pg.evaluate("MOCK.fs.setDoc({path:'bookings/lk1'},{customerUid:'u9999900001',custName:'X',src:'app',kind:'ride',veh:'sedan',fare:150,pay:'cash',status:'assigned',driverPhone:'+919999900002',when:Date.now()})")
        await pg.evaluate("MOCK.fs.setDoc({path:'bookings/lk1/private/pin'},{pin:'4321'})")
        api=await df.evaluate("(async()=>{const r=[];for(let i=0;i<5;i++)r.push((await CL.call('verifyPin',{bookingId:'lk1',pin:'0000'})).ok);try{await CL.call('verifyPin',{bookingId:'lk1',pin:'4321'});r.push('opened')}catch(e){r.push(e.code)}return r})()")
        check('locked after 5 wrong PINs',api[-1]=='functions/resource-exhausted' and (await pg.evaluate("MOCK.dump()['bookings/lk1'].status"))=='assigned',api)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
