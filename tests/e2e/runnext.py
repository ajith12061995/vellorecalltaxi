# "Next ride before this one ends" (27 Nov): during a local trip, near the drop, a waiting local ride whose pickup is near
# that drop is offered on a small card; Accept assigns it to this driver (still-waiting check); it starts by itself when
# the trip ends. Far pickups, outstation rides and declined rides are not offered.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
def bk(id,st,frm,to,extra=''):
    return f"""(()=>{{const t=Date.now();MOCK.fs.setDoc({{path:'bookings/{id}'}},{{status:'{st}',kind:'ride',veh:'sedan',fare:120,km:4,pay:'cash',custName:'C {id}',customerUid:'u{id}',src:'app',
      from:{{ta:'{frm[0]}',en:'{frm[0]}',lat:{frm[1]},lon:{frm[2]}}},to:{{ta:'{to[0]}',en:'{to[0]}',lat:{to[1]},lon:{to[2]}}},createdAt:{{__ms:t}},when:t{extra}}})}})()"""
KAT=('Katpadi',12.9716,79.1590);CMC=('CMC',12.9246,79.1353);FORT=('Fort',12.9206,79.1328);NEAR=('Near CMC',12.9300,79.1400);FAR=('Far',12.9900,79.1800)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1400,'height':900},geolocation={'latitude':12.9700,'longitude':79.1580},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)+' @ '+(e.stack or '')[:300]))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:10,minbal:100})")
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500);await D.locator('#ons').click();await pg.wait_for_timeout(2000)
        # the driver's current local trip Katpadi → CMC, already started
        await pg.evaluate(bk('t1','ontrip',KAT,CMC,",driverPhone:'+919999900002',driverName:'Test Driver',assignedAt:{__ms:t-6e5},startedAt:{__ms:t-3e5}"));await pg.wait_for_timeout(2500)
        check('driver is on the trip',await df.evaluate("!!(J&&J.id==='t1'&&J.b&&J.b.status==='ontrip')"),await df.evaluate("J&&J.id"))
        # waiting rides: one near the coming drop, one far, one outstation near
        await pg.evaluate(bk('n1','searching',NEAR,FORT));await pg.evaluate(bk('f1','searching',FAR,FORT));await pg.evaluate(bk('o1','searching',NEAR,FORT,",kind:'outstation'"))
        await pg.wait_for_timeout(1500)
        # still far from the drop (at Katpadi): nothing
        await df.evaluate("POS={lat:12.9700,lon:79.1580};nextCheck()");await pg.wait_for_timeout(400)
        check('far from the drop: no next-ride card',await D.locator('#nextcard').count()==0)
        # 1 km from the drop
        await df.evaluate("POS={lat:12.9330,lon:79.1380};nextCheck()");await pg.wait_for_timeout(600)
        t=' '.join((await D.locator('#nextcard').inner_text()).split()) if await D.locator('#nextcard').count() else ''
        check('near the drop: card for the ride whose pickup is near the drop',await D.locator('#nextcard').count()==1 and 'Near CMC' in t and 'Far' not in t,t)
        check('card shows the fare and distance from the drop',('₹120' in t) and ('km' in t or 'கி.மீ' in t),t)
        check('the trip screen stays (current job unchanged)',await df.evaluate("J.id==='t1'"))
        await D.locator('#nxok').click();await pg.wait_for_timeout(1200)
        n1=await pg.evaluate("MOCK.store.get('bookings/n1')")
        check('Accept → that ride is assigned to this driver',n1['status']=='assigned' and n1.get('driverPhone')=='+919999900002',n1['status'])
        check('card closed, current trip still running',await D.locator('#nextcard').count()==0 and await df.evaluate("J.id==='t1'&&NEXT&&NEXT.id==='n1'"))
        await df.evaluate("nextCheck()");await pg.wait_for_timeout(400)
        check('only one next ride at a time',await D.locator('#nextcard').count()==0)
        # trip ends → the next ride starts by itself
        await df.evaluate("clearInterval(TK);stopJob();J=null;home()");await pg.wait_for_timeout(1800)
        check('trip ended → next ride starts (going to pickup)',await df.evaluate("!!(J&&J.id==='n1')") and await df.evaluate("!NEXT"))
        # a second trip: someone else takes the offered ride before Accept
        await pg.evaluate(bk('t2','ontrip',KAT,CMC,",driverPhone:'+919999900002',driverName:'Test Driver',assignedAt:{__ms:t-6e5},startedAt:{__ms:t-3e5}"))
        await df.evaluate("stopJob();J=null;adoptJob({id:'t2',...MOCK.store.get('bookings/t2')})") if False else None
        await df.evaluate("clearInterval(TK);stopJob();J=null;home()");await pg.wait_for_timeout(2500)
        await df.evaluate("if(!J||J.id!=='t2'){const b=parent.MOCK.store.get('bookings/t2');adoptJob({id:'t2',...b})}");await pg.wait_for_timeout(800)
        await pg.evaluate(bk('n2','searching',NEAR,FORT));await pg.wait_for_timeout(1500)
        await df.evaluate("POS={lat:12.9330,lon:79.1380};nextCheck()");await pg.wait_for_timeout(600)
        check('second trip: card for n2',await D.locator('#nextcard').count()==1 and 'n2'==await df.evaluate("NEXTSHOW&&NEXTSHOW.id"))
        await pg.evaluate("MOCK.fs.updateDoc({path:'bookings/n2'},{status:'assigned',driverPhone:'+919999900009'})");await pg.wait_for_timeout(800)
        await D.locator('#nxok').click();await pg.wait_for_timeout(1200)
        check('taken by another driver → not assigned to us, card gone, trip continues',(await pg.evaluate("MOCK.store.get('bookings/n2').driverPhone"))=='+919999900009' and await D.locator('#nextcard').count()==0 and await df.evaluate("J.id==='t2'&&!NEXT"))
        # decline: not offered again
        await pg.evaluate(bk('n3','searching',NEAR,FORT));await pg.wait_for_timeout(1500)
        await df.evaluate("nextCheck()");await pg.wait_for_timeout(500)
        await D.locator('#nxno').click();await pg.wait_for_timeout(500)
        await df.evaluate("nextCheck()");await pg.wait_for_timeout(500)
        check('Decline → not offered again',await D.locator('#nextcard').count()==0)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
