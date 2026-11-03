# PIN works with the customer app CLOSED; wrong PIN refused; old-rules fallback; office "start trip" override.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def login_d(D,pg):
    await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
    for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
    await D.locator('#go').click();await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
async def login_c(C,pg):
    await C.locator('#go').click();await pg.wait_for_timeout(300)
    await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
    for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
    await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
async def enter(df,pin):
    await df.evaluate(f"(()=>{{const ins=[...document.querySelectorAll('#pinb input')];'{pin}'.split('').forEach((d,i)=>ins[i].value=d);cloudStart(ins)}})()")
async def run(old):
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(1500)
        if old:await pg.evaluate("()=>{MOCK.denyUpdate=(p,d)=>p.startsWith('bookings/')&&Object.keys(d).some(k=>['startedAt','pinOk','fareFinal','fx','comm','commLocal'].includes(k))}")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await login_d(D,pg);await login_c(C,pg)
        await cf.evaluate("S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3500);bid=await cf.evaluate("R.id")
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']");pin=(await pg.evaluate(f"MOCK.dump()['bookings/{bid}/private/pin']"))['pin']
        tag='[old rules] ' if old else ''
        check(tag+'booking has pinSalt + pinHash, not the PIN',bk.get('pinHash') and bk.get('pinSalt') and pin not in str(bk))
        # customer closes the app
        await pg.evaluate("document.getElementById('c').src='about:blank'");await pg.wait_for_timeout(500)
        await D.locator('#acc').click();await pg.wait_for_timeout(2000)
        await df.evaluate("atPickup()");await pg.wait_for_timeout(800)
        wrong=str((int(pin)+1)%10000).zfill(4)
        await enter(df,wrong);await pg.wait_for_timeout(1500)
        st=(await pg.evaluate(f"MOCK.dump()['bookings/{bid}']"))['status'];pe=await df.evaluate("document.getElementById('pe').textContent")
        check(tag+'wrong PIN refused at once',st=='assigned' and ('தப்பு' in pe or 'Wrong' in pe),pe)
        await enter(df,pin);await pg.wait_for_timeout(2500)
        bk=await pg.evaluate(f"MOCK.dump()['bookings/{bid}']")
        check(tag+'right PIN starts trip with customer app closed',bk['status']=='ontrip',bk['status'])
        if not old:check('startedAt + pinOk saved',bk.get('startedAt') and bk.get('pinOk')==True)
        onscreen=await df.evaluate("!!document.getElementById('end')||document.body.innerText.includes('பயணத்தில்')")
        check(tag+'driver on trip screen',onscreen)
        await pg.screenshot(path=f"shots/pin{'_old' if old else ''}.png",clip={'x':400,'y':0,'width':400,'height':860})
        if not old:
            # office override on a second booking assigned to this driver
            await pg.evaluate("MOCK.fs.setDoc({path:'bookings/ov1'},{customerUid:'u1',custName:'X',custPhone:'+919000000000',src:'phone',kind:'ride',from:{key:null,ta:'A',en:'A',lat:12.95,lon:79.13},to:{key:null,ta:'B',en:'B',lat:12.93,lon:79.13},veh:'sedan',fare:150,pay:'cash',status:'assigned',driverPhone:'+919999900077',when:Date.now(),createdAt:{toMillis(){return Date.now()}},updatedAt:{toMillis(){return Date.now()}}})")
            await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
            await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
            await of.evaluate("bookSheet(DB.bk.find(x=>x._id==='ov1'))");await pg.wait_for_timeout(400)
            await O.locator('#bst').click();await pg.wait_for_timeout(1200)
            ov=await pg.evaluate("MOCK.dump()['bookings/ov1']")
            check('office start-trip override',ov['status']=='ontrip' and str(ov.get('startedBy','')).startswith('office:'),ov.get('startedBy'))
        check(tag+'no page errors',not errs,errs[:3])
        await b.close()
async def main():
    await run(False);await run(True)
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
