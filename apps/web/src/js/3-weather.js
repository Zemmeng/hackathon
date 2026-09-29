'use strict';
/* ============================================================
   Weather: GIS rasters, contours, particle flows and atmosphere
   ============================================================ */
const WX_KINDS=['clear','storm','flood','fog','heat','wind'];
const WX_META={
  clear:{label:'Clear',zh:'晴',dark:'#4FE3C1',light:'#08977F'},
  storm:{label:'Storm',zh:'雷暴',dark:'#9DB2FF',light:'#3552C8'},
  flood:{label:'Flood',zh:'内涝',dark:'#4AA3FF',light:'#1467C8'},
  fog:{label:'Fog',zh:'浓雾',dark:'#C3CFD6',light:'#5E707C'},
  heat:{label:'Heat',zh:'高温',dark:'#FF7445',light:'#C9471B'},
  wind:{label:'Wind',zh:'大风',dark:'#B7F36B',light:'#4E8A12'}};
const wxLabel=k=>L(WX_META[k].label,WX_META[k].zh);
const WX_ICON={
  clear:'<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13"/>',
  storm:'<path d="M4.5 10.5a3 3 0 0 1 .3-6A4 4 0 0 1 12.5 5a2.8 2.8 0 0 1-.5 5.5"/><path d="M8.5 8l-2 3.5h3l-2 3.5"/>',
  flood:'<path d="M1 8c1.7-1.6 3.3 1.6 5 0s3.3 1.6 5 0 3.3 1.6 4 .6M1 12c1.7-1.6 3.3 1.6 5 0s3.3 1.6 5 0 3.3 1.6 4 .6"/><path d="M8 1.5L6.6 3.6a1.6 1.6 0 1 0 2.8 0z"/>',
  fog:'<path d="M2 4h12M1 7h14M3 10h10M2 13h9"/>',
  heat:'<path d="M6 2.5a1.5 1.5 0 0 1 3 0v7a3 3 0 1 1-3 0z"/><path d="M11.5 4h2M11.5 7h2"/>',
  wind:'<path d="M1 6h9a2 2 0 1 0-2-2M1 10h11a2 2 0 1 1-2 2M1 8h5"/>'};
const FOG_LAYERS=[{m:210,vx:1.6,vy:.6,a:.72},{m:520,vx:-.8,vy:.35,a:.58}];
const AOI={x0:-130,x1:90,y0:-70,y1:60};

class Flow{
  constructor(n){this.n=n;this.x=new Float32Array(n);this.y=new Float32Array(n);this.a=new Float32Array(n);this.cv=document.createElement('canvas');this.g=this.cv.getContext('2d');this.w=0;this.h=0;this.dpr=1;this.ver=-1;this.seeded=false;}
  fit(V){
    if(this.w!==V.w||this.h!==V.h||this.dpr!==V.dpr){this.w=V.w;this.h=V.h;this.dpr=V.dpr;this.cv.width=Math.max(1,Math.round(V.w*V.dpr));this.cv.height=Math.max(1,Math.round(V.h*V.dpr));this.ver=-1;}
    if(this.ver!==V.ver){this.g.setTransform(1,0,0,1,0,0);this.g.clearRect(0,0,this.cv.width,this.cv.height);this.ver=V.ver;}
    this.g.setTransform(V.dpr,0,0,V.dpr,0,0);
  }
  reset(){this.seeded=false;this.ver=-1;}
  respawn(i,spawn,life){const p=spawn();if(!p){this.a[i]=0;return;}this.x[i]=p[0];this.y[i]=p[1];this.a[i]=life[0]+Math.random()*(life[1]-life[0]);}
  run(V,dt,field,spawn,colorOf,o){
    const fade=o.fade||.1,life=o.life||[1.5,4],speed=o.speed||1;
    this.fit(V);const g=this.g;
    if(!this.seeded){for(let i=0;i<this.n;i++)this.respawn(i,spawn,life);this.seeded=true;}
    g.globalCompositeOperation='destination-out';g.fillStyle=`rgba(0,0,0,${fade})`;g.fillRect(0,0,V.w,V.h);g.globalCompositeOperation='source-over';
    const B=new Map();
    for(let i=0;i<this.n;i++){
      this.a[i]-=dt;const x=this.x[i],y=this.y[i];
      const f=this.a[i]>0?field(x,y):null;
      if(!f){this.respawn(i,spawn,life);continue;}
      const nx=x+f[0]*dt*speed,ny=y+f[1]*dt*speed;this.x[i]=nx;this.y[i]=ny;
      const sx=V.X(x),sy=V.Y(y),ex=V.X(nx),ey=V.Y(ny);
      if((sx<-4&&ex<-4)||(sx>V.w+4&&ex>V.w+4)||(sy<-4&&ey<-4)||(sy>V.h+4&&ey>V.h+4)){if(Math.random()<.08)this.respawn(i,spawn,life);continue;}
      const col=colorOf(f);let arr=B.get(col);if(!arr){arr=[];B.set(col,arr);}arr.push(sx,sy,ex,ey);
    }
    g.lineWidth=o.lw||1.2;g.lineCap='round';
    for(const[col,a]of B){g.strokeStyle=col;g.beginPath();for(let k=0;k<a.length;k+=4){g.moveTo(a[k],a[k+1]);g.lineTo(a[k+2],a[k+3]);}g.stroke();}
  }
}

class Weather{
  constructor(W,G){
    this.W=W;this.G=G;this.kind='clear';this.t=0;this.h=0;this.light=false;this.age=0;
    this.R={};this.cont=[];this.lst=null;this.floodBase=null;this.hyd=-1;this.wet=[];
    this.rain=[];this.splash=[];this.strikes=[];this.flash=0;this.nextStrike=1.6;this.strikeCount=0;this.clock='17:00:00';this.view=null;
    this.windFlow=new Flow(2200);this.waterFlow=new Flow(1100);this._fog=null;this._fogL=null;this.pois=null;this.deep=null;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  /* the world changed under us (T15: real buildings arrived): drop every raster built from the old grids, rebuild the current one */
  rebind(W,G){this.W=W;this.G=G;this.R={};this.lst=null;this.floodBase=null;this.pois=null;this.deep=null;this.wet=[];this.set(this.kind);}
  set(k){this.kind=k;this.cont=[];this.age=1e9;this.strikes=[];this.flash=0;this.nextStrike=1.4;this.windFlow.reset();this.waterFlow.reset();this.hyd=-1;if(k!=='clear')this.buildRaster(k==='fog'?null:k);}
  setTheme(light){if(this.light!==light){this.light=light;this.windFlow.reset();this.waterFlow.reset();if(this.kind==='wind')this.buildRaster('wind');}}
  hydro(h){return h<.42?.45+.55*smooth(h/.42):1-.5*smooth((h-.42)/.58);}
  fogI(){const h=this.h;return h<.6?1:1-.7*smooth((h-.6)/.4);}
  /* ---------- fields ---------- */
  radarAt(x,y){
    const t=this.t,sp=(t*7.5)%1150,sp2=(t*7.5+575)%1150;
    const e=(cx,cy,rx,ry)=>{const dx=(x-cx)/rx,dy=(y-cy)/ry;return Math.exp(-(dx*dx+dy*dy));};
    const g=Math.max(e(-460+sp*.84,330-sp*.54,125,88),e(-460+sp2*.84,150-sp2*.54,105,78)*.9,e(60+60*Math.sin(t*.05),10+40*Math.cos(t*.04),78,56)*.62);
    const n=fbm((x-t*6.3)*.011,(y+t*4.05)*.011,4,3),st=fbm(x*.005+t*.004,y*.005,3,9);
    return 2+(g*(.35+.9*n)+.22*st*st*st)*66;
  }
  cells(){const t=this.t,sp=(t*7.5)%1150,sp2=(t*7.5+575)%1150;return[[-460+sp*.84,330-sp*.54],[-460+sp2*.84,150-sp2*.54]];}
  windAt(x,y){
    const t=this.t;let sp=14.4*(.72+.56*fbm(x*.004+t*.04,y*.004-t*.02,3,11));
    const ph=(x*.8-y*.6)*.011-t*.85;sp*=1+.62*Math.pow(Math.max(0,Math.sin(ph)),6);
    let u=WIND_DIR[0]*sp,v=WIND_DIR[1]*sp;
    const st=streetAt(x,y);
    if(st){const m=Math.hypot(u,v);if(st.axis==='h'){u=Math.sign(u)*m*1.08;v*=.22;}else{v=Math.sign(v)*m*1.05;u*=.22;}}
    if(this.G.wakeAt(x,y)){u*=.42;v*=.42;}
    return[u,v];
  }
  gustFronts(){const t=this.t,out=[];for(let k=-6;k<=6;k++){out.push((Math.PI/2+2*Math.PI*k+t*.85)/.011);}return out;} /* values of 0.8x-0.6y */
  elevGrad(x){const ex=Math.exp(-Math.pow((x+200)/38,2));return[.0034+1.1*ex*2*(x+200)/(38*38),.0021];}
  fogDensity(x,y){
    const I=this.fogI();let clear=1;
    for(const L of FOG_LAYERS){const px=(x-WORLD.x0-this.t*L.vx)*256/L.m,py=(WORLD.y1+this.t*L.vy-y)*256/L.m;const v=fbm(px/64,py/64,5,41,4);clear*=1-L.a*smooth(clamp((v-.34)/.4,0,1));}
    return clamp((1-clear)*I+.18*I,0,1);
  }
  visibility(x,y){return 25+150*Math.pow(1-this.fogDensity(x,y),1.7);}
  /* ---------- rasters ---------- */
  buildFloodBase(){
    const G=this.G,B=new Float32Array(NX*NY);
    for(let j=0;j<NY;j++){const y=WORLD.y1-(j+.5)*CELL;for(let i=0;i<NX;i++){const x=WORLD.x0+(i+.5)*CELL,k=j*NX+i,c=G.cls[k];
      if(c===CLS.ROOF||c===CLS.HERITAGE||c===CLS.DOME||c===CLS.GLASS){B[k]=-1;continue;}
      let d=.46*Math.exp(-Math.pow((x+200)/26,2));
      if(Math.abs(y)<15)d+=.31*clamp((-x-12)/190,0,1);
      if(Math.abs(x)<15&&y<-15)d+=.22*clamp((-y-15)/230,0,1);
      if(Math.abs(y+100)<5)d+=.13;
      if(Math.abs(y+200)<15)d+=.2*clamp((100-x)/300,0,1);
      const st=streetAt(x,y);if(st&&d>.03){const cr=carriage(st);if(x>=cr.x0&&x<=cr.x1&&y>=cr.y0&&y<=cr.y1){const dk=st.axis==='h'?Math.min(y-cr.y0,cr.y1-y):Math.min(x-cr.x0,cr.x1-x);if(dk<2.5)d+=.05;}}
      if(c===CLS.FOOT)d-=.14;else if(c!==CLS.ROAD&&c!==CLS.BIKE&&c!==CLS.TRAM&&c!==CLS.LANE)d-=.2;
      d+=(fbm(x*.05,y*.05,2,21)-.5)*.05-.015;B[k]=d;}}
    this.floodBase=B;
  }
  buildLST(){
    const G=this.G,L=new Float32Array(NX*NY);
    for(let j=0;j<NY;j++){const y=WORLD.y1-(j+.5)*CELL;for(let i=0;i<NX;i++){const x=WORLD.x0+(i+.5)*CELL,k=j*NX+i,c=G.cls[k];let T;
      switch(c){case CLS.ROAD:T=64;break;case CLS.LANE:T=58;break;case CLS.BIKE:T=61;break;case CLS.TRAM:T=56;break;case CLS.FOOT:T=50;break;case CLS.PLAZA:T=52;break;case CLS.ROOF:T=39+(.62-G.alb[k])*30;break;case CLS.HERITAGE:T=45;break;case CLS.DOME:T=43;break;case CLS.GLASS:T=57;break;case CLS.TREE:T=30.5;break;case CLS.LAWN:T=33.5;break;default:T=48;}
      if(G.shade[k]&&c!==CLS.TREE&&c!==CLS.LAWN)T-=(c===CLS.ROOF||c===CLS.HERITAGE)?6:12;
      T+=(hash2(i,j,77)-.5)*2+(fbm(x*.03,y*.03,2,5)-.5)*3;L[k]=T;}}
    this.lst=L;
    const at=(x,y)=>L[this.G.idx(x,y)];
    let shadeP=null;for(let y=-100;y<=20;y+=2)for(let x=-60;x<=40;x+=2){const q=this.G.idx(x,y);if(this.G.cls[q]===CLS.FOOT&&this.G.shade[q]){const d=(x+13)**2+(y+40)**2;if(!shadeP||d<shadeP.d)shadeP={x,y,d};}}
    if(!shadeP)shadeP={x:-13,y:-40};
    let cool=null;for(const b of this.W.buildings){const cx=b.cx!=null?b.cx:(b.x0+b.x1)/2,cy=b.cy!=null?b.cy:(b.y0+b.y1)/2;if(cx>AOI.x0&&cx<AOI.x1+100&&cy>AOI.y0-30&&cy<AOI.y1&&b.kind==='roof'&&(!cool||b.albedo>cool.albedo))cool={...b,cx,cy};}
    this.pois=[{x:70,y:-6.6,t:'ASPHALT',zh:'沥青路面',c:'#FDB32F',v:()=>at(70,-6.6),dx:40,dy:-44},{x:shadeP.x,y:shadeP.y,t:'BUILDING SHADE',zh:'建筑阴影',c:'#8BD17C',v:()=>at(shadeP.x,shadeP.y),dx:-120,dy:-30},{x:36,y:-72,t:'LAWN',zh:'草坪',c:'#8BD17C',v:()=>at(36,-72),dx:40,dy:40}];
    if(cool)this.pois.push({x:cool.cx,y:cool.cy,t:'COOL ROOF',zh:'冷屋顶',c:'#9FD3FF',v:()=>at(cool.cx,cool.cy),dx:44,dy:-30});
  }
  buildRaster(k){
    if(!k)return;this.age=0;
    const cell={storm:5,flood:2,heat:2,wind:8}[k],nx=Math.round((WORLD.x1-WORLD.x0)/cell),ny=Math.round((WORLD.y1-WORLD.y0)/cell);
    let r=this.R[k];if(!r){const cv=document.createElement('canvas');cv.width=nx;cv.height=ny;const g=cv.getContext('2d');r=this.R[k]={cv,g,img:g.createImageData(nx,ny),grid:new Float32Array(nx*ny),nx,ny,cell};}
    const d=r.img.data,G=r.grid;
    if(k==='storm'){for(let j=0;j<ny;j++){const y=WORLD.y1-(j+.5)*cell;for(let i=0;i<nx;i++){const x=WORLD.x0+(i+.5)*cell,q=j*nx+i,v=this.radarAt(x,y);G[q]=v;const o=q*4,c=v>=15?dbzRgb(v):null;if(c){d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=clamp((v-15)*22,60,235);}else d[o+3]=0;}}}
    else if(k==='flood'){if(!this.floodBase)this.buildFloodBase();if(this.hyd<0)this.hyd=this.hydro(this.h);const B=this.floodBase,hy=this.hyd;this.wet.length=0;let best=null;
      for(let q=0;q<nx*ny;q++){const b=B[q];const v=b<0?0:Math.max(0,b*hy-.012);G[q]=v;const o=q*4;if(v<.012){d[o+3]=0;continue;}const c=RAMPS.depth(v/.42),sp=.86+.28*hash2(q,3,9);d[o]=c[0]*sp;d[o+1]=c[1]*sp;d[o+2]=c[2]*sp;d[o+3]=Math.min(245,150+v*400);if(v>.05)this.wet.push(q);
        const x=WORLD.x0+(q%nx+.5)*cell,y=WORLD.y1-(Math.floor(q/nx)+.5)*cell;if(x>AOI.x0-80&&x<AOI.x1&&y>AOI.y0&&y<AOI.y1&&(!best||v>best.v))best={x,y,v};}
      this.deep=best;}
    else if(k==='heat'){if(!this.lst)this.buildLST();G.set(this.lst);for(let q=0;q<nx*ny;q++){const c=RAMPS.inferno((G[q]-26)/44),o=q*4;d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255;}}
    else if(k==='wind'){const ramp=this.light?RAMPS.windLight:RAMPS.wind;for(let j=0;j<ny;j++){const y=WORLD.y1-(j+.5)*cell;for(let i=0;i<nx;i++){const x=WORLD.x0+(i+.5)*cell,q=j*nx+i,w=this.windAt(x,y),kmh=Math.hypot(w[0],w[1])*3.6;G[q]=kmh;const c=ramp(kmh/100),o=q*4;d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255;}}}
    r.g.putImageData(r.img,0,0);
    const L={storm:[[35,1],[50,0]],flood:[[.1,1],[.2,0],[.3,0]],heat:[[40,1],[50,0],[60,0]],wind:[[70,1]]}[k];
    this.cont=L.map(([lv,dash])=>({lv,dash,cell,seg:contour(G,nx,ny,lv)}));
  }
  sample(k,x,y){const r=this.R[k];if(!r)return null;const i=Math.floor((x-WORLD.x0)/r.cell),j=Math.floor((WORLD.y1-y)/r.cell);if(i<0||j<0||i>=r.nx||j>=r.ny)return null;return r.grid[j*r.nx+i];}
  depthAt(x,y){return this.kind==='flood'?(this.sample('flood',x,y)||0):0;}
  visAt(x,y){return this.kind==='fog'?this.visibility(x,y):9999;}
  maxIn(k,box,step){let m=-1e9;for(let x=box.x0;x<=box.x1;x+=step)for(let y=box.y0;y<=box.y1;y+=step){const v=this.sample(k,x,y);if(v!=null&&v>m)m=v;}return m;}
  /* ---------- per-frame update ---------- */
  update(dt,h){
    this.t+=dt;this.h=h;const k=this.kind;this.age+=dt;
    if(k==='storm'){if(this.age>.12)this.buildRaster('storm');this.nextStrike-=dt;if(this.nextStrike<=0&&this.view){this.strike(this.view);this.nextStrike=2.6+Math.random()*4.5;}}
    else if(k==='flood'){const hy=this.hydro(h);if(Math.abs(hy-this.hyd)>.004||!this.R.flood){this.hyd=hy;this.buildRaster('flood');}}
    else if(k==='heat'){if(!this.R.heat)this.buildRaster('heat');}
    else if(k==='wind'){if(this.age>.3)this.buildRaster('wind');}
    for(const s of this.strikes)s.age+=dt;
    this.strikes=this.strikes.filter(s=>s.age<12);
    this.flash=Math.max(0,this.flash-dt*4.5);
  }
  strike(V){
    let best=null;const x0=Math.max(WORLD.x0,V.wx(0)),x1=Math.min(WORLD.x1,V.wx(V.w)),y0=Math.max(WORLD.y0,V.wy(V.h)),y1=Math.min(WORLD.y1,V.wy(0));
    for(let n=0;n<40;n++){const x=lerp(x0,x1,Math.random()),y=lerp(y0,y1,Math.random()),v=this.radarAt(x,y);if(v>47&&(!best||v>best.v))best={x,y,v};}
    if(!best)return;
    const bolt=[];for(let b=0;b<4;b++){let a=Math.random()*Math.PI*2,px=best.x,py=best.y;const pts=[[px,py]];const len=b===0?9:5;for(let s=0;s<len;s++){a+=(Math.random()-.5)*1.3;const l=2.5+Math.random()*4;px+=Math.cos(a)*l;py+=Math.sin(a)*l;pts.push([px,py]);}bolt.push(pts);}
    this.strikes.push({x:best.x,y:best.y,age:0,bolt,kA:(18+Math.random()*44)|0,pol:Math.random()<.85?'−':'+',clock:this.clock});
    this.strikeCount++;if(!this.reduced)this.flash=1;
  }
  /* ---------- drawing ---------- */
  drawGround(ctx,V){
    const k=this.kind;if(k==='clear')return;
    if(k==='storm'||k==='flood'){ctx.save();ctx.fillStyle=this.light?'rgba(70,120,170,.1)':'rgba(150,185,215,.1)';for(const st of this.W.streets){const r=carriage(st);ctx.fillRect(V.X(r.x0),V.Y(r.y1),(r.x1-r.x0)*V.s,(r.y1-r.y0)*V.s);}ctx.restore();}
    const r=this.R[k];
    if(r){ctx.save();ctx.imageSmoothingEnabled=k==='wind'||r.cell*V.s>14;ctx.globalAlpha=(this.dim||1)*{storm:this.light?.58:.5,flood:.8,heat:this.light?.74:.66,wind:this.light?.44:.36}[k];ctx.drawImage(r.cv,V.X(WORLD.x0),V.Y(WORLD.y1),(WORLD.x1-WORLD.x0)*V.s,(WORLD.y1-WORLD.y0)*V.s);ctx.restore();}
    if(k==='flood'){
      const self=this;
      this.waterFlow.run(V,1/60,(x,y)=>{const dd=self.sample('flood',x,y);if(!dd||dd<.03)return null;const g=self.elevGrad(x);let u=-g[0],v=-g[1];const st=streetAt(x,y);if(st){if(st.axis==='h')v=0;else u=0;}const m=Math.hypot(u,v)||1,sp=.8+4*dd;return[u/m*sp,v/m*sp];},
        ()=>{if(!self.wet.length)return null;const q=self.wet[(Math.random()*self.wet.length)|0];return[WORLD.x0+(q%NX+Math.random())*CELL,WORLD.y1-(Math.floor(q/NX)+Math.random())*CELL];},
        ()=>self.light?'rgba(255,255,255,.85)':'rgba(220,240,255,.75)',{fade:.14,lw:1.1,speed:4,life:[1,3]});
      ctx.drawImage(this.waterFlow.cv,0,0,V.w,V.h);
    }
    this.drawContours(ctx,V);
  }
  drawContours(ctx,V){
    if(!this.cont.length)return;const k=this.kind;
    const fmt={storm:v=>`${v} dBZ`,flood:v=>`${v.toFixed(1)} m`,heat:v=>`${v}°C`,wind:v=>`${v} km/h`}[k];
    ctx.save();ctx.lineWidth=1;ctx.strokeStyle=this.light?'rgba(16,24,30,.55)':'rgba(236,242,246,.55)';
    for(const C of this.cont){ctx.setLineDash(C.dash?[4,4]:[]);ctx.beginPath();const c=C.cell,s=C.seg;for(let m=0;m<s.length;m+=4){ctx.moveTo(V.X(WORLD.x0+(s[m]+.5)*c),V.Y(WORLD.y1-(s[m+1]+.5)*c));ctx.lineTo(V.X(WORLD.x0+(s[m+2]+.5)*c),V.Y(WORLD.y1-(s[m+3]+.5)*c));}ctx.stroke();}
    ctx.setLineDash([]);ctx.font=`600 9.5px ${FONT_MONO}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    const placed=[];
    for(const C of this.cont){let n=0;const c=C.cell,s=C.seg,stride=4*Math.max(1,Math.floor(s.length/4/40));for(let m=0;m<s.length&&n<4;m+=stride){const px=V.X(WORLD.x0+(s[m]+.5)*c),py=V.Y(WORLD.y1-(s[m+1]+.5)*c);if(px<60||py<70||px>V.w-60||py>V.h-60)continue;if(placed.some(p=>Math.hypot(p[0]-px,p[1]-py)<170))continue;placed.push([px,py]);n++;const txt=fmt(C.lv);ctx.strokeStyle=this.light?'rgba(255,255,255,.95)':'rgba(8,11,14,.9)';ctx.lineWidth=3.5;ctx.strokeText(txt,px,py);ctx.fillStyle=this.light?'#1A2328':'#F1F5F7';ctx.fillText(txt,px,py);}}
    ctx.restore();
  }
  drawAtmos(ctx,V,dt){
    const k=this.kind;this.view=V;ctx.save();ctx.globalAlpha=this.dim||1;this._atmos(ctx,V,dt,k);ctx.restore();
  }
  _atmos(ctx,V,dt,k){
    if(k==='storm')this.drawRain(ctx,V,dt);
    else if(k==='fog')this.drawFog(ctx,V);
    else if(k==='wind'){
      const self=this,ramp=this.light?RAMPS.windLight:RAMPS.wind,cols=[0,1,2,3,4,5].map(i=>rgba(ramp(i/5),this.light?.9:.85));
      const x0=()=>Math.max(WORLD.x0,V.wx(0)),x1=()=>Math.min(WORLD.x1,V.wx(V.w)),y0=()=>Math.max(WORLD.y0,V.wy(V.h)),y1=()=>Math.min(WORLD.y1,V.wy(0));
      this.windFlow.run(V,dt,(x,y)=>(x<WORLD.x0||x>WORLD.x1||y<WORLD.y0||y>WORLD.y1)?null:self.windAt(x,y),()=>[lerp(x0(),x1(),Math.random()),lerp(y0(),y1(),Math.random())],f=>cols[clamp(Math.round(Math.hypot(f[0],f[1])*3.6/20),0,5)],{fade:.09,lw:1.3,speed:1.7,life:[1.2,3.5]});
      ctx.drawImage(this.windFlow.cv,0,0,V.w,V.h);
    }
  }
  drawRain(ctx,V,dt){
    const n=Math.min(1100,Math.round(V.w*V.h/900));
    while(this.rain.length<n)this.rain.push({x:Math.random()*(V.w+200)-200,y:Math.random()*V.h,l:.6+Math.random()*.8,k:.8+Math.random()*.5});
    this.rain.length=n;const vx=150,vy=560,B=[[],[],[]];
    for(const p of this.rain){p.x+=vx*dt*p.k;p.y+=vy*dt*p.k;if(p.y>V.h+20||p.x>V.w+20){p.x=Math.random()*(V.w+240)-240;p.y=-20-Math.random()*80;}
      const d=this.sample('storm',V.wx(p.x),V.wy(p.y))||0,a=clamp((d-16)/34,0,1);if(a<.06)continue;
      B[a>.66?2:a>.33?1:0].push(p.x,p.y,p.x-vx*.035*p.l,p.y-vy*.035*p.l);
      if(a>.55&&Math.random()<dt*.5&&this.splash.length<90)this.splash.push({x:p.x,y:p.y,age:0});}
    ctx.save();ctx.lineCap='round';ctx.lineWidth=1;
    const cs=this.light?['rgba(40,70,110,.14)','rgba(40,70,110,.25)','rgba(40,70,110,.38)']:['rgba(205,222,240,.16)','rgba(205,222,240,.3)','rgba(215,230,245,.48)'];
    B.forEach((a,i)=>{ctx.strokeStyle=cs[i];ctx.beginPath();for(let m=0;m<a.length;m+=4){ctx.moveTo(a[m],a[m+1]);ctx.lineTo(a[m+2],a[m+3]);}ctx.stroke();});
    ctx.strokeStyle=this.light?'rgba(40,70,110,.4)':'rgba(215,230,245,.5)';
    for(const s of this.splash){s.age+=dt;const f=s.age/.45;ctx.globalAlpha=1-f;ctx.beginPath();ctx.ellipse(s.x,s.y,2+f*6,1+f*3,0,0,Math.PI*2);ctx.stroke();}
    this.splash=this.splash.filter(s=>s.age<.45);
    ctx.restore();
  }
  fogTile(){
    if(this._fog&&this._fogL===this.light)return this._fog;
    const N=256,cv=document.createElement('canvas');cv.width=cv.height=N;const g=cv.getContext('2d'),id=g.createImageData(N,N),col=this.light?[252,253,254]:[214,224,231];
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){const v=fbm(i/64,j/64,5,41,4),a=smooth(clamp((v-.34)/.4,0,1)),k=(j*N+i)*4;id.data[k]=col[0];id.data[k+1]=col[1];id.data[k+2]=col[2];id.data[k+3]=a*255;}
    g.putImageData(id,0,0);this._fog=cv;this._fogL=this.light;return cv;
  }
  drawFog(ctx,V){
    const I=this.fogI(),tile=this.fogTile();ctx.save();
    ctx.fillStyle=this.light?`rgba(236,240,243,${.36*I})`:`rgba(150,166,176,${.2*I})`;ctx.fillRect(0,0,V.w,V.h);
    for(const L of FOG_LAYERS){const p=ctx.createPattern(tile,'repeat');const sc=L.m*V.s/256;if(p.setTransform)p.setTransform(new DOMMatrix([sc,0,0,sc,V.X(WORLD.x0+this.t*L.vx),V.Y(WORLD.y1+this.t*L.vy)]));ctx.globalAlpha=L.a*I;ctx.fillStyle=p;ctx.fillRect(0,0,V.w,V.h);}
    ctx.restore();
  }
  drawNotes(ctx,V,TK){
    const k=this.kind,col=WX_META[k][this.light?'light':'dark'];
    if(k==='storm'){
      for(const s of this.strikes){
        const px=V.X(s.x),py=V.Y(s.y);
        if(s.age<.45){ctx.save();ctx.globalAlpha=1-s.age/.45;ctx.strokeStyle=this.light?'#5B3FD6':'#F3EEFF';ctx.shadowColor='#B9A7FF';ctx.shadowBlur=16;ctx.lineWidth=2;for(const b of s.bolt){ctx.beginPath();b.forEach((p,i)=>i?ctx.lineTo(V.X(p[0]),V.Y(p[1])):ctx.moveTo(V.X(p[0]),V.Y(p[1])));ctx.stroke();}ctx.restore();}
        const f=Math.min(1,s.age/.9);ctx.save();ctx.globalAlpha=Math.max(0,1-s.age/12);ctx.strokeStyle=this.light?'#6A4BE0':'#FFE45C';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(px,py,6+f*22,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(px-5,py);ctx.lineTo(px+5,py);ctx.moveTo(px,py-5);ctx.lineTo(px,py+5);ctx.stroke();ctx.restore();
        if(s.age>.3&&s.age<10)drawTag(ctx,px,py,34,-30,`${L('CG','地闪')} ${s.pol}${s.kA} kA · ${s.clock}`,this.light?'#6A4BE0':'#FFE45C',TK);
      }
      const c=this.cells()[0],px=V.X(c[0]),py=V.Y(c[1]);
      if(px>60&&px<V.w-240&&py>90&&py<V.h-120){ctx.save();ctx.strokeStyle=this.light?'rgba(20,30,40,.7)':'rgba(255,255,255,.75)';ctx.setLineDash([5,4]);ctx.lineWidth=1.5;const ex=px+.84*90*V.s,ey=py+.54*90*V.s;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(ex,ey);ctx.stroke();ctx.setLineDash([]);const a=Math.atan2(ey-py,ex-px);ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-9*Math.cos(a-.4),ey-9*Math.sin(a-.4));ctx.moveTo(ex,ey);ctx.lineTo(ex-9*Math.cos(a+.4),ey-9*Math.sin(a+.4));ctx.stroke();ctx.restore();drawTag(ctx,px,py,-20,-26,L('CELL S-2 → SE 27 km/h','雷暴单体 S-2 → 东南 27 km/h'),col,TK);}
    }else if(k==='flood'){
      for(const[x,y]of[[-60,-11],[-150,-11],[-12,-122],[12,-168]]){const px=V.X(x),py=V.Y(y);if(px<-10||py<-10||px>V.w+10||py>V.h+10)continue;ctx.save();ctx.fillStyle=TK.panel;ctx.strokeStyle=TK.risk;ctx.lineWidth=1.5;ctx.fillRect(px-5,py-5,10,10);ctx.strokeRect(px-5,py-5,10,10);ctx.beginPath();ctx.moveTo(px-3,py-3);ctx.lineTo(px+3,py+3);ctx.moveTo(px+3,py-3);ctx.lineTo(px-3,py+3);ctx.stroke();ctx.restore();}
      const pp=[-150,-11];drawTag(ctx,V.X(pp[0]),V.Y(pp[1]),-20,-58,L('PIT BLOCKED ×4','排水井堵塞 ×4'),TK.risk,TK);
      if(this.deep&&this.deep.v>.05)drawTag(ctx,V.X(this.deep.x),V.Y(this.deep.y),-40,-52,`${L('DEPTH','水深')} ${this.deep.v.toFixed(2)} m${this.deep.v>.25?L(' · IMPASSABLE',' · 无法通行'):''}`,col,TK);
      const ex=V.X(-200);if(ex>20&&ex<V.w-20){const ft=L('WILLIAMS CREEK FLOW PATH','WILLIAMS CREEK 古河道汇流线');ctx.save();ctx.translate(ex,V.h*.62);ctx.rotate(-Math.PI/2);ctx.font=`600 10px ${FONT_MONO}`;ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle=this.light?'rgba(255,255,255,.9)':'rgba(6,10,14,.85)';ctx.strokeText(ft,0,0);ctx.fillStyle=col;ctx.fillText(ft,0,0);ctx.restore();}
    }else if(k==='heat'&&this.pois){
      for(const p of this.pois)drawTag(ctx,V.X(p.x),V.Y(p.y),p.dx,p.dy,`${L(p.t,p.zh)} ${p.v().toFixed(1)} °C`,p.c,TK);
    }else if(k==='wind'){
      ctx.save();ctx.strokeStyle=col;ctx.lineWidth=2;ctx.setLineDash([9,6]);
      for(const c of this.gustFronts()){ /* line 0.8x-0.6y=c */ const ax=-400,ay=(0.8*ax-c)/.6,bx=400,by=(0.8*bx-c)/.6;const p0=[V.X(ax),V.Y(ay)],p1=[V.X(bx),V.Y(by)];ctx.beginPath();ctx.moveTo(p0[0],p0[1]);ctx.lineTo(p1[0],p1[1]);ctx.stroke();
        const mx=V.wx(V.w*.3),my=(0.8*mx-c)/.6,py=V.Y(my);if(py>90&&py<V.h-120){ctx.setLineDash([]);drawTag(ctx,V.w*.3,py,0,-22,L('GUST FRONT','阵风锋'),col,TK);ctx.setLineDash([9,6]);}}
      ctx.restore();
    }
  }
  drawFlash(ctx,V){if(this.flash>0){ctx.fillStyle=this.light?`rgba(255,255,255,${.2*this.flash})`:`rgba(225,220,255,${.22*this.flash})`;ctx.fillRect(0,0,V.w,V.h);}}
  probe(x,y){
    const k=this.kind;
    if(k==='storm'){const d=this.sample('storm',x,y);if(d==null)return null;const Z=Math.pow(10,d/10),Rr=Math.pow(Z/200,1/1.6);return{v:`${d.toFixed(0)} dBZ`,n:d<15?L('no echo','无回波'):`≈${Rr.toFixed(Rr<10?1:0)} mm/h · ${d>50?L('intense','强降水'):d>40?L('heavy','大雨'):d>25?L('moderate','中雨'):L('light','小雨')}`};}
    if(k==='flood'){const d=this.sample('flood',x,y)||0;return{v:`${L('depth','水深')} ${d.toFixed(2)} m`,n:d>.3?L('impassable','无法通行'):d>.15?L('unsafe for cyclists','骑行不安全'):d>.05?L('no step-free access','无障碍通行中断'):L('dry','无积水')};}
    if(k==='fog'){return{v:`${L('VIS','能见度')} ${this.visibility(x,y).toFixed(0)} m`,n:`${L('density','雾浓度')} ${(this.fogDensity(x,y)*100).toFixed(0)}%`};}
    if(k==='heat'){const t=this.sample('heat',x,y);if(t==null)return null;const cn=clsName(this.G.classAt(x,y));return{v:`${L('LST','地表温度')} ${t.toFixed(1)} °C`,n:L(cn.toLowerCase(),cn)+(this.G.shadeAt(x,y)?L(' · shaded',' · 阴影中'):'')};}
    if(k==='wind'){const w=this.windAt(x,y),kmh=Math.hypot(w[0],w[1])*3.6,dir=(Math.atan2(-w[0],-w[1])*180/Math.PI+360)%360;return{v:`${kmh.toFixed(0)} km/h`,n:`${L('from','来向')} ${dir.toFixed(0)}°${this.G.wakeAt(x,y)?L(' · building wake',' · 建筑风影区'):''}`};}
    return{v:clsName(this.G.classAt(x,y)),n:this.G.shadeAt(x,y)?L('in shadow','阴影中'):L('sunlit','受光')};
  }
}
