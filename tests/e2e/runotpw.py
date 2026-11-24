# OTP boxes on narrow phones (320–430 px wide) in the customer app, driver app and driver join page:
#  all 6 boxes fully visible inside the screen, equal size, digits big (≥20px), no sideways scroll; whole join page has no sideways scroll
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i if not c else '')
M="""()=>{const W=document.documentElement.clientWidth,ins=[...document.querySelectorAll('.otp input')].filter(i=>i.offsetParent);
 const r=ins.map(i=>i.getBoundingClientRect());return {W,n:ins.length,sw:document.documentElement.scrollWidth,
 inside:r.every(x=>x.left>=0&&x.right<=W+0.5),ws:r.map(x=>Math.round(x.width)),fs:ins.map(i=>parseFloat(getComputedStyle(i).fontSize)),
 overlap:r.some((x,k)=>k&&x.left<r[k-1].right-0.5)}}"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();errs=[]
        for W in [320,344,360,375,393,412,430]:
            pg=await b.new_page(viewport={'width':1900,'height':900});pg.on('pageerror',lambda e:errs.append(str(e)))
            await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
            await pg.evaluate(f"['c','d'].forEach(i=>document.getElementById(i).style.width='{W}px')");await pg.wait_for_timeout(300)
            cf=pg.frame(url=B+'c2.html');df=pg.frame(url=B+'d2.html');C=pg.frame_locator('#c');D=pg.frame_locator('#d')
            await cf.evaluate("S.logged=false;S.name='';save();login()");await pg.wait_for_timeout(400)
            if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)  # guest home → sign in
            await C.locator('#ph').fill('9999900011');await C.locator('#go').click();await pg.wait_for_timeout(600)
            m=await cf.evaluate(M);ok=m['n']==6 and m['inside'] and len(set(m['ws']))==1 and min(m['fs'])>=20 and m['sw']<=m['W'] and not m['overlap']
            check(f'customer {W}px: 6 boxes inside, equal, readable',ok,m)
            await df.evaluate("S.logged=false;save();login()");await pg.wait_for_timeout(400)
            await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(600)
            m=await df.evaluate(M);ok=m['n']==6 and m['inside'] and len(set(m['ws']))==1 and min(m['fs'])>=20 and m['sw']<=m['W'] and not m['overlap']
            check(f'driver {W}px: 6 boxes inside, equal, readable',ok,m)
            await pg.close()
            pg=await b.new_page(viewport={'width':1900,'height':900});pg.on('pageerror',lambda e:errs.append(str(e)))
            await pg.goto(B+'harness_j.html');await pg.wait_for_timeout(2500)
            await pg.evaluate(f"document.getElementById('c').style.width='{W}px'");await pg.wait_for_timeout(300)
            jf=pg.frame(url=B+'j2.html');J=pg.frame_locator('#c')
            sw0=await jf.evaluate("[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
            check(f'join {W}px: phone screen has no sideways scroll',sw0[0]<=sw0[1],sw0)
            await J.locator('#ph').fill('9876512345');await J.locator('#ph').dispatch_event('input');await J.locator('#go').click();await pg.wait_for_timeout(600)
            m=await jf.evaluate(M);ok=m['n']==6 and m['inside'] and len(set(m['ws']))==1 and min(m['fs'])>=20 and m['sw']<=m['W'] and not m['overlap']
            check(f'join {W}px: 6 boxes inside, equal, readable',ok,m)
            if W in (320,360): await J.locator('#o0').press_sequentially('123',delay=30);await pg.wait_for_timeout(200);await pg.locator('#c').screenshot(path=f'shots/otpw_join_{W}.png');await jf.evaluate("document.querySelectorAll('.otp input').forEach(i=>i.value='')")
            await J.locator('#o0').fill('123456');await pg.wait_for_timeout(1200)
            sw=await jf.evaluate("[document.documentElement.scrollWidth,document.documentElement.clientWidth,!!document.getElementById('nm')]")
            check(f'join {W}px: OTP works → form opens, form has no sideways scroll',sw[2] and sw[0]<=sw[1],sw)
            if W in (320,360,412,430):
                await J.locator('[data-v=sedan]').click();await pg.wait_for_timeout(200)
                await J.locator('#nm').fill('Murugan K');await J.locator('#ecp').fill('9840011122')
                await J.locator('#pl').fill('TN 23 CK 4455')
                cut=await jf.evaluate("""[...document.querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=date]),select')].filter(i=>i.offsetParent&&i.value).map(i=>{const c=document.createElement('canvas').getContext('2d');const cs=getComputedStyle(i);c.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;const t=i.tagName=='SELECT'?i.options[i.selectedIndex].text:i.value;return [i.id,t,c.measureText(t).width,i.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-(i.tagName=='SELECT'?20:0)]}).filter(x=>x[2]>x[3])""")
                check(f'join {W}px: typed name, phone, plate fully visible (not cut)',not cut,cut)
                for k in ['photo','dlF','dlB','rcF','rcB','aadhaarF','aadhaarB','ins','permit']:
                    await J.locator(f'[data-f={k}]').set_input_files('fixtures/doc.jpg');await pg.wait_for_timeout(300)
                sw=await jf.evaluate("[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
                check(f'join {W}px: filled form (photos) has no sideways scroll',sw[0]<=sw[1],sw)
                check(f'join {W}px: short form — no number / date boxes to type',await jf.evaluate("document.querySelectorAll('input[type=date],#dln,#br,#mo,#yr,#sig,#upi').length")==0)
                await jf.evaluate("document.getElementById('sb').scrollIntoView({block:'center'})");await pg.locator('#c').screenshot(path=f'shots/otpw_form_{W}.png')
            await pg.close()
        check('no page errors',not errs,errs)
        print('RESULT',('PASS' if all(res) else 'FAIL'),f'{sum(res)}/{len(res)}');await b.close()
asyncio.run(main())
