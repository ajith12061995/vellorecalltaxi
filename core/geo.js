/* VCT core · geo: distance, road-graph route, point along a path
   Shared by the customer, driver and office apps. Plain script (globals), loaded before each app's main script.
   Uses page globals at run time only: S, L, P, ROADS, CL, F, toast, modal, c(), mapLoop. */
function hav(a,b){const R=6371,r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lon-a.lon)*r;const x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function route(from,to){ // dijkstra on the tiny road graph
  const d={},prev={},q=new Set(Object.keys(P));Object.keys(P).forEach(k=>d[k]=Infinity);d[from]=0;
  while(q.size){let u=null;q.forEach(k=>{if(u===null||d[k]<d[u])u=k});q.delete(u);if(u===to)break;
    ROADS.forEach(([a,b])=>{let v=a===u?b:b===u?a:null;if(v&&q.has(v)){const nd=d[u]+hav(P[u],P[v]);if(nd<d[v]){d[v]=nd;prev[v]=u}}})}
  const path=[to];while(path[0]!==from&&prev[path[0]])path.unshift(prev[path[0]]);
  const viaKm=d[to]*1.25,directKm=hav(P[from],P[to])*1.35;
  if((from==='pick'||from==='drop'||to==='pick'||to==='drop')&&directKm<viaKm)return {path:[from,to],km:Math.max(1.2,directKm)};
  return {path,km:Math.max(1.2,viaKm)};
}
function along(pts,f){
  const seg=[];let tot=0;for(let i=1;i<pts.length;i++){const d=hav(pts[i-1],pts[i]);seg.push(d);tot+=d}
  let want=Math.max(0,Math.min(1,f))*tot,i=0;while(i<seg.length-1&&want>seg[i]){want-=seg[i];i++}
  const a=pts[i],b=pts[i+1]||pts[i],k=seg[i]?want/seg[i]:1;
  return{lat:a.lat+(b.lat-a.lat)*k,lon:a.lon+(b.lon-a.lon)*k,nlat:b.lat,nlon:b.lon,idx:i};
}
