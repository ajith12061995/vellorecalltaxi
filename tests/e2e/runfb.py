# App feedback (23 Nov): customers (Help tab) and drivers (menu) send a feedback note with stars.
# It is saved as a 'feedback' ticket (same rules as call-backs) and shows in Office → Support with a "Feedback" tag.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:0,minbal:100,office:'7200730416'})")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        D=pg.frame_locator('#d');df=pg.frame(url=B+'d2.html')
        await D.locator('#ph').fill('9999900002');await D.locator('#go').click();await pg.wait_for_timeout(300)
        for i,d in enumerate('123456'):await D.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(1500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        if not await C.locator('#ph').count() and await C.locator('.nav button[data-tab="me"]').count():await C.locator('.nav button[data-tab="me"]').click();await pg.wait_for_timeout(400)  # guest home → sign in
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}");await pg.wait_for_timeout(1500)
        fbs="(()=>[...MOCK.store.entries()].filter(([k,v])=>k.startsWith('tickets/')&&v.type==='feedback').map(([k,v])=>v))()"

        # ---- customer: Help tab → Send feedback
        await C.locator('.nav button[data-tab="help"]').click();await pg.wait_for_timeout(700)
        check('Help tab shows the feedback card',await C.locator('#fbk').count()==1)
        await C.locator('#fbk').click();await pg.wait_for_timeout(400)
        check('feedback sheet opens with 5 stars',await C.locator('[data-fs]').count()==5)
        await C.locator('#fbs').click();await pg.wait_for_timeout(300)
        check('empty feedback is refused with a message',(await C.locator('#fbe').inner_text()).strip()!='' and len(await pg.evaluate(fbs))==0)
        await C.locator('[data-fs="4"]').click();await pg.wait_for_timeout(100)
        check('4 stars lit',await C.locator('.fbstars button.on').count()==4)
        await C.locator('[data-fk="booking"]').click()
        await C.locator('#fbn').fill('Booking was easy <b>nice</b>');await C.locator('#fbs').click();await pg.wait_for_timeout(1200)
        f=await pg.evaluate(fbs)
        check('customer feedback saved as one feedback ticket',len(f)==1,f)
        f=f[0] if f else {}
        uid=await cf.evaluate("CUID")
        check('ticket carries the customer uid (rules need it)',f.get('uid')==uid and uid,(f.get('uid'),uid))
        check('title has topic and stars',f.get('title',{}).get('en')=='Feedback: Booking · ★★★★',f.get('title'))
        check('note and name saved',f.get('note')=='Booking was easy <b>nice</b>' and f.get('cust')=='Priya' and f.get('status')=='open',f)
        check('only rule-allowed note length',len(f.get('note',''))<=1000)
        check('sheet closed, Help shows it under My requests',await C.locator('#fbs').count()==0 and 'Feedback' in await C.locator('.recent').inner_text())

        # ---- office: Support shows it with a Feedback tag, the note is escaped
        await of.evaluate("S.sec='sup';save();show()");await pg.wait_for_timeout(1000)
        card=O.locator('.scard.feedback')
        check('office Support lists the feedback',await card.count()==1)
        txt=await card.first.inner_text() if await card.count() else ''
        check('office card shows tag, stars and note',('Feedback' in txt) and ('★★★★' in txt) and ('Booking was easy' in txt),txt)
        check('note HTML is not rendered as markup',await card.first.locator('p.snote b').count()==0 if await card.count() else False)
        check('feedback button says "Add note", not "Called them"',await card.first.locator('[data-sp]').count()==1 and 'Called' not in await card.first.locator('[data-sp]').inner_text() if await card.count() else False)

        # ---- driver: menu → Send feedback
        await D.locator('#menu').click();await pg.wait_for_timeout(500)
        check('driver menu has "Send feedback"',await D.locator('[data-dm="fb"]').count()==1)
        await D.locator('[data-dm="fb"]').click();await pg.wait_for_timeout(600)
        await D.locator('#fbs').click();await pg.wait_for_timeout(300)
        check('driver: empty feedback refused',(await D.locator('#fbe').inner_text()).strip()!='')
        await D.locator('[data-fk="map"]').click();await D.locator('#fbn').fill('Map loads slowly');await D.locator('#fbs').click();await pg.wait_for_timeout(1200)
        f=await pg.evaluate(fbs)
        dr=[x for x in f if x.get('cust','').startswith('Driver')]
        check('driver feedback saved',len(dr)==1,f)
        d=dr[0] if dr else {}
        duid=await df.evaluate("CL.user.uid")
        check('driver ticket has driver uid, phone and topic',d.get('uid')==duid and d.get('phone')=='9999900002' and d.get('title',{}).get('en')=='Driver feedback: Map / location',d)
        check('driver sheet closed',await D.locator('#fbs').count()==0)
        await of.evaluate("show()");await pg.wait_for_timeout(800)
        check('office now lists 2 feedback notes',await O.locator('.scard.feedback').count()==2)
        # driver's own feedback must not count as a complaint against that driver
        comp=await of.evaluate("(()=>{const d=DB.drv.find(x=>x.phone==='9999900002');return DB.sup.filter(t=>t.type!=='callback'&&t.type!=='feedback'&&t.phone&&t.phone.replace('+91','')===d.phone&&t.type!=='sos').length})()")
        check('driver feedback is not a complaint',comp==0)
        # office closes one
        await O.locator('.scard.feedback [data-sc]').first.click();await pg.wait_for_timeout(800)
        st=[x.get('status') for x in await pg.evaluate(fbs)]
        check('office can close a feedback note',st.count('closed')==1,st)
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
