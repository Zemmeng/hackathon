/* ============================================================
   T45 · VMS lab (01 Configure › Signs). The same plan with only VMS-1's words changed — or only where it stands —
   scored side by side by the engine, with the one it recommends. Click a row or a distance to use it.
   Every number is BE.api.run() on planFrom(); nothing is typed into the page. The wordings are built from the engine's
   own routes (now_min, turn_m) and delay, so a sign never claims more minutes than the engine gives.
   Hooks (one line each): 5-app.js signs tab → vlabHTML() + vlMount(); 6-engine.js engRun() → vlAfterRun().
   ============================================================ */
/* vlab-pure:begin — tests/test_vlab.py runs this block in node */
const VL_AT=[60,150,300,500]; // distances upstream tried for the recommended wording (m); the slider allows 40–1000
const VL_WARN=[['ROADWORK','AHEAD']];
// A road name as one VMS line (≤ 10 characters), same shortening as the engine advisor; too long → null (never cut mid-word)
function vlRoad(name){
  let s=String(name||'').toUpperCase().replace(/[^A-Z0-9 .,'&/:+-]/g,' ').replace(/\s+/g,' ').trim();
  if(s&&s.length<=10)return s;
  s=s.replace(/\s+(STREET|ST|ROAD|RD|AVENUE|AVE|LANE|LN|PARADE|PDE)$/,'');
  return s&&s.length<=10?s:null;
}
// Wordings to try, from the no-guidance run b (ROADWORK AHEAD only): { k, frames }. Minutes on the sign come from b.
function vlCands(b){
  const rs=(b&&b.routes)||[],stay=rs.find(r=>r.id==='stay');
  const alts=rs.filter(r=>r.id!=='stay'&&Number.isFinite(r.now_min)).sort((x,y)=>x.now_min-y.now_min||(x.turn_m||0)-(y.turn_m||0));
  const out=[{k:'base',frames:VL_WARN},{k:'vague',frames:[['EXPECT','DELAYS']]}];
  const st=vlRoad(b&&b.street);if(st)out.push({k:'avoid',frames:[['AVOID',st]]});
  const dm=Math.round(((b&&b.mean_delay_s)||0)/60);if(dm>=2)out.push({k:'delay',frames:[['DELAYS',`${Math.min(dm,99)} MIN`]]});
  for(const r of alts.slice(0,2)){const n=vlRoad(r.name);if(n)out.push({k:'use',road:r.name,turn_m:r.turn_m,frames:[['USE',n]]});}
  const r0=alts[0],n0=r0&&vlRoad(r0.name),save=stay&&r0?Math.round(stay.now_min-r0.now_min):0;
  if(n0&&save>=1)out.push({k:'save',road:r0.name,turn_m:r0.turn_m,frames:[['USE',n0],['SAVE',`${Math.min(save,99)} MIN`]]});
  return out;
}
const vlWords=f=>f.flat().join(' ').split(/\s+/).filter(Boolean).length;
// Recommended row: shortest queue; a tie goes to fewer words (less to read at speed). -1 when nothing beats the baseline.
function vlBest(rows){
  const base=rows.find(r=>r.k==='base');let bi=-1;
  rows.forEach((r,i)=>{if(!Number.isFinite(r.q))return;const b=rows[bi];if(!b||r.q<b.q||(r.q===b.q&&vlWords(r.frames)<vlWords(b.frames)))bi=i;});
  return bi>=0&&base&&rows[bi].q<base.q?bi:-1;
}
const vlText=f=>f.map(x=>x.join(' ')).join(' ▸ ');
/* vlab-pure:end */

const VL={key:'',at:null,seq:0,busy:false,rows:[],spots:[],best:-1,base:null,err:null,src:''};
const vlKey=()=>[EP.link,EP.hour,EP.lanes,EP.all,EP.foot,EP.vmsAt,EP.sign,EP.signAt,EP.arrowAt,JSON.stringify(EP.time)].join('|');
const vlPlan=(frames,at)=>planFrom({...EP,f1:frames[0].join('\n'),f2:(frames[1]||[]).join('\n'),vmsAt:at==null?EP.vmsAt:at});
const vlOk=p=>{try{return BE.api.check(p).every(c=>c.ok);}catch(e){return false;}};
// Not a .stack: 7-glass.js compactPanel() folds top-level .stack sections, and the lab must stay open in compact mode (demo)
function vlabHTML(){return BE.api&&EP.link?'<div id="vlab" class="vlab"></div>':'';}
function vlMount(){vlRender();if(EP.tab1==='signs'&&S.step===1&&vlKey()!==VL.key)vlRun();}
function vlAfterRun(){if(EP.tab1==='signs'&&S.step===1)vlRender();} // the typed text changed or the slider moved: update marks, don't re-score
// Score every wording at the current distance, then the recommended one at VL_AT. Rows appear one by one.
async function vlRun(){
  if(!engOn())return;
  const seq=++VL.seq;Object.assign(VL,{key:vlKey(),at:EP.vmsAt,busy:true,rows:[],spots:[],best:-1,base:null,err:null,src:''});vlRender();
  try{
    const b=await BE.api.run(vlPlan(VL_WARN));if(seq!==VL.seq)return;
    VL.base=b;VL.src=(b.flags&&b.flags.reading_src)||'';
    for(const c of vlCands(b)){
      const p=vlPlan(c.frames);if(!vlOk(p))continue;
      const s=c.k==='base'?b:await BE.api.run(p);if(seq!==VL.seq)return;
      VL.rows.push({...c,q:s.queue_m,d:s.mean_delay_s,share:s.detour_share});VL.best=vlBest(VL.rows);vlRender();
    }
    const w=VL.rows[VL.best];
    if(w)for(const at of VL_AT){const s=await BE.api.run(vlPlan(w.frames,at));if(seq!==VL.seq)return;VL.spots.push({at,q:s.queue_m});vlRender();}
  }catch(e){if(seq!==VL.seq)return;VL.err=e;console.warn('VMS lab failed',e);}
  VL.busy=false;vlRender();
}
function vlUse(frames,at){EP.f1=frames[0].join('\n');EP.f2=(frames[1]||[]).join('\n');if(at!=null)EP.vmsAt=at;renderPanel();engChanged(0);}
function vlHTML(){
  const head=`<div class="row between"><span class="eyebrow">${L('VMS lab · same plan, other words','VMS 试验台 · 同一方案只换字')}</span><span class="eyebrow">${engHour(EP.hour)} · ${fmtN(VL.at==null?EP.vmsAt:VL.at)} m</span></div>`;
  if(VL.err)return head+`<p class="small" style="color:var(--risk)">${L('The lab could not score the wordings.','试验台算不出来。')} ${esc(VL.err.message||VL.err)}</p>`;
  if(!VL.rows.length)return head+`<p class="small muted">${L('Scoring each wording on the real CBD network…','正在真实 CBD 路网上逐条计算…')}</p>`;
  const cur=[parseFrame(EP.f1),parseFrame(EP.f2)].filter(f=>f.length),same=f=>JSON.stringify(f)===JSON.stringify(cur);
  const max=Math.max(...VL.rows.map(r=>r.q||0),1),order=VL.rows.map((r,i)=>i).sort((a,b)=>VL.rows[a].q-VL.rows[b].q);
  const tag=(t,c)=>`<i class="tag${c?' '+c:''}">${t}</i>`;
  const rows=order.map(i=>{const r=VL.rows[i],best=i===VL.best;
    return`<button type="button" class="vlab-row${best?' best':''}" data-vl="${i}" aria-current="${same(r.frames)}"><span class="tx">${esc(vlText(r.frames))}${best?tag(L('Recommended','推荐')):''}${r.k==='base'?tag(L('Baseline','基准'),'base'):''}${same(r.frames)?tag(L('Yours','当前'),'cur'):''}</span><span class="track"><i style="width:${Math.max(2,Math.round((r.q||0)/max*100))}%"></i></span><span class="n">${fmtN(r.q)} m</span></button>`;}).join('');
  const w=VL.rows[VL.best],base=VL.rows.find(r=>r.k==='base');
  const rec=w&&base?`<p class="vlab-rec">${L(`Recommended: <b>${esc(vlText(w.frames))}</b> — queue ${fmtN(base.q)} → ${fmtN(w.q)} m (−${fmtN(base.q-w.q)} m). Same sign, same hire; only the words change.`,`推荐 <b>${esc(vlText(w.frames))}</b>：排队 ${fmtN(base.q)} → ${fmtN(w.q)} m（少 ${fmtN(base.q-w.q)} m）。同一块屏、同样租金，只换了字。`)}</p>`
    :base?`<p class="vlab-rec muted">${L('No wording beats the plain warning at this hour.','这个时段没有比「前方施工」更好的写法。')}</p>`:'';
  const turn=w&&Number.isFinite(w.turn_m)?w.turn_m:null;
  const spots=w&&VL.spots.length?`<div class="stack vlab-spots"><span class="eyebrow">${L('Where it stands · recommended words','摆在哪 · 用推荐的字')}${turn!=null?` · ${L(`turn into ${esc(shortSt(w.road))} ${fmtN(turn)} m before the works`,`拐进 ${esc(shortSt(w.road))} 的路口在施工前 ${fmtN(turn)} m`)}`:''}</span><div class="chips">${VL.spots.map(p=>{const late=turn!=null&&p.at<=turn;
      return`<button type="button" data-vlat="${p.at}" aria-pressed="${p.at===EP.vmsAt&&same(w.frames)}">${fmtN(p.at)} m · ${fmtN(p.q)} m${late?` · ${L('past the turn','已过拐口')}`:''}</button>`;}).join('')}</div></div>`:'';
  const src=VL.src==='llm'?L('AI reads the sign','大模型读屏'):VL.src?L('rule-based reading','规则读屏'):'';
  return head+`<div class="vlab-rows">${rows}</div>${rec}${spots}<p class="legend-src">${L(`Each row: the engine on this plan with only VMS-1 changed · queue on the main approach, this hour${src?` · ${src}`:''} · minutes on the sign come from the engine's own route times.${VL.busy?' Scoring…':''}`,`每一行：引擎在这份方案上只换 VMS-1 算的 · 主进口道这一小时的排队${src?` · ${src}`:''} · 屏上的分钟数取自引擎算的路线时间。${VL.busy?' 计算中…':''}`)}${VL.key&&VL.key!==vlKey()?` <button type="button" class="linkbtn" data-vlre>${L('Settings changed — re-score','设置变了 · 重算')}</button>`:''}</p>`;
}
function vlRender(){
  const el=document.getElementById('vlab');if(!el)return;const h=vlHTML();if(el.dataset.sig===h)return;el.innerHTML=h;el.dataset.sig=h;
  el.querySelectorAll('[data-vl]').forEach(b=>b.onclick=()=>{const r=VL.rows[+b.dataset.vl];if(r)vlUse(r.frames);});
  el.querySelectorAll('[data-vlat]').forEach(b=>b.onclick=()=>{const r=VL.rows[VL.best];if(r)vlUse(r.frames,+b.dataset.vlat);});
  const re=el.querySelector('[data-vlre]');if(re)re.onclick=()=>vlRun();
}
