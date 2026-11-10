/* VCT core · maps: Google / Leaflet / drawn map, routes, place search, reverse geocode
   Shared by the customer, driver and office apps. Plain script (globals), loaded before each app's main script.
   Uses page globals at run time only: S, L, P, ROADS, CL, F, toast, modal, c(), mapLoop. */
const AREAS=[
  {ta:'காட்பாடி',en:'Katpadi',lat:12.9690,lon:79.1440},{ta:'காந்தி நகர்',en:'Gandhi Nagar',lat:12.9550,lon:79.1390},
  {ta:'பிரம்மபுரம்',en:'Brahmapuram',lat:12.9850,lon:79.1450},{ta:'விருதம்பட்டு',en:'Viruthampet',lat:12.9480,lon:79.1220},
  {ta:'சத்துவாச்சாரி',en:'Sathuvachari',lat:12.9370,lon:79.1640},{ta:'தோட்டப்பாளையம்',en:'Thottapalayam',lat:12.9265,lon:79.1420},
  {ta:'கொசப்பேட்டை',en:'Kosapet',lat:12.9300,lon:79.1250},{ta:'வேலூர் டவுன்',en:'Vellore Town',lat:12.9220,lon:79.1330},
  {ta:'சாய்நாதபுரம்',en:'Sainathapuram',lat:12.9150,lon:79.1440},{ta:'அல்லாபுரம்',en:'Allapuram',lat:12.9050,lon:79.1350},
  {ta:'பாகாயம்',en:'Bagayam',lat:12.8890,lon:79.1350},{ta:'திருமலைக்கோடி',en:'Thirumalaikodi',lat:12.8730,lon:79.0920}
];
const COS=Math.cos(12.94*Math.PI/180);
const RIVER=[[79.04,12.9440],[79.08,12.9475],[79.11,12.9452],[79.135,12.9468],[79.16,12.9490],[79.19,12.9462],[79.23,12.9478]];
const hsh=(a,b)=>{let h=(Math.imul(a,374761393)+Math.imul(b,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295};
const CELL=.0011,LX=i=>i*CELL+(hsh(i,7)-.5)*CELL*.35,LY=j=>j*CELL*.9+(hsh(j,11)-.5)*CELL*.3;
const WB=(()=>{let sd=7;const r=()=>(sd=(sd*9301+49297)%233280)/233280;const a=[];for(let i=0;i<220;i++)a.push([79.06+r()*.14,12.86+r()*.14,.002+r()*.005,.0015+r()*.004]);return a})();
const ramp=(v,a,b)=>Math.max(0,Math.min(1,(v-a)/(b-a)));

function makeCanvasMap(cv,o={}){
  const ctx=cv.getContext('2d'),dpr=Math.min(2,window.devicePixelRatio||1);
  const cam={lat:P.home.lat,lon:P.home.lon,s:20000},MIN=2500,MAX=700000;
  const clamp=s=>Math.max(MIN,Math.min(MAX,s));
  let W=0,H=0,anim=null,wheelT=0;
  const X=lon=>W/2+(lon-cam.lon)*cam.s*COS,Y=lat=>H/2+(cam.lat-lat)*cam.s;
  const toLL=(x,y)=>({lon:cam.lon+(x-W/2)/(cam.s*COS),lat:cam.lat-(y-H/2)/cam.s});
  function size(){const r=cv.getBoundingClientRect();W=r.width;H=r.height;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
  const end=()=>o.onEnd&&o.onEnd({lat:cam.lat,lon:cam.lon});
  const pan=(dx,dy)=>{cam.lon-=dx/(cam.s*COS);cam.lat+=dy/cam.s};
  function zoomAt(x,y,f){const ll=toLL(x,y);cam.s=clamp(cam.s*f);cam.lon=ll.lon-(x-W/2)/(cam.s*COS);cam.lat=ll.lat+(y-H/2)/cam.s}
  function flyTo(lat,lon,s,ms=550){const a={...cam},b={lat,lon,s:clamp(s)},t0=performance.now();o.onStart&&o.onStart();
    anim=now=>{let k=Math.min(1,(now-t0)/ms);k=1-Math.pow(1-k,3);cam.lat=a.lat+(b.lat-a.lat)*k;cam.lon=a.lon+(b.lon-a.lon)*k;cam.s=a.s*Math.pow(b.s/a.s,k);if(k>=1){anim=null;end()}}}
  function zoomAtAnim(x,y,f){const ll=toLL(x,y),s2=clamp(cam.s*f);flyTo(ll.lat+(y-H/2)/s2,ll.lon-(x-W/2)/(s2*COS),s2,320)}
  function fit(pts,pad=40,top=0){if(!W)size();const la=pts.map(p=>p.lat),lo=pts.map(p=>p.lon);
    const dLa=Math.max(.004,Math.max(...la)-Math.min(...la)),dLo=Math.max(.004,Math.max(...lo)-Math.min(...lo));
    cam.s=clamp(Math.min((W-pad*2)/(dLo*COS),(H-pad*2-top)/dLa));
    cam.lat=(Math.max(...la)+Math.min(...la))/2+top/2/cam.s;cam.lon=(Math.max(...lo)+Math.min(...lo))/2}

  /* gestures */
  const pts=new Map();let moved=false,lastT=0,vx=0,vy=0,lastTap=0,down=null;
  const pos=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  const cen=()=>{let x=0,y=0;pts.forEach(p=>{x+=p.x;y+=p.y});return{x:x/pts.size,y:y/pts.size}};
  const spr=c=>{let d=0;pts.forEach(p=>{d+=Math.hypot(p.x-c.x,p.y-c.y)});return d/pts.size};
  cv.addEventListener('pointerdown',e=>{e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(_){}
    pts.set(e.pointerId,pos(e));anim=null;if(pts.size===1){moved=false;vx=vy=0;lastT=performance.now();down=pos(e);o.onStart&&o.onStart()}else moved=true});
  cv.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;
    const c0=cen(),s0=spr(c0);pts.set(e.pointerId,pos(e));const c1=cen(),s1=spr(c1);
    const dx=c1.x-c0.x,dy=c1.y-c0.y;pan(dx,dy);if(pts.size>1&&s0>4)zoomAt(c1.x,c1.y,s1/s0);
    const now=performance.now(),dt=Math.max(1,now-lastT);vx=.6*vx+.4*dx/dt;vy=.6*vy+.4*dy/dt;lastT=now;
    if(down&&Math.hypot(c1.x-down.x,c1.y-down.y)>5)moved=true});
  const up=e=>{if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);if(pts.size){vx=vy=0;return}
    const now=performance.now();
    if(!moved){if(now-lastTap<320){const p=pos(e);lastTap=0;zoomAtAnim(p.x,p.y,2.4);return}lastTap=now;end();return}
    if(now-lastT>90)vx=vy=0;
    if(Math.hypot(vx,vy)>.25){let t0=now;anim=n=>{const dt=n-t0;t0=n;pan(vx*dt,vy*dt);const d=Math.pow(.9,dt/16);vx*=d;vy*=d;if(Math.hypot(vx,vy)<.02){anim=null;end()}}}
    else end()};
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{e.preventDefault();const p=pos(e);if(!wheelT&&o.onStart)o.onStart();anim=null;
    zoomAt(p.x,p.y,Math.exp(-e.deltaY*(e.ctrlKey?.01:.0018)));clearTimeout(wheelT);wheelT=setTimeout(()=>{wheelT=0;end()},220)},{passive:false});

  /* drawing */
  const cars=Array.from({length:6},(_,i)=>({e:ROADS[(i*3)%ROADS.length],t:hsh(i,3),s:.0012+hsh(i,5)*.0018,k:['auto','bike','car','suv'][i%4]}));
  function frame(ts){
    if(!document.body.contains(cv))return;
    const r=cv.getBoundingClientRect();if(r.width!==W||r.height!==H)size();
    if(anim)anim(ts);
    const css=getComputedStyle(document.documentElement),c=n=>css.getPropertyValue(n).trim();
    ctx.fillStyle=c('--map-land');ctx.fillRect(0,0,W,H);
    const tl=toLL(0,0),br=toLL(W,H);
    // neighbourhood blocks (far view)
    const aBlk=1-ramp(cam.s,60000,120000);
    if(aBlk>0){ctx.globalAlpha=aBlk;ctx.fillStyle=c('--map-block');WB.forEach(b=>{const x=X(b[0]),y=Y(b[1]+b[3]),w=b[2]*cam.s*COS,h=b[3]*cam.s;if(x>W||y>H||x+w<0||y+h<0)return;ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(8,w/4));ctx.fill()});ctx.globalAlpha=1}
    // streets + buildings (close view)
    const aSt=ramp(cam.s,16000,32000),aBd=ramp(cam.s,55000,110000);
    const i0=Math.floor(tl.lon/CELL)-1,i1=Math.ceil(br.lon/CELL)+1,j0=Math.floor(br.lat/(CELL*.9))-1,j1=Math.ceil(tl.lat/(CELL*.9))+1;
    if(aSt>0&&(i1-i0)*(j1-j0)<4000){
      const sw=Math.max(2,cam.s*.00007);
      if(aBd>0){ctx.globalAlpha=aBd;ctx.fillStyle=c('--map-bldg');
        for(let i=i0;i<i1;i++)for(let j=j0;j<j1;j++){const x0=X(LX(i)),x1=X(LX(i+1)),y0=Y(LY(j+1)),y1=Y(LY(j));const m=sw/2+3,cw=(x1-x0-2*m)/3,ch=(y1-y0-2*m)/2;
          for(let a=0;a<3;a++)for(let b=0;b<2;b++){const h=hsh(i*7+a,j*13+b);if(h<.16)continue;const g=2+h*3;ctx.beginPath();ctx.roundRect(x0+m+a*cw+g,y0+m+b*ch+g,cw-2*g,ch-2*g,2);ctx.fill()}}
        ctx.globalAlpha=1}
      ctx.globalAlpha=aSt;ctx.strokeStyle=c('--map-road');ctx.lineWidth=sw;ctx.beginPath();
      for(let i=i0;i<=i1;i++){const x=X(LX(i));ctx.moveTo(x,0);ctx.lineTo(x,H)}
      for(let j=j0;j<=j1;j++){const y=Y(LY(j));ctx.moveTo(0,y);ctx.lineTo(W,y)}
      ctx.stroke();ctx.globalAlpha=1}
    // Palar river
    ctx.strokeStyle=c('--map-river');ctx.lineWidth=Math.max(10,cam.s*.0016);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    RIVER.forEach(([lo,la],i)=>i?ctx.lineTo(X(lo),Y(la)):ctx.moveTo(X(lo),Y(la)));ctx.stroke();
    const rl=RIVER.find(([lo])=>X(lo)>20)||RIVER[0];
    ctx.fillStyle=c('--map-label');ctx.font='italic 600 11px Hind Madurai, sans-serif';ctx.fillText(S.lang==='ta'?'பாலாறு':'Palar River',Math.max(8,X(rl[0])),Y(rl[1])-Math.max(8,cam.s*.0009));
    // main roads
    const rw=Math.min(30,Math.max(7,cam.s*.00012));
    [[c('--map-edge'),rw+4],[c('--map-road'),rw]].forEach(([col,w])=>{ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();ROADS.forEach(([a,b])=>{ctx.moveTo(X(P[a].lon),Y(P[a].lat));ctx.lineTo(X(P[b].lon),Y(P[b].lat))});ctx.stroke()});
    // route
    const path=o.path;
    const LP=o.line?o.line():(path&&path.length>1?path.map(k=>P[k]):null);
    if(LP&&LP.length>1){ctx.strokeStyle=c('--navy');ctx.lineWidth=Math.max(6,rw*.6);ctx.beginPath();LP.forEach((p,i)=>i?ctx.lineTo(X(p.lon),Y(p.lat)):ctx.moveTo(X(p.lon),Y(p.lat)));ctx.stroke();
      ctx.setLineDash([2,10]);ctx.strokeStyle='#FFC21A';ctx.lineWidth=3;ctx.lineDashOffset=-(ts/40%12);ctx.stroke();ctx.setLineDash([])}
    // vehicles
    if(o.cars)cars.forEach(v=>{v.t+=v.s;if(v.t>1){v.t=0;v.e=ROADS[Math.floor(Math.random()*ROADS.length)]}const a=P[v.e[0]],b=P[v.e[1]];
      const ax=X(a.lon),ay=Y(a.lat),bx=X(b.lon),by=Y(b.lat),x=ax+(bx-ax)*v.t,y=ay+(by-ay)*v.t;
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(by-ay,bx-ax));ctx.fillStyle='#0B4A36';ctx.beginPath();ctx.roundRect(-9,-6,18,12,4);ctx.fill();ctx.fillStyle='#FFC21A';ctx.beginPath();ctx.roundRect(-6,-4,v.k==='bike'?6:12,8,2);ctx.fill();ctx.restore()});
    // places
    Object.keys(P).forEach(k=>{if((o.hide||[]).includes(k))return;if(CUSTOM.includes(k)&&!(path&&path.includes(k))&&!o.hide)return;
      const p=P[k],x=X(p.lon),y=Y(p.lat);if(x<-60||x>W+60||y<-40||y>H+40)return;
      const isDest=path&&k===path[path.length-1],isFrom=path&&k===path[0],isHome=k==='home';
      if(isHome&&!isFrom&&!isDest){const pulse=(ts/1200)%1;ctx.fillStyle=`rgba(44,81,150,${.35*(1-pulse)})`;ctx.beginPath();ctx.arc(x,y,10+pulse*18,0,7);ctx.fill();
        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,9,0,7);ctx.fill();ctx.fillStyle='#2C5196';ctx.beginPath();ctx.arc(x,y,6,0,7);ctx.fill()}
      else if(isDest||isFrom){ctx.fillStyle=isFrom?'#1E8A5A':'#0B4A36';ctx.beginPath();ctx.arc(x,y-18,11,0,7);ctx.fill();ctx.beginPath();ctx.moveTo(x-7,y-12);ctx.lineTo(x,y);ctx.lineTo(x+7,y-12);ctx.fill();ctx.fillStyle='#FFC21A';ctx.beginPath();ctx.arc(x,y-18,5,0,7);ctx.fill()}
      else{ctx.fillStyle=c('--surface');ctx.strokeStyle=c('--map-label');ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,4,0,7);ctx.fill();ctx.stroke()}
      const big=isDest||isFrom||isHome;ctx.font=(big?'700 12.5px ':'600 11px ')+'Hind Madurai, sans-serif';const lb=p[S.lang];const tw=ctx.measureText(lb).width;
      const lx=Math.min(Math.max(x+10,6),W-tw-10),ly=(isDest||isFrom)?y-34:y-8;
      ctx.fillStyle=c('--surface');ctx.globalAlpha=.88;ctx.beginPath();ctx.roundRect(lx-4,ly-12,tw+8,17,5);ctx.fill();ctx.globalAlpha=1;
      ctx.fillStyle=big?c('--fg'):c('--map-label');ctx.fillText(lb,lx,ly)});
    (o.pins||[]).forEach(q=>{const x=X(q.lon),y=Y(q.lat);ctx.fillStyle=q.col;ctx.beginPath();ctx.arc(x,y-18,11,0,7);ctx.fill();ctx.beginPath();ctx.moveTo(x-7,y-12);ctx.lineTo(x,y);ctx.lineTo(x+7,y-12);ctx.fill();ctx.fillStyle='#FFC21A';ctx.beginPath();ctx.arc(x,y-18,5,0,7);ctx.fill()});
    if(o.fleet)o.fleet().forEach(f=>{const x=X(f.lon),y=Y(f.lat);if(x<-20||x>W+20||y<-20||y>H+20)return;
      ctx.fillStyle='rgba(19,40,79,.25)';ctx.beginPath();ctx.arc(x,y+2,12,0,7);ctx.fill();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,12,0,7);ctx.fill();ctx.fillStyle=f.col;ctx.beginPath();ctx.arc(x,y,9.5,0,7);ctx.fill();
      ctx.fillStyle=f.col==='#F2A900'?'#0B4A36':'#fff';ctx.font='800 11px Hind Madurai, sans-serif';ctx.textAlign='center';ctx.fillText(f.tag,x,y+4);ctx.textAlign='left';
      if(cam.s>30000){ctx.font='700 10.5px Hind Madurai, sans-serif';const tw=ctx.measureText(f.label).width;ctx.fillStyle=c('--surface');ctx.globalAlpha=.92;ctx.beginPath();ctx.roundRect(x+14,y-8,tw+8,16,4);ctx.fill();ctx.globalAlpha=1;ctx.fillStyle=c('--fg');ctx.fillText(f.label,x+18,y+4)}});
    // live driver
    if(o.driver){const d=o.driver();if(d){const x=X(d.lon),y=Y(d.lat),ang=Math.atan2(Y(d.nlat)-y,X(d.nlon)-x)||0;const pl=(ts/900)%1;
      ctx.fillStyle=`rgba(30,58,110,${.25*(1-pl)})`;ctx.beginPath();ctx.arc(x,y,16+pl*16,0,7);ctx.fill();
      ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(-16,-11,32,22,8);ctx.fill();
      ctx.fillStyle='#0B4A36';ctx.beginPath();ctx.roundRect(-14,-9,28,18,6);ctx.fill();ctx.fillStyle='#FFC21A';ctx.beginPath();ctx.roundRect(-3,-6,11,12,3);ctx.fill();ctx.restore()}}
    // scale bar
    if(o.scale){const mpp=111320/cam.s;const nice=[5,10,20,50,100,200,500,1000,2000,5000].find(v=>v/mpp>=70)||5000;const px=nice/mpp,sx=16,sy=H-42;
      ctx.fillStyle=c('--surface');ctx.globalAlpha=.9;ctx.beginPath();ctx.roundRect(sx-6,sy-18,px+12,28,8);ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle=c('--fg');ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,sy-4);ctx.lineTo(sx,sy+2);ctx.lineTo(sx+px,sy+2);ctx.lineTo(sx+px,sy-4);ctx.stroke();
      ctx.fillStyle=c('--fg');ctx.font='700 11px Hind Madurai, sans-serif';ctx.fillText(nice>=1000?nice/1000+' '+T[S.lang].km:nice+' '+T[S.lang].m,sx+2,sy-7)}
    mapLoop=requestAnimationFrame(frame);
  }
  size();mapLoop=requestAnimationFrame(frame);
  return{cam,fit,flyTo,zoomBy:f=>flyTo(cam.lat,cam.lon,cam.s*f,300),setView:(lat,lon,s)=>{cam.lat=lat;cam.lon=lon;cam.s=clamp(s)},center:()=>({lat:cam.lat,lon:cam.lon})};
}



/* ---------- real map on the live site: Leaflet + OpenStreetMap (drawn map stays as the offline / preview fallback) ---------- */
const MAPCFG={
  tiles:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attr:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a>',
  search:'https://photon.komoot.io/api/',
  reverse:'https://nominatim.openstreetmap.org/reverse',
  route:'https://router.project-osrm.org/route/v1/driving/'
};
const LF=window.L&&window.L.map?window.L:null;
// (the customer app loads Google Maps in the background: window.MAPS_READY; driver / office load it before this file)
const REALMAP=(!!LF||!!(window.GMAPS_KEY&&((window.google&&window.google.maps)||window.MAPS_READY)))&&/^https?:/.test(location.protocol);
const zFromS=s=>Math.max(3,Math.min(19,Math.log2(s*360/256)));
const sFromZ=z=>256*Math.pow(2,z)/360;
function makeMap(cv,o={}){return GMAP()?makeGoogleMap(cv,o):(LF&&REALMAP)?makeLeafletMap(cv,o):makeCanvasMap(cv,o)}
/* top-view vehicle markers for the live map */
const TOPI={car:`<ellipse cx="12" cy="23" rx="11" ry="20" fill="#000" opacity=".2"/><path d="M5 4 Q12 0 19 4 Q22 6 22 12 L22 36 Q22 42 16 42 L8 42 Q2 42 2 36 L2 12 Q2 6 5 4 Z" fill="#FFFFFF" stroke="#9aa7a0" stroke-width=".8"/><path d="M5 12 Q12 9 19 12 L18 17 Q12 15 6 17 Z" fill="#2b3a44"/><rect x="5.5" y="17" width="13" height="15" rx="2" fill="#0B4A36"/><rect x="9" y="22" width="6" height="4" rx="1" fill="#FFC21A"/><path d="M6 32 Q12 34 18 32 L18 36 Q12 37 6 36 Z" fill="#2b3a44"/><rect x="3" y="4.5" width="4" height="2" rx="1" fill="#FFF7C2"/><rect x="17" y="4.5" width="4" height="2" rx="1" fill="#FFF7C2"/>`,auto:`<ellipse cx="13" cy="19" rx="11" ry="16" fill="#000" opacity=".18"/><path d="M13 2 L22 9 L22 31 Q22 34 19 34 L7 34 Q4 34 4 31 L4 9 Z" fill="#FFC21A" stroke="#8a6a00" stroke-width=".8"/><rect x="5.5" y="12" width="15" height="18" rx="3" fill="#0B4A36"/><path d="M8 8 L18 8 L20 11 L6 11 Z" fill="#2b3a44"/>`,bike:`<ellipse cx="8" cy="19" rx="6" ry="16" fill="#000" opacity=".18"/><rect x="6" y="2" width="4" height="9" rx="2" fill="#20262A"/><rect x="6" y="25" width="4" height="9" rx="2" fill="#20262A"/><rect x="3.5" y="9" width="9" height="17" rx="4" fill="#FFFFFF" stroke="#9aa7a0" stroke-width=".7"/><rect x="1" y="9" width="14" height="2" rx="1" fill="#20262A"/><rect x="5" y="14" width="6" height="8" rx="3" fill="#0B4A36"/>`};
const TOPS={car:[24,44],auto:[26,36],bike:[16,36]};
function topSvg(k,rot,sz){const w=TOPS[k][0],h=TOPS[k][1];return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz||48}" height="${sz||48}" viewBox="0 0 48 48"><g transform="rotate(${Math.round(rot||0)} 24 24) translate(${24-w/2} ${24-h/2})">${TOPI[k]}</g></svg>`}
const topKind=v=>v==='auto'?'auto':v==='bike'?'bike':'car';
function topIcon(k,rot,sz){sz=sz||48;return gIcon(topSvg(k,rot,sz),sz,sz,sz/2,sz/2)}
function makeLeafletMap(cv,o={}){
  const host=document.createElement('div');host.className='map lmap';cv.replaceWith(host);
  const m=LF.map(host,{zoomControl:false,zoomSnap:.25,attributionControl:true}).setView([P.home.lat,P.home.lon],14);
  m.attributionControl.setPrefix(false);
  LF.tileLayer(MAPCFG.tiles,{maxZoom:19,attribution:MAPCFG.attr}).addTo(m);
  if(o.scale)LF.control.scale({imperial:false,position:'bottomleft'}).addTo(m);
  const ic=(html,w,h,ax,ay)=>LF.divIcon({className:'lmk',html,iconSize:[w,h],iconAnchor:[ax,ay]});
  const pinI=col=>ic(`<svg class="lpin" width="30" height="40" viewBox="0 0 46 60"><path d="M23 58C23 58 4 36 4 22a19 19 0 0138 0c0 14-19 36-19 36z" fill="${col}" stroke="#fff" stroke-width="3"/><circle cx="23" cy="22" r="8" fill="#FFC21A"/></svg>`,30,40,15,39);
  const pins=[];let me=null,acc=null,drv=null,ln=null,ln2=null;const fleet={},near={};
  const userMoved={v:false};
  m.on('movestart',e=>{o.onStart&&o.onStart()});
  m.on('moveend',()=>{if(!alive())return;const c=m.getCenter();o.onEnd&&o.onEnd({lat:c.lat,lon:c.lng})});
  function setPins(list){
    while(pins.length>list.length)m.removeLayer(pins.pop());
    list.forEach((p,i)=>{if(!pins[i]){pins[i]=LF.marker([p.lat,p.lon],{icon:pinI(p.col),interactive:false,keyboard:false}).addTo(m);pins[i]._col=p.col}
      else{pins[i].setLatLng([p.lat,p.lon]);if(pins[i]._col!==p.col){pins[i].setIcon(pinI(p.col));pins[i]._col=p.col}}});
  }
  function sync(){
    if(!alive()){clearInterval(tk);try{m.off();m.stop();m.remove()}catch(e){}return}
    const list=(o.pins||[]).slice();
    if(o.path&&o.path.length){const a=P[o.path[0]],b=P[o.path[o.path.length-1]];if(a)list.push({lat:a.lat,lon:a.lon,col:'#1E8A5A'});if(b&&o.path.length>1)list.push({lat:b.lat,lon:b.lon,col:'#121212'})}
    setPins(list.filter(p=>p&&p.lat!=null));
    if(!o.driver&&!o.fleet&&P.home){if(!me)me=LF.marker([P.home.lat,P.home.lon],{icon:ic('<i class="lme"></i>',18,18,9,9),interactive:false,keyboard:false}).addTo(m);else me.setLatLng([P.home.lat,P.home.lon]);
      if(P.home.acc){if(!acc)acc=LF.circle([P.home.lat,P.home.lon],{radius:P.home.acc,stroke:false,fillColor:'#2C5196',fillOpacity:.14,interactive:false}).addTo(m);else{acc.setLatLng([P.home.lat,P.home.lon]);acc.setRadius(P.home.acc)}}}
    const lc=o.line?o.line():(o.path&&o.path.length>1?o.path.map(k=>P[k]).filter(Boolean):null);
    if(lc&&lc.length>1){const ll=lc.map(p=>[p.lat,p.lon]);if(!ln){ln=LF.polyline(ll,{color:'#12664A',weight:6,opacity:.9}).addTo(m);ln2=LF.polyline(ll,{color:'#FFC21A',weight:2.5,dashArray:'2 9'}).addTo(m)}else{ln.setLatLngs(ll);ln2.setLatLngs(ll)}}
    else if(ln){m.removeLayer(ln);m.removeLayer(ln2);ln=ln2=null}
    const d=o.driver?o.driver():null;
    if(d&&d.lat!=null){const ang=d.nlat!=null?Math.atan2(-(d.nlat-d.lat),(d.nlon-d.lon)*Math.cos(d.lat*Math.PI/180))*180/Math.PI:0;
      if(!drv)drv=LF.marker([d.lat,d.lon],{icon:ic('<div class="lcar2">'+topSvg('car',0)+'</div>',48,48,24,24),interactive:false,keyboard:false,zIndexOffset:500}).addTo(m);else drv.setLatLng([d.lat,d.lon]);
      const el=drv.getElement();if(el&&el.firstChild)el.firstChild.style.transform=`rotate(${d.nlat!=null&&(d.nlat!==d.lat||d.nlon!==d.lon)?bearing(d,{lat:d.nlat,lon:d.nlon}):0}deg)`}
    else if(drv){m.removeLayer(drv);drv=null}
    if(o.fleet){const seen={};o.fleet().forEach(f=>{const k=f.label+f.tag;seen[k]=1;
        const html=`<span class="lfleet" style="background:${f.col};color:${f.col==='#F2A900'?'#0B4A36':'#fff'}">${f.tag}<b>${f.label}</b></span>`;
        if(!fleet[k]){fleet[k]=LF.marker([f.lat,f.lon],{icon:ic(html,26,26,13,13),keyboard:false}).addTo(m);fleet[k]._h=html}
        else{fleet[k].setLatLng([f.lat,f.lon]);if(fleet[k]._h!==html){fleet[k].setIcon(ic(html,26,26,13,13));fleet[k]._h=html}}});
      Object.keys(fleet).forEach(k=>{if(!seen[k]){m.removeLayer(fleet[k]);delete fleet[k]}})}
    if(o.near){const seen={};o.near().forEach(c=>{seen[c.id]=1;if(!near[c.id]){near[c.id]=LF.marker([c.lat,c.lon],{icon:ic('<div class="lcar2" style="transform:rotate('+c.rot+'deg)">'+topSvg(topKind(c.veh),0,40)+'</div>',40,40,20,20),interactive:false,keyboard:false}).addTo(m)}else near[c.id].setLatLng([c.lat,c.lon])});
      Object.keys(near).forEach(k=>{if(!seen[k]){m.removeLayer(near[k]);delete near[k]}})}
  }
  const alive=()=>document.body.contains(host);
  const tk=setInterval(sync,500);setTimeout(()=>{if(alive()){m.invalidateSize();sync()}},60);
  const api={
    cam:{get s(){return sFromZ(m.getZoom())},get lat(){return m.getCenter().lat},get lon(){return m.getCenter().lng}},
    fit(pts,pad=40,top=0){pts=(pts||[]).filter(p=>p&&p.lat!=null);if(!pts.length)return;if(pts.length===1){m.setView([pts[0].lat,pts[0].lon],16);return}
      setTimeout(()=>{if(!alive())return;m.invalidateSize();m.fitBounds(LF.latLngBounds(pts.map(p=>[p.lat,p.lon])),{paddingTopLeft:[pad,pad+top],paddingBottomRight:[pad,pad+24],maxZoom:17})},70)},
    flyTo(lat,lon,s){if(alive())m.flyTo([lat,lon],zFromS(s),{duration:.6})},
    zoomBy(f){if(alive())m.setZoom(m.getZoom()+Math.log2(f))},
    setView(lat,lon,s){if(alive())m.setView([lat,lon],zFromS(s),{animate:false})},
    center(){const c=m.getCenter();return{lat:c.lat,lon:c.lng}},
    leaflet:m
  };
  return api;
}

/* real road distance (OSRM), cached; falls back to straight-line estimate */
const ROUTEC={};
const _graphRoute=route;
const rKey=(a,b)=>a.lat.toFixed(5)+','+a.lon.toFixed(5)+'|'+b.lat.toFixed(5)+','+b.lon.toFixed(5);
if(REALMAP){route=function(from,to){const a=P[from],b=P[to];if(!a||!b||a.lat==null||b.lat==null)return _graphRoute(from,to);
  const k=rKey(a,b),c=ROUTEC[k];if(c&&c.km)return{path:[from,to],km:c.km,mins:c.mins,pts:c.pts,real:true};
  if(!c)fetchRoute(a,b,k);
  return{path:[from,to],km:Math.max(1.2,hav(a,b)*1.35),pts:[{lat:a.lat,lon:a.lon},{lat:b.lat,lon:b.lon}]}}}
async function fetchRoute(a,b,k){
  ROUTEC[k]={pending:true};
  if(GMAP()){try{ROUTEC[k]=await gRoute(a,b);document.dispatchEvent(new CustomEvent('route-ready',{detail:k}));return}catch(e){}}
  try{const r=await fetch(`${MAPCFG.route}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);const j=await r.json();const rt=j.routes&&j.routes[0];if(!rt)throw 0;
    let pts=rt.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]}));if(pts.length>400){const st=Math.ceil(pts.length/400);pts=pts.filter((p,i)=>i%st===0||i===pts.length-1)}
    ROUTEC[k]={km:Math.max(1,rt.distance/1000),mins:rt.duration?Math.round(rt.duration/60):null,pts}}
  catch(e){ROUTEC[k]={km:Math.max(1.2,hav(a,b)*1.35),pts:[{lat:a.lat,lon:a.lon},{lat:b.lat,lon:b.lon}]}}
  document.dispatchEvent(new CustomEvent('route-ready',{detail:k}));
}

/* name + full address for a point. Chain: Google (nearby place name + geocoder) -> Nominatim (1 request/second) -> null.
   Each step has a time limit; only good answers are cached; failures are reported (errors collection) so the cause is visible.
   Returns {ta,en,sub,addr}: name, short area, full address. The caller always keeps the exact lat/lon itself. */
const GEOC={};let GEOLAST=0,GEOFAIL={};
function geoWithin(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))])}
function geoLog(step,e){const m='revGeo '+step+': '+String((e&&(e.code||e.message))||e).slice(0,120);if(GEOFAIL[m])return;GEOFAIL[m]=1;
  try{window.dispatchEvent(new ErrorEvent('error',{message:m,filename:'core/map.js',lineno:0}))}catch(_){}}
async function revGeo(lat,lon){
  const k=lat.toFixed(5)+','+lon.toFixed(5)+S.lang;if(GEOC[k])return GEOC[k];
  if(GMAP()){try{const g=await geoWithin(gRevGeo(lat,lon),7000);if(g&&g.ta){GEOC[k]=g;return g}}catch(e){geoLog('google',e)}}
  for(let i=0;i<2;i++){
    const wait=Math.max(0,1100-(Date.now()-GEOLAST));if(wait)await new Promise(r=>setTimeout(r,wait));GEOLAST=Date.now();
    try{const ac=new AbortController(),t=setTimeout(()=>ac.abort(),7000);
      const r=await fetch(`${MAPCFG.reverse}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=${S.lang==='ta'?'ta,en':'en'}`,{signal:ac.signal});clearTimeout(t);
      if(!r.ok)throw new Error('http '+r.status);const j=await r.json();
      const a=j.address||{};const main=j.name||a.amenity||a.shop||a.building||a.house_number&&a.road&&(a.house_number+', '+a.road)||a.road||a.neighbourhood||a.suburb||'';
      const area=[a.road&&a.road!==main?a.road:'',a.suburb||a.neighbourhood||a.village||a.hamlet||'',a.city||a.town||a.county||''].filter(Boolean).slice(0,2).join(', ');
      const addr=(j.display_name||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,6).join(', ')||[main,area].filter(Boolean).join(', ');
      const g={ta:main||area||'',en:main||area||'',sub:area,addr};if(!g.ta)return null;GEOC[k]=g;return g}
    catch(e){geoLog('osm',e)}
  }
  return null;
}
/* resolve with a time limit (used when the customer taps Confirm) */
function revGeoWait(lat,lon,ms){return Promise.race([revGeo(lat,lon),new Promise(r=>setTimeout(()=>r(null),ms||4000))])}


/* ---------- Google Maps (used when a key is set in maps-config.js); OpenStreetMap stays as fallback ---------- */
let GFAIL=false;
window.gm_authFailure=function(){GFAIL=true;try{toast(S.lang==='ta'?'Google Maps key வேலை செய்யல. இலவச map காட்டுறோம்':'Google Maps key rejected. Showing the free map')}catch(e){}};
const GMAP=()=>!GFAIL&&!!(window.GMAPS_KEY&&window.google&&window.google.maps&&window.google.maps.Map);
const gIcon=(svg,w,h,ax,ay)=>({url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg),scaledSize:new google.maps.Size(w,h),anchor:new google.maps.Point(ax,ay)});
const gPinSvg=col=>`<svg xmlns="http://www.w3.org/2000/svg" width="46" height="60" viewBox="0 0 46 60"><path d="M23 58C23 58 4 36 4 22a19 19 0 0138 0c0 14-19 36-19 36z" fill="${col}" stroke="#fff" stroke-width="3"/><circle cx="23" cy="22" r="8" fill="#FFC21A"/></svg>`;
function bearing(a,b){const r=Math.PI/180,y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r),x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);return(Math.atan2(y,x)/r+360)%360}
function makeGoogleMap(cv,o={}){
  const g=google.maps;const host=document.createElement('div');host.className='map lmap gmap';cv.replaceWith(host);
  const m=new g.Map(host,{center:{lat:P.home.lat,lng:P.home.lon},zoom:15,disableDefaultUI:true,clickableIcons:false,gestureHandling:'greedy',keyboardShortcuts:false});
  if(o.sat!==false&&!o.fleet){const b=document.createElement('button');b.className='gsat';b.type='button';b.textContent=S.lang==='ta'?'செயற்கைக்கோள்':'Satellite';
    b.onclick=()=>{const sat=m.getMapTypeId()!=='hybrid';m.setMapTypeId(sat?'hybrid':'roadmap');b.textContent=sat?(S.lang==='ta'?'சாதாரண map':'Map'):(S.lang==='ta'?'செயற்கைக்கோள்':'Satellite');b.classList.toggle('on',sat)};
    m.controls[g.ControlPosition.LEFT_BOTTOM].push(b)}
  let dragging=false;
  m.addListener('dragstart',()=>{dragging=true;o.onStart&&o.onStart()});
  m.addListener('zoom_changed',()=>{o.onStart&&o.onStart()});
  m.addListener('idle',()=>{dragging=false;const c=m.getCenter();o.onEnd&&o.onEnd({lat:c.lat(),lon:c.lng()})});
  const pins=[];let me=null,acc=null,drv=null,ln=null,ln2=null;const fleet={},near={};
  function setPins(list){
    while(pins.length>list.length)pins.pop().setMap(null);
    list.forEach((p,i)=>{if(!pins[i]){pins[i]=new g.Marker({map:m,position:{lat:p.lat,lng:p.lon},icon:gIcon(gPinSvg(p.col),30,40,15,39),clickable:false,zIndex:200});pins[i]._col=p.col}
      else{pins[i].setPosition({lat:p.lat,lng:p.lon});if(pins[i]._col!==p.col){pins[i].setIcon(gIcon(gPinSvg(p.col),30,40,15,39));pins[i]._col=p.col}}});
  }
  function sync(){
    if(!document.body.contains(host)){clearInterval(tk);return}
    const list=(o.pins||[]).slice();
    if(o.path&&o.path.length){const a=P[o.path[0]],b=P[o.path[o.path.length-1]];if(a)list.push({lat:a.lat,lon:a.lon,col:'#1E8A5A'});if(b&&o.path.length>1)list.push({lat:b.lat,lon:b.lon,col:'#121212'})}
    setPins(list.filter(p=>p&&p.lat!=null));
    if(!o.driver&&!o.fleet&&P.home){const pos={lat:P.home.lat,lng:P.home.lon};
      if(!me){me=new g.Marker({map:m,position:pos,clickable:false,zIndex:150,icon:{path:g.SymbolPath.CIRCLE,scale:8,fillColor:'#2C5196',fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});
        acc=new g.Circle({map:m,center:pos,radius:P.home.acc||0,strokeOpacity:0,fillColor:'#2C5196',fillOpacity:.14,clickable:false})}
      else{me.setPosition(pos);acc.setCenter(pos);acc.setRadius(P.home.acc||0)}}
    const lc=o.line?o.line():(o.path&&o.path.length>1?o.path.map(k=>P[k]).filter(Boolean):null);
    if(lc&&lc.length>1){const path=lc.map(p=>({lat:p.lat,lng:p.lon}));
      if(!ln){ln=new g.Polyline({map:m,path,strokeColor:'#12664A',strokeWeight:6,strokeOpacity:.9,clickable:false,zIndex:50});
        ln2=new g.Polyline({map:m,path,strokeOpacity:0,clickable:false,zIndex:51,icons:[{icon:{path:'M 0,-1 0,1',strokeOpacity:1,strokeColor:'#FFC21A',scale:2},offset:'0',repeat:'12px'}]})}
      else{ln.setPath(path);ln2.setPath(path)}}
    else if(ln){ln.setMap(null);ln2.setMap(null);ln=ln2=null}
    const d=o.driver?o.driver():null;
    if(d&&d.lat!=null){const rot=d.nlat!=null&&(d.nlat!==d.lat||d.nlon!==d.lon)?bearing(d,{lat:d.nlat,lon:d.nlon}):(drv&&drv._rot)||0;
      const icon=topIcon('car',rot);
      if(!drv){drv=new g.Marker({map:m,position:{lat:d.lat,lng:d.lon},icon,clickable:false,zIndex:300});}else{drv.setPosition({lat:d.lat,lng:d.lon});if(Math.abs((drv._rot||0)-rot)>2)drv.setIcon(icon)}drv._rot=rot}
    else if(drv){drv.setMap(null);drv=null}
    if(o.fleet){const seen={};o.fleet().forEach(f=>{const k=f.label+f.tag;seen[k]=1;
        const icon={path:g.SymbolPath.CIRCLE,scale:12,fillColor:f.col,fillOpacity:1,strokeColor:'#fff',strokeWeight:2.5};
        const label={text:f.tag,color:f.col==='#F2A900'?'#0B4A36':'#fff',fontWeight:'800',fontSize:'11px'};
        if(!fleet[k])fleet[k]=new g.Marker({map:m,position:{lat:f.lat,lng:f.lon},icon,label,title:f.label,zIndex:100});
        else{fleet[k].setPosition({lat:f.lat,lng:f.lon});fleet[k].setIcon(icon)}});
      Object.keys(fleet).forEach(k=>{if(!seen[k]){fleet[k].setMap(null);delete fleet[k]}})}
    if(o.near){const seen={};o.near().forEach(c=>{seen[c.id]=1;if(!near[c.id])near[c.id]=new g.Marker({map:m,position:{lat:c.lat,lng:c.lon},icon:topIcon(topKind(c.veh),c.rot,40),clickable:false,zIndex:90});else near[c.id].setPosition({lat:c.lat,lng:c.lon})});
      Object.keys(near).forEach(k=>{if(!seen[k]){near[k].setMap(null);delete near[k]}})}
  }
  const tk=setInterval(sync,500);setTimeout(sync,30);
  return{
    cam:{get s(){return sFromZ(m.getZoom()||15)},get lat(){return m.getCenter().lat()},get lon(){return m.getCenter().lng()}},
    fit(pts,pad=40,top=0){pts=(pts||[]).filter(p=>p&&p.lat!=null);if(!pts.length)return;if(pts.length===1){m.setCenter({lat:pts[0].lat,lng:pts[0].lon});m.setZoom(17);return}
      const b=new g.LatLngBounds();pts.forEach(p=>b.extend({lat:p.lat,lng:p.lon}));setTimeout(()=>{m.fitBounds(b,{top:pad+top,bottom:pad+24,left:pad,right:pad});const z=m.getZoom();if(z>17)m.setZoom(17)},60)},
    flyTo(lat,lon,s){m.panTo({lat,lng:lon});m.setZoom(Math.round(zFromS(s)))},
    zoomBy(f){m.setZoom((m.getZoom()||15)+Math.round(Math.log2(f)))},
    setView(lat,lon,s){m.setCenter({lat,lng:lon});m.setZoom(Math.round(zFromS(s)))},
    center(){const c=m.getCenter();return{lat:c.lat(),lon:c.lng()}},
    gmap:m
  };
}
function decodePoly(str){let i=0,lat=0,lng=0;const out=[];while(i<str.length){let b,s=0,r=0;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<s;s+=5}while(b>=32);lat+=(r&1)?~(r>>1):(r>>1);s=0;r=0;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<s;s+=5}while(b>=32);lng+=(r&1)?~(r>>1):(r>>1);out.push({lat:lat/1e5,lon:lng/1e5})}return out}
async function gRoute(a,b){
  const r=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':window.GMAPS_KEY,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'},
    body:JSON.stringify({origin:{location:{latLng:{latitude:a.lat,longitude:a.lon}}},destination:{location:{latLng:{latitude:b.lat,longitude:b.lon}}},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'})});
  const j=await r.json();const rt=j.routes&&j.routes[0];if(!rt||!rt.distanceMeters)throw new Error('no-route');
  return{km:Math.max(1,rt.distanceMeters/1000),mins:rt.duration?Math.round(parseInt(rt.duration)/60):null,pts:decodePoly(rt.polyline.encodedPolyline)};
}
/* route for in-app navigation: the full road line + duration. Google Routes (traffic-aware for the first route of a
   leg, plain for re-routes: cheaper), else OSRM, else null. src tells the screen which routing credit to show. */
async function navRoute(a,b,traffic){
  if(GMAP()){try{const r=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':window.GMAPS_KEY,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'},
      body:JSON.stringify({origin:{location:{latLng:{latitude:a.lat,longitude:a.lon}}},destination:{location:{latLng:{latitude:b.lat,longitude:b.lon}}},travelMode:'DRIVE',routingPreference:traffic?'TRAFFIC_AWARE':'TRAFFIC_UNAWARE'})});
    const j=await r.json(),rt=j.routes&&j.routes[0];if(rt&&rt.polyline)return{pts:decodePoly(rt.polyline.encodedPolyline),secs:rt.duration?parseInt(rt.duration):0,src:'google'}}catch(e){}}
  try{const r=await fetch(`${MAPCFG.route}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`),j=await r.json(),rt=j.routes&&j.routes[0];
    if(rt)return{pts:rt.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]})),secs:rt.duration||0,src:'osrm'}}catch(e){}
  return null;
}
const PLUSCODE=/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/;
async function gNearName(lat,lon){
  try{const {Place}=await google.maps.importLibrary('places');
    const {places}=await Place.searchNearby({fields:['displayName','formattedAddress'],locationRestriction:{center:{lat,lng:lon},radius:40},maxResultCount:1,rankPreference:'DISTANCE',language:S.lang==='ta'?'ta':'en',
      excludedPrimaryTypes:['locality','sublocality','route','political']});
    const p=places&&places[0];return p&&p.displayName?{name:p.displayName,addr:p.formattedAddress||''}:null}catch(e){geoLog('google-places',e);return null}
}
async function gRevGeo(lat,lon){
  const [r,near]=await Promise.all([new google.maps.Geocoder().geocode({location:{lat,lng:lon},language:S.lang==='ta'?'ta':'en'}),gNearName(lat,lon)]);
  const res=(r&&r.results)||[];if(!res.length&&!near)return null;
  const best=res.find(x=>x.types.some(t=>['point_of_interest','establishment','premise','street_address','subpremise'].includes(t)))||res[0];
  let main='',area='',addr='';
  if(best){const comp=t=>{const c=best.address_components.find(a=>a.types.includes(t));return c?c.long_name:''};
    const parts=best.formatted_address.split(',').map(s=>s.trim()).filter(p=>p&&!PLUSCODE.test(p));
    main=parts[0]||comp('route')||comp('sublocality')||'';addr=parts.join(', ');
    area=[comp('sublocality_level_1')||comp('sublocality')||comp('neighborhood'),comp('locality')].filter(x=>x&&x!==main).join(', ')}
  if(near){main=near.name;if(near.addr)addr=near.addr.split(',').map(s=>s.trim()).filter(p=>p&&!PLUSCODE.test(p)).join(', ')}
  return main?{ta:main,en:main,sub:area,addr:addr||[main,area].filter(Boolean).join(', ')}:null;
}
let GSESS=null;
async function gSuggest(q,near,rad){
  const {AutocompleteSuggestion,AutocompleteSessionToken}=await google.maps.importLibrary('places');
  if(!GSESS)GSESS=new AutocompleteSessionToken();
  const {suggestions}=await AutocompleteSuggestion.fetchAutocompleteSuggestions({input:q,sessionToken:GSESS,includedRegionCodes:['in'],language:S.lang==='ta'?'ta':'en',
    locationBias:{center:{lat:near.lat,lng:near.lon},radius:Math.min(50000,rad||30000)}});
  return(suggestions||[]).filter(s=>s.placePrediction).map(s=>{const p=s.placePrediction;return{name:(p.mainText&&p.mainText.text)||p.text.text,sub:(p.secondaryText&&p.secondaryText.text)||'',pred:p}});
}
async function gPick(x){const place=x.pred.toPlace();await place.fetchFields({fields:['location']});GSESS=null;return{lat:place.location.lat(),lon:place.location.lng()}}
