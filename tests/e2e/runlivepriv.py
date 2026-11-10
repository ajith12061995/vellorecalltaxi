# Driver position privacy: the customer "nearby" map reads cars/{login id} (no phone number, ~110 m rounding);
# live/{phone} keeps the exact position and carries bk = the ride the driver is on, which is what lets
# (only) that ride's customer follow the driver (see firestore.rules riderOf + tests/rules).
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.99413,'longitude':80.17087},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200)
        await D.locator('#ons').click();await pg.wait_for_timeout(3000)
        car=await pg.evaluate("MOCK.store.get('cars/u9999900002')")
        check('online driver writes cars/{login id}',bool(car) and car.get('online') is True,car)
        check('cars doc has only map fields (no phone, name, plate, booking)',car and set(car)<= {'lat','lon','gh','online','busy','veh','updatedAt'},car and sorted(car))
        check('cars position rounded to 3 decimals',car and abs(car['lat']*1e3-round(car['lat']*1e3))<1e-6 and abs(car['lat']-12.99413)<0.001,car and car.get('lat'))
        allcars=await pg.evaluate("JSON.stringify([...MOCK.store.keys()].filter(k=>k.startsWith('cars/')))")
        check('no phone number in any cars id','99999' not in allcars.replace('u9999900002',''),allcars)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('live keeps exact position, bk empty while free',lv and abs(lv['lat']-12.99413)<1e-6 and lv.get('bk')=='' and lv.get('busy') is False,lv)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2500)
        await cf.evaluate("CFG.area={lat:12.99,lon:80.17};P.maa={ta:'Chennai Airport',en:'Chennai Airport',sub:'Meenambakkam',lat:12.9900,lon:80.1693,km:0};P.tbm={ta:'Tambaram',en:'Tambaram',sub:'',lat:12.9249,lon:80.1000,km:0};S.from='maa';S.dest='tbm';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(2500)
        near=await cf.evaluate("JSON.stringify(NEAR)")
        check('customer map shows the car from cars/ (login id, not phone)','u9999900002' in near and '+91' not in near,near)
        check('car rotation is a number',await cf.evaluate("NEAR.every(n=>Number.isFinite(n.rot))"))
        await C.locator('#bookb').click();await pg.wait_for_timeout(4000);await D.locator('#acc').click();await pg.wait_for_timeout(3000)
        bid=await cf.evaluate("R&&R.id")
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('after accepting, live.bk = the booking id',lv and bid and lv.get('bk')==bid,(lv and lv.get('bk'),bid))
        car=await pg.evaluate("MOCK.store.get('cars/u9999900002')")
        check('busy car stays without booking id',car and car.get('busy') is True and 'bk' not in car,car)
        check('customer follows the driver position',await cf.evaluate("!!(R&&R.dpos&&R.dpos.lat)"))
        # a first denied read (driver app not yet marked the ride) is retried
        await cf.evaluate("""(()=>{if(LIVEUNSUB){LIVEUNSUB();LIVEUNSUB=null}R.dpos=null;const o=F().onSnapshot;let n=0;
          window.__deny=1;F().onSnapshot=(r,a,e)=>{if(r&&r.path&&r.path.startsWith('live/')&&window.__deny){window.__deny=0;n++;setTimeout(()=>e&&e({code:'permission-denied'}),10);return()=>{}}return o(r,a,e)};
          watchDrv(R.b.driverPhone)})()""")
        await pg.wait_for_timeout(1000)
        check('denied read leaves no listener',await cf.evaluate("LIVEUNSUB===null"))
        await pg.wait_for_timeout(8500)
        check('retried after 8 s and follows the driver',await cf.evaluate("!!LIVEUNSUB&&!!(R.dpos&&R.dpos.lat)"))
        await df.evaluate("goLive(false)") if await df.evaluate("!J") else None
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
