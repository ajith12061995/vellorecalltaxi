# Driver location like Uber/Ola (26 Nov): bad GPS readings skipped, heading + speed + accuracy sent,
# every ~4 s on a ride, ~8 s while moving, 30 s when standing; the public rounded doc at most every 15 s.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
CNT="""(()=>{window.__w={live:0,cars:0};const f=MOCK.fs.setDoc;MOCK.fs.setDoc=function(r,d,o){const p=r&&r.path||'';
  if(p.startsWith('live/'))__w.live++;if(p.startsWith('cars/'))__w.cars++;return f.apply(this,arguments)}})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.95,'longitude':79.14},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        await D.locator('#ons').click();await pg.wait_for_timeout(1200)
        await df.evaluate("stopGeo()")
        await df.evaluate("geoFix(12.9500,79.1400,6,null,null)");await pg.wait_for_timeout(300)
        await df.evaluate("LASTLIVE=0;pushLive(true)");await pg.wait_for_timeout(300)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('live has heading/speed/accuracy fields',lv and 'hd' in lv and 'sp' in lv and lv.get('acc')==6,lv)
        # a bad reading (300 m accuracy, 2 km away) right after a good one is skipped
        await df.evaluate("geoFix(12.9680,79.1400,300,null,null)")
        pos=await df.evaluate("[POS.lat,POSACC]")
        check('inaccurate jump skipped',abs(pos[0]-12.95)<1e-6 and pos[1]==6,pos)
        # moving north ~55 m in 2.2 s → heading ≈ 0, speed ≈ 25 m/s capped sensibly, km/h sent
        await pg.wait_for_timeout(2200);await df.evaluate("geoFix(12.9505,79.1400,5,null,null)")
        hd,sp=await df.evaluate("[POSHD,POSSP]")
        check('heading from movement ≈ north',hd is not None and (hd<=5 or hd>=355),hd)
        check('speed from movement (m/s)',sp>10 and sp<=45,sp)
        # phone-given bearing / speed win
        await df.evaluate("geoFix(12.9506,79.1401,5,92,11)")
        hd,sp=await df.evaluate("[POSHD,POSSP]");check('native bearing + speed used',hd==92 and sp==11,[hd,sp])
        # bearing ignored when standing (speed below 0.8 m/s) → keeps the last good heading
        await df.evaluate("geoFix(12.9506,79.1401,5,250,0.2)")
        check('standing: heading kept',await df.evaluate("POSHD")==92)
        await df.evaluate(CNT.replace('MOCK','parent.MOCK'))
        # moving at 11 m/s: a send at most every 8 s; standing: none before 30 s
        await df.evaluate("LASTLIVE=Date.now()-8100;geoFix(12.9507,79.1402,5,92,11)");await pg.wait_for_timeout(200)
        w=await df.evaluate("__w");check('moving: sent after 8 s',w['live']==1,w)
        await df.evaluate("geoFix(12.9508,79.1403,5,92,11)");await pg.wait_for_timeout(200)
        w=await df.evaluate("__w");check('moving: not again within 8 s',w['live']==1,w)
        await df.evaluate("HBPOS={lat:12.9508,lon:79.1403};LASTLIVE=Date.now()-9000;geoFix(12.9508,79.1403,5,0,0)");await pg.wait_for_timeout(200)
        w=await df.evaluate("__w");check('standing: no send from a reading at 9 s',w['live']==1,w)
        # on a ride: every 4 s
        await df.evaluate("J={id:'bX',b:{status:'ontrip',kind:'local'}};LASTLIVE=Date.now()-4100;geoFix(12.9509,79.1404,5,90,8)");await pg.wait_for_timeout(200)
        w=await df.evaluate("__w");check('ride: sent after 4 s',w['live']==2,w)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')")
        check('ride: busy + bk + speed km/h sent',lv['busy'] and lv['bk']=='bX' and abs(lv['sp']-28.8)<0.01 and lv['hd']==90,lv)
        check('ride: public rounded doc written on the state change',w['cars']>=1,w)
        c0=w['cars']
        await df.evaluate("LASTLIVE=Date.now()-4100;geoFix(12.9510,79.1405,5,90,8)");await pg.wait_for_timeout(200)
        w=await df.evaluate("__w");check('public doc not rewritten within 15 s',w['cars']==c0 and w['live']==3,w)
        # heartbeat while standing with no ride: a send once 30 s have passed
        await df.evaluate("J=null;HBPOS={lat:POS.lat,lon:POS.lon};LASTLIVE=Date.now()-20000");await pg.wait_for_timeout(5600)
        w=await df.evaluate("__w");check('standing: no heartbeat at 20-25 s',w['live']==3,w)
        await df.evaluate("HBPOS={lat:POS.lat,lon:POS.lon};LASTLIVE=Date.now()-30500");await pg.wait_for_timeout(5600)
        w=await df.evaluate("__w");check('standing heartbeat at 30 s',w['live']==4,w)
        # rules not yet accepting hd/sp/acc: the position still goes (without them), and they are not retried for 10 minutes
        await pg.evaluate("""(()=>{const f=MOCK.fs.setDoc;window.__deny=0;MOCK.fs.setDoc=function(r,d,o){if(r&&r.path&&r.path.startsWith('live/')&&d&&'hd' in d){__deny++;return Promise.reject({code:'permission-denied'})}return f.apply(this,arguments)}})()""")
        await df.evaluate("LIVEXAT=0;POS={lat:12.9601,lon:79.1401};LASTLIVE=0;pushLive(true)");await pg.wait_for_timeout(400)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')");dn=await pg.evaluate("__deny")
        check('refused extra fields → position still written',abs(lv['lat']-12.9601)<1e-7 and 'hd' not in lv or abs(lv['lat']-12.9601)<1e-7,lv)
        await df.evaluate("POS={lat:12.9602,lon:79.1401};LASTLIVE=0;pushLive(true)");await pg.wait_for_timeout(400)
        lv=await pg.evaluate("MOCK.store.get('live/+919999900002')");dn2=await pg.evaluate("__deny")
        check('not retried with extra fields within 10 min',dn==1 and dn2==1 and abs(lv['lat']-12.9602)<1e-7,[dn,dn2,lv.get('lat')])
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
