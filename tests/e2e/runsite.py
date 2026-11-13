# Public website velloretaxi.app/vellore/ — the whole page with fake Google Maps / Routes and a fake Firebase:
# Office content + prices replace the built-in ones, photos, booking box (Google place search, road km, city and
# outstation fares = the app's prices, vehicle choice, link into the app), contact form, language, menu, phones, safety.
import asyncio, json, base64, re, os
R=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from playwright.async_api import async_playwright
U='http://localhost:8765/vellore/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
FAKE_CFG="export const firebaseConfig={projectId:'demo-site'};export const APPCHECK_SITE_KEY='';export const VCT_ENV='test';"
FAKE_APP="export function initializeApp(c,n){return{c,n}}"
FAKE_FS="""export function getFirestore(a){return{a}}
export function doc(db,...p){return{path:p.join('/')}}
export function collection(db,n){return{path:n}}
export function serverTimestamp(){return{__ts:1}}
export async function getDoc(r){const d=(window.__FS||{})[r.path];return{exists:()=>d!==undefined,data:()=>JSON.parse(JSON.stringify(d))}}
export async function addDoc(c,d){if(window.__FSFAIL)throw new Error('permission-denied');(window.__FSADD=window.__FSADD||[]).push({col:c.path,d});return{id:'e1'}}"""
FAKE_GM="""(function(){const q=new URLSearchParams(document.currentScript.src.split('?')[1]);
window.google={maps:{importLibrary:async()=>({AutocompleteSessionToken:function(){},AutocompleteSuggestion:{fetchAutocompleteSuggestions:async({input})=>({suggestions:[
  {placePrediction:{mainText:{text:'Green Circle'},secondaryText:{text:'Vellore, Tamil Nadu'},text:{text:'Green Circle'},toPlace:()=>({fetchFields:async()=>{},location:{lat:()=>12.9512,lng:()=>79.1361}})}}]})}}),
  Map:function(){this.fitBounds=()=>{}},Polyline:function(o){window.__poly=o;this.setMap=()=>{}},Marker:function(){this.setMap=()=>{}},LatLngBounds:function(){this.extend=()=>{}}}};
window[q.get('callback')]()})();"""
SITE={'phone':'9876543210','driverPhone':'9123456780','whatsapp':'9000000001','email':'hello@velloretaxi.app','address':'12 Officer Line, Vellore',
  'places':[{'id':'fort','ta':'கோட்டை','en':'The Fort','dta':'பழைய கோட்டை','den':'Old fort','img':1},
            {'id':'p9','ta':'<img src=x onerror=window.PWN=1>','en':'Lake<script>','dta':'','den':''},
            {'id':'bad id!','ta':'skip','en':'skip'}]}
PRICES={'fares':{'mini':{'base':99,'per':15},'sedan':{'base':120,'per':19}},'out':{'rate1':{'mini':16},'bata1':{'mini':300},'min1':80,'mind':250,'daykm':400,'rate':{'mini':11},'bata':{'mini':300}}}
JPG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
def road(route):
    b=json.loads(route.request.post_data); d=b['destination']['location']['latLng']
    far=d['longitude']>79.6 or d['longitude']<78.9
    km=124 if far else 6
    return route.fulfill(status=200,content_type='application/json',body=json.dumps({'routes':[{'distanceMeters':km*1000,'duration':f'{km*70}s','polyline':{'encodedPolyline':'_p~iF~ps|U_ulLnnqC'}}]}))
async def fakes(ctx,fs=True):
    await ctx.route('**/maps.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FAKE_GM))
    await ctx.route('**/routes.googleapis.com/**',road)
    if fs:
        await ctx.route('**/firebase-config.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FAKE_CFG))
        await ctx.route('**/firebasejs/**/firebase-app.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FAKE_APP))
        await ctx.route('**/firebasejs/**/firebase-firestore-lite.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body=FAKE_FS))
def link(href):
    m=re.match(r'^/#book=([A-Za-z0-9_-]+)$',href or '');s=m.group(1);s+='='*(-len(s)%4)
    return json.loads(base64.urlsafe_b64decode(s).decode())
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        # ---- 1. no database, no Google: built-in values, straight-line estimate
        ctx=await b.new_context(viewport={'width':1366,'height':900})
        await ctx.route('**/maps.googleapis.com/**',lambda r:r.abort())
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(U);await pg.wait_for_timeout(1500)
        check('English by default, 6 vehicles, Mini ₹105',await pg.evaluate("document.documentElement.dataset.l")=='en' and await pg.locator('#board .row').count()==6 and '₹105' in await pg.inner_text('#board'))
        check('6 places with built-in photos and a photo credit line, Chennai Airport example ₹2,280',await pg.locator('#plist .place img[src^="/vellore/places/"]').count()==6 and await pg.locator('.credit a').count()==6 and await pg.inner_text('#exAmt')=='2,280')
        await pg.click('#chips [data-pt=katpadi]');await pg.click('#chips [data-pt=cmc]');await pg.wait_for_timeout(1500)
        ri=await pg.inner_text('#rinfo')
        check('no Google: estimate marked approx., fares shown',('தோராயம்' in ri or 'approx' in ri) and await pg.locator('#vl label').count()==6,ri)
        check('no page errors (offline mode)',not errs,errs)
        await ctx.close()
        # ---- 2. with Office data + Google
        ctx=await b.new_context(viewport={'width':1366,'height':900});await fakes(ctx)
        await ctx.add_init_script(f"window.__FS={json.dumps({'public/site':SITE,'public/prices':PRICES,'siteImg/fort':{'data':JPG},'siteImg/p9':{'data':'javascript:alert(1)'}})}")
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(U);await pg.wait_for_timeout(3500)
        hrefs=await pg.evaluate("[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))")
        check('Office numbers replace the built-in ones (call, WhatsApp, driver, email)','tel:+919876543210' in hrefs and 'tel:+919123456780' in hrefs and any(h.startswith('https://wa.me/919000000001') for h in hrefs) and 'mailto:hello@velloretaxi.app' in hrefs)
        check('no old number left on the page',not any(h in ('tel:+917200730416','tel:+919944039933','tel:+919344039933') for h in hrefs))
        src=open(os.path.join(R,'vellore','index.html'),encoding='utf-8').read()+open(os.path.join(R,'vellore','site.js'),encoding='utf-8').read()
        check('built-in driver help number is 93440 39933 (99440 39933 was a mistake)','9944039933' not in src and '99440 39933' not in src and "driverPhone: '9344039933'" in src and 'tel:+919344039933' in src)
        ct=await pg.inner_text('#contact')
        check('numbers and address shown as text','98765 43210' in ct and '12 Officer Line, Vellore' in ct,ct[:200])
        check('Office prices: Mini ₹99 on the board',('₹99' in await pg.inner_text('#board')) and await pg.locator('[data-show=mini]').first.inner_text()=='99')
        check('places from Office (bad id skipped), photo shown',await pg.locator('#plist .place').count()==2 and await pg.locator('#plist .place img').count()==1 and 'The Fort' in await pg.inner_text('#plist'))
        check('place names are escaped, a bad photo is ignored',await pg.evaluate("!window.PWN") and await pg.locator('#plist script').count()==0 and await pg.locator('#plist .place').nth(1).locator('svg').count()==1)
        # Google place search
        await pg.click('#bf');await pg.type('#bf','green',delay=30);await pg.wait_for_timeout(1200)
        st=await pg.inner_text('#sgf')
        check('typing shows Google places',('Green Circle' in st),st)
        await pg.click('#sgf button:has-text("Green Circle")');await pg.wait_for_timeout(300)
        check('pickup chosen',await pg.input_value('#bf')=='Green Circle')
        await pg.click('#chips [data-pt=maa]');await pg.wait_for_timeout(1500)
        ri=await pg.inner_text('#rinfo')
        check('road km from Google: 124 km Outstation, not approx.','124' in ri and 'Outstation' in ri and 'தோராயம்' not in ri,ri)
        exp=await pg.evaluate("SITEQ.out('mini',124,'one',window.__vctSite.state().PRICES).total")
        vl=await pg.inner_text('#vl')
        check('Mini one way = the app/server price (₹2,280)',exp==2280 and '₹2,280' in vl,vl[:80])
        check('route drawn on the map',await pg.evaluate("!!window.__poly&&window.__poly.path.length>=2") and not await pg.locator('#bmap').get_attribute('hidden') is not None)
        await pg.click('#otype [data-o=round]');await pg.wait_for_timeout(200)
        rnd=await pg.evaluate("SITEQ.out('mini',124,'round',window.__vctSite.state().PRICES).total")
        check('round trip price',f'₹{rnd:,}' in await pg.inner_text('#vl'),rnd)
        await pg.click('#vl label:has-text("Sedan")');await pg.wait_for_timeout(200)
        x=link(await pg.get_attribute('#go','href'))
        check('Book link: places, Sedan, outstation, round trip',x['v']=='sedan' and x['k']=='out' and x['o']=='round' and x['f']['n']=='Green Circle' and abs(x['t']['lon']-80.1709)<1e-4,x)
        # city trip
        await pg.click('#st .clr');await pg.click('#chips [data-pt=cmc]');await pg.wait_for_timeout(1200)
        fare=await pg.evaluate("FARE.cityFare({base:99,per:15},6)")
        vl=await pg.inner_text('#vl');x=link(await pg.get_attribute('#go','href'))
        check('city trip: 6 km Mini = cityFare with Office prices, auto offered',f'₹{fare}' in vl and 'Auto' in vl and x['k']=='local',(fare,vl[:60]))
        await pg.click('#st .clr');await pg.click('#bt');await pg.type('#bt','green');await pg.wait_for_timeout(900);await pg.click('#sgt button:has-text("Green Circle")');await pg.wait_for_timeout(500)
        check('pickup = drop is refused',await pg.inner_text('#berr')!='' and not await pg.locator('#res.on').count())
        # popular trip buttons
        await pg.click('#dest [data-trip="newbus|tpt"]');await pg.wait_for_timeout(1200)
        x=link(await pg.get_attribute('#go','href'))
        check('popular trip button fills both places',x['f']['n'] in ('New Bus Stand','புதிய பேருந்து நிலையம்') and x['t']['n'] in ('Tirupati','திருப்பதி'),x)
        # contact form
        await pg.wait_for_timeout(2600)
        await pg.fill('#enq [name=name]','P');await pg.click('#esend');await pg.wait_for_timeout(200)
        check('form: short name refused',await pg.inner_text('#fmsg')!='' and not await pg.evaluate("window.__FSADD"))
        await pg.fill('#enq [name=name]','Priya');await pg.fill('#enq [name=phone]','12345');await pg.click('#esend');await pg.wait_for_timeout(200)
        check('form: bad number refused',not await pg.evaluate("window.__FSADD"))
        await pg.fill('#enq [name=phone]','+91 99446 40416');await pg.select_option('#enq [name=kind]','event');await pg.fill('#enq [name=msg]','Wedding 5 cars on 20 Nov');await pg.click('#esend');await pg.wait_for_timeout(800)
        add=await pg.evaluate("window.__FSADD")
        check('form: enquiry saved with exactly the allowed fields',add and add[0]['col']=='enquiries' and add[0]['d']=={'name':'Priya','phone':'9944640416','kind':'event','msg':'Wedding 5 cars on 20 Nov','status':'open','src':'web','createdAt':{'__ts':1}},add)
        check('form: thank-you shown, form cleared',('Thank you' in await pg.inner_text('#fmsg')) and await pg.input_value('#enq [name=name]')=='')
        await pg.evaluate("window.__FSFAIL=1");await pg.fill('#enq [name=name]','Ravi');await pg.fill('#enq [name=phone]','9944640416');await pg.click('#esend');await pg.wait_for_timeout(600)
        check('form: failure tells them to call the office number','98765 43210' in await pg.inner_text('#fmsg'))
        await pg.evaluate("window.__FSFAIL=0;window.__FSADD=[]");await pg.fill('#enq [name=website]','spam');await pg.click('#esend');await pg.wait_for_timeout(400)
        check('form: robots (hidden field) are not saved',await pg.evaluate("window.__FSADD.length")==0)
        # language
        await pg.click('#lang');await pg.wait_for_timeout(300)
        check('தமிழ் switch (places + booking text change)',await pg.locator('h1 .ta').is_visible() and 'கோட்டை' in await pg.inner_text('#plist'))
        await pg.reload();await pg.wait_for_timeout(1200)
        check('Tamil remembered',await pg.evaluate("document.documentElement.dataset.l")=='ta')
        ld=await pg.evaluate("JSON.parse(document.querySelector('script[type=\"application/ld+json\"]').textContent)")
        check('search data: TaxiService + FAQ',[g['@type'] for g in ld['@graph']]==['TaxiService','FAQPage'])
        check('no page errors',not errs,errs)
        await ctx.close()
        # ---- 3. phones
        for w in (360,390,768):
            ctx=await b.new_context(viewport={'width':w,'height':800});await fakes(ctx,fs=False);m=await ctx.new_page()
            await m.goto(U);await m.wait_for_timeout(700)
            await m.click('#chips [data-pt=katpadi]');await m.click('#chips [data-pt=maa]');await m.wait_for_timeout(900)
            check(f'{w}px: no sideways scroll with fares open',not await m.evaluate("document.documentElement.scrollWidth>innerWidth"))
            await m.locator('#book').scroll_into_view_if_needed();await m.wait_for_timeout(500)
            check(f'{w}px: call/WhatsApp buttons step aside over the booking box',await m.evaluate("document.querySelector('.fab').classList.contains('away')"))
            await m.locator('#faq').scroll_into_view_if_needed();await m.wait_for_timeout(500)
            check(f'{w}px: and come back further down',await m.evaluate("!document.querySelector('.fab').classList.contains('away')"))
            if w<900:
                vis=await m.locator('#menu').is_visible();await m.click('#burger');await m.wait_for_timeout(400)
                ok=await m.locator('#menu a[href="#contact"]').is_visible();await m.click('#menu a[href="#contact"]');await m.wait_for_timeout(600)
                check(f'{w}px: menu opens and closes after a tap',not vis and ok and not await m.locator('#menu a[href="#contact"]').is_visible())
            await ctx.close()
        # ---- 4. storage blocked
        ctx=await b.new_context();await ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
        q=await ctx.new_page();e2=[];q.on('pageerror',lambda e:e2.append(str(e)))
        await q.goto(U);await q.wait_for_timeout(600);await q.click('#lang')
        check('works with storage blocked',not e2 and await q.evaluate("document.documentElement.dataset.l")=='ta',e2)
        check('live notice shown, links to booking',await q.locator('#soon').is_visible() and await q.get_attribute('#soon','href')=='#book' and ('Now live' in (st:=await q.locator('#soon').inner_text()) or 'இப்போ வேலூரில்' in st))
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
