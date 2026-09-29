'use strict';
/* ============================================================
   Multi-agent micro-simulation (IDM car-following, signals, conflicts)
   Drive-on-left: westbound traffic on the south half of La Trobe St.
   ============================================================ */
const TYPES={
  car:{len:4.5,wid:1.85,v0:13.2,a:1.7,b:2.8,T:1.25,s0:2.2},
  unf:{len:4.6,wid:1.85,v0:13.9,a:1.9,b:2.8,T:.95,s0:2},
  bus:{len:12.5,wid:2.5,v0:11.5,a:1.0,b:2.0,T:1.6,s0:3},
  tram:{len:30,wid:2.65,v0:10.5,a:.9,b:1.5,T:2,s0:4},
  bike:{len:1.8,wid:.7,v0:5.3,a:1.0,b:2.4,T:.9,s0:1.2},
  ped:{len:.55,wid:.55,v0:1.35},
  wc:{len:1.1,wid:.8,v0:1.0}};
const WXP={
  clear:{v:1,T:1,b:1,ped:1,bike:1,wob:0,rate:1},
  storm:{v:.82,T:1.4,b:.72,ped:1.12,bike:.85,wob:.15,rate:.9},
  flood:{v:.78,T:1.5,b:.75,ped:.85,bike:.7,wob:.1,rate:.75},
  fog:{v:.74,T:1.7,b:.9,ped:.92,bike:.86,wob:0,rate:.85},
  heat:{v:.96,T:1.1,b:1,ped:.84,bike:.88,wob:0,rate:.8},
  wind:{v:.9,T:1.25,b:.95,ped:.9,bike:.76,wob:.55,rate:.85}};
const LAYOUTS={
  before:{bx0:-70,bx1:-30,by:-5.0,lane:-4.3,s0:-22,s1:-28,r0:-71,r1:-79,hoard:-11.6,vms:60,bike0:-20,bike1:-27,bret0:-72,bret1:-80,taper:6},
  after:{bx0:-78,bx1:-38,by:-5.9,lane:-4.7,s0:-4,s1:-34,r0:-79,r1:-90,hoard:-12.3,vms:140,bike0:-21,bike1:-38,bret0:-80,bret1:-91,taper:10}};

function mkPath(pts){const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return{pts,cum,L:cum[cum.length-1]};}
function posAt(p,s,o){const c=p.cum,n=c.length;s=clamp(s,0,p.L);let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}const a=p.pts[lo],b=p.pts[hi],L=(c[hi]-c[lo])||1e-9,t=(s-c[lo])/L;o.x=a[0]+(b[0]-a[0])*t;o.y=a[1]+(b[1]-a[1])*t;o.hx=(b[0]-a[0])/L;o.hy=(b[1]-a[1])/L;return o;}
function sAt(p,axis,val){const ax=axis==='x'?0:1;for(let i=1;i<p.pts.length;i++){const a=p.pts[i-1][ax],b=p.pts[i][ax];if(a!==b&&(a-val)*(b-val)<=0)return p.cum[i-1]+(p.cum[i]-p.cum[i-1])*(val-a)/(b-a);}return null;}
function easeY(a,b,n){const o=[];for(let i=1;i<=n;i++){const t=i/n,e=t*t*(3-2*t);o.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*e]);}return o;}
function bez(a,c,b,n){const o=[];for(let i=1;i<=n;i++){const t=i/n,u=1-t;o.push([u*u*a[0]+2*u*t*c[0]+t*t*b[0],u*u*a[1]+2*u*t*c[1]+t*t*b[1]]);}return o;}

function buildNet(layout){
  const Z=LAYOUTS[layout],E=338,N={};
  const add=(id,o)=>{o.id=id;o.path=mkPath(o.pts);if(o.stopAxis!=null)o.stopS=sAt(o.path,o.stopAxis,o.stopVal);if(o.dwell)o.dwellS=sAt(o.path,o.dwell.axis,o.dwell.val);N[id]=o;return o;};
  const wb=(sa,sb)=>[[E,-6.6],[sa,-6.6],...easeY([sa,-6.6],[sb,Z.lane],8),[Z.r0,Z.lane],...easeY([Z.r0,Z.lane],[Z.r1,-6.6],8),[-E,-6.6]];
  add('WB',{type:'car',pts:wb(Z.s0,Z.s1),rate:.11,grp:'EW',stopAxis:'x',stopVal:20.5,vms:Z.vms});
  add('WBU',{type:'unf',pts:layout==='before'?wb(-26,-31):wb(Z.s0,Z.s1),rate:.03,grp:'EW',stopAxis:'x',stopVal:20.5,vms:Z.vms,unf:true});
  add('BUS',{type:'bus',pts:[[E,-6.6],[Z.s0,-6.6],...easeY([Z.s0,-6.6],[Z.s1,Z.lane],8),[Z.r0,Z.lane],...easeY([Z.r0,Z.lane],[-94,-8.9],10),[-100,-8.9],...easeY([-100,-8.9],[-112,-6.6],8),[-E,-6.6]],rate:1/85,grp:'EW',stopAxis:'x',stopVal:20.5,vms:Z.vms,dwell:{axis:'x',val:-97,t:18}});
  add('EB',{type:'car',pts:[[-E,6.6],[E,6.6]],rate:.11,grp:'EW',stopAxis:'x',stopVal:-20.5});
  add('SBL',{type:'car',pts:[[6.6,E],[6.6,17],...bez([6.6,17],[6.6,6.6],[17,6.6],8),[E,6.6]],rate:.04,grp:'NS',stopAxis:'y',stopVal:20.5});
  add('EBL',{type:'car',pts:[[-E,6.6],[-17,6.6],...bez([-17,6.6],[-6.6,6.6],[-6.6,17],8),[-6.6,E]],rate:.035,grp:'EW',stopAxis:'x',stopVal:-20.5});
  add('TLE',{type:'tram',pts:[[-E,2],[E,2]],rate:1/80,grp:'EW',stopAxis:'x',stopVal:-20.5});
  add('TLW',{type:'tram',pts:[[E,-2],[-E,-2]],rate:1/80,grp:'EW',stopAxis:'x',stopVal:20.5});
  add('TSN',{type:'tram',pts:[[-2,-E],[-2,E]],rate:1/55,grp:'NS',stopAxis:'y',stopVal:-20.5,dwell:{axis:'y',val:-56,t:16}});
  add('TSS',{type:'tram',pts:[[2,E],[2,-E]],rate:1/55,grp:'NS',stopAxis:'y',stopVal:20.5,dwell:{axis:'y',val:-60,t:16}});
  add('BLE',{type:'bike',pts:[[-E,9.4],[E,9.4]],rate:.045,grp:'EW',stopAxis:'x',stopVal:-20.5});
  add('BLW',{type:'bike',pts:[[E,-9.4],[Z.bike0,-9.4],...easeY([Z.bike0,-9.4],[Z.bike1,Z.lane],Z.taper),[Z.bret0,Z.lane],...easeY([Z.bret0,Z.lane],[Z.bret1,-9.4],8),[-E,-9.4]],rate:.065,grp:'EW',stopAxis:'x',stopVal:20.5,yieldX:layout==='after'?Z.bike0+1:null});
  add('BSN',{type:'bike',pts:[[-9.4,-E],[-9.4,E]],rate:.05,grp:'NS',stopAxis:'y',stopVal:-20.5});
  add('BSS',{type:'bike',pts:[[9.4,E],[9.4,-E]],rate:.05,grp:'NS',stopAxis:'y',stopVal:20.5});
  /* pedestrians: footpaths with signalised crossings */
  const f=12.8,xw=17.2,k=13.2,yc=(-10.5+Z.hoard)/2;
  const ped=(id,pts,gateIdx,grp,narrow)=>{const o=add(id,{type:'ped',pts,rate:.03,grp});o.gateS=o.path.cum[gateIdx];if(narrow){o.narrowS=sAt(o.path,'x',narrow);o.narrowW=Math.abs(Z.hoard+10.5);}return o;};
  const rev=a=>a.slice().reverse();
  const ltn=[[-E,f],[-k,f],[-k,xw],[k,xw],[k,f],[E,f]];
  ped('PNE',ltn,2,'PEW');ped('PNW',rev(ltn),2,'PEW');
  const lts=[[-E,-f],[Z.bx0-5,-f],[Z.bx0-1,yc],[Z.bx1+1,yc],[Z.bx1+5,-f],[-k,-f],[-k,-xw],[k,-xw],[k,-f],[E,-f]];
  ped('PSE',lts,6,'PEW',Z.bx0-2);ped('PSW',rev(lts),2,'PEW',Z.bx1+2);
  const sww=[[-f,-E],[-f,-k],[-xw,-k],[-xw,k],[-f,k],[-f,E]];ped('PWN',sww,2,'PNS');ped('PWS',rev(sww),2,'PNS');
  const swe=[[f,-E],[f,-k],[xw,-k],[xw,k],[f,k],[f,E]];ped('PEN',swe,2,'PNS');ped('PES',rev(swe),2,'PNS');
  return N;
}

const RISK_CELL=4,RNX=(WORLD.x1-WORLD.x0)/RISK_CELL,RNY=(WORLD.y1-WORLD.y0)/RISK_CELL;
class Sim{
  constructor(layout,opts={}){
    this.layout=layout;this.Z=LAYOUTS[layout];this.net=buildNet(layout);this.agents=[];this.t=0;this.nid=1;this.R=rng(opts.seed||4218);
    this.wxk='clear';this.wx=WXP.clear;this.env=null;this.events=[];this.recent=new Map();
    this.stats={conflicts:0,critical:0,harsh:0,delay:0,done:0,noRoute:0,merges:0};
    this.hist=[];this.histT=0;this.next={};for(const k in this.net)this.next[k]=this.R()*6;
    this.script=opts.script?{t0:opts.t0||45,phase:0}:null;this.sigOff=this.script?((90-(this.script.t0%90))%90):0;
    this.risk=new Float32Array(RNX*RNY);this.riskVer=0;this.critical=null;this.suppress={};this.minute=new Float32Array(60);this.clock0=opts.clock0||0;
    this.tmp={x:0,y:0,hx:0,hy:0};
  }
  setWeather(k,env){this.wxk=k;this.wx=WXP[k];this.env=env;}
  resetStats(){this.events=[];this.recent.clear();this.stats={conflicts:0,critical:0,harsh:0,delay:0,done:0,noRoute:0,merges:0};this.minute.fill(0);this.risk.fill(0);this.riskVer++;}
  signal(){const c=((this.t+this.sigOff)%90+90)%90;return{c,EW:c<40?'G':c<43?'A':'R',NS:c>=45&&c<80?'G':c>=45&&c<83?'A':'R',PEW:c<27?'W':c<37?'F':'D',PNS:c>=45&&c<66?'W':c>=45&&c<76?'F':'D'};}
  spawn(p,s0,v,tag){
    const ty=p.type==='ped'?(this.R()<.07?'wc':'ped'):p.type,T=TYPES[ty];
    const s=s0==null?0:s0;
    if(s0==null){for(const a of this.agents)if(a.p===p&&a.s<T.len+(TYPES[a.type].len)+4)return null;}
    const a={id:this.nid++,p,type:ty,kind:(ty==='ped'||ty==='wc')?'ped':'veh',s,v:v==null?(T.v0*.85):v,len:T.len,wid:T.wid,v0:T.v0*(.9+this.R()*.2),t0:this.t,tag:tag||null,acc:0,x:0,y:0,hx:1,hy:0,off:0,trail:[],ph:this.R()*6.28};
    if(ty==='ped'||ty==='wc')a.v0=T.v0*(.85+this.R()*.3);
    posAt(p.path,a.s,a);this.agents.push(a);return a;
  }
  spawnAtX(id,x,v,tag){const p=this.net[id];return this.spawn(p,sAt(p.path,'x',x),v,tag);}
  step(dt){
    this.t+=dt;const sig=this.signal(),A=this.agents,wx=this.wx;
    /* scripted critical scenario (C-17, D-42, Bus 250) */
    const S=this.script;
    if(S&&S.phase===0&&this.t>=S.t0){
      S.phase=1;const ids=new Set(['WB','WBU','BUS','BLW']);
      this.agents=this.agents.filter(a=>!(ids.has(a.p.id)&&a.x>-60&&a.x<260));
      const vc=TYPES.bike.v0*wx.bike,vd=TYPES.unf.v0*wx.v,tm=(62+21.5)/vc,d0=-10.8+vd*tm;
      const c=this.spawnAtX('BLW',62,vc,'C-17');if(c)c.v0=TYPES.bike.v0;
      const d=this.spawnAtX('WBU',d0,vd,'D-42');if(d){d.v0=TYPES.unf.v0;d.ignoreVms=this.layout==='before';}
      const b=this.spawnAtX('BUS',d0+34,Math.min(vd,11),'BUS 250');if(b)b.v0=TYPES.bus.v0;
      this.suppress={WB:S.t0+20,WBU:S.t0+20,BUS:S.t0+45,BLW:S.t0+16};
    }
    for(const k in this.net){if(this.t<this.next[k])continue;const p=this.net[k];this.next[k]=this.t-Math.log(1-this.R())/(p.rate*wx.rate);if(this.suppress[k]&&this.t<this.suppress[k])continue;this.spawn(p);}
    const L=this.agents;
    for(const a of L){if(a.kind==='ped')this.stepPed(a,dt,sig);else this.stepVeh(a,dt,sig,L);}
    for(const a of L){posAt(a.p.path,a.s,a);if(a.kind==='veh'&&a.type==='bike'&&wx.wob){a.off=Math.sin(this.t*2.3+a.ph)*wx.wob*.6;a.x+=-a.hy*a.off;a.y+=a.hx*a.off;}}
    /* conflicts */
    for(const a of L){
      if(a.kind!=='veh'||a.type==='bike'||a.v<1.5)continue;
      for(const b of L){
        if(b===a)continue;const dx=b.x-a.x,dy=b.y-a.y,lon=dx*a.hx+dy*a.hy;if(lon<=0||lon>30)continue;
        const lat=Math.abs(-dx*a.hy+dy*a.hx);if(lat>(a.wid+b.wid)/2+.4)continue;
        const cosb=b.hx*a.hx+b.hy*a.hy,dv=a.v-b.v*cosb;if(dv<1)continue;
        const car2=b.kind==='veh'&&b.type!=='bike';if(car2&&dv<3)continue;
        const g=Math.max(.1,lon-(a.len+b.len)/2),ttc=g/dv;if(ttc<1.5)this.conflict(a,b,ttc);
      }
    }
    for(const a of L){if(a.s>=a.p.path.L-.5||a.done){if(a.kind==='veh'&&(a.type==='car'||a.type==='unf')&&!a.done){this.stats.delay+=Math.max(0,(this.t-a.t0)-a.p.path.L/a.v0);this.stats.done++;}a.gone=true;}}
    this.agents=L.filter(a=>!a.gone);
    this.histT+=dt;
    if(this.histT>=.1){this.histT=0;
      const snap=[];for(const a of this.agents){if(Math.abs(a.x+30)>130||Math.abs(a.y)>110)continue;snap.push({id:a.id,x:a.x,y:a.y,hx:a.hx,hy:a.hy,l:a.len,w:a.wid,ty:a.type,tag:a.tag,v:a.v,acc:a.acc});}
      const h={t:this.t,a:snap};this.hist.push(h);if(this.hist.length>130)this.hist.shift();
      if(this.critical&&!this.critical.frozen){this.critical.snaps.push(h);if(this.t>this.critical.t+1.8)this.critical.frozen=true;}
      for(const a of this.agents)if(a.kind==='veh'&&a.type!=='tram'){a.trail.push(a.x,a.y);if(a.trail.length>16)a.trail.splice(0,2);}
    }
  }
  stepVeh(a,dt,sig,L){
    const T=TYPES[a.type],wx=this.wx,p=a.p;
    if(a.dwellT!=null&&!a.dwelt){a.dwellT+=dt;a.v=0;if(a.dwellT>p.dwell.t)a.dwelt=true;return;}
    let v0=a.v0*(a.type==='bike'?wx.bike:wx.v);
    if(p.vms!=null&&!a.ignoreVms&&(a.type==='car'||a.type==='unf'||a.type==='bus')){const read=Math.min(120,this.env?this.env.visAt(p.vms,-6):120)*(p.unf?.6:1);if(a.x<p.vms+read)v0=Math.min(v0,8.33);}
    if(this.env&&this.wxk==='flood'){const d=this.env.depthAt(a.x,a.y);if(a.type==='bike'&&d>.1)v0=Math.min(v0,1.8);else if(d>.18&&a.type!=='tram')v0=Math.min(v0,2.8);}
    let gap=1e9,dv=0;const hx=a.hx,hy=a.hy;
    for(const b of L){if(b===a)continue;const dx=b.x-a.x,dy=b.y-a.y,lon=dx*hx+dy*hy;if(lon<=0||lon>80)continue;const lat=Math.abs(-dx*hy+dy*hx);if(lat>(a.wid+b.wid)/2+(b.kind==='ped'?.6:.3))continue;const g=lon-(a.len+b.len)/2;if(g<gap){gap=g;dv=a.v-b.v*(b.hx*hx+b.hy*hy);}}
    if(p.stopS!=null&&a.s+a.len/2<p.stopS+.5){const st=sig[p.grp],d=p.stopS-(a.s+a.len/2);if(st==='R'||(st==='A'&&d>a.v*a.v/(2*T.b)+1)){if(d<gap){gap=Math.max(d,.01);dv=a.v;}}}
    if(p.dwellS!=null&&!a.dwelt){const d=p.dwellS-a.s;if(d>-.5){if(a.v<.4&&d<2.5){a.dwellT=0;a.v=0;return;}if(d<gap){gap=Math.max(d,.01);dv=a.v;}}}
    if(p.yieldX!=null&&!a.yielded&&a.x>p.yieldX-1){
      let block=false;for(const b of L){if(b.kind==='ped'||b.type==='bike'||b.type==='tram')continue;if(Math.abs(b.y+6.6)<2.4&&b.x>a.x-3&&b.x<a.x+32&&b.v>1.2){block=true;break;}}
      const d=a.x-p.yieldX;if(block){if(d<gap){gap=Math.max(d,.01);dv=a.v;}}else if(d<1.2){a.yielded=true;this.stats.merges++;}
    }
    const b=T.b*wx.b,TT=T.T*wx.T;
    let acc=T.a*(1-Math.pow(a.v/Math.max(v0,.1),4));
    if(gap<1e8){const ss=T.s0+Math.max(0,a.v*TT+a.v*dv/(2*Math.sqrt(T.a*b)));acc-=T.a*Math.pow(ss/Math.max(gap,.05),2);}
    acc=clamp(acc,-9,T.a);if(acc<-4.2&&a.v>3&&!a.harsh){a.harsh=true;this.stats.harsh++;}if(acc>-2)a.harsh=false;
    a.acc=acc;a.v=Math.max(0,a.v+acc*dt);a.s+=a.v*dt;
  }
  stepPed(a,dt,sig){
    const p=a.p;let v=a.v0*this.wx.ped;
    if(a.blocked){a.blockT+=dt;a.v=0;if(a.blockT>7)a.done=true;return;}
    if(p.gateS!=null&&!a.crossing){const d=p.gateS-a.s;if(d<.6){if(sig[p.grp]==='W'||d<-.3)a.crossing=true;else v=0;}}
    if(a.crossing&&a.s>p.gateS+30)a.crossing=false;
    if(a.type==='wc'&&p.narrowS!=null&&!a.passed){const d=p.narrowS-a.s;if(d>0&&d<1.2){if(p.narrowW<1.2){a.blocked=true;a.blockT=0;this.stats.noRoute++;this.flag(a.x,a.y,'noroute');return;}a.passed=true;}}
    if(this.env&&this.wxk==='flood'){const ah=posAt(p.path,a.s+2,this.tmp),d=this.env.depthAt(ah.x,ah.y);if(a.type==='wc'&&d>.05){a.blocked=true;a.blockT=0;this.stats.noRoute++;this.flag(a.x,a.y,'noroute');return;}if(d>.15)v*=.5;}
    a.v=v;a.s+=v*dt;
  }
  flag(x,y,kind){this.events.push({t:this.t,x,y,kind,sev:kind==='noroute'?1:0});}
  conflict(a,b,ttc){
    const key=a.id<b.id?a.id+'-'+b.id:b.id+'-'+a.id,prev=this.recent.get(key);
    if(prev&&this.t-prev.t<6){if(ttc<prev.ttc){prev.ttc=ttc;prev.sev=ttc<1?2:1;}return;}
    const ev={t:this.t,x:(a.x+b.x)/2,y:(a.y+b.y)/2,ttc,sev:ttc<1?2:1,kind:'conflict',types:[a.type,b.type],tags:[a.tag,b.tag],v:[a.v,b.v]};
    this.recent.set(key,ev);this.events.push(ev);this.stats.conflicts++;
    const m=clamp(Math.floor((this.clock0+this.t)/60),0,59);this.minute[m]+=1;
    const i0=Math.floor((ev.x-WORLD.x0)/RISK_CELL),j0=Math.floor((WORLD.y1-ev.y)/RISK_CELL);
    for(let j=j0-4;j<=j0+4;j++)for(let i=i0-4;i<=i0+4;i++){if(i<0||j<0||i>=RNX||j>=RNY)continue;const d2=(i-i0)**2+(j-j0)**2;this.risk[j*RNX+i]+=(ev.sev===2?1.6:1)*Math.exp(-d2/6);}
    this.riskVer++;
    const tags=ev.tags;if(this.script&&!this.critical&&tags.includes('C-17')&&tags.includes('D-42')){this.critical=ev;ev.snaps=this.hist.filter(h=>h.t>=this.t-6).slice();ev.frozen=false;ev.scripted=true;}
    if(ev.sev===2)this.stats.critical++;
  }
  counts(){const c={veh:0,ped:0,bike:0,tram:0,bus:0};for(const a of this.agents){if(a.kind==='ped')c.ped++;else if(a.type==='bike')c.bike++;else if(a.type==='tram')c.tram++;else if(a.type==='bus')c.bus++;else c.veh++;}c.total=this.agents.length;return c;}
  meanDelay(){return this.stats.done?this.stats.delay/this.stats.done:0;}
}
