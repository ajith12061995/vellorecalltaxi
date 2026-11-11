# "Book" on the website opens the customer app as /#book=<base64 JSON>. After the customer signs in, the fare screen
# opens with the same pickup, drop and vehicle (city) or the outstation screen (one way / round trip). Bad or
# hostile links are ignored or cleaned (names can't inject HTML).
import asyncio, json, base64
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
def enc(x):return base64.urlsafe_b64encode(json.dumps(x,ensure_ascii=False).encode()).decode().rstrip('=')
KAT={'lat':12.9716,'lon':79.1376,'n':'காட்பாடி ஜங்ஷன்'};CMC={'lat':12.9246,'lon':79.1356,'n':'CMC Hospital'};MAA={'lat':12.9941,'lon':80.1709,'n':'Chennai Airport'}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        # a link opened before signing in is kept until the sign-in is done
        await cf.evaluate(f"history.replaceState(null,'','#book={enc({'f':KAT,'t':CMC,'v':'sedan','k':'local','o':'one'})}');BOOKLINK=readBookLink()")
        check('link read and removed from the address bar',await cf.evaluate("!!BOOKLINK&&!location.hash"))
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(2500)
        st=await cf.evaluate("({from:S.from,dest:S.dest,veh:S.veh,mode:S.mode,pick:P.pick&&P.pick.ta,drop:P.drop&&P.drop.en,lat:P.pick&&P.pick.lat,left:BOOKLINK})")
        check('after sign-in: fare screen with the website places and Sedan',st['from']=='pick' and st['dest']=='drop' and st['veh']=='sedan' and st['pick']=='காட்பாடி ஜங்ஷன்' and st['drop']=='CMC Hospital' and abs(st['lat']-12.9716)<1e-6 and st['left'] is None,st)
        txt=await C.locator('body').inner_text()
        check('the screen shows both places and a Book button','காட்பாடி ஜங்ஷன்' in txt and 'CMC Hospital' in txt and await C.locator('#bookb').count()==1,txt[:200])
        check('used once (not again on the next home screen)',await cf.evaluate("(home(),S.from==='home')"))
        # outstation, round trip
        await cf.evaluate(f"history.replaceState(null,'','#book={enc({'f':KAT,'t':MAA,'v':'suv','k':'out','o':'round'})}');BOOKLINK=readBookLink();home()");await pg.wait_for_timeout(1500)
        st=await cf.evaluate("({mode:S.mode,type:OS.type,veh:OS.veh,dest:P.drop.en})")
        check('outstation link → outstation screen, round trip, MPV',st=={'mode':'out','type':'round','veh':'suv','dest':'Chennai Airport'},st)
        # hostile name
        bad={'lat':12.93,'lon':79.14,'n':'<img src=x onerror="parent.PWN=1">CMC'}
        await cf.evaluate(f"history.replaceState(null,'','#book={enc({'f':bad,'t':CMC,'v':'mini<script>','k':'local'})}');BOOKLINK=readBookLink();home()");await pg.wait_for_timeout(1500)
        st=await cf.evaluate("({n:P.pick.ta,veh:S.veh})")
        check('HTML in a place name is removed, unknown vehicle ignored','<' not in st['n'] and '>' not in st['n'] and st['veh']!='mini<script>' and not await pg.evaluate("window.PWN"),st)
        # broken / impossible links are ignored
        for h in ['#book=abc','#book='+enc({'f':{'lat':0,'lon':0},'t':CMC}),'#book='+enc({'f':KAT}),'#book=%%%']:
            await cf.evaluate(f"history.replaceState(null,'',{json.dumps(h)});try{{sessionStorage.removeItem('vct-booklink')}}catch(e){{}};BOOKLINK=readBookLink()")
            check(f'ignored: {h[:22]}',await cf.evaluate("BOOKLINK===null"))
        check('normal home screen still works',await cf.evaluate("(home(),S.from==='home'&&!S.dest)"))
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
