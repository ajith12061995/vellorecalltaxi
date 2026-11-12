# WhatsApp panel (Office → Settings → Server & monitoring, owner only): switch, phone number id, test numbers,
# message types; message log with delivery status; customer replies (escaped) and "mark seen".
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
        await pg.evaluate("""(()=>{const t=Date.now();
          MOCK.store.set('waLog/b1_done',{bookingId:'abcdef99',kind:'done',to:'919944640416',status:'read',at:{toDate:()=>new Date(t)}});
          MOCK.store.set('waLog/b2_confirmed',{bookingId:'zzzzzz11',kind:'confirmed',to:'917200730416',status:'failed',error:'132001 Template <b>missing</b>',at:{toDate:()=>new Date(t-1000)}});
          MOCK.store.set('waInbox/m1',{from:'919944640416',name:'Priya',text:'<img src=x onerror=window.PWN=1> driver எங்கே?',type:'text',seen:false,at:new Date(t).toISOString()});})()""")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        await O.locator('#wal').click();await pg.wait_for_timeout(1200)
        check('panel opens with the switch OFF when nothing is saved',await O.locator('#wao').count()==1 and not await O.locator('#wao').is_checked())
        check('all five message types ticked by default',await O.locator('[data-wak]:checked').count()==5)
        # turning on without a phone number id is refused
        await O.locator('#wao').check();await O.locator('#wasv').click();await pg.wait_for_timeout(600)
        check('ON without Phone number ID → not saved',await pg.evaluate("MOCK.store.get('waConfig/main')") is None)
        # bad test number refused
        await O.locator('#wapid').fill('123456789012345');await O.locator('#watt').fill('12345');await O.locator('#wasv').click();await pg.wait_for_timeout(600)
        check('bad test number → not saved',await pg.evaluate("MOCK.store.get('waConfig/main')") is None)
        await O.locator('#watt').fill('+91 99446 40416, 7200730416');await O.locator('[data-wak="ontrip"]').uncheck()
        await O.locator('#wasv').click();await pg.wait_for_timeout(800)
        w=await pg.evaluate("MOCK.store.get('waConfig/main')")
        check('saved: on, phone id, test numbers cleaned, trip-started unticked',
              w and w.get('on') is True and w.get('phoneId')=='123456789012345' and w.get('testTo')==['9944640416','7200730416']
              and w.get('kinds')==['confirmed','assigned','done','cancelled'],w)
        ca=await pg.evaluate("MOCK.store.get('config/app')") or {}
        check('nothing else written to the public config/app',not any(k in ca for k in ('wa','testTo','phoneId')),list(ca))
        # log + replies
        await O.locator('#wal').click();await pg.wait_for_timeout(1200)
        lg=await O.locator('#walog').inner_text()
        check('log shows type, number, status and booking no.','Trip completed' in lg or 'பயணம் முடிவு' in lg,lg[:200])
        check('read and failed status shown with the Meta error',('Read' in lg or 'படிச்சாங்க' in lg) and ('Failed' in lg or 'தோல்வி' in lg) and '132001' in lg and 'ABCDEF' in lg,lg[:300])
        check('Meta error text is escaped (no HTML)',await O.locator('#walog b:has-text("missing")').count()==0)
        inb=await O.locator('#wain').inner_text()
        check('customer reply shown with name and number','Priya' in inb and '919944640416' in inb and 'driver எங்கே?' in inb,inb[:200])
        check('reply text is escaped (no script runs)',await of.evaluate("!window.PWN") and await O.locator('#wain img').count()==0)
        check('reloaded settings keep the saved values',await O.locator('#wapid').input_value()=='123456789012345' and await O.locator('#wao').is_checked() and not await O.locator('[data-wak="ontrip"]').is_checked())
        # conversation + reply (customer); a registered driver is tagged Driver; 24 h window enforced
        await pg.evaluate("""(()=>{const t=Date.now();
          MOCK.store.set('waInbox/m2',{from:'919999900002',name:'Raja',text:'wallet recharge பண்ணிட்டேன்',type:'text',seen:false,at:new Date(t-60e3).toISOString()});
          MOCK.store.set('waInbox/m3',{from:'919876500009',name:'Old',text:'hello',type:'text',seen:false,at:new Date(t-26*3600e3).toISOString()});})()""")
        await O.locator('#wal').click();await pg.wait_for_timeout(1200)
        inb=await O.locator('#wain').inner_text()
        check('sender tagged: registered driver vs customer',('🚖 Driver' in inb) and ('👤 Customer' in inb),inb[:300])
        await O.locator('[data-wth="919944640416"]').click();await pg.wait_for_timeout(1000)
        th=await of.evaluate("document.getElementById('wtl').innerText")
        check('conversation shows their message',('driver எங்கே?' in th),th[:120])
        ww=await O.locator('#wtw').inner_text();dis=await O.locator('#wtx').is_disabled()
        check('reply allowed inside 24 h',not dis and ('மணி' in ww or ' h ' in ww),(dis,ww))
        await O.locator('#wts').click();await pg.wait_for_timeout(400)
        check('empty reply not sent',not await pg.evaluate("(window.__waSent||[]).length") and bool(await O.locator('#wte').inner_text()))
        await O.locator('#wtx').fill('<b>5</b> நிமிஷத்துல driver வருவார்');await O.locator('#wts').click();await pg.wait_for_timeout(1200)
        sent=await pg.evaluate("window.__waSent||[]")
        check('reply sent through the server to that number',len(sent)==1 and sent[0]['to']=='919944640416' and 'நிமிஷத்துல' in sent[0]['text'],sent)
        th=await of.evaluate("document.getElementById('wtl').innerText")
        check('our reply shows in the conversation (escaped)','<b>5</b>' in th and await O.locator('#wtl b').count()==0,th[-120:])
        await pg.screenshot(path='shots/wa_reply.png',clip={'x':1150,'y':0,'width':750,'height':860})
        await O.locator('#wtc').click();await pg.wait_for_timeout(300)
        await O.locator('#wal').click();await pg.wait_for_timeout(1200)
        await O.locator('[data-wth="919876500009"]').click();await pg.wait_for_timeout(1000)
        check('after 24 h: reply box locked with a clear note',await O.locator('#wtx').is_disabled() and ('24' in await O.locator('#wtw').inner_text()))
        check('opening a conversation marks it seen',(await pg.evaluate("MOCK.store.get('waInbox/m3')")).get('seen') is True)
        await O.locator('#wtc').click();await pg.wait_for_timeout(300)
        # switch off
        await O.locator('#wao').uncheck();await O.locator('#wasv').click();await pg.wait_for_timeout(800)
        check('switched off',(await pg.evaluate("MOCK.store.get('waConfig/main')")).get('on') is False)
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
