'use strict';
const FONT_MONO='"JetBrains Mono","Noto Sans SC",ui-monospace,Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace';
const FONT_BODY='Inter,"Noto Sans SC",ui-sans-serif,system-ui,sans-serif';
/* ============================================================
   Basemaps: procedural orthophoto (RGB / NIR false colour) and vector streets (light / dark)
   ============================================================ */
const PAL_RGB={ground:'#2a2a25',foot:'#6a665d',road:'#2f302e',line:'rgba(232,228,218,.62)',yellow:'rgba(214,176,66,.72)',tramBed:'#484741',rail:'rgba(168,166,158,.85)',bike:'#3b6a47',zebra:'rgba(236,232,222,.8)',shadow:'rgba(5,6,7,.56)',
  roofs:['#4a4843','#57544d','#3d3c38','#615d55','#6e6a61','#45423c','#524f47','#7a7466','#3a3935','#686257','#80796b','#8c887a','#9d998d','#5b5f5f','#4b5152','#b3b0a6'],
  hvac:'#a39e92',solar:'#26364a',sky:'#b9c6ca',tree:['#1e331b','#2c4727','#44643a','#5f8349'],lawn:['#3c5335','#47623d'],paving:'#77726a',path:'#8f897d',platform:'#8b877e',platEdge:'#c9b458',heritage:'#8d9189',
  dome:['#b2bfb3','#66766a','#2c3530'],glass:['#a9bfca','#587080','#233039'],brick:'#8a4b35',mall:'#9a978d',tower:['#3b4148','#50575f']};
const PAL_NIR={...PAL_RGB,ground:'#3a4042',foot:'#7f8e92',road:'#223036',line:'rgba(220,235,240,.55)',tramBed:'#3a484e',bike:'#5a2a28',
  roofs:['#5d7a82','#6f8c93','#4f6770','#8aa5ab','#93a9ae','#56707a','#7b979e','#a9bfc3','#3f5760','#68848c','#8fb0b6','#b8cbcf'],
  tree:['#5c0f0c','#961c16','#cc3328','#ee5a4a'],lawn:['#b3322a','#c9473c'],paving:'#8d9da1',path:'#a4b3b6',heritage:'#9fb3b7',dome:['#c3d3d6','#71878d','#33444a'],glass:['#86a6b2','#3f5b66','#18272e'],brick:'#7b8f93',mall:'#9fb1b5',tower:['#3d5058','#52666e']};

function renderImagery(W,pal){
  const S=4,cw=(WORLD.x1-WORLD.x0)*S,ch=(WORLD.y1-WORLD.y0)*S;
  const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;const g=cv.getContext('2d');
  const X=x=>(x-WORLD.x0)*S,Y=y=>(WORLD.y1-y)*S;
  const rect=(r,c)=>{g.fillStyle=c;g.fillRect(X(r.x0),Y(r.y1),(r.x1-r.x0)*S,(r.y1-r.y0)*S);};
  const poly=(pts,c)=>{g.fillStyle=c;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(X(p[0]),Y(p[1])):g.moveTo(X(p[0]),Y(p[1])));g.closePath();g.fill();};
  const disc=(x,y,r,c)=>{g.fillStyle=c;g.beginPath();g.arc(X(x),Y(y),r*S,0,Math.PI*2);g.fill();};
  const line=(x0,y0,x1,y1,c,w,dash)=>{g.strokeStyle=c;g.lineWidth=w*S;g.setLineDash(dash?dash.map(d=>d*S):[]);g.beginPath();g.moveTo(X(x0),Y(y0));g.lineTo(X(x1),Y(y1));g.stroke();g.setLineDash([]);};
  const R=rng(99);
  g.fillStyle=pal.ground;g.fillRect(0,0,cw,ch);
  /* streets */
  for(const s of W.streets)rect(streetRect(s),pal.foot);
  for(const s of W.streets)rect(carriage(s),pal.road);
  for(const l of W.lanes)rect(l,pal.road);
  for(const s of W.streets){
    const c=carriage(s),H=s.axis==='h';
    const along=(off,col,w,dash,pad=4)=>{for(const[a,b]of freeSpans(s,pad)){if(H)line(a,s.c+off,b,s.c+off,col,w,dash);else line(s.c+off,a,s.c+off,b,col,w,dash);}};
    const band=(o0,o1,col,pad=0)=>{for(const[a,b]of freeSpans(s,pad)){const lo=s.c+Math.min(o0,o1),hi=s.c+Math.max(o0,o1);rect(H?{x0:a,x1:b,y0:lo,y1:hi}:{x0:lo,x1:hi,y0:a,y1:b},col);}};
    if(s.main){
      if(s.tram){for(const o of[-2,2]){band(o-1.45,o+1.45,pal.tramBed,-2);for(const r of[-.72,.72]){for(const[a,b]of freeSpans(s,-15)){if(H)line(a,s.c+o+r,b,s.c+o+r,pal.rail,.14);else line(s.c+o+r,a,s.c+o+r,b,pal.rail,.14);}}}
        along(4.2,pal.line,.15,[3,6]);along(-4.2,pal.line,.15,[3,6]);}
      else{along(.22,pal.yellow,.14);along(-.22,pal.yellow,.14);along(3.6,pal.line,.14,[3,6]);along(-3.6,pal.line,.14,[3,6]);along(7.2,pal.line,.14,[3,6]);along(-7.2,pal.line,.14,[3,6]);}
      if(s.bike){band(8.25,10.5,pal.bike,1);band(-8.25,-10.5,pal.bike,1);along(8.25,pal.line,.15);along(-8.25,pal.line,.15);}
    }else if(!s.little){along(0,pal.line,.13,[3,5]);}
  }
  /* crossings at main intersections */
  for(const h of W.streets.filter(s=>s.axis==='h'&&s.w>=20))for(const v of W.streets.filter(s=>s.axis==='v'&&s.w>=20)){
    const hw=h.w/2-h.fp,vw=v.w/2-v.fp;
    for(const sg of[-1,1]){
      const xc=v.c+sg*(v.w/2+2.2);for(let y=h.c-hw+.3;y<h.c+hw-.3;y+=1.1)rect({x0:xc-1.8,x1:xc+1.8,y0:y,y1:y+.55},pal.zebra);
      const yc=h.c+sg*(h.w/2+2.2);for(let x=v.c-vw+.3;x<v.c+vw-.3;x+=1.1)rect({x0:x,x1:x+.55,y0:yc-1.8,y1:yc+1.8},pal.zebra);
      const xs=v.c+sg*(v.w/2+4.6);rect(sg>0?{x0:xs,x1:xs+.4,y0:h.c-hw,y1:h.c}:{x0:xs-.4,x1:xs,y0:h.c,y1:h.c+hw},pal.zebra);
      const ys=h.c+sg*(h.w/2+4.6);rect(sg>0?{x0:v.c,x1:v.c+vw,y0:ys,y1:ys+.4}:{x0:v.c-vw,x1:v.c,y0:ys-.4,y1:ys},pal.zebra);
    }
  }
  for(const p of W.platforms){rect(p,pal.platform);const e=p.x0<0?p.x1-.35:p.x0;rect({x0:e,x1:e+.35,y0:p.y0,y1:p.y1},pal.platEdge);}
  rect(W.busStop,'#2a2c2e');rect({x0:W.busStop.x0+.3,x1:W.busStop.x1-.3,y0:W.busStop.y0+.35,y1:W.busStop.y1-.35},'#9fb3bd');
  /* plazas and parks */
  for(const p of W.plazas){rect(p,pal.paving);g.globalAlpha=.25;for(let x=p.x0;x<p.x1;x+=3)line(x,p.y0,x,p.y1,'#000',.08);for(let y=p.y0;y<p.y1;y+=3)line(p.x0,y,p.x1,y,'#000',.08);g.globalAlpha=1;}
  for(const p of W.parks){rect(p,pal.lawn[0]);g.save();g.beginPath();g.rect(X(p.x0),Y(p.y1),(p.x1-p.x0)*S,(p.y1-p.y0)*S);g.clip();g.globalAlpha=.45;for(let k=-120;k<120;k+=6){g.fillStyle=pal.lawn[1];g.beginPath();g.moveTo(X(p.x0+k),Y(p.y1));g.lineTo(X(p.x0+k+3),Y(p.y1));g.lineTo(X(p.x0+k+3+80),Y(p.y0));g.lineTo(X(p.x0+k+80),Y(p.y0));g.fill();}g.restore();g.globalAlpha=1;}
  for(const pth of W.paths)line(pth[0][0],pth[0][1],pth[1][0],pth[1][1],pal.path,2.4);
  /* shadows */
  g.fillStyle=pal.shadow;
  for(const b of W.buildings){const L=Math.min(b.h*SHD.k,60),pts=[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]];const P=hull(pts.concat(pts.map(p=>[p[0]+SHD.dx*L,p[1]+SHD.dy*L])));poly(P,pal.shadow);}
  for(const l of W.landmarks){const L=Math.min(l.h*SHD.k,40);disc(l.x+SHD.dx*L*.5,l.y+SHD.dy*L*.5,l.r*1.02,pal.shadow);disc(l.x+SHD.dx*L,l.y+SHD.dy*L,l.r,pal.shadow);}
  /* roofs */
  for(const b of W.buildings)roof(b);
  function edges(b){line(b.x0,b.y1,b.x1,b.y1,'rgba(255,255,255,.2)',.35);line(b.x0,b.y0,b.x0,b.y1,'rgba(255,255,255,.14)',.35);line(b.x0,b.y0,b.x1,b.y0,'rgba(0,0,0,.35)',.35);line(b.x1,b.y0,b.x1,b.y1,'rgba(0,0,0,.28)',.35);}
  function roof(b){
    const Rb=rng(b.seed),w=b.x1-b.x0,h=b.y1-b.y0;
    let base=b.kind==='heritage'?pal.heritage:b.kind==='mall'?pal.mall:b.kind==='tower'?pal.tower[Rb()<.5?0:1]:pal.roofs[Math.floor(b.tone*pal.roofs.length)%pal.roofs.length];
    rect(b,base);
    const gr=g.createLinearGradient(X(b.x0),Y(b.y1),X(b.x1),Y(b.y0));gr.addColorStop(0,'rgba(255,255,255,.07)');gr.addColorStop(1,'rgba(0,0,0,.1)');g.fillStyle=gr;g.fillRect(X(b.x0),Y(b.y1),w*S,h*S);
    edges(b);
    if(b.kind==='tower'){
      const ins=Math.min(w,h)*.16,t={x0:b.x0+ins,y0:b.y0+ins,x1:b.x1-ins,y1:b.y1-ins};
      poly(hull([[t.x0,t.y0],[t.x1,t.y0],[t.x1,t.y1],[t.x0,t.y1],[t.x0+SHD.dx*3,t.y0+SHD.dy*3],[t.x1+SHD.dx*3,t.y0+SHD.dy*3],[t.x1+SHD.dx*3,t.y1+SHD.dy*3]]),'rgba(0,0,0,.35)');
      rect(t,pal.tower[1]);edges(t);
      if(b.h>150){const cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2,r=Math.min(w,h)*.22;disc(cx,cy,r,'#5b6166');g.strokeStyle='rgba(230,230,220,.8)';g.lineWidth=.35*S;g.beginPath();g.arc(X(cx),Y(cy),r*.8*S,0,Math.PI*2);g.stroke();g.fillStyle='rgba(230,230,220,.85)';g.font=`700 ${r*S*1.05}px sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText('H',X(cx),Y(cy));}
      else{const u={x0:t.x0+w*.1,y0:t.y0+h*.1,x1:t.x0+w*.3,y1:t.y0+h*.25};rect(u,pal.hvac);}
      return;
    }
    if(b.kind==='mall'){for(let x=b.x0+6;x<b.x1-4;x+=9)rect({x0:x,x1:x+1.6,y0:b.y0+4,y1:b.y1-4},rgba(hexRgb(pal.sky),.55));return;}
    if(b.kind==='heritage'){g.globalAlpha=.5;const cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2,m=Math.min(w,h)/2;const r0=w>h?[b.x0+m,cy,b.x1-m,cy]:[cx,b.y0+m,cx,b.y1-m];line(r0[0],r0[1],r0[2],r0[3],'rgba(255,255,255,.35)',.3);for(const[cxn,cyn]of[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]]){const nx=cxn<cx?r0[0]:r0[2],ny=cyn<cy?r0[1]:r0[3];line(cxn,cyn,nx,ny,'rgba(0,0,0,.35)',.25);}g.globalAlpha=1;return;}
    if(b.solar&&w>10&&h>8){for(let y=b.y0+2;y<b.y1-2.5;y+=2.3){rect({x0:b.x0+2,x1:b.x1-2,y0:y,y1:y+1.5},pal.solar);line(b.x0+2,y+1.5,b.x1-2,y+1.5,'rgba(200,220,240,.25)',.12);}}
    const n=w*h>150?(Rb()*5)|0:0;
    for(let i=0;i<n;i++){const uw=1.5+Rb()*3.5,uh=1.5+Rb()*3;if(w<uw+3||h<uh+3)continue;const ux=b.x0+1.5+Rb()*(w-uw-3),uy=b.y0+1.5+Rb()*(h-uh-3);rect({x0:ux+.5,x1:ux+uw+.5,y0:uy-.4,y1:uy+uh-.4},'rgba(0,0,0,.35)');rect({x0:ux,x1:ux+uw,y0:uy,y1:uy+uh},pal.hvac);}
    if(Rb()<.3&&w*h>200){const sx=b.x0+2+Rb()*(w-6),sy=b.y0+2+Rb()*(h-6);rect({x0:sx,x1:sx+2.4,y0:sy,y1:sy+2.4},pal.sky);}
  }
  /* landmarks */
  for(const l of W.landmarks){
    if(l.kind==='dome'){
      const pts=Array.from({length:8},(_,i)=>[l.x+l.r*Math.cos(i*Math.PI/4+Math.PI/8),l.y+l.r*Math.sin(i*Math.PI/4+Math.PI/8)]);
      const gr=g.createRadialGradient(X(l.x-l.r*.35),Y(l.y+l.r*.35),l.r*S*.1,X(l.x),Y(l.y),l.r*S*1.05);gr.addColorStop(0,pal.dome[0]);gr.addColorStop(.6,pal.dome[1]);gr.addColorStop(1,pal.dome[2]);
      g.fillStyle=gr;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(X(p[0]),Y(p[1])):g.moveTo(X(p[0]),Y(p[1])));g.closePath();g.fill();
      for(const p of pts)line(l.x,l.y,p[0],p[1],'rgba(20,26,22,.55)',.25);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;line(l.x+Math.cos(a)*l.r*.25,l.y+Math.sin(a)*l.r*.25,l.x+Math.cos(a)*l.r*.9,l.y+Math.sin(a)*l.r*.9,'rgba(255,255,255,.12)',.15);}
      disc(l.x,l.y,l.r*.2,pal.dome[0]);disc(l.x,l.y,l.r*.09,'#dfe6df');
    }else if(l.kind==='cone'){
      const gr=g.createRadialGradient(X(l.x-l.r*.3),Y(l.y+l.r*.3),l.r*S*.1,X(l.x),Y(l.y),l.r*S);gr.addColorStop(0,pal.glass[0]);gr.addColorStop(.7,pal.glass[1]);gr.addColorStop(1,pal.glass[2]);
      g.fillStyle=gr;g.beginPath();g.arc(X(l.x),Y(l.y),l.r*S,0,Math.PI*2);g.fill();
      for(let i=0;i<24;i++){const a=i*Math.PI/12;line(l.x,l.y,l.x+Math.cos(a)*l.r,l.y+Math.sin(a)*l.r,'rgba(210,230,240,.22)',.12);}
      for(const f of[.35,.62,.86]){g.strokeStyle='rgba(210,230,240,.25)';g.lineWidth=.14*S;g.beginPath();g.arc(X(l.x),Y(l.y),l.r*f*S,0,Math.PI*2);g.stroke();}
    }else if(l.kind==='shot'){disc(l.x+SHD.dx*1.2,l.y+SHD.dy*1.2,l.r,'rgba(0,0,0,.4)');disc(l.x,l.y,l.r,pal.brick);disc(l.x-.6,l.y+.6,l.r*.6,rgba(hexRgb(pal.brick).map(v=>v*1.2),1));}
  }
  /* trees */
  for(const t of W.trees){const L=t.r*1.15;disc(t.x+SHD.dx*L,t.y+SHD.dy*L,t.r*.95,'rgba(4,6,4,.5)');}
  for(const t of W.trees){
    const gr=g.createRadialGradient(X(t.x-t.r*.35),Y(t.y+t.r*.35),0,X(t.x),Y(t.y),t.r*S);gr.addColorStop(0,pal.tree[3]);gr.addColorStop(.55,pal.tree[2]);gr.addColorStop(1,pal.tree[1]);
    disc(t.x,t.y,t.r,pal.tree[0]);g.fillStyle=gr;g.beginPath();g.arc(X(t.x),Y(t.y),t.r*.92*S,0,Math.PI*2);g.fill();
    for(let i=0;i<4;i++){const a=R()*Math.PI*2,d=R()*t.r*.55;disc(t.x+Math.cos(a)*d,t.y+Math.sin(a)*d,t.r*(.18+R()*.18),rgba(hexRgb(pal.tree[3]),.35));}
  }
  /* sensor grain + low-frequency tone */
  const nz=document.createElement('canvas');nz.width=nz.height=256;const nctx=nz.getContext('2d');const id=nctx.createImageData(256,256);
  for(let i=0;i<id.data.length;i+=4){const v=128+(R()-.5)*76;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255;}nctx.putImageData(id,0,0);
  g.globalCompositeOperation='overlay';g.globalAlpha=.24;g.fillStyle=g.createPattern(nz,'repeat');g.fillRect(0,0,cw,ch);
  const lf=document.createElement('canvas');lf.width=128;lf.height=120;const lctx=lf.getContext('2d');const ld=lctx.createImageData(128,120);
  for(let j=0;j<120;j++)for(let i=0;i<128;i++){const v=fbm(i*.06,j*.06,4,5)*255;const k=(j*128+i)*4;ld.data[k]=ld.data[k+1]=ld.data[k+2]=v;ld.data[k+3]=255;}
  lctx.putImageData(ld,0,0);g.globalCompositeOperation='soft-light';g.globalAlpha=.35;g.imageSmoothingEnabled=true;g.drawImage(lf,0,0,cw,ch);
  g.globalCompositeOperation='source-over';g.globalAlpha=1;
  return cv;
}

const VEC={
  light:{land:'#EEF1F0',foot:'#F7F8F7',road:'#FFFFFF',casing:'#D2D9D8',lane:'#F9FAFA',park:'#D5E8D2',tree:'rgba(142,190,138,.55)',tram:'#AEB9BC',bike:'#CDE7D5',zebra:'#E1E7E6',bldg:'#DEE3E2',bldgEdge:'#C5CDCC',bldgSide:'#CFD6D5',plaza:'#F1F1EC',label:'#4F6064',halo:'rgba(255,255,255,.92)',poi:'#6E7F84',dome:'#C9D6CD',glass:'#CFE0EA',marking:'#DDE3E2',platform:'#E4E6E1'},
  dark:{land:'#0D1215',foot:'#151C21',road:'#20292F',casing:'#2C383F',lane:'#1A2328',park:'#132519',tree:'rgba(64,112,74,.45)',tram:'#3A4951',bike:'#1B3527',zebra:'#34424A',bldg:'#1A2328',bldgEdge:'#2A363E',bldgSide:'#0A0F12',plaza:'#171F24',label:'#9AABB2',halo:'rgba(9,13,16,.92)',poi:'#7C8E97',dome:'#2B3A33',glass:'#1B2E3A',marking:'#35434B',platform:'#28323A'}};

function drawVector(c,V,W,pal){
  const X=x=>V.X(x),Y=y=>V.Y(y),s=V.s;
  const rect=(r,col)=>{c.fillStyle=col;c.fillRect(X(r.x0),Y(r.y1),(r.x1-r.x0)*s,(r.y1-r.y0)*s);};
  c.fillStyle=pal.land;c.fillRect(0,0,V.w,V.h);
  for(const st of W.streets)rect(streetRect(st),pal.foot);
  for(const st of W.streets){const r=carriage(st);rect(r,pal.road);}
  c.strokeStyle=pal.casing;c.lineWidth=1;
  for(const st of W.streets){const r=carriage(st);if(st.axis==='h'){for(const y of[r.y0,r.y1]){c.beginPath();c.moveTo(0,Y(y));c.lineTo(V.w,Y(y));c.stroke();}}else{for(const x of[r.x0,r.x1]){c.beginPath();c.moveTo(X(x),0);c.lineTo(X(x),V.h);c.stroke();}}}
  for(const l of W.lanes)rect(l,pal.lane);
  for(const st of W.streets){
    const H=st.axis==='h';
    if(st.bike)for(const sg of[-1,1])for(const[a,b]of freeSpans(st,1)){const lo=st.c+Math.min(sg*8.25,sg*10.5),hi=st.c+Math.max(sg*8.25,sg*10.5);rect(H?{x0:a,x1:b,y0:lo,y1:hi}:{x0:lo,x1:hi,y0:a,y1:b},pal.bike);}
    if(st.tram&&s>1.6){c.strokeStyle=pal.tram;c.lineWidth=Math.max(1,s*.25);c.setLineDash([Math.max(3,s*1.2),Math.max(2,s*.8)]);for(const o of[-2,2]){c.beginPath();if(H){c.moveTo(0,Y(st.c+o));c.lineTo(V.w,Y(st.c+o));}else{c.moveTo(X(st.c+o),0);c.lineTo(X(st.c+o),V.h);}c.stroke();}c.setLineDash([]);}
    if(st.main&&s>3){c.strokeStyle=pal.marking;c.lineWidth=1;c.setLineDash([s*3,s*6]);for(const o of(st.tram?[-4.2,4.2]:[-3.6,3.6,-7.2,7.2]))for(const[a,b]of freeSpans(st,4)){c.beginPath();if(H){c.moveTo(X(a),Y(st.c+o));c.lineTo(X(b),Y(st.c+o));}else{c.moveTo(X(st.c+o),Y(a));c.lineTo(X(st.c+o),Y(b));}c.stroke();}c.setLineDash([]);}
  }
  if(s>2.4)for(const h of W.streets.filter(q=>q.axis==='h'&&q.w>=20))for(const v of W.streets.filter(q=>q.axis==='v'&&q.w>=20)){const hw=h.w/2-h.fp,vw=v.w/2-v.fp;for(const sg of[-1,1]){const xc=v.c+sg*(v.w/2+2.2);for(let y=h.c-hw+.3;y<h.c+hw-.3;y+=1.1)rect({x0:xc-1.8,x1:xc+1.8,y0:y,y1:y+.55},pal.zebra);const yc=h.c+sg*(h.w/2+2.2);for(let x=v.c-vw+.3;x<v.c+vw-.3;x+=1.1)rect({x0:x,x1:x+.55,y0:yc-1.8,y1:yc+1.8},pal.zebra);}}
  for(const p of W.platforms)rect(p,pal.platform);
  for(const p of W.plazas)rect(p,pal.plaza);
  for(const p of W.parks)rect(p,pal.park);
  c.strokeStyle=pal.foot;c.lineWidth=Math.max(1,s*2);for(const pth of W.paths){c.beginPath();c.moveTo(X(pth[0][0]),Y(pth[0][1]));c.lineTo(X(pth[1][0]),Y(pth[1][1]));c.stroke();}
  /* buildings with a soft extrusion */
  for(const b of W.buildings){const e=Math.min(b.h,90)*.045;c.fillStyle=pal.bldgSide;c.fillRect(X(b.x0+e*.8),Y(b.y1-e),(b.x1-b.x0)*s,(b.y1-b.y0)*s);}
  for(const b of W.buildings){rect(b,pal.bldg);c.strokeStyle=pal.bldgEdge;c.lineWidth=1;c.strokeRect(X(b.x0)+.5,Y(b.y1)+.5,(b.x1-b.x0)*s-1,(b.y1-b.y0)*s-1);}
  for(const l of W.landmarks){c.fillStyle=l.kind==='dome'?pal.dome:l.kind==='cone'?pal.glass:pal.bldgEdge;c.strokeStyle=pal.bldgEdge;c.beginPath();c.arc(X(l.x),Y(l.y),l.r*s,0,Math.PI*2);c.fill();c.stroke();}
  c.fillStyle=pal.tree;for(const t of W.trees){c.beginPath();c.arc(X(t.x),Y(t.y),t.r*s*.8,0,Math.PI*2);c.fill();}
}

const LANDMARK_LABELS=[
  {x:130,y:-82,t:'STATE LIBRARY VICTORIA',zh:'维多利亚州立图书馆',min:1.8},{x:-100,y:-30,t:'MELBOURNE CENTRAL',zh:'墨尔本中央购物中心',min:1.8},{x:90,y:62,t:'RMIT UNIVERSITY',zh:'皇家墨尔本理工大学',min:1.8},
  {x:-86,y:-66,t:"COOP'S SHOT TOWER",zh:'库普制弹塔',min:5}];
function drawLabels(c,V,W,pal){
  c.save();c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
  const size=V.s>5?11:10;
  c.font=`500 ${size}px ${FONT_MONO}`;
  try{c.letterSpacing='1.5px';}catch(e){}
  for(const st of W.streets){
    if(st.little&&V.s<2.2)continue;
    const txt=L(st.name.toUpperCase(),st.zh);const tw=c.measureText(txt).width+12;
    const H=st.axis==='h',step=Math.max(520,tw*2.2)/V.s;
    const lo=H?V.wx(0):V.wy(V.h),hi=H?V.wx(V.w):V.wy(0);
    const spans=freeSpans(st,tw/2/V.s+2);
    for(let u=Math.floor(lo/step)*step+step*.5;u<hi;u+=step){
      if(!spans.some(([a,b])=>u>a&&u<b))continue;
      const off=st.tram?0:0;const px=H?V.X(u):V.X(st.c+off),py=H?V.Y(st.c+off):V.Y(u);
      c.save();c.translate(px,py);if(!H)c.rotate(-Math.PI/2);
      c.strokeStyle=pal.halo;c.lineWidth=3.2;c.strokeText(txt,0,0);c.fillStyle=pal.label;c.fillText(txt,0,0);c.restore();
    }
  }
  c.font=`500 9.5px ${FONT_MONO}`;
  for(const l of LANDMARK_LABELS){if(V.s<l.min)continue;const px=V.X(l.x),py=V.Y(l.y);if(px<-100||py<-20||px>V.w+100||py>V.h+20)continue;const t=L(l.t,l.zh);c.strokeStyle=pal.halo;c.lineWidth=3;c.strokeText(t,px,py);c.fillStyle=pal.poi;c.fillText(t,px,py);}
  try{c.letterSpacing='0px';}catch(e){}
  c.restore();
}
