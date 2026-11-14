# Office corner alerts: WhatsApp chats button (unread count) + new-message card + quick replies that only fill the box;
# a new booking shows a corner card that opens the booking. Messages are escaped.
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
        await pg.evaluate("MOCK.store.set('waInbox/old1',{from:'919000000001',name:'Old',text:'pazhaya',type:'text',seen:false,at:new Date(Date.now()-3600e3).toISOString()})")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(2000)
        fab=O.locator('#wafab')
        check('WhatsApp button in the corner, 1 unread chat from before login',await fab.is_visible() and (await fab.locator('em').inner_text())=='1')
        check('no alert card for a message that was already waiting at login',await O.locator('.ncard').count()==0)
        await pg.evaluate("MOCK.fs.setDoc(MOCK.fs.doc(null,'waInbox','new1'),{from:'919944640416',name:'Priya',text:'<img src=x onerror=window.PWN=1> driver எங்கே?',type:'text',seen:false,at:new Date().toISOString()})")
        await pg.wait_for_timeout(900)
        card=O.locator('.ncard.wa')
        check('new message → corner card with sender and text',await card.count()==1 and 'Priya' in await card.inner_text() and 'driver எங்கே' in await card.inner_text(),await card.count())
        check('count goes to 2 chats',(await fab.locator('em').inner_text())=='2')
        check('message text is not run as HTML',await of.evaluate("!window.PWN && !document.querySelector('.ncard img')"))
        await pg.screenshot(path='shots/ofn_card.png',clip={'x':800,'y':0,'width':1100,'height':880})
        await card.click();await pg.wait_for_timeout(1200)
        check('card opens that chat with the reply box',await O.locator('#wtx').count()==1 and 'driver எங்கே' in await O.locator('#wtl').inner_text())
        await O.locator('#wtq [data-q="1"]').click()
        v=await O.locator('#wtx').input_value()
        check('quick reply only fills the box (nothing sent)','velloretaxi.app' in v and await pg.evaluate("Object.keys(MOCK.dump()).filter(k=>k.startsWith('waLog/reply_')).length")==0,v)
        await pg.wait_for_timeout(600)
        check('opening the chat marks it read → count 1',(await fab.locator('em').inner_text())=='1')
        await of.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove()")
        await fab.click();await pg.wait_for_timeout(1000)
        rows=await O.locator('.wach').count()
        check('button opens the chat list, unread first',rows==2 and 'Old' in await O.locator('.wach').first.inner_text(),rows)
        await pg.screenshot(path='shots/ofn_list.png',clip={'x':800,'y':0,'width':1100,'height':880})
        await of.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove()")
        # new booking → corner card → opens the booking
        await pg.evaluate("""MOCK.fs.setDoc(MOCK.fs.doc(null,'bookings','bkNEW1'),{status:'scheduled',kind:'schedule',veh:'mini',custName:'Ravi',custPhone:'+919876500001',
          from:{key:'katpadi'},to:{key:'cmc'},fare:150,when:Date.now()+3*3600e3,createdAt:Date.now(),updatedAt:Date.now()})""")
        await pg.wait_for_timeout(1200)
        bc=O.locator('.ncard.bk')
        t=await bc.inner_text() if await bc.count() else ''
        check('new booking → corner card with route and customer',await bc.count()==1 and ('Katpadi' in t or 'காட்பாடி' in t) and 'CMC' in t and 'Ravi' in t,t)
        await bc.click();await pg.wait_for_timeout(900)
        check('card opens the booking',await of.evaluate("!!document.querySelector('.modal')") and 'Ravi' in await of.evaluate("document.querySelector('.modal').innerText"))
        await of.evaluate("document.querySelector('.modal')&&document.querySelector('.modal').remove()")
        await of.evaluate("logout()");await pg.wait_for_timeout(600)
        check('logout removes the button',await O.locator('#wafab').count()==0)
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
