# Office: driver card "View documents" shows the photos sent through the join form; only real base64 photos
# and known photo slots are shown (a tampered upload cannot run code in the office).
import asyncio,base64
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
JPG='data:image/jpeg;base64,'+base64.b64encode(open('fixtures/doc.jpg','rb').read()).decode()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();pg=await b.new_page(viewport={'width':1900,'height':880});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        evil='x" onerror="parent.__pwn=1'
        await pg.evaluate("""([jpg,evil])=>{const S=MOCK.store;
          S.set('driverApps/+919999900002',{status:'approved',name:'test driver',files:['dlF','fc',evil]});
          S.set('driverApps/+919999900002/files/dlF',{data:jpg});
          S.set('drivers/+919999900003',{name:'Two',veh:'sedan',wallet:200,plate:'TN23X0002',model:'Dzire'});
          S.set('driverApps/+919999900002/files/fc',{data:evil});
          S.set('driverApps/+919999900077',{status:'pending',name:'Bad Actor',phone:'+919999900077',files:['photo',evil],exp:{},submittedAt:Date.now()});
          S.set('driverApps/+919999900077/files/photo',{data:'data:image/png;base64,AAAA" onerror="parent.__pwn=2'});}""",[JPG,evil])
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='drv';show()");await pg.wait_for_timeout(800)
        await O.locator('[data-dph="+919999900002"]').click();await pg.wait_for_timeout(1200)
        tiles=await of.evaluate("[...document.querySelectorAll('.modal [id^=dp_]')].map(a=>a.id+':'+(a.querySelector('img')?'img':a.innerText.trim().slice(0,20)))")
        check('real DL photo shown, bad photo refused, unknown slot dropped',tiles==['dp_dlF:img','dp_fc:Photo சரியில்ல\nFC'] or (len(tiles)==2 and tiles[0]=='dp_dlF:img' and 'சரியில்ல' in tiles[1]),tiles)
        box=await pg.evaluate("(()=>{const r=document.getElementById('o').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
        await pg.screenshot(path='shots/docs_office.png',clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        await of.evaluate("document.querySelector('.modal').remove()")
        # driver without join-form documents
        other=await of.evaluate("(DB.drv.find(d=>d.id!=='+919999900002'&&!(DB.apps||[]).some(a=>a.id===d.id))||{}).id")
        await O.locator(f'[data-dph="{other}"]').click();await pg.wait_for_timeout(600)
        txt=await of.evaluate("document.querySelector('.modal').innerText")
        check('driver without uploads: clear message',('app-ல இல்லை' in txt) or ('No documents' in txt),txt[:80])
        await of.evaluate("document.querySelector('.modal').remove()")
        # pending application with tampered photo
        await of.evaluate("S.sec='appr';show()");await pg.wait_for_timeout(600)
        await of.evaluate("reviewApp((DB.apps||[]).find(a=>a.id==='+919999900077'))");await pg.wait_for_timeout(1200)
        imgs=await of.evaluate("[...document.querySelectorAll('.modal [id^=im_]')].map(a=>a.id)")
        check('approval review: only known slots, tampered photo not rendered',imgs==['im_photo'] and not await of.evaluate("!!document.querySelector('.modal img')"),imgs)
        check('no code ran from uploads',await pg.evaluate("!window.__pwn"))
        check('no page errors',not errs,errs[:3])
        await b.close()
    print('RESULT','PASS' if all(res) else 'FAIL',f'{sum(res)}/{len(res)}')
asyncio.run(main())
