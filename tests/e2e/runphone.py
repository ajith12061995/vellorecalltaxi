# Customer / rider phone numbers are NOT in the booking (drivers can read waiting bookings); they are in
# bookings/{id}/private/contact. The accepting driver, the office and the customer still get them.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},geolocation={'latitude':12.955,'longitude':79.139},permissions=['geolocation'])
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("(()=>{const c=MOCK.store.get('config/app');if(c)c.privPhone=true;else MOCK.store.set('config/app',{privPhone:true})})()")
        C=pg.frame_locator('#c');D=pg.frame_locator('#d');O=pg.frame_locator('#o')
        cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1200)
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await D.locator('#go').click();await pg.wait_for_timeout(1200);await D.locator('#ons').click();await pg.wait_for_timeout(1500)
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2000)
        # 1) booking for someone else (rider)
        await cf.evaluate("S.rider={name:'Amma',phone:'9876500011'};S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3000);bid=await cf.evaluate("R.id")
        dump=await pg.evaluate('MOCK.dump()');bk=dump[f'bookings/{bid}'];ct=dump.get(f'bookings/{bid}/private/contact')
        check('waiting booking has no customer phone',('custPhone' not in bk) and '+919999900001' not in str(bk),str({k:bk.get(k) for k in ('custName','rider')}))
        check('waiting booking has no rider phone, keeps rider name',bk.get('rider')=={'name':'Amma'} and '9876500011' not in str(bk))
        check('contact saved privately',ct=={'custPhone':'+919999900001','riderPhone':'9876500011'},str(ct))
        # driver sees the request: no number shown anywhere on screen
        txt=await df.evaluate("document.body.innerText")
        check('driver request screen shows no number','9999900001' not in txt and '9876500011' not in txt)
        await D.locator('#acc').click();await pg.wait_for_timeout(2500)
        cp=await df.evaluate("custPh()")
        sh=await cf.evaluate("(document.getElementById('rshare')||{}).href||''")
        check('customer can still share the trip with the rider on WhatsApp','wa.me/919876500011' in sh,sh[:40])
        check('accepting driver gets the rider number for calling',cp=='+919876500011',cp)
        # office shows both numbers
        await of.evaluate("remap()");await pg.wait_for_timeout(800)
        ob=await of.evaluate(f"JSON.stringify((DB.bk.find(b=>b._id==='{bid}')||{{}}))")
        check('office sees customer + rider numbers','"phone":"9999900001"' in ob and '"phone":"9876500011"' in ob,ob[:200])
        # 2) driver cancels → automatic re-book carries the contact over
        await D.locator('#jcx').click();await pg.wait_for_timeout(400)
        await D.locator('.reason').nth(2).click();await D.locator('#cy').click();await pg.wait_for_timeout(3500)
        nid=await cf.evaluate("R&&R.id");dump=await pg.evaluate('MOCK.dump()')
        nb=dump.get(f'bookings/{nid}',{});nct=dump.get(f'bookings/{nid}/private/contact')
        check('re-booked ride also hides the phone and keeps the contact',nid!=bid and 'custPhone' not in nb and nct and nct.get('riderPhone')=='9876500011',str(nct))
        await cf.evaluate("stopWatch();forgetRide();R=null;S.rider=null;home()");await pg.wait_for_timeout(500)
        # 3) scheduled booking path
        sid=await cf.evaluate("cloudSchedule({kind:'schedule',veh:{id:'sedan'},to:{ta:'CMC',en:'CMC'},hasDrop:false,fare:200,when:Date.now()+5*36e5,pay:'cash'})")
        dump=await pg.evaluate('MOCK.dump()')
        check('scheduled booking hides the phone too',sid and 'custPhone' not in dump[f'bookings/{sid}'] and dump.get(f'bookings/{sid}/private/contact',{}).get('custPhone')=='+919999900001')
        # 4) office phone booking
        n0=len([k for k in dump if k.startswith('bookings/') and k.count('/')==1])
        await of.evaluate("newBooking()");await pg.wait_for_timeout(500)
        await O.locator('#nph').fill('9443322110');await O.locator('#nph').dispatch_event('input');await O.locator('#nnm').fill('Kumar')
        await of.evaluate("const s=document.getElementById('nto');s.value=[...s.options].map(o=>o.value).find(v=>v&&v!==document.getElementById('nfr').value);s.dispatchEvent(new Event('change'))")
        await O.locator('#nsv').click();await pg.wait_for_timeout(2000)
        dump=await pg.evaluate('MOCK.dump()')
        pk=[k for k,v in dump.items() if k.count('/')==1 and k.startswith('bookings/') and v.get('custName')=='Kumar']
        pct=dump.get(pk[0]+'/private/contact') if pk else None
        check('office phone booking: number kept private',pk and 'custPhone' not in dump[pk[0]] and pct and pct.get('custPhone')=='+919443322110',str(pct))
        await of.evaluate("S.sec='book';show()");await pg.wait_for_timeout(800)
        otx=await of.evaluate("document.body.innerText")
        check('office list shows the phone booking number','9443322110' in otx)
        await pg.screenshot(path='shots/phone_office.png')
        # 5) switch OFF (before the new rules are published): number stays in the booking as before
        await cf.evaluate("CFG.privPhone=false;S.rider=null;S.dest='cmc';S.veh='sedan';S.pay='cash';fareScreen()");await pg.wait_for_timeout(1200)
        await C.locator('#bookb').click();await pg.wait_for_timeout(3000);oid=await cf.evaluate("R.id");dump=await pg.evaluate('MOCK.dump()')
        check('switch off: old behaviour (number in booking) + contact also saved',dump[f'bookings/{oid}'].get('custPhone')=='+919999900001' and dump.get(f'bookings/{oid}/private/contact',{}).get('custPhone')=='+919999900001')
        print('ERR',errs)
        check('no page errors',not errs,str(errs[:3]))
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
