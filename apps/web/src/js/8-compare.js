'use strict';
/* ============================================================
   Compare · choose · export (T23 · D-0929-2011 ④ · #48 steps ④⑦⑧), under the advisor in step 4.
   Up to 3 plans side by side: the plan in the form + the advisor's alternatives, each re-run by backend.js run() for this
   hour (car delay, tram & bus riders, pedestrians). Hire cost is /api/public/js/pack.js quote() on the RPM inventory
   (apps/roads equipment.json, assumed day rates, labelled as such) over the whole works period. A person picks one and
   writes why; the one-page pack is pack.js buildPack() + packText(), shown as text (textContent) to print or copy.
   T22's inventory-based options slot in at cmpSources(). Nothing here computes a traffic number itself.
   ============================================================ */

/* pure:begin — tests/compare_glue.mjs runs this block in node */
const CMP_MAX=3;
// Plans to compare: the form's plan first, then advisor alternatives that change this hour (a date shift is judged over
// the whole works period, so it stays in the advisor list above). Ids A, B, C are what the pack's decision line shows.
function cmpSources(plan,adv){
  const out=[{id:'A',kind:'now',plan}];
  for(const o of (adv&&adv.options)||[]){
    if(out.length>=CMP_MAX)break;
    if(!o||!o.plan||o.skipped||o.kind==='shift')continue;
    out.push({id:String.fromCharCode(65+out.length),kind:o.kind,plan:o.plan,frames:o.frames||null,equipment:o.equipment||null,at_m:o.at_m==null?null:o.at_m});
  }
  return out;
}
// run() summary → the three traffic numbers on a card (null = the engine has no data for it)
function cmpNumbers(s){
  if(!s)return{car:null,transit:null,peds:null};
  return{car:Number.isFinite(s.delay_min)?s.delay_min:null,
    transit:s.transit&&s.transit.src&&Number.isFinite(s.transit.pax_min)?s.transit.pax_min:null,
    peds:s.peds&&s.peds.src&&Number.isFinite(s.peds.extra_min)?s.peds.extra_min:null};
}
// Lowest per metric → { key: [row indexes] }. Nothing is marked when fewer than 2 plans have the number or all are equal.
function cmpBest(rows,keys){
  const out={};
  for(const k of keys){
    const vs=rows.map((r,i)=>[i,r&&r[k]]).filter(([,v])=>Number.isFinite(v));
    if(vs.length<2)continue;const lo=Math.min(...vs.map(([,v])=>v)),hi=Math.max(...vs.map(([,v])=>v));
    if(lo===hi)continue;out[k]=vs.filter(([,v])=>v===lo).map(([i])=>i);
  }
  return out;
}
// What a plan puts on the VMS, frame by frame (for the card; set with textContent)
function cmpVms(plan){
  const ws=plan&&plan.worksites&&plan.worksites[0],v=ws&&(ws.equipment||[]).find(e=>e.type==='vms');
  return v&&v.frames?v.frames.map(f=>f.join(' / ')).join('  ▸  '):'';
}
/* pure:end */

const CP={key:'',seq:0,busy:false,rows:[],pick:null,by:'contractor',reason:'',mod:null,inv:null,invErr:null,loading:null};

// pack.js (quote, pack, text) + explain.js (only optionFromRun: run() summary → the metrics the pack's notice list uses) + inventory
function cmpLoad(){
  if(CP.loading)return CP.loading;
  CP.loading=Promise.all([import('/api/public/js/pack.js'),import('/api/public/js/explain.js')])
    .then(async([pack,ex])=>{CP.mod={pack,ex};try{CP.inv=await pack.loadInventory();}catch(e){CP.invErr=e;console.warn('equipment inventory not loaded',e);}})
    .catch(e=>{CP.invErr=e;console.warn('pack module not loaded',e);});
  return CP.loading;
}
// The engine's own link records carry len_m / name / lanes / tram, which is all pack.js reads
function cmpLinks(ws){const net=engNet(),m=new Map();if(!net||!ws)return m;for(const id of ws.links||[]){const l=net.links.get(id);if(l)m.set(id,l);}return m;}
function cmpLabel(r){return r.kind==='now'?L('Your plan','现在的方案'):r.kind==='text'?L('Reword the VMS','改屏上的字'):r.kind==='move'?L('Move the VMS','挪 VMS'):r.kind;}
function cmpWhat(r){return r.kind==='move'?(r.equipment||'VMS')+' → '+r.at_m+' m '+L('upstream','上游'):cmpVms(r.plan)||L('No VMS','没有 VMS');} // textContent only

async function cmpUpdate(){
  if(!engOn()||EP.badText||!EP.adv)return;
  const srcs=cmpSources(planFrom(EP),EP.adv),key=JSON.stringify(srcs.map(x=>x.plan));
  if(key===CP.key)return;
  CP.key=key;CP.rows=[];CP.pick=null;CP.busy=true;const seq=++CP.seq;
  const rows=[];
  for(const x of srcs){let s=null;try{s=await BE.api.run(x.plan);}catch(e){console.warn('compare: run failed',e);}rows.push({...x,s});}
  await cmpLoad();
  for(const r of rows){
    const ws=r.plan.worksites[0];r.hire=null;r.days=null;
    if(CP.mod&&CP.inv){try{const q=CP.mod.pack.quote(ws,CP.inv,{links:cmpLinks(ws)});r.hire=q.total_aud;r.days=q.days;r.partial=q.total_aud===null;}catch(e){console.warn('compare: quote failed',e);}}
  }
  if(seq!==CP.seq)return;
  CP.rows=rows;CP.busy=false;cmpRender();
}

function cmpHTML(){
  if(!engOn()||EP.badText)return'';
  const head=`<div class="between cmp-head"><span class="eyebrow" style="color:var(--sun-ink)">${L('Compare plans · choose one','方案对比 · 选一套')}</span><span class="eyebrow">${engHour(EP.hour)}</span></div>`;
  if(!EP.adv)return head+`<div class="card eng-note"><b>${EP.advBusy?L('Waiting for the advisor’s alternatives…','等顾问给出其他方案…'):L('No alternatives to compare yet','还没有可以对比的方案')}</b></div>`;
  if(CP.busy||!CP.rows.length)return head+`<div class="card eng-note"><b>${L('Scoring each plan on the real CBD network…','正在真实 CBD 路网上逐套计算…')}</b></div>`;
  if(CP.rows.length<2)return head+`<div class="card eng-note"><b>${L('The advisor found no alternative for this hour — only your plan to compare.','顾问这个时段没有别的改法 —— 只有现在这一套。')}</b></div>`;
  const nums=CP.rows.map(r=>({...cmpNumbers(r.s),hire:r.hire})),best=cmpBest(nums,['car','transit','peds','hire']);
  const mark=(k,i)=>best[k]&&best[k].includes(i)?`<i class="cmp-best">${L('lowest','最少')}</i>`:'';
  const cell=(k,i,v,unit)=>`<div><span class="eyebrow">${{car:L('Car delay','车延误'),transit:L('Tram & bus','电车公交'),peds:L('On foot','行人'),hire:L('Hire','租金')}[k]}</span><b>${v}</b><small>${unit}</small>${mark(k,i)}</div>`;
  const cards=CP.rows.map((r,i)=>{
    const n=nums[i],ok=!!r.s,picked=CP.pick===i;
    return`<div class="card cmp-card" aria-current="${picked}"><div class="cmp-hd"><b>${String.fromCharCode(65+i)} · ${esc(cmpLabel(r))}</b><span class="chips"><button type="button" data-cmppick="${i}" aria-pressed="${picked}" ${ok?'':'disabled'}>${picked?L('Chosen','已选'):L('Choose this','选这个')}</button></span></div>
      <span class="cmp-what" data-cmpwhat="${i}"></span>
      ${ok?`<div class="cmp-nums">${cell('car',i,n.car==null?'—':fmtN(n.car),L('veh·min','车·分钟'))}${cell('transit',i,n.transit==null?'—':fmtN(n.transit),L('rider·min','人·分钟'))}${cell('peds',i,n.peds==null?'—':fmtN(n.peds),L('ped·min','人·分钟'))}${cell('hire',i,r.hire==null?'—':'A$'+fmtN(r.hire),r.days?L(`${fmtN(r.days)} days · assumed`,`${fmtN(r.days)} 天 · 假设值`):L('no inventory','无库存数据'))}</div>`
        :`<p class="small" style="color:var(--risk)">${L('The engine could not score this plan.','引擎算不了这套方案。')}</p>`}</div>`;}).join('');
  let h=head+`<div class="cmp-cards">${cards}</div>
    <p class="legend-src">${L(`Car, tram & bus and on-foot numbers: engine, this hour (${engHour(EP.hour)}), person- or vehicle-minutes. Hire: RPM inventory × day rate × works days — day rates and stock are assumptions, RPM Hire’s formal quote applies.`,`车、电车公交、行人：引擎算的这一小时（${engHour(EP.hour)}），单位是车·分钟或人·分钟。租金：RPM 库存 × 日租价 × 施工天数 —— 日租价和库存件数是假设值，以 RPM Hire 正式报价为准。`)}</p>`;
  if(CP.pick!=null&&CP.rows[CP.pick]){
    h+=`<div class="stack cmp-choose"><div class="between cmp-head"><span class="eyebrow">${L('Decision','决定')} · ${String.fromCharCode(65+CP.pick)}</span><span class="eyebrow">${L('a person decides, not the tool','由人拍板，工具只给数字')}</span></div>
      <div class="chips">${[['contractor',L('Contractor','施工方')],['council',L('Council','市政')]].map(([k,t])=>`<button type="button" data-cmpby="${k}" aria-pressed="${CP.by===k}">${t}</button>`).join('')}</div>
      <textarea id="cmpReason" rows="2" maxlength="280" aria-label="${L('Why this plan','为什么选这套')}" placeholder="${L('Why this plan? e.g. shortest queue, trams keep running','为什么选这套？例如排队最短、电车照常运行')}"></textarea>
      <button type="button" class="btn" id="cmpExport" ${CP.mod&&CP.inv?'':'disabled'}>${L('Export one-page pack →','导出一页执行包 →')}</button>
      ${CP.invErr?`<p class="small" style="color:var(--risk)">${L('Equipment inventory not loaded — the pack needs it for the equipment list and hire quote.','设备库存没加载上 —— 执行包要用它列设备清单和报价。')}</p>`:''}</div>`;
  }
  return h;
}

function cmpRender(){
  const el=document.getElementById('cmp4');if(!el)return;
  cmpUpdate();
  const h=cmpHTML();if(el.dataset.sig===h)return;el.innerHTML=h;el.dataset.sig=h;
  el.querySelectorAll('[data-cmpwhat]').forEach(x=>{const r=CP.rows[+x.dataset.cmpwhat];x.textContent=r?cmpWhat(r):'';});
  el.querySelectorAll('[data-cmppick]').forEach(b=>b.onclick=()=>{CP.pick=+b.dataset.cmppick;cmpRender();});
  el.querySelectorAll('[data-cmpby]').forEach(b=>b.onclick=()=>{CP.by=b.dataset.cmpby;cmpRender();});
  const ta=document.getElementById('cmpReason');if(ta){ta.value=CP.reason;ta.oninput=()=>{CP.reason=ta.value;};}
  const ex=document.getElementById('cmpExport');if(ex)ex.onclick=cmpExport;
}

// Chosen plan → pack.js execution pack → a print / copy sheet. Every string goes in with textContent.
function cmpExport(){
  const r=CP.rows[CP.pick];if(!r||!r.s||!CP.mod||!CP.inv)return;
  const ws=r.plan.worksites[0],lang=LANG.cur==='zh'?'zh':'en';let txt='';
  try{
    const impacts=CP.mod.ex.optionFromRun(r.id,'plan',r.s).metrics;
    const p=CP.mod.pack.buildPack({...ws,title:ws.name,status:'decided',decision:{option:r.id,by:CP.by,reason:CP.reason.trim(),at:new Date().toISOString()}},{inventory:CP.inv,links:cmpLinks(ws),impacts});
    txt=CP.mod.pack.packText(p,lang);
  }catch(e){console.warn('export failed',e);toast(L('Could not build the pack','执行包生成失败'));return;}
  let sh=document.getElementById('cmpSheet');
  if(!sh){sh=document.createElement('div');sh.id='cmpSheet';sh.className='cmp-sheet';sh.setAttribute('role','dialog');sh.setAttribute('aria-modal','true');document.body.appendChild(sh);}
  sh.innerHTML=`<div class="cmp-doc"><div class="between no-print"><b>${L('Execution pack','执行包')}</b><span class="cmp-acts"><button type="button" class="btn ghost" id="cmpCopy">${L('Copy','复制')}</button><button type="button" class="btn" id="cmpPrint">${L('Print / save PDF','打印 / 存 PDF')}</button><button type="button" class="btn ghost" id="cmpClose">${L('Close','关闭')}</button></span></div><pre id="cmpText"></pre></div>`;
  document.getElementById('cmpText').textContent=txt;
  const close=()=>{sh.hidden=true;document.removeEventListener('keydown',esc1);};
  const esc1=e=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',esc1);
  document.getElementById('cmpClose').onclick=close;
  sh.onclick=e=>{if(e.target===sh)close();};
  document.getElementById('cmpPrint').onclick=()=>window.print();
  document.getElementById('cmpCopy').onclick=()=>{const done=()=>toast(L('Pack copied','已复制执行包'));try{navigator.clipboard.writeText(txt).then(done,()=>toast(L('Copy failed — select the text and copy it','复制失败 —— 请手动选中复制')));}catch(e){toast(L('Copy failed — select the text and copy it','复制失败 —— 请手动选中复制'));}};
  sh.hidden=false;document.getElementById('cmpClose').focus();
}
