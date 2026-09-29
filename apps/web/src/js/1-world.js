'use strict';
/* ============================================================
   Utilities
   ============================================================ */
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function hash2(x,y,s){let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1442695041))|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return(h>>>0)/4294967296;}
function vnoise(x,y,s,P){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;let x0=xi,y0=yi,x1=xi+1,y1=yi+1;
  if(P){x0=((x0%P)+P)%P;y0=((y0%P)+P)%P;x1=((x1%P)+P)%P;y1=((y1%P)+P)%P;}
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash2(x0,y0,s),b=hash2(x1,y0,s),c=hash2(x0,y1,s),d=hash2(x1,y1,s);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm(x,y,oct,s,P){let t=0,amp=.5,f=1,n=0;for(let i=0;i<oct;i++){t+=amp*vnoise(x*f,y*f,(s||0)+i*31,P?P*f:0);n+=amp;amp*=.5;f*=2;}return t/n;}
const hexRgb=h=>{h=String(h).trim().replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
const rgba=(c,a)=>{const[r,g,b]=Array.isArray(c)?c:hexRgb(c);return`rgba(${r|0},${g|0},${b|0},${a})`;};
function makeRamp(stops){const s=stops.map(([t,c])=>[t,hexRgb(c)]);const f=t=>{t=clamp(t,0,1);for(let i=1;i<s.length;i++)if(t<=s[i][0]){const[t0,c0]=s[i-1],[t1,c1]=s[i],k=(t-t0)/((t1-t0)||1);return[c0[0]+(c1[0]-c0[0])*k,c0[1]+(c1[1]-c0[1])*k,c0[2]+(c1[2]-c0[2])*k];}return s[s.length-1][1];};f.stops=stops;return f;}
const RAMPS={
  inferno:makeRamp([[0,'#0D0829'],[.13,'#2A0B5A'],[.25,'#50127B'],[.38,'#78207F'],[.5,'#9F2F7F'],[.62,'#C73D73'],[.72,'#E85A5B'],[.82,'#F8813F'],[.92,'#FDB32F'],[1,'#F9E86B']]),
  depth:makeRamp([[0,'#B4E1FF'],[.3,'#5AAEFF'],[.65,'#2C7BE5'],[1,'#0B3D91']]),
  wind:makeRamp([[0,'#3288BD'],[.25,'#99D594'],[.5,'#FFFFBF'],[.75,'#FC8D59'],[1,'#D53E4F']]),
  windLight:makeRamp([[0,'#1F5F8B'],[.25,'#2F8A4E'],[.5,'#A88400'],[.75,'#D2601A'],[1,'#B01218']]),
  risk:makeRamp([[0,'#1B3BFF'],[.35,'#00C2FF'],[.55,'#FFD23F'],[.75,'#FF8A3D'],[1,'#FF3B4E']]),
  fog:makeRamp([[0,'#F4F7F9'],[1,'#5E707C']]),
};
/* NWS-style radar reflectivity colour table */
const DBZ=[[5,'#04E9E7'],[10,'#019FF4'],[15,'#0300F4'],[20,'#02FD02'],[25,'#01C501'],[30,'#008E00'],[35,'#FDF802'],[40,'#E5BC00'],[45,'#FD9500'],[50,'#FD0000'],[55,'#D40000'],[60,'#BC0000'],[65,'#F800FD']].map(([d,c])=>[d,hexRgb(c),c]);
function dbzRgb(d){let c=null;for(const e of DBZ){if(d>=e[0])c=e[1];else break;}return c;}

/* marching squares → flat segment list in grid coordinates (cell centres) */
function contour(G,nx,ny,level){
  const seg=[];
  for(let j=0;j<ny-1;j++){const r0=j*nx,r1=r0+nx;for(let i=0;i<nx-1;i++){
    const a=G[r0+i],b=G[r0+i+1],c=G[r1+i+1],d=G[r1+i];
    let k=0;if(a>level)k|=1;if(b>level)k|=2;if(c>level)k|=4;if(d>level)k|=8;
    if(k===0||k===15)continue;
    const f=(p,q)=>(level-p)/((q-p)||1e-9);
    const T=[i+f(a,b),j],Rr=[i+1,j+f(b,c)],B=[i+f(d,c),j+1],L=[i,j+f(a,d)];
    let s;
    switch(k){case 1:case 14:s=[L,T];break;case 2:case 13:s=[T,Rr];break;case 3:case 12:s=[L,Rr];break;case 4:case 11:s=[Rr,B];break;case 6:case 9:s=[T,B];break;case 7:case 8:s=[L,B];break;case 5:s=[L,T,Rr,B];break;case 10:s=[T,Rr,L,B];break;}
    for(let m=0;m<s.length;m+=2)seg.push(s[m][0],s[m][1],s[m+1][0],s[m+1][1]);
  }}
  return seg;
}
function hull(pts){
  pts=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];
  for(const p of pts){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
  for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
  up.pop();lo.pop();return lo.concat(up);
}
function inConvex(P,x,y){for(let i=0,n=P.length;i<n;i++){const a=P[i],b=P[(i+1)%n];if((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])<0)return false;}return true;}

/* ============================================================
   World: Swanston St × La Trobe St, Melbourne CBD (local metres, x east, y north)
   ============================================================ */
const WORLD={x0:-320,x1:320,y0:-300,y1:300};
const ORIGIN={lat:-37.8098,lon:144.9652};
const MLAT=111320,MLON=111320*Math.cos(ORIGIN.lat*Math.PI/180);
const toLL=(x,y)=>[ORIGIN.lat+y/MLAT,ORIGIN.lon+x/MLON];
function dms(v,pos,neg){const h=v<0?neg:pos;v=Math.abs(v);const d=Math.floor(v),mf=(v-d)*60,m=Math.floor(mf),s=(mf-m)*60;return`${d}°${String(m).padStart(2,'0')}′${s.toFixed(1).padStart(4,'0')}″${h}`;}
const SUN={az:292,el:34};
const SHD=(()=>{const a=((SUN.az+180)%360)*Math.PI/180;return{dx:Math.sin(a),dy:Math.cos(a),k:1/Math.tan(SUN.el*Math.PI/180)};})();
const WIND_DIR=[0.8,-0.6]; /* NW wind blowing toward SE */
const CLS={GROUND:0,ROAD:1,FOOT:2,TRAM:3,ROOF:4,TREE:5,LAWN:6,GLASS:7,BIKE:8,DOME:9,PLAZA:10,LANE:11,HERITAGE:12};
const CLS_NAME=['Open ground','Asphalt road','Footpath','Tram track bed','Roof','Tree canopy','Lawn','Glass roof','Bike lane','Copper dome','Paved plaza','Laneway','Heritage roof'];
const CLS_NAME_ZH=['空地','沥青路面','人行道','电车轨道','屋顶','树冠','草坪','玻璃屋顶','自行车道','铜质穹顶','铺装广场','小巷','历史建筑屋顶'];
const clsName=c=>L(CLS_NAME[c],CLS_NAME_ZH[c]);
const STREETS=[
  {id:'latrobe',name:'La Trobe St',zh:'拉筹伯街',axis:'h',c:0,w:30,fp:4.5,tram:true,bike:true,main:true},
  {id:'lonsdale',name:'Lonsdale St',zh:'朗斯代尔街',axis:'h',c:-200,w:30,fp:4.5,main:true},
  {id:'llonsdale',name:'Little Lonsdale St',zh:'小朗斯代尔街',axis:'h',c:-100,w:10,fp:1.6,little:true},
  {id:'llatrobe',name:'Little La Trobe St',zh:'小拉筹伯街',axis:'h',c:100,w:9,fp:1.5,little:true},
  {id:'abeckett',name:"A'Beckett St",zh:'阿贝克特街',axis:'h',c:200,w:20,fp:3},
  {id:'swanston',name:'Swanston St',zh:'斯旺斯顿街',axis:'v',c:0,w:30,fp:4.5,tram:true,bike:true,main:true},
  {id:'russell',name:'Russell St',zh:'罗素街',axis:'v',c:200,w:30,fp:4.5,main:true},
  {id:'elizabeth',name:'Elizabeth St',zh:'伊丽莎白街',axis:'v',c:-200,w:30,fp:4.5,tram:true,main:true},
];
function streetRect(s){return s.axis==='h'?{x0:WORLD.x0-60,x1:WORLD.x1+60,y0:s.c-s.w/2,y1:s.c+s.w/2}:{x0:s.c-s.w/2,x1:s.c+s.w/2,y0:WORLD.y0-60,y1:WORLD.y1+60};}
function carriage(s){const r=streetRect(s);return s.axis==='h'?{x0:r.x0,x1:r.x1,y0:r.y0+s.fp,y1:r.y1-s.fp}:{x0:r.x0+s.fp,x1:r.x1-s.fp,y0:r.y0,y1:r.y1};}
/* intervals along a street that are outside crossing streets (for markings/trees) */
function freeSpans(s,pad){
  const others=STREETS.filter(o=>o.axis!==s.axis).map(o=>[o.c-o.w/2-pad,o.c+o.w/2+pad]).sort((a,b)=>a[0]-b[0]);
  const lo=s.axis==='h'?WORLD.x0-60:WORLD.y0-60,hi=s.axis==='h'?WORLD.x1+60:WORLD.y1+60;
  const out=[];let cur=lo;for(const[a,b]of others){if(a>cur)out.push([cur,a]);cur=Math.max(cur,b);}if(cur<hi)out.push([cur,hi]);return out;
}

function buildWorld(){
  const R=rng(20260929);
  const W={streets:STREETS,buildings:[],trees:[],parks:[],plazas:[],lanes:[],platforms:[],landmarks:[],paths:[]};
  const vs=STREETS.filter(s=>s.axis==='v').sort((a,b)=>a.c-b.c),hs=STREETS.filter(s=>s.axis==='h').sort((a,b)=>a.c-b.c);
  const xb=[WORLD.x0-60,...vs.map(s=>s.c),WORLD.x1+60],xw=[0,...vs.map(s=>s.w),0];
  const yb=[WORLD.y0-60,...hs.map(s=>s.c),WORLD.y1+60],yw=[0,...hs.map(s=>s.w),0];
  const near=(a,b)=>Math.abs(a-b)<.6;
  function lot(b,depth){
    const w=b.x1-b.x0,h=b.y1-b.y0;
    if(depth<5&&(w>34||h>34)&&(R()<.9||w>70||h>70)){
      const vert=w>h,r=.3+R()*.4;let gap=0;
      if(depth<2&&R()<.33&&(vert?w:h)>60)gap=3+R()*2;
      if(vert){const s=b.x0+w*r;lot({...b,x1:s-gap/2},depth+1);lot({...b,x0:s+gap/2},depth+1);if(gap)W.lanes.push({x0:s-gap/2,x1:s+gap/2,y0:b.y0,y1:b.y1});}
      else{const s=b.y0+h*r;lot({...b,y1:s-gap/2},depth+1);lot({...b,y0:s+gap/2},depth+1);if(gap)W.lanes.push({x0:b.x0,x1:b.x1,y0:s-gap/2,y1:s+gap/2});}
      return;
    }
    if(R()<.06&&w*h<1400){W.plazas.push({...b});return;}
    const tall=R()<.16;
    W.buildings.push({x0:b.x0+.35,y0:b.y0+.35,x1:b.x1-.35,y1:b.y1-.35,h:tall?45+R()*140:8+R()*30,tone:R(),albedo:.1+R()*.5,seed:(R()*1e9)|0,solar:R()<.12,kind:tall?'tower':'roof'});
  }
  for(let i=0;i<xb.length-1;i++)for(let j=0;j<yb.length-1;j++){
    const b={x0:xb[i]+xw[i]/2,x1:xb[i+1]-xw[i+1]/2,y0:yb[j]+yw[j]/2,y1:yb[j+1]-yw[j+1]/2};
    if(b.x1<=b.x0||b.y1<=b.y0)continue;
    if(near(b.x0,15)&&near(b.y1,-15)){ /* State Library Victoria */
      W.parks.push({x0:15,y0:-95,x1:58,y1:-15,kind:'lawn'});
      W.paths.push([[15,-15],[58,-56]],[[15,-95],[58,-56]],[[15,-56],[58,-56]]);
      W.buildings.push({x0:60,y0:-82,x1:100,y1:-27,h:24,kind:'heritage',tone:.7,albedo:.34,seed:11});
      W.buildings.push({x0:100,y0:-40,x1:183.5,y1:-16.5,h:22,kind:'heritage',tone:.6,albedo:.34,seed:12});
      W.buildings.push({x0:100,y0:-93.5,x1:183.5,y1:-72,h:20,kind:'heritage',tone:.6,albedo:.34,seed:13});
      W.buildings.push({x0:160,y0:-72,x1:183.5,y1:-40,h:22,kind:'heritage',tone:.6,albedo:.34,seed:14});
      W.plazas.push({x0:100,y0:-72,x1:160,y1:-40});
      W.landmarks.push({kind:'dome',x:130,y:-56,r:17,h:36,name:'La Trobe Reading Room'});
      continue;
    }
    if(near(b.x1,-15)&&near(b.y1,-15)){ /* Melbourne Central */
      W.buildings.push({x0:-183.5,y0:-94,x1:-17,y1:-16.5,h:26,kind:'mall',tone:.5,albedo:.45,seed:21});
      W.buildings.push({x0:-181,y0:-92,x1:-142,y1:-54,h:211,kind:'tower',tone:.15,albedo:.18,seed:22});
      W.landmarks.push({kind:'cone',x:-86,y:-54,r:25,h:42,name:'Melbourne Central cone'});
      W.landmarks.push({kind:'shot',x:-86,y:-54,r:4.6,h:50,name:"Coop's Shot Tower"});
      continue;
    }
    if(near(b.x0,15)&&near(b.y0,15)){ /* RMIT courtyard */
      W.plazas.push({x0:118,y0:22,x1:165,y1:50});
      lot({x0:15,y0:15,x1:185,y1:22},4);lot({x0:15,y0:22,x1:118,y1:95.5},1);lot({x0:165,y0:22,x1:185,y1:95.5},3);lot({x0:118,y0:50,x1:165,y1:95.5},2);
      continue;
    }
    lot(b,0);
  }
  W.platforms.push({x0:-7.6,x1:-3.9,y0:-78,y1:-38},{x0:3.9,x1:7.6,y0:-78,y1:-38});
  W.busStop={x0:-104,x1:-86,y0:-14.4,y1:-12.8};
  return W;
}

/* ---------- rasterised land-cover, shadow and wind-wake grids (2 m) ---------- */
const CELL=2,NX=(WORLD.x1-WORLD.x0)/CELL,NY=(WORLD.y1-WORLD.y0)/CELL;
function buildGrids(W){
  const n=NX*NY,cls=new Uint8Array(n),alb=new Float32Array(n),hgt=new Float32Array(n),shade=new Uint8Array(n),wake=new Uint8Array(n);
  const rng2=r=>({i0:clamp(Math.ceil((r.x0-WORLD.x0)/CELL-.5),0,NX-1),i1:clamp(Math.floor((r.x1-WORLD.x0)/CELL-.5),0,NX-1),j0:clamp(Math.ceil((WORLD.y1-r.y1)/CELL-.5),0,NY-1),j1:clamp(Math.floor((WORLD.y1-r.y0)/CELL-.5),0,NY-1)});
  const fill=(r,v,a,h)=>{const q=rng2(r);for(let j=q.j0;j<=q.j1;j++)for(let i=q.i0;i<=q.i1;i++){const k=j*NX+i;cls[k]=v;if(a!==undefined){alb[k]=a;hgt[k]=h;}}};
  const disc=(cx,cy,r,v,a,h)=>{const q=rng2({x0:cx-r,x1:cx+r,y0:cy-r,y1:cy+r});for(let j=q.j0;j<=q.j1;j++){const y=WORLD.y1-(j+.5)*CELL;for(let i=q.i0;i<=q.i1;i++){const x=WORLD.x0+(i+.5)*CELL;if((x-cx)**2+(y-cy)**2<=r*r){const k=j*NX+i;cls[k]=v;if(a!==undefined){alb[k]=a;hgt[k]=h;}}}}};
  for(const s of W.streets)fill(streetRect(s),CLS.FOOT);
  for(const s of W.streets){const c=carriage(s);fill(c,CLS.ROAD);
    if(s.tram){for(const o of[-2,2])fill(s.axis==='h'?{x0:c.x0,x1:c.x1,y0:s.c+o-1.4,y1:s.c+o+1.4}:{x0:s.c+o-1.4,x1:s.c+o+1.4,y0:c.y0,y1:c.y1},CLS.TRAM);}
    if(s.bike){for(const sg of[-1,1]){const a=s.c+sg*8.25,b=s.c+sg*10.5;const lo=Math.min(a,b),hi=Math.max(a,b);fill(s.axis==='h'?{x0:c.x0,x1:c.x1,y0:lo,y1:hi}:{x0:lo,x1:hi,y0:c.y0,y1:c.y1},CLS.BIKE);}}
  }
  for(const p of W.plazas)fill(p,CLS.PLAZA);
  for(const l of W.lanes)fill(l,CLS.LANE);
  for(const p of W.parks)fill(p,CLS.LAWN);
  for(const b of W.buildings)fill(b,b.kind==='heritage'?CLS.HERITAGE:CLS.ROOF,b.albedo,b.h);
  for(const l of W.landmarks){if(l.kind==='dome')disc(l.x,l.y,l.r,CLS.DOME,.3,l.h);else if(l.kind==='cone')disc(l.x,l.y,l.r,CLS.GLASS,.4,l.h);else disc(l.x,l.y,l.r,CLS.ROOF,.2,l.h);}
  for(const t of W.trees)disc(t.x,t.y,t.r*.9,CLS.TREE);
  /* shadows (sun) and wakes (wind) from extruded footprints */
  const cast=(pts,own,L,dx,dy,into,skipRoof)=>{
    const P=hull(pts.concat(pts.map(p=>[p[0]+dx*L,p[1]+dy*L])));
    let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const p of P){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
    const q=rng2({x0,x1,y0,y1});
    for(let j=q.j0;j<=q.j1;j++){const y=WORLD.y1-(j+.5)*CELL;for(let i=q.i0;i<=q.i1;i++){const x=WORLD.x0+(i+.5)*CELL;if(own(x,y))continue;if(!inConvex(P,x,y))continue;const k=j*NX+i;if(skipRoof&&(cls[k]===CLS.ROOF||cls[k]===CLS.HERITAGE))continue;into[k]=1;}}
  };
  const oct=(cx,cy,r)=>Array.from({length:8},(_,i)=>[cx+r*Math.cos(i*Math.PI/4),cy+r*Math.sin(i*Math.PI/4)]);
  for(const b of W.buildings){
    const pts=[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]],own=(x,y)=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1;
    cast(pts,own,Math.min(b.h*SHD.k,60),SHD.dx,SHD.dy,shade,false);
    cast(pts,own,Math.min(b.h*1.3,70),WIND_DIR[0],WIND_DIR[1],wake,true);
  }
  for(const l of W.landmarks){const own=(x,y)=>(x-l.x)**2+(y-l.y)**2<=l.r*l.r;cast(oct(l.x,l.y,l.r),own,Math.min(l.h*SHD.k,40),SHD.dx,SHD.dy,shade,false);}
  for(const t of W.trees){const q=rng2({x0:t.x-t.r*2,x1:t.x+t.r*2,y0:t.y-t.r*2,y1:t.y+t.r*2});const cx=t.x+SHD.dx*t.r*1.1,cy=t.y+SHD.dy*t.r*1.1;for(let j=q.j0;j<=q.j1;j++){const y=WORLD.y1-(j+.5)*CELL;for(let i=q.i0;i<=q.i1;i++){const x=WORLD.x0+(i+.5)*CELL;if((x-cx)**2+(y-cy)**2<=t.r*t.r)shade[j*NX+i]=1;}}}
  const idx=(x,y)=>{const i=Math.floor((x-WORLD.x0)/CELL),j=Math.floor((WORLD.y1-y)/CELL);return(i<0||j<0||i>=NX||j>=NY)?-1:j*NX+i;};
  return{cls,alb,hgt,shade,wake,idx,
    classAt(x,y){const k=idx(x,y);return k<0?CLS.GROUND:cls[k];},
    shadeAt(x,y){const k=idx(x,y);return k<0?0:shade[k];},
    wakeAt(x,y){const k=idx(x,y);return k<0?0:wake[k];},
    albAt(x,y){const k=idx(x,y);return k<0?0:alb[k];}};
}
function streetAt(x,y){for(const s of STREETS){const r=streetRect(s);if(x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1)return s;}return null;}
