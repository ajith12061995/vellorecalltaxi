# "Book" on the website opens the customer app as /#book=<base64 JSON>. The fare screen opens at once (even before
# signing in); after the customer signs in (asked on Book), the fare screen
# opens again with the same pickup, drop and vehicle (city) or the outstation screen (one way / round trip). Bad or
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
        await C.locator('#go').click();await pg.wait_for_timeout(1200)
        st=await cf.evaluate("({logged:S.logged,from:S.from,dest:S.dest,veh:S.veh,book:!!document.getElementById('bookb')})")
        check('guest (not signed in): the website trip opens right away with prices',st=={'logged':False,'from':'pick','dest':'drop','veh':'sedan','book':True},st)
        await C.locator('#bookb').click();await pg.wait_for_timeout(500)  # Book → sign in
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('body').evaluate("()=>{S.name='Priya';save();saveProfile({})}");await pg.wait_for_timeout(2500)
        st=await cf.evaluate("({from:S.from,dest:S.dest,veh:S.veh,mode:S.mode,pick:P.pick&&P.pick.ta,drop:P.drop&&P.drop.en,lat:P.pick&&P.pick.lat,left:BOOKLINK})")
        check('after sign-in: fare screen with the website places and Sedan',st['from']=='pick' and st['dest']=='drop' and st['veh']=='sedan' and st['pick']=='காட்பாடி ஜங்ஷன்' and st['drop']=='CMC Hospital' and abs(st['lat']-12.9716)<1e-6 and st['left'] is None,st)
        txt=await C.locator('body').inner_text()
        check('the screen shows both places and a Book button','காட்பாடி ஜங்ஷன்' in txt and 'CMC Hospital' in txt and await C.locator('#bookb').count()==1,txt[:200])
        check('used once (not again on the next home screen)',await cf.evaluate("(home(),S.from==='home')"))
        # outstation, round trip
        await cf.evaluate(f"history.replaceState(null,'','#book={enc({'f':KAT,'t':MAA,'v':'suv','k':'out','o':'round'})}');BOOKLINK=readBookLink();home()");await pg.wait_for_timeout(1500)
        st=await cf.evaluate("({mode:S.mode,type:OS.type,veh:OS.veh,dest:P.drop.en})")
        check('outstation link → outstation screen, round trip, MPV',st=={'mode':'out','type':'round','veh':'suv','dest':'Chennai Airport'},st)
        # pickup time and hourly rental from the website (26 Nov)
        w3=await cf.evaluate("Math.round((Date.now()+3*36e5)/9e5)*9e5")
        await cf.evaluate(f"history.replaceState(null,'','#book='+{json.dumps('')}+btoa(unescape(encodeURIComponent(JSON.stringify({{f:{json.dumps(KAT)},t:{json.dumps(CMC)},v:'sedan',k:'local',o:'one',w:{w3}}})))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));BOOKLINK=readBookLink();home()");await pg.wait_for_timeout(1200)
        st=await cf.evaluate("({when:S.when,mode:S.mode,veh:S.veh,txt:document.body.innerText.includes('Schedule')||document.body.innerText.includes('Schedule பண்ணு')})")
        check('city link with a time 3 h ahead → scheduled ride at that time',st['when']==w3 and st['mode']=='' and st['veh']=='sedan' and st['txt'],st)
        for lbl,dw in [('10 minutes ahead',10*60e3),('in the past',-36e5),('40 days ahead',40*864e5)]:
            await cf.evaluate(f"(()=>{{const x={{f:{json.dumps(KAT)},t:{json.dumps(CMC)},v:'mini',k:'local',o:'one',w:Date.now()+{dw}}};history.replaceState(null,'','#book='+btoa(unescape(encodeURIComponent(JSON.stringify(x)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));BOOKLINK=readBookLink();home()}})()");await pg.wait_for_timeout(900)
            check(f'time {lbl} → ride now (no schedule)',await cf.evaluate("S.when===null&&S.dest==='drop'"))
        w2=await cf.evaluate("Math.round((Date.now()+2*864e5)/9e5)*9e5")
        await cf.evaluate(f"(()=>{{const x={{f:{json.dumps(KAT)},t:{json.dumps(MAA)},v:'sedan',k:'out',o:'one',w:{w2}}};history.replaceState(null,'','#book='+btoa(unescape(encodeURIComponent(JSON.stringify(x)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));BOOKLINK=readBookLink();home()}})()");await pg.wait_for_timeout(1200)
        st=await cf.evaluate("({mode:S.mode,leave:OS.leave,type:OS.type})")
        check('outstation link with a time → leaving at that time',st['mode']=='out' and st['leave']==w2 and st['type']=='one',(st,w2))
        await cf.evaluate(f"(()=>{{const x={{f:{json.dumps(KAT)},v:'suv',k:'rent',h:6,w:{w3}}};history.replaceState(null,'','#book='+btoa(unescape(encodeURIComponent(JSON.stringify(x)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));BOOKLINK=readBookLink();home()}})()");await pg.wait_for_timeout(1200)
        st=await cf.evaluate("({mode:S.mode,pkg:PKG[RS.pkg].h,veh:RS.veh,when:RS.when,from:S.from,dest:S.dest,pick:P.pick.ta,fare:!!document.getElementById('bookb')})")
        check('rental link (pickup only) → rental screen: 6 hours, MPV, chosen time',st=={'mode':'rent','pkg':6,'veh':'suv','when':w3,'from':'pick','dest':None,'pick':'காட்பாடி ஜங்ஷன்','fare':True},st)
        await cf.evaluate(f"(()=>{{const x={{f:{json.dumps(KAT)},v:'sedan',k:'rent',h:7}};history.replaceState(null,'','#book='+btoa(unescape(encodeURIComponent(JSON.stringify(x)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));BOOKLINK=readBookLink();home()}})()");await pg.wait_for_timeout(1000)
        check('rental with an unknown package → the 4-hour package',await cf.evaluate("S.mode==='rent'&&PKG[RS.pkg].h===4&&RS.when===null"))
        await cf.evaluate("S.mode='';home()");await pg.wait_for_timeout(500)
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
