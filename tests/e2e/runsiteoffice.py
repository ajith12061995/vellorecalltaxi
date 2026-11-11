# Office side of the public website: Settings Save copies only the price fields to public/prices; the owner edits
# website numbers, address, places and photos (Office → Settings → 🌐 Website); website enquiries show in Support.
import asyncio, os
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
PNG=os.path.join(os.path.dirname(os.path.abspath(__file__)),'fixtures','place.png')
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':1000})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        await pg.evaluate("MOCK.store.set('config/app',{comm:7,minbal:100,office:'7200730416',blocked:['9999999999'],fares:{mini:{base:105,per:16}}})")
        O=pg.frame_locator('#o');of=pg.frame(url=B+'o2.html')
        await O.locator('#ph').fill('8220201462');await O.locator('#lgn').click();await pg.wait_for_timeout(300)
        await O.locator('#otp').fill('123456');await pg.wait_for_timeout(1500)
        await of.evaluate("S.sec='set';save();show()");await pg.wait_for_timeout(1000)
        # 1) Settings Save → public/prices
        await O.locator('[data-f="mini.base"]').fill('110');await O.locator('#sv').click();await pg.wait_for_timeout(1500)
        pr=await pg.evaluate("MOCK.store.get('public/prices')")
        check('Save copies prices to the website (Mini 110)',pr and pr['fares']['mini']['base']==110 and 'out' in pr,pr and pr.get('fares',{}).get('mini'))
        check('nothing private in the website copy (no commission, blocked numbers, office settings)',pr and set(pr.keys())<={'fares','out','rent','night','area','updatedAt'},list(pr or {}))
        # 2) Website editor
        await O.locator('#wsl').click();await pg.wait_for_timeout(1000)
        check('editor opens with the current numbers and 6 places',await O.locator('#ws_ph').input_value()=='9344640416' and await O.locator('#ws_wa').input_value()=='' and await O.locator('#wspl [data-pi]').count()==6)
        await O.locator('#ws_ph').fill('12345');await O.locator('#wssv').click();await pg.wait_for_timeout(600)
        check('bad booking number refused',await pg.evaluate("MOCK.store.get('public/site')") is None)
        await O.locator('#ws_ph').fill('9876543210');await O.locator('#ws_ad').fill('12 Officer Line, Vellore')
        await O.locator('#wspl [data-pi="0"] [data-k="ta"]').fill('வேலூர் கோட்டை (புதுசு)')
        await O.locator('#wspl [data-pd="0"]').click();await pg.wait_for_timeout(200)        # fort moves down
        check('move down keeps the typed name',await O.locator('#wspl [data-pi="1"] [data-k="ta"]').input_value()=='வேலூர் கோட்டை (புதுசு)')
        await O.locator('#wspl [data-px="5"]').click();await pg.wait_for_timeout(200)        # remove the last place
        await O.locator('#wsadd').click();await pg.wait_for_timeout(200)
        await O.locator('#wspl [data-pi="5"] [data-k="en"]').fill('Kailasagiri Hill')
        await O.locator('#wspl [data-pf="1"]').set_input_files(PNG);await pg.wait_for_timeout(1500)
        check('photo shrunk and previewed',await O.locator('#wspl [data-pi="1"] img').count()==1)
        await O.locator('#wspl [data-pi="5"] [data-k="en"]').fill('');await O.locator('#wssv').click();await pg.wait_for_timeout(500)
        check('a place without a name is refused',await pg.evaluate("MOCK.store.get('public/site')") is None)
        await O.locator('#wspl [data-pi="5"] [data-k="en"]').fill('Kailasagiri Hill');await O.locator('#wssv').click();await pg.wait_for_timeout(1500)
        st=await pg.evaluate("MOCK.store.get('public/site')")
        ids=[x['id'] for x in st['places']] if st else []
        check('saved: numbers, address, 6 places in the new order',st and st['phone']=='9876543210' and st['address']=='12 Officer Line, Vellore' and ids[:2]==['temple','fort'] and 'cmc' not in ids and len(ids)==6,ids)
        fort=[x for x in st['places'] if x['id']=='fort'][0] if st else {}
        check('edited name saved, photo marked',fort.get('ta')=='வேலூர் கோட்டை (புதுசு)' and fort.get('img',0)>0,fort)
        img=await pg.evaluate("(MOCK.store.get('siteImg/fort')||{}).data||''")
        check('photo stored as a small JPEG (≤ 1200 px, < 900 KB)',img.startswith('data:image/jpeg;base64,') and len(img)<900000,len(img))
        w=await of.evaluate("new Promise(r=>{const i=new Image();i.onload=()=>r(i.width);i.src=(MOCK_STORE_IMG=parent.MOCK.store.get('siteImg/fort').data)})")
        check('photo width 1200 px (was 1600)',w==1200,w)
        # remove the photo again
        await O.locator('#wspl [data-pi="1"] [data-pr="1"]').click();await O.locator('#wssv').click();await pg.wait_for_timeout(1200)
        st=await pg.evaluate("MOCK.store.get('public/site')");fort=[x for x in st['places'] if x['id']=='fort'][0]
        check('photo removed: no picture stored, place keeps its drawing',await pg.evaluate("MOCK.store.get('siteImg/fort')") is None and not fort.get('img'))
        # 3) website enquiry in Support
        await of.evaluate("F().setDoc(F().doc(CL.db,'enquiries','q1'),{name:'Priya',phone:'9944640416',kind:'event',msg:'Wedding 5 cars',status:'open',src:'web',createdAt:F().serverTimestamp()})")
        await pg.wait_for_timeout(1200)
        await of.evaluate("S.sec='sup';save();show()");await pg.wait_for_timeout(800)
        txt=await O.locator('#main').inner_text()
        check('enquiry shows in Support with type, name, number and message',('Website enquiry' in txt) and 'Priya' in txt and '9944640416' in txt and 'Wedding 5 cars' in txt,txt[:300])
        badge=await O.locator('[data-sec="sup"] em').first.inner_text() if await O.locator('[data-sec="sup"] em').count() else ''
        check('Support badge counts it',badge=='1',badge)
        await O.locator('[data-sp^="W"]').first.click();await pg.wait_for_timeout(300)
        await O.locator('#sn').fill('Called, 5 cars booked');await O.locator('#ss').click();await pg.wait_for_timeout(800)
        q=await pg.evaluate("MOCK.store.get('enquiries/q1')")
        check('"Called them" saves note + in progress on the enquiry',q['status']=='progress' and q['note']=='Called, 5 cars booked' and q['handledBy'],q)
        await O.locator('[data-sc^="W"]').first.click();await pg.wait_for_timeout(800)
        check('Close works',(await pg.evaluate("MOCK.store.get('enquiries/q1')"))['status']=='closed')
        check('support tickets still go to tickets (not mixed up)',await pg.evaluate("[...MOCK.store.keys()].filter(k=>k.startsWith('tickets/')).length")==0)
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
