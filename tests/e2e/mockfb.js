// In-memory stand-in for the subset of Firebase the apps use. Lives in the harness window; iframes share it.
(function(){
  const store=new Map(); const subs=[]; let seq=0; let t=Date.now();
  const TS=()=>{const v=++t;return {toMillis(){return v}}};
  const clone=o=>o==null?o:JSON.parse(JSON.stringify(o,(k,v)=>v&&typeof v.toMillis==='function'?{__ms:v.toMillis()}:v),(k,v)=>v&&v.__ms!=null?{toMillis(){return v.__ms}}:v);
  const resolve=(val,prev)=>{
    if(val&&val.__ts)return TS();
    if(val&&val.__inc!=null)return (+prev||0)+val.__inc;
    if(val&&typeof val==='object'&&!Array.isArray(val)&&typeof val.toMillis!=='function'){const o={};for(const k in val)o[k]=resolve(val[k],prev?prev[k]:undefined);return o}
    return val;
  };
  const docRef=(path)=>({type:'doc',path,id:path.split('/').pop()});
  const snapDoc=(path)=>{const d=store.get(path);return{id:path.split('/').pop(),exists:()=>store.has(path),data:()=>clone(d)}};
  const inColl=(path,coll)=>path.startsWith(coll+'/')&&path.split('/').length===coll.split('/').length+1;
  const runQuery=(q)=>{
    let rows=[...store.keys()].filter(p=>inColl(p,q.path)).map(p=>({p,d:store.get(p)}));
    (q.cons||[]).forEach(c=>{if(c.w){const[f,op,v]=c.w;const g=r=>r.d[f];rows=rows.filter(r=>op==='=='?g(r)===v:op==='>='?g(r)!=null&&g(r)>=v:op==='<'?g(r)!=null&&g(r)<v:op==='<='?g(r)!=null&&g(r)<=v:op==='>'?g(r)!=null&&g(r)>v:op==='!='?g(r)!==v:op==='in'?v.includes(g(r)):true)}});
    const o=(q.cons||[]).find(c=>c.o);if(o){const[f,dir]=o.o;rows=rows.filter(r=>r.d[f]!=null).sort((a,b)=>{const av=a.d[f]&&a.d[f].toMillis?a.d[f].toMillis():a.d[f],bv=b.d[f]&&b.d[f].toMillis?b.d[f].toMillis():b.d[f];return dir==='desc'?bv-av:av-bv})}
    const l=(q.cons||[]).find(c=>c.l);if(l)rows=rows.slice(0,l.l);
    return{docs:rows.map(r=>({id:r.p.split('/').pop(),data:()=>clone(r.d)}))};
  };
  const notify=()=>setTimeout(()=>subs.slice().forEach(s=>{try{s.fire()}catch(e){console.error('listener',e)}}),0);
  const DOTTED=1;const undot=(d,prev)=>{const o={};for(const k in d){if(k.includes('.')){const[a,b]=k.split('.');o[a]={...((prev||{})[a]||{}),...(o[a]||{}),[b]:d[k]}}else o[k]=d[k]}return o};
  const write=(path,data,merge)=>{const prev=store.get(path);data=undot(data,prev);store.set(path,merge&&prev?{...prev,...resolve(data,prev)}:resolve(data,prev||{}));};
  const fs={
    doc:(db,...seg)=>docRef(seg.join('/')),
    collection:(db,...seg)=>({type:'coll',path:seg.join('/')}),
    query:(c,...cons)=>({type:'query',path:c.path,cons}),
    where:(f,op,v)=>({w:[f,op,v]}),orderBy:(f,dir)=>({o:[f,dir||'asc']}),limit:n=>({l:n}),
    serverTimestamp:()=>({__ts:true}),increment:n=>({__inc:n}),
    async getDoc(r){return snapDoc(r.path)},
    async getDocs(q){return runQuery(q.type==='coll'?{path:q.path}:q)},
    async setDoc(r,d,o){write(r.path,d,o&&o.merge);notify()},
    async updateDoc(r,d){if(!store.has(r.path))throw{code:'not-found'};if(window.MOCK&&MOCK.denyUpdate&&MOCK.denyUpdate(r.path,d))throw{code:'permission-denied'};write(r.path,d,true);notify()},
    async addDoc(c,d){const id='d'+(++seq).toString(36)+Math.random().toString(36).slice(2,8);write(c.path+'/'+id,d,false);notify();return docRef(c.path+'/'+id)},
    async deleteDoc(r){store.delete(r.path);notify()},
    onSnapshot(target,cb,err){
      const s={fire:()=>cb(target.type==='doc'?snapDoc(target.path):runQuery(target.type==='coll'?{path:target.path}:target))};
      subs.push(s);setTimeout(s.fire,0);
      return ()=>{const i=subs.indexOf(s);if(i>=0)subs.splice(i,1)};
    },
    async runTransaction(db,fn){const q=[];const tx={get:async r=>snapDoc(r.path),update:(r,d)=>q.push(()=>{if(!store.has(r.path))throw{code:'not-found'};write(r.path,d,true)}),set:(r,d)=>q.push(()=>write(r.path,d,false))};
      const res=await fn(tx);q.forEach(f=>f());notify();return res},
    writeBatch(){const q=[];return{update:(r,d)=>q.push(()=>write(r.path,d,true)),set:(r,d,o)=>q.push(()=>write(r.path,d,o&&o.merge)),delete:r=>q.push(()=>store.delete(r.path)),async commit(){q.forEach(f=>f());notify()}}},
  };
  // network simulation for tests: MOCK.delay = ms added to every call; MOCK.down = true makes calls fail like no internet
  ['getDoc','getDocs','setDoc','updateDoc','addDoc','deleteDoc','runTransaction'].forEach(k=>{const f=fs[k];fs[k]=async(...a)=>{
    if(window.MOCK&&MOCK.delay)await new Promise(r=>setTimeout(r,MOCK.delay));if(window.MOCK&&MOCK.down)throw{code:'unavailable',message:'offline'};return f(...a)}});
  window.MOCK={store,fs,dump:()=>{const o={};store.forEach((v,k)=>o[k]=clone(v));return o}};
  window.makeApi=function(){
    let user=null,pending=null;const cbs=[];
    return{live:true,db:{},fs,toMs:v=>v&&typeof v.toMillis==='function'?v.toMillis():(typeof v==='number'?v:0),
      get user(){return user},get phone(){return user?user.phoneNumber:null},
      prepOtp(){window.PREP=(window.PREP||0)+1;return Promise.resolve()},
      async sendOtp(p){pending=p;window.SENT=(window.SENT||[]).concat([p]);return true},
      async verifyOtp(code){if(code!=='123456')throw{code:'auth/invalid-verification-code'};user={uid:'u'+pending,phoneNumber:'+91'+pending};cbs.forEach(c=>c(user));return user},
      waitUser(){return Promise.resolve(user)},onUser(cb){cbs.push(cb);return()=>{}},
      async googleLogin(){user={uid:'g123',phoneNumber:null,email:'priya@gmail.com',displayName:'Priya G'};cbs.forEach(c=>c(user));return user},
      async logout(){user=null},errText:(e)=>'ERR '+(e&&e.code||e),
      // web push: no real Firebase here; returns a fake device token and records which service worker was asked for
      nativePush() { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform() && /VCTPush/.test(navigator.userAgent)); },
        async nativePushToken() {
          if (!this.nativePush()) return null;
          try {
            const PN = window.Capacitor.registerPlugin('PushNotifications');
            let p = await PN.checkPermissions();
            if (p.receive !== 'granted') { p = await PN.requestPermissions(); if (p.receive !== 'granted') return null; }
            try { await PN.createChannel({ id: 'rides', name: 'Ride alerts', description: 'Ride and trip alerts', importance: 5, visibility: 1, vibration: true, lights: true }); } catch (e) { /* older Android */ }
            return await new Promise(res => {
              const tm = setTimeout(() => res(null), 15000);
              PN.addListener('registration', x => { clearTimeout(tm); res(x && x.value || null); });
              PN.addListener('registrationError', () => { clearTimeout(tm); res(null); });
              PN.register().catch(() => { clearTimeout(tm); res(null); });
            });
          } catch (e) { console.warn('native push', e); return null; }
        },
      async pushToken(v,sw,sc){if(!v)return null;(window.__pushReg=window.__pushReg||[]).push(sw+'|'+sc);return 'tok-'+(user&&user.uid||'x')},
      // same decisions as functions/index.js verifyPin
      async call(name,data){if(window.MOCK&&MOCK.down)throw{code:'functions/unavailable'};if(window.MOCK&&MOCK.fnDown)throw{code:'functions/internal'};
        if(name==='deleteMyAccount'){if(!user)throw{code:'functions/unauthenticated'};const ph=user.phoneNumber;
          if(ph&&store.get('drivers/'+ph)){store.set('deletionRequests/'+ph,{kind:'driver',phone:ph,uid:user.uid,status:'pending'});return{queued:true}}
          const mine=[...store.keys()].filter(k=>/^bookings\/[^/]+$/.test(k)&&store.get(k).customerUid===user.uid);
          if(mine.some(k=>['searching','assigned','ontrip','scheduled'].includes(store.get(k).status)))return{ok:false,why:'active'};
          mine.forEach(k=>{const b=store.get(k);delete b.custPhone;b.custName='Deleted user';b.custDeleted=true;store.set(k,b)});store.delete('users/'+user.uid);(window.__deleted=window.__deleted||[]).push(user.uid);return{ok:true,bookings:mine.length}}
        // same decisions as functions/index.js purgeDriver (owner only; refused on a ride; wallet needs force; backup copy first)
        if(name==='purgeDriver'){const me=user&&user.phoneNumber,st=me&&store.get('staff/'+me),{phone,confirm,force}=data||{};
          if(!st||st.role!=='owner')throw{code:'functions/permission-denied'};if(!/^\+91[6-9]\d{9}$/.test(String(phone||''))||String(confirm)!==String(phone).slice(-4))throw{code:'functions/invalid-argument'};
          const dr=store.get('drivers/'+phone);if(!dr&&!store.get('driverApps/'+phone))return{ok:false,why:'none'};
          if(dr&&(+dr.wallet||0)!==0&&force!==true)return{ok:false,why:'wallet',wallet:+dr.wallet};
          const bk=[...store.keys()].filter(k=>/^bookings\/[^/]+$/.test(k)&&store.get(k).driverPhone===phone);
          if(bk.some(k=>['assigned','arrived','ontrip'].includes(store.get(k).status)))return{ok:false,why:'active'};
          const keys=[...store.keys()].filter(k=>k==='drivers/'+phone||k==='live/'+phone||k.startsWith('driverApps/'+phone)||k==='deletionRequests/'+phone||bk.some(b=>k===b||k.startsWith(b+'/'))
            ||(/^(ledger|recharges)\/[^/]+$/.test(k)&&store.get(k).driverPhone===phone));
          window.__purgeBackup=keys.map(k=>({path:k,data:JSON.parse(JSON.stringify(store.get(k)))}));
          const n=c=>keys.filter(k=>k.split('/')[0]===c&&k.split('/').length===2).length,out={ok:true,trips:n('bookings'),ledger:n('ledger'),recharges:n('recharges'),docs:keys.filter(k=>k.startsWith('driverApps/'+phone+'/files/')).length,total:keys.length,backup:'b1'};
          keys.forEach(k=>store.delete(k));notify();return out}
        if(name!=='verifyPin')throw{code:'functions/not-found'};
        const ph=user&&user.phoneNumber,{bookingId,pin}=data||{};if(!ph||!bookingId||!/^\d{4}$/.test(String(pin)))throw{code:'functions/invalid-argument'};
        const b=store.get('bookings/'+bookingId);if(!b||b.driverPhone!==ph)throw{code:'functions/permission-denied'};
        if(b.status!=='assigned')return{ok:b.status==='ontrip'};
        if((b.pinFails||0)>=5)throw{code:'functions/resource-exhausted'};
        const pp=store.get('bookings/'+bookingId+'/private/pin');
        if(!pp||String(pp.pin)!==String(pin)){write('bookings/'+bookingId,{pinFails:(b.pinFails||0)+1},true);notify();return{ok:false}}
        write('bookings/'+bookingId,{status:'ontrip',startedAt:Date.now(),pinOk:true,updatedAt:Date.now()},true);notify();return{ok:true}}};
  };
})();
