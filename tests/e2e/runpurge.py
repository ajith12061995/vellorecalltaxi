# Owner removes a driver completely (Drivers → driver → "Remove this driver completely"):
# wrong confirm digits refused; on a ride refused; wallet money asks again; then profile, application + documents,
# trips he drove (with chat), ledger, recharges all gone; another driver's data kept; backup copy taken first.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
PD='+919999900060'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate(f"""(()=>{{const s=MOCK.store,PD='{PD}';
          s.set('drivers/'+PD,{{name:'Subramani',veh:'auto',plate:'TN 23 X 1',model:'Bajaj RE',wallet:0,rating:5,online:false,blocked:false,docs:{{dl:Date.now()-2*864e5}}}});
          s.set('driverApps/'+PD,{{status:'approved',files:['dl']}});s.set('driverApps/'+PD+'/files/dl',{{data:'data:image/jpeg;base64,xx'}});
          s.set('bookings/p1',{{driverPhone:PD,status:'assigned',fare:150,veh:'auto',customerUid:'u1',createdAt:Date.now()}});
          s.set('bookings/p1/chat/m1',{{from:'d',text:'coming'}});
          s.set('bookings/p2',{{driverPhone:PD,status:'done',fare:120,veh:'auto',customerUid:'u1',createdAt:Date.now()}});
          s.set('bookings/p3',{{driverPhone:'+919999900002',status:'done',fare:200,veh:'auto',customerUid:'u1',createdAt:Date.now()}});
          s.set('ledger/p2',{{driverPhone:PD,comm:12}});s.set('ledger/p3',{{driverPhone:'+919999900002',comm:20}});
          s.set('recharges/r1',{{driverPhone:PD,amt:100,status:'approved'}});}})()""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2000)
        open_=f"document.querySelectorAll('.modal').forEach(m=>m.remove());driverDetail(drvById('{PD}'))"
        await of.evaluate(open_);await pg.wait_for_timeout(1500)
        check('owner sees "Remove this driver completely"',await of.evaluate("!!document.getElementById('dpurge')"))
        await O.locator('#dpurge').click();await pg.wait_for_timeout(400)
        await O.locator('#pc').fill('1234');await O.locator('#py').click();await pg.wait_for_timeout(500)
        check('wrong last 4 digits refused, nothing removed',await pg.evaluate(f"!!MOCK.store.get('drivers/{PD}')") and 'match' in (await of.evaluate("document.getElementById('pe').textContent")) or 'சரியா' in (await of.evaluate("document.getElementById('pe').textContent")))
        await O.locator('#pc').fill('0060');await O.locator('#py').click();await pg.wait_for_timeout(1000)
        t=await of.evaluate("document.getElementById('pe').textContent")
        check('refused while he is on a ride',('ride' in t) and await pg.evaluate(f"!!MOCK.store.get('drivers/{PD}')"),t)
        await pg.evaluate("MOCK.store.set('bookings/p1',{...MOCK.store.get('bookings/p1'),status:'cancelled'})")
        await pg.evaluate(f"MOCK.store.set('drivers/{PD}',{{...MOCK.store.get('drivers/{PD}'),wallet:-40}})");await pg.wait_for_timeout(300)
        await O.locator('#py').click();await pg.wait_for_timeout(1000)
        t=await of.evaluate("document.body.innerText")
        check('wallet money: asks again showing the amount',('₹40' in t and ('பாக்கி' in t or 'owes' in t)) and await pg.evaluate(f"!!MOCK.store.get('drivers/{PD}')"))
        await pg.screenshot(path='shots/purge_confirm.png',clip={'x':800,'y':0,'width':1100,'height':860})
        await O.locator('#pc').fill('0060');await O.locator('#py').click();await pg.wait_for_timeout(1500)
        gone=await pg.evaluate(f"['drivers/{PD}','driverApps/{PD}','driverApps/{PD}/files/dl','bookings/p1','bookings/p1/chat/m1','bookings/p2','ledger/p2','recharges/r1'].filter(k=>MOCK.store.get(k))")
        check('driver, documents, trips + chat, ledger, recharges all removed',not gone,gone)
        kept=await pg.evaluate("['bookings/p3','ledger/p3','drivers/+919999900002'].every(k=>MOCK.store.get(k))")
        check("other driver's data kept",kept)
        bk=await pg.evaluate("(window.__purgeBackup||[]).map(x=>x.path)")
        check('backup copy taken of everything removed',f'drivers/{PD}' in bk and 'bookings/p2' in bk and len(bk)==8,len(bk))
        t=await of.evaluate("document.body.innerText")
        check('office confirms with counts',('2 trips' in t) or ('நீக்கியாச்சு' in t),t[-120:].replace('\n',' '))
        await pg.wait_for_timeout(1000)
        check('driver no longer in the drivers list',await of.evaluate(f"!DB.drv.some(d=>d.id==='{PD}')") if await of.evaluate("typeof DB!=='undefined'&&Array.isArray(DB.drv)") else await of.evaluate(f"!drvById('{PD}')"))
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
