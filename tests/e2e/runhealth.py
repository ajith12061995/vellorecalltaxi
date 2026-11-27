# Office "Fleet health" (27 Nov): one clear state per driver — ready / weak / lost / paused / off / on a ride — with the
# reason in plain words, a WhatsApp message that fixes exactly that, a booking-waiting bar with the nearest drivers to
# call, and a "no driver ready" alert.
import asyncio,urllib.parse
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
SEED="""(()=>{const t=Date.now(),D=(ph,name,veh,plate,online,extra)=>MOCK.store.set('drivers/'+ph,{name,veh,plate,model:'x',wallet:500,rating:5,online,createdAt:{__ts:true},...(extra||{})}),
  Lv=(ph,ago,lat,lon,veh)=>MOCK.store.set('live/'+ph,{lat,lon,online:true,busy:false,bk:'',veh,updatedAt:{__ms:t-ago}});
  D('+919999900021','Ready Ravi','mini','TN 23 AA 2101',true,{dev:{app:'1.0.16+',ovl:true,pwr:true,loc:'granted',notif:'granted',at:{__ms:t}}});Lv('+919999900021',60e3,12.9680,79.1390,'mini');
  D('+919999900022','Weak Wasim','mini','TN 23 AA 2202',true,{dev:{app:'1.0.16+',ovl:true,pwr:false,loc:'granted',notif:'granted',at:{__ms:t}}});Lv('+919999900022',10*60e3,12.9600,79.1400,'mini');
  D('+919999900023','Lost Lokesh','mini','TN 23 AA 2303',true,{dev:{app:'1.0.15-',ovl:false,pwr:true,loc:'granted',notif:'granted',at:{__ms:t}}});Lv('+919999900023',5*36e5,12.9300,79.1300,'mini');
  D('+919999900024','Silent Siva','mini','TN 23 AA 2404',true);Lv('+919999900024',2*864e5,12.9200,79.1500,'mini');
  D('+919999900025','Paused Prabhu','mini','TN 23 AA 2505',false,{autoOff:{__ms:t-36e5}});
  D('+919999900026','Off Om','mini','TN 23 AA 2606',false);
})()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1500,'height':1000})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate(SEED)
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2500)
        st=await of.evaluate("Object.fromEntries(DB.drv.filter(d=>d.id.startsWith('+9199999000')&&+d.id.slice(-2)>=21&&+d.id.slice(-2)<=26).map(d=>[d.en.split(' ')[0],rstate(d)]))")
        check('states: ready / weak / lost / lost / paused / off',st=={'Ready':'ready','Weak':'weak','Lost':'lost','Silent':'lost','Paused':'paused','Off':'off'},st)
        why=await of.evaluate("Object.fromEntries(['22','23','24','25'].map(k=>{const d=DB.drv.find(x=>x.id==='+9199999000'+k);return [k,rwhy(d).map(x=>x.k)]}))")
        check('reason: weak + battery restricted → "Battery"',why['22']==['pwr'],why['22'])
        check('reason: lost + old app → "Old app"',why['23']==['app'],why['23'])
        check('reason: no phone report at all → "No phone report (old app?)"',why['24']==['norep'],why['24'])
        check('reason: paused by the server is said first',why['25'][0]=='paused',why['25'])
        m=await of.evaluate("fixMsg(DB.drv.find(x=>x.id==='+919999900023'))")
        check('WhatsApp fix for an old app says Update to 1.0.16, and to open the app and switch ON','Update' in m and '1.0.16' in m and 'ON' in m and 'Battery' not in m,m)
        m=await of.evaluate("fixMsg(DB.drv.find(x=>x.id==='+919999900022'))")
        check('WhatsApp fix for battery restriction says Battery → No restrictions','No restrictions' in m and 'Update' not in m,m)
        u=await of.evaluate("waFix(DB.drv.find(x=>x.id==='+919999900022'))")
        check('WhatsApp link goes to that driver with the message',u.startswith('https://wa.me/919999900022?text=') and 'No%20restrictions' in u,u[:80])
        # dashboard tile
        await of.evaluate("S.sec='dash';save();show()");await pg.wait_for_timeout(1200)
        n=await of.evaluate("rcount()")
        tile=' '.join((await O.locator('.rtile').inner_text()).split())
        check('dashboard: "Ready now" with weak / lost / OFF counts',(f"{n['ready']}/" in tile) and ('weak '+str(n['weak']) in tile or 'பலவீனம் '+str(n['weak']) in tile),tile)
        await O.locator('.rtile').click();await pg.wait_for_timeout(900)
        check('tapping it opens Drivers on the Ready tab',await of.evaluate("S.sec==='drv'&&DF==='sig'"))
        # drivers page: lost tab with reasons and the WhatsApp fix link
        await O.locator('[data-df=lost]').click();await pg.wait_for_timeout(800)
        txt=' '.join((await O.locator('.cards').inner_text()).split())
        check('Lost tab: Lokesh (old app), Siva (no report), Prabhu (paused)',all(x in txt for x in ['Lost Lokesh','Silent Siva','Paused Prabhu']) and 'Ready Ravi' not in txt and 'Weak Wasim' not in txt,txt[:200])
        check('Lost tab: reason and WhatsApp fix on the card',('Old app' in txt or 'பழைய app' in txt) and await O.locator('.cards a[href^="https://wa.me/919999900023"]').count()==1)
        await O.locator('[data-df=weak]').click();await pg.wait_for_timeout(600)
        check('Weak tab: only Wasim',' '.join((await O.locator('.cards').inner_text()).split()).count('Wasim')>=1 and await O.locator('.dcard').count()==1)
        # a city ride waiting 50 s with no driver → bar with the 3 nearest drivers, ready first
        await pg.evaluate("""MOCK.store.set('bookings/bkw1',{status:'searching',kind:'ride',veh:'mini',fare:120,km:3,custName:'Kala',from:{ta:'காட்பாடி',en:'Katpadi',lat:12.9700,lon:79.1400},to:{ta:'CMC',en:'CMC',lat:12.9250,lon:79.1350},createdAt:{__ms:Date.now()-50e3},when:Date.now()-50e3,src:'app'});
          MOCK.fs.setDoc({path:'bookings/bkw1'},MOCK.store.get('bookings/bkw1'))""")
        await of.evaluate("S.sec='dash';save();show()")
        await pg.wait_for_timeout(1500);await of.evaluate("ringCheck()");await pg.wait_for_timeout(300)
        near=await of.evaluate("[...document.querySelectorAll('#ringbar .near a')].map(a=>[a.textContent,a.getAttribute('href')])")
        check('waiting ride: nearest drivers to call, ready first',len(near)==3 and 'Ready Ravi' in near[0][0] and near[0][1]=='tel:+919999900021' and 'Weak Wasim' in near[1][0],near)
        check('waiting ride: a corner alert too',await O.locator('#ncards .ncard').count()>=1)
        # no driver ready → alert once
        await pg.evaluate("(()=>{const l=MOCK.store.get('live/+919999900021');MOCK.fs.setDoc({path:'live/+919999900021'},{...l,updatedAt:{__ms:Date.now()-20*60e3}})})()")
        await pg.wait_for_timeout(1200)
        await of.evaluate("(()=>{R0AT=0;document.querySelectorAll('#ncards .ncard').forEach(c=>c.remove());const _h=Date.prototype.getHours;Date.prototype.getHours=function(){return 11};try{readyCheck()}finally{Date.prototype.getHours=_h}})()")
        t=' '.join((await O.locator('#ncards').inner_text()).split())
        check('no driver ready (11 am) → "No driver is ready right now" alert',('No driver is ready' in t or 'ரெடி வண்டி இல்லை' in t),t)
        await of.evaluate("(()=>{document.querySelectorAll('#ncards .ncard').forEach(c=>c.remove());const _h=Date.prototype.getHours;Date.prototype.getHours=function(){return 11};try{readyCheck()}finally{Date.prototype.getHours=_h}})()")
        check('…not repeated within 30 minutes',await O.locator('#ncards .ncard').count()==0)
        check('no page errors',not errs,errs[:3])
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
