# Bug 9 Nov (owner's phone, Android app): outstation one-way showed ₹1,710 (built-in 11/km, min 80 km) while
# config/app had 16/km and min 350 km (desktop showed ₹5,900). Android WebView has no window.Notification, and the
# customer config handler read Notification.permission when native push is on, so it threw before applying
# outstation/rental prices, commission, server PIN, number privacy and dispatch settings.
import asyncio
from playwright.async_api import async_playwright
B='http://localhost:8765/tests/e2e/out/'
res=[]
def check(n,c,i=''):res.append(bool(c));print(('PASS ' if c else 'FAIL ')+n,i)
# Android WebView: native bridge with push, and no Web Notification API at all
FAKE="""(()=>{try{delete window.Notification}catch(e){};window.Notification=undefined;
 window.Capacitor={isNativePlatform:()=>true,nativePromise:(p,m,o)=>{if(p==='PushNotifications'&&m==='checkPermissions')return Promise.resolve({receive:'granted'});return Promise.resolve({})},
  nativeCallback:()=>'cb1',addListener:(p,e,cb)=>Promise.resolve({remove(){}})}})()"""
CFG={'comm':5,'minbal':100,'push':{'vapid':'BTESTKEY'},'serverPin':True,'privPhone':True,
     'fares':{'mini':{'base':105,'per':16}},
     'out':{'rate':{'mini':11,'sedan':12,'suv':16,'psuv':20,'trav':24},'rate1':{'mini':16,'sedan':17,'suv':19,'psuv':24,'trav':29},
            'bata':{'mini':300,'sedan':300,'suv':350,'psuv':400,'trav':500},'bata1':{'mini':300,'sedan':300,'suv':350,'psuv':400,'trav':500},
            'min1':350,'mind':250,'daykm':400}}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1900,'height':880},user_agent='Mozilla/5.0 (Linux; Android 14) VCTApp VCTPush')
        await ctx.add_init_script(FAKE)
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B+'harness_x.html');await pg.wait_for_timeout(2500)
        C=pg.frame_locator('#c');cf=pg.frame(url=B+'c2.html')
        check('test setup: no Notification API, native bridge present',await cf.evaluate("typeof window.Notification==='undefined'&&!!window.Capacitor&&NATIVEC()"))
        await C.locator('#go').click();await pg.wait_for_timeout(300)
        await C.locator('#ph').fill('9999900001');await C.locator('#go').click();await pg.wait_for_timeout(500)
        for i,d in enumerate('123456'):await C.locator(f'#o{i}').fill(d)
        await pg.wait_for_timeout(800);await C.locator('#nm').fill('Priya');await C.locator('#go').click();await pg.wait_for_timeout(1500)
        await pg.evaluate("c=>MOCK.fs.setDoc({path:'config/app'},c)",CFG);await pg.wait_for_timeout(1500)
        st=await cf.evaluate("({r1:ORATE1.mini,min1:OMIN1,comm:CFG.comm,pin:CFG.serverPin,priv:CFG.privPhone,mini:VEH.find(v=>v.id==='mini').base})")
        check('city fare applied (Mini base 105)',st['mini']==105,st)
        check('one-way price applied (16/km)',st['r1']==16,st)
        check('one-way minimum km applied (350)',st['min1']==350,st)
        check('commission, server PIN and number privacy applied',st['comm']==5 and st['pin'] and st['priv'],st)
        q=await cf.evaluate("(()=>{OS.type='one';return oQuote('mini',128).total})()")
        check('Vellore → Chennai 128 km one way, Mini = ₹5,900 (same as desktop)',q==5900,q)
        await pg.evaluate("MOCK.fs.updateDoc({path:'config/app'},{'out':Object.assign({},%s,{rate1:Object.assign({},%s,{mini:18})})})"%(str(CFG['out']).replace('True','true'),str(CFG['out']['rate1'])))
        await pg.wait_for_timeout(1200)
        q2=await cf.evaluate("(()=>{OS.type='one';return oQuote('mini',128).total})()")
        check('office changes one-way Mini to 18 → app shows ₹6,600 without restart',q2==6600,q2)
        check('no page errors',not errs,errs)
        await b.close()
asyncio.run(main())
print('RESULT','PASS' if all(res) else 'FAIL','%d/%d'%(sum(res),len(res)))
