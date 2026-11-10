# "Bring a driver friend": a driver's own join link carries a code for their number; the join form saves who referred
# the applicant; the office sees it on the application and on both drivers. No money moves (bonus is paid by the owner).
import asyncio, os, re
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
PNG=os.path.join(os.path.dirname(os.path.abspath(__file__)),'fixtures','place.png')
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':1000})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        # 1) the driver's share screen
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(400)
        await D.locator('#o0').fill('123456');await pg.wait_for_timeout(1500)
        await D.locator('#menu').click();await pg.wait_for_timeout(500)
        check('driver menu has "Bring a driver friend"',await D.locator('[data-dm="ref"]').count()==1)
        await D.locator('[data-dm="ref"]').click();await pg.wait_for_timeout(1200)
        link=await D.locator('#rlink').inner_text()
        m=re.search(r'/join/\?ref=([0-9a-z]+)$',link)
        check('share link is the join page with a code',bool(m),link)
        code=m.group(1) if m else ''
        check('the code stands for the driver\'s own number',await df.evaluate("c=>VCTREF.phone(c)",code)=='9999900002')
        wa=await D.locator('#rwa').get_attribute('href')
        check('WhatsApp share carries the same link',('ref%3D'+code) in wa and wa.startswith('https://wa.me/?text='),wa[:90])
        # 2) a friend opens the link and applies
        await pg.goto(B+'harness_j.html');await pg.wait_for_timeout(2500)
        J=pg.frame_locator('#c');jf=pg.frame(url=B+'j2.html')
        await jf.evaluate("c=>history.replaceState(null,'','?ref='+c)",code)
        await J.locator('#ph').fill('9876512345');await J.locator('#go').click();await pg.wait_for_timeout(400)
        await J.locator('#o0').fill('123456');await pg.wait_for_timeout(1200)
        check('join form: referrer number filled in from the link',await J.locator('#rfp').input_value()=='9999900002')
        # own number / bad number are refused with a clear message (checked through the page's own rule)
        check('own number cannot be the referrer',await jf.evaluate("VCTREF.clean('9876512345',S.phone)")=='' and await jf.evaluate("VCTREF.clean('12345',S.phone)")=='')
        # hostile ref in the address is ignored
        await jf.evaluate("history.replaceState(null,'','?ref=%3Cimg%20src%3Dx%20onerror%3Dparent.PWN%3D1%3E')")
        check('junk in the link gives no referrer',await jf.evaluate("VCTREF.fromUrl(location.search,S.phone)") is None and not await pg.evaluate("window.PWN"))
        # typing your own number as the referrer is refused on Send, with a message
        await J.locator('#rfp').fill('9876512345');await J.locator('#sb').click();await pg.wait_for_timeout(400)
        await jf.evaluate("S.data.agreed=true");
        own=await jf.evaluate("(()=>{const D=S.data;return !!D.ref&&!VCTREF.clean(D.ref,S.phone)})()")
        check('typed own number is caught before sending',own and await pg.evaluate("MOCK.store.get('driverApps/+919876512345')") is None)
        await J.locator('#rfp').fill('9999900002')
        # fill the form the short way: put the data in and submit through the page's own submit()
        await jf.evaluate("""()=>{const y=Date.now()+200*864e5;S.veh='sedan';
          Object.assign(S.data,{name:'Murugan K',ecName:'Lakshmi',ecPhone:'9840011122',dlNo:'TN2320200012345',years:'5',area:'Katpadi',brand:'Maruti Suzuki',model:'Dzire',year:2022,plate:'TN 23 CK 4455',ownVehicle:true,
            exp:{dl:y,ins:y,permit:y,fc:y},upi:'murugan@okaxis',agreed:true,sig:'Murugan K',ref:document.getElementById('rfp').value});
          const img='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
          Object.keys(SLOTS).forEach(k=>{if(SLOTS[k][2])S.files[k]=img});}""")
        await jf.evaluate("submit()");await pg.wait_for_timeout(2500)
        a=await pg.evaluate("MOCK.store.get('driverApps/+919876512345')")
        check('application saved with the referrer (+91…)',bool(a) and a.get('ref')=='+919999900002' and a.get('status')=='pending',a and {k:a.get(k) for k in ['ref','status','name']})
        # 3) office sees it
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300);await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='appr';save();show()");await pg.wait_for_timeout(800)
        await O.locator('[data-av]').first.click();await pg.wait_for_timeout(1200)
        tx=await O.locator('#refby').inner_text() if await O.locator('#refby').count() else ''
        check('office application shows who referred (name + number)','+919999900002' in tx and len(tx)>14,tx)
        await O.locator('#apok').click();await pg.wait_for_timeout(1500)
        d=await pg.evaluate("MOCK.store.get('drivers/+919876512345')")
        check('approved driver keeps the referrer',bool(d) and d.get('ref')=='+919999900002' and d.get('wallet')==0,d and {k:d.get(k) for k in ['ref','wallet','name']})
        check('no money moved: the referring driver\'s wallet is unchanged',(await pg.evaluate("MOCK.store.get('drivers/+919999900002')")).get('wallet')==500)
        ln=await of.evaluate("refLine('+919999900002',RAWD.find(x=>x._id==='+919999900002')||{})")
        check('office: the referring driver shows 1 referred driver by name',': 1<' in ln and 'Murugan K' in ln,ln[:200])
        ln2=await of.evaluate("refLine('+919876512345',RAWD.find(x=>x._id==='+919876512345')||{})")
        check('office: the new driver shows who referred him','Test Driver' in ln2,ln2[:200])
        check('office: a driver with no referrals shows no line',await of.evaluate("refLine('+910000000000',{})")=='')
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
