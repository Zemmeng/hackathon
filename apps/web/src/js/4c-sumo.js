/* sumo:begin */
// Step 2 on the REAL network (T40): a replay of Eclipse SUMO runs on the CBD network built from OSM (network.json) with
// SCATS weekday 08:00 flows — baked (/sumo/public/real/) or a live cloud run, both in the v2 replay format
// (docs/contract.md §HTTP API): per scenario a manifest (vehicle table, signal heads, chunks, metrics) and ~60 s chunks of
// 1 s samples [i, lon×1e6, lat×1e6, angle°, speed cm/s] + every signal's state string + the works queue (m).
// SumoReplay wears the same surface the page already draws from GridSim (4b-grid.js): isGrid, t, step(), all / agents,
// signalHeads(), works(), stats, minute, risk … so drawAgents / drawJunctions / updateLive / gridPick need no SUMO branch.
// It needs a GridSim spec for the same works link (junction positions for click-to-zoom, the closed-lane polygon); the page
// passes the one it already runs. Positions are linear between samples; the heading is SUMO's angle turned through the
// local map of geoToWorld (page x / y are fitted to the Hoddle grid, not due east / north). Plays to the last loaded sample
// and waits there while later chunks load; loops once all are in. Pure, no DOM: tests/sumo_glue.mjs runs this block in node.
const SUMO_LINK='l595594354_9756035316';
// SUMO angle (0 = north, clockwise) at lat / lon → unit heading in page coordinates
function sumoHead(lat,lon,p,a){
  const r=a*Math.PI/180,d=1e-5,q=geoToWorld(lat+Math.cos(r)*d,lon+Math.sin(r)*d/Math.cos(lat*Math.PI/180));
  const hx=q[0]-p[0],hy=q[1]-p[1],n=Math.hypot(hx,hy);return n>0?[hx/n,hy/n]:[1,0];
}
// Signal head state from a SUMO state string at link indices idx: any G/g → green, else any y/Y → amber, else red
function sumoHeadState(s,idx){
  if(typeof s!=='string')return'R';let y=false;
  for(const i of idx||[]){const c=s[i];if(c==='G'||c==='g')return'G';if(c==='y'||c==='Y')y=true;}
  return y?'A':'R';
}
// The closed lane SUMO ran (manifest.works.lane_shape_e6, its centre line [lon×1e6, lat×1e6]…) → a page polygon 3.2 units wide.
// SUMO closes the lane the plan says (Lonsdale: the median lane, "RIGHT LANE CLOSED"); the grid sim's polygon is its kerb lane
function sumoLanePoly(shape){
  const P=(shape||[]).filter(q=>Array.isArray(q)&&isFinite(q[0])&&isFinite(q[1])).map(q=>geoToWorld(q[1]/1e6,q[0]/1e6)),n=P.length;if(n<2)return null;
  const L=[],R=[];
  for(let i=0;i<n;i++){const a=P[Math.max(0,i-1)],b=P[Math.min(n-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy)||1,nx=-dy/d*1.6,ny=dx/d*1.6;
    L.push([P[i][0]+nx,P[i][1]+ny]);R.push([P[i][0]-nx,P[i][1]-ny]);}
  return L.concat(R.reverse());
}
class SumoReplay{
  // index: index.json · scenario id · manifest: <id>/manifest.json · opts {spec, polys (used when the manifest has no works.lane_shape_e6), src {source, elapsedMs, reason}}
  constructor(index,scenario,manifest,opts={}){
    const M=manifest||{};
    if(!M||!Array.isArray(M.agents)||!Array.isArray(M.chunks))throw new Error('bad SUMO manifest');
    this.isGrid=true;this.isSumo=true;this.index=index||{};this.scenario=scenario;this.man=M;this.spec=opts.spec||null;
    this.src=opts.src||{source:'baked'};const lp=M.works&&sumoLanePoly(M.works.lane_shape_e6);this.polys=lp?[lp]:opts.polys||[];this.hour=clamp(Math.floor(+(this.index.hour!=null?this.index.hour:8)),0,23);
    this.dt=+M.sample_s>0?+M.sample_s:1;this.clock0=+M.clock0_s||0;this.dur=+M.duration_s||0;
    this.meta=M.agents.map(a=>({id:String(a.id),type:a.type==='bus'?'bus':'car',len:Math.max(2,(+a.length_m||5)*GRID_K),wid:Math.max(1,(+a.width_m||1.8)*GRID_K)}));
    this.heads=(M.signal_heads||[]).map(h=>{const p=geoToWorld(h.lat_e6/1e6,h.lon_e6/1e6);return{x:p[0],y:p[1],tls:h.tls,idx:h.idx||[],id:h.id};});
    this.frames=[];this.nLoaded=0;this.nChunks=M.chunks.length;this.chunksIn=0;
    this.t=0;this.cars=new Map();this.all=[];this.agents=this.all;this.events=[];this.critical=null;
    this.risk=new Float32Array(RNX*RNY);this.riskVer=0;this.minute=new Float32Array(60);this.tlsNow={};this.q=0;
    this.pm=((M.per_minute&&M.per_minute.harsh)||[]).map(v=>+v||0);
    this.resetStats();
  }
  get metrics(){const s=(this.index.scenarios||[]).find(x=>x.id===this.scenario);return Object.assign({},s&&s.metrics,this.man.metrics);}
  get ready(){return this.nLoaded>0;}
  get complete(){return this.chunksIn>=this.nChunks&&this.nLoaded===this.frames.length;}
  // Chunk k (frames-NNN.json) → page coordinates once, up front; frames are placed by t, so chunks may arrive in any order
  addChunk(k,data){
    const F=(data&&data.frames)||[],n=this.meta.length;
    for(const f of F){
      const a=Array.isArray(f.a)?f.a:[],m=a.length,ids=new Int32Array(m),x=new Float32Array(m),y=new Float32Array(m),hx=new Float32Array(m),hy=new Float32Array(m),v=new Float32Array(m);
      let j=0;
      for(const r of a){const i=r[0]|0;if(i<0||i>=n)continue;const lat=r[2]/1e6,lon=r[1]/1e6,p=geoToWorld(lat,lon),h=sumoHead(lat,lon,p,+r[3]||0);
        ids[j]=i;x[j]=p[0];y[j]=p[1];hx[j]=h[0];hy[j]=h[1];v[j]=Math.max(0,+r[4]||0)/100*GRID_K;j++;}
      const fi=Math.round((+f.t||0)/this.dt);if(fi<0||fi>1e5)continue;
      this.frames[fi]={ids:ids.subarray(0,j),x:x.subarray(0,j),y:y.subarray(0,j),hx:hx.subarray(0,j),hy:hy.subarray(0,j),v:v.subarray(0,j),tls:f.tls||null,q:+f.q||0};
    }
    this.chunksIn++;while(this.frames[this.nLoaded])this.nLoaded++;
    if(this.nLoaded&&this.all.length===0)this._pose();
  }
  // Wall-clock second of the hour the replay is at (08:00:00 + clock0_s + t)
  clock(){return clamp(this.clock0+this.t,0,3599);}
  resetStats(){
    this.stats={conflicts:0,critical:0,harsh:0,delay:0,done:0,noRoute:0,merges:0};this.minute.fill(0);this.risk.fill(0);this.riskVer++;this._m=-1;
    this._stats();
  }
  // harsh = hard-braking events SUMO counted per minute (per_minute.harsh), summed up to the minute the replay is in
  _stats(){
    const m=Math.floor(this.t/60);if(m===this._m)return;this._m=m;let h=0;this.minute.fill(0);
    for(let k=0;k<=m&&k<this.pm.length;k++){h+=this.pm[k];const c=clamp(Math.floor((this.clock0+k*60)/60),0,59);this.minute[c]+=this.pm[k];}
    this.stats.harsh=h;
  }
  setWeather(){} // SUMO ran in clear weather; the page's weather layer is drawn over it unchanged
  seek(t){const end=Math.max(0,(this.nLoaded-1)*this.dt);this.t=clamp(+t||0,0,end);for(const c of this.cars.values())c.trail.length=0;this._m=-1;this._stats();this._pose();}
  step(dt){
    if(!(dt>0)||!this.nLoaded)return;
    const end=(this.nLoaded-1)*this.dt;this.t+=dt;
    if(this.t>end){if(this.complete&&end>0){this.t%=end;for(const c of this.cars.values())c.trail.length=0;this.resetStats();}else this.t=end;} // loop, or wait for the next chunk
    this._stats();this._pose();
  }
  _pose(){
    const n=this.nLoaded;if(!n)return;
    const u0=this.t/this.dt,i=clamp(Math.floor(u0),0,n-1),A=this.frames[i],B=i+1<n?this.frames[i+1]:null,u=B?u0-i:0;
    const nx=new Int32Array(this.meta.length).fill(-1);if(B)for(let j=0;j<B.ids.length;j++)nx[B.ids[j]]=j;
    if(A.tls)this.tlsNow=Object.assign({},this.tlsNow,A.tls);this.q=B?A.q+(B.q-A.q)*u:A.q;
    const seen=new Set(),all=[];
    for(let j=0;j<A.ids.length;j++){
      const i2=A.ids[j],b=nx[i2],M=this.meta[i2];let x=A.x[j],y=A.y[j],hx=A.hx[j],hy=A.hy[j],v=A.v[j],acc=0;
      if(b>=0){x+=(B.x[b]-x)*u;y+=(B.y[b]-y)*u;const hx2=hx+(B.hx[b]-hx)*u,hy2=hy+(B.hy[b]-hy)*u,hn=Math.hypot(hx2,hy2);if(hn>1e-6){hx=hx2/hn;hy=hy2/hn;}
        acc=(B.v[b]-v)/this.dt;v+=(B.v[b]-v)*u;}
      let c=this.cars.get(i2);
      if(!c){c={id:M.id,kind:'veh',type:M.type,x,y,hx,hy,v,acc,len:M.len,wid:M.wid,trail:[],tag:null,blocked:false,tt:-1};this.cars.set(i2,c);}
      c.x=x;c.y=y;c.hx=hx;c.hy=hy;c.v=v;c.acc=acc;
      if(this.t-c.tt>=.4||this.t<c.tt){c.tt=this.t;c.trail.push(x,y);if(c.trail.length>24)c.trail.splice(0,2);}
      seen.add(i2);all.push(c);
    }
    for(const k of this.cars.keys())if(!seen.has(k))this.cars.delete(k);
    this.all=all;this.agents=all;
  }
  signalHeads(){return this.heads.map(h=>({x:h.x,y:h.y,state:sumoHeadState(this.tlsNow[h.tls],h.idx),id:h.id,shown:true}));}
  works(){return{polys:this.scenario==='baseline'?[]:this.polys,queue_m:this.q};}
}
/* sumo:end */
