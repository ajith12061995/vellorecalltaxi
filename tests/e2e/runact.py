import asyncio
from playwright.async_api import async_playwright
SEED=r"""
(()=>{const S=MOCK.store,now=Date.now(),D=864e5,T=t=>({toMillis(){return t}});
S.set('drivers/+919999900003',{name:'Murugan K',veh:'sedan',plate:'TN 23 AA 0002',model:'Dzire (2019)',year:2019,wallet:80,rating:5,online:false,blocked:false,docs:{}});
S.set('users/u9999900001',{name:'Priya',phone:'+919999900001',joinedAt:T(now-20*D)});
S.set('users/u9999900004',{name:'Karthik',phone:'+919999900004',joinedAt:T(now-2*3600e3)});
S.set('users/u9999900005',{name:'Revathi',phone:'+919999900005',joinedAt:T(now-3*D)});
const P=[['cmc','CMC மருத்துவமனை','CMC Hospital',12.925,79.135],['katpadi','காட்பாடி ஜங்ஷன்','Katpadi Junction',12.972,79.138],['vit','VIT','VIT',12.969,79.155],['newbus','புதிய பேருந்து நிலையம்','New Bus Stand',12.94,79.13]];
let n=0;const mk=(o)=>{n++;const p=P[n%4],q=P[(n+1)%4];S.set('bookings/seed'+n,{customerUid:o.u,custName:o.cn,custPhone:o.cp,src:'app',kind:o.kind||'ride',from:{key:p[0],ta:p[1],en:p[2],lat:p[3],lon:p[4]},to:{key:q[0],ta:q[1],en:q[2],lat:q[3],lon:q[4]},veh:o.veh||'sedan',km:5,fare:o.fare||180,tip:o.tip||0,pay:'cash',status:o.st,driverPhone:o.d||null,driverName:o.dn||'',cancelReason:o.cr||null,rating:o.r||0,custRating:o.crt||0,when:o.t,createdAt:T(o.t),doneAt:o.st==='done'?T(o.t+20*60e3):null})};
const C=[['u9999900001','Priya','+919999900001'],['u9999900004','Karthik','+919999900004'],['u9999900005','Revathi','+919999900005']];
for(let i=0;i<40;i++){const c=C[i%3],t=now-(i%9)*D-((i*7)%14+7)*3600e3;mk({u:c[0],cn:c[1],cp:c[2],st:i%7===3?'cancelled':'done',cr:i%7===3?(i%2?'customer':'driver: வண்டி பழுது'):null,d:i%2?'+919999900002':'+919999900003',dn:i%2?'Test Driver':'Murugan K',r:i%2?5:(i%3?3:2),tip:i%5===0?20:0,t,fare:150+(i*13)%120,veh:i%2?'auto':'sedan',kind:i%11===0?'rental':'ride'})}
for(let i=0;i<4;i++){const c=C[1];mk({u:c[0],cn:c[1],cp:c[2],st:'cancelled',cr:'customer',t:now-i*3600e3})}
mk({u:null,cn:'Phone lady',cp:'+919876543210',st:'done',d:'+919999900003',dn:'Murugan K',t:now-3600e3});
S.set('tickets/t1',{type:'complaint',title:{ta:'Driver மோசமா பேசினார்',en:'Driver was rude'},cust:'Revathi',phone:'+919999900005',trip:'SEED2'.slice(0,6),status:'open',date:now-D,createdAt:T(now-D)});
})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('http://localhost:8765/tests/e2e/out/harness_x.html');await pg.wait_for_timeout(1500)
        await pg.evaluate(SEED);await pg.wait_for_timeout(500)
        O=pg.frame_locator('#o');C=pg.frame_locator('#c');of=pg.frame(url='http://localhost:8765/tests/e2e/out/o2.html');cf=pg.frame(url='http://localhost:8765/tests/e2e/out/c2.html')
        OL={'x':800,'y':0,'width':1100,'height':860}
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(1500)
        await of.evaluate("document.getElementById('actlist').scrollIntoView()");await pg.wait_for_timeout(400)
        await pg.screenshot(path='shots/ac1.png',clip=OL)
        await O.locator('[data-ab]').nth(1).click();await pg.wait_for_timeout(600);await pg.screenshot(path='shots/ac2.png',clip=OL)
        print('ERR',errs);await b.close();return
        await of.evaluate("S.sec='cust';save();show()");await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/of1.png',clip=OL)
        await O.locator('[data-cd2="u9999900004"]').click();await pg.wait_for_timeout(600);await pg.screenshot(path='shots/of2.png',clip=OL)
        await O.locator('#cbk').click();await pg.wait_for_timeout(1200)
        print('blocked cfg',await pg.evaluate("JSON.stringify(MOCK.dump()['config/app'].blocked)"))
        await of.evaluate("S.sec='drv';save();show()");await pg.wait_for_timeout(2000);await pg.screenshot(path='shots/of3.png',clip=OL)
        await O.locator('[data-dv]').first.click();await pg.wait_for_timeout(1200);await pg.screenshot(path='shots/of4.png',clip=OL)
        await O.locator('#dnote').fill('Test note: லேட்டா வந்தார்');await O.locator('#dns').click();await pg.wait_for_timeout(1200)
        print('notes',await pg.evaluate("JSON.stringify(Object.entries(MOCK.dump()).filter(([k,v])=>k.startsWith('drivers/')&&v.notes).map(([k,v])=>[k,v.notes.length]))"))
        await of.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove();RD=30;S.sec='rep';save();show()");await pg.wait_for_timeout(1800);await pg.screenshot(path='shots/of5.png',clip=OL)
        await of.evaluate("document.querySelector('main, .main')&&0");
        await of.evaluate("S.sec='book';BT='done';save();show()");await pg.wait_for_timeout(600)
        await O.locator('#bq').fill('Karthik');await pg.wait_for_timeout(800);await pg.screenshot(path='shots/of6.png',clip=OL)
        print('book rows',await of.evaluate("document.querySelectorAll('.table .tr:not(.th)').length"))
        # customer blocked
        bl=await pg.evaluate("MOCK.dump()['config/app'].blocked[0]")
        ph=bl.replace('+91','')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill(ph);await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        if await cf.evaluate("!!document.getElementById('nm')"):
            await C.locator('#nm').fill('X');await C.locator('#go').click();await pg.wait_for_timeout(1000)
        await cf.evaluate("S.dest='cmc';S.veh='tr'+'av';S.when=Date.now()+5*36e5;fareScreen()");await pg.wait_for_timeout(800)
        await C.locator('#bookb').click();await pg.wait_for_timeout(800)
        print('blocked modal',await cf.evaluate("!!document.getElementById('bok')"))
        await pg.screenshot(path='shots/of7.png',clip={'x':0,'y':0,'width':400,'height':860})
        print('ERR',errs);await b.close()
asyncio.run(main())
