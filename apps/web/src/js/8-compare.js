'use strict';
/* ============================================================
   Compare · choose · export (T23 · D-0929-2011 ④ · #48 steps ④⑦⑧), under the advisor in step 4.
   Up to 3 plans side by side. Normally they are T22's be.options(): cheapest / standard / guided kits drawn from the RPM
   inventory, each run by the engine for this hour, with hire and stock checks — every number comes from backend.js.
   If options() is missing or fails (e.g. no inventory), fall back to the plan in the form + the advisor's alternatives,
   each re-run by run(), with hire from /api/public/js/pack.js quote() (same inventory, same assumed day rates).
   A person picks one and writes why; the one-page pack is pack.js buildPack() + packText(), shown with textContent to
   print or copy. Nothing here computes a traffic number itself.
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
// be.options() result → card rows (A, B, C); result is the engine's brief summary for this hour, hire is over the works period
function cmpFromOptions(res){
  return ((res&&res.options)||[]).slice(0,CMP_MAX).map((o,i)=>({id:String.fromCharCode(65+i),tier:o.id,kind:'kit',label:o.label,label_zh:o.label_zh,plan:o.plan,s:o.result||null,
    hire:o.hire&&Number.isFinite(o.hire.total_aud)?o.hire.total_aud:null,days:res.days==null?null:res.days,flags:o.flags||{}}));
}
// Equipment in a plan by type → { vms, sign, arrow, barrier } counts (qty when the kit gives one)
function cmpKit(plan){
  const ws=plan&&plan.worksites&&plan.worksites[0],k={vms:0,sign:0,arrow:0,barrier:0};
  for(const e of (ws&&ws.equipment)||[])if(e.type in k)k[e.type]+=Number.isInteger(e.qty)&&e.qty>0?e.qty:1;
  return k;
}
// What a plan puts on the VMS, frame by frame (for the card; set with textContent)
function cmpVms(plan){
  const ws=plan&&plan.worksites&&plan.worksites[0],v=ws&&(ws.equipment||[]).find(e=>e.type==='vms');
  return v&&v.frames?v.frames.map(f=>f.join(' / ')).join('  ▸  '):'';
}
// Execution pack → one printable page. d = pack.js packDoc(p, lang); x = { rows: [{ id, label, car, transit, peds, hire }], pick, by, hour, date }
// (the plans compared, numbers from the engine); h = { L, esc, fmt } passed in so tests/compare_glue.mjs runs this in node.
// Every string goes through esc(), every number through fmt(). The page is paper-white in both themes.
function cmpDocHTML(d,x,h){
  const{L,esc,fmt}=h,lb=d.labels,c=lb.cols,aud=v=>v==null?'—':'A$'+fmt(v);
  const ch=(x.rows||[])[x.pick],wp=String(d.when||'').split(' · ');
  const facts=[[lb.when,esc(wp[0]),esc(wp.slice(1).join(' · '))],[lb.decision,ch?esc(ch.id)+' · '+esc(ch.label):esc(d.decision||'—'),ch?esc(x.by||''):''],
    [lb.total,d.quote.total_aud==null?esc(d.quote.at_least)+' '+aud(d.quote.partial_aud):aud(d.quote.total_aud),esc(L('assumed day rates','日租价为假设值'))]];
  const opts=(x.rows||[]).map((r,i)=>`<tr${i===x.pick?' class="pick"':''}><td>${esc(r.id)} · ${esc(r.label)}${i===x.pick?` <em>${esc(L('chosen','已选'))}</em>`:''}</td><td class="n">${r.car==null?'—':fmt(r.car)}</td><td class="n">${r.transit==null?'—':fmt(r.transit)}</td><td class="n">${r.peds==null?'—':fmt(r.peds)}</td><td class="n">${aud(r.hire)}</td></tr>`).join('');
  const eq=d.quote.lines.map(l=>`<tr><td>${esc(l.name||l.item)}${l.over?`<div class="pd-over">${esc(l.over)}</div>`:''}</td><td class="n">${l.qty==null?'?':fmt(l.qty)}</td><td class="n">${l.rate==null?'—':'A$'+fmt(l.rate)+esc(d.quote.per_day)}</td><td class="n">${fmt(l.days)}</td><td class="n">${aud(l.cost)}</td></tr>`).join('');
  const vms=d.vms.map(v=>`<div class="pd-vms"><div class="pd-vms-meta"><b>${esc(v.id)}</b><span>${esc(v.at)}</span><span>${esc(v.when)}</span></div><div class="pd-frames">${v.frames.map(f=>`<figure><figcaption>${esc(f.label)}</figcaption><div class="pd-led">${f.lines.map(esc).join('<br>')}</div></figure>`).join('')}</div></div>`).join('');
  const signs=d.signs.map(g=>`<li><b>${esc(g.id)}</b> · ${esc(g.at)}${g.text?` · <span class="pd-mono">${esc(g.text)}</span>`:''}</li>`).join('');
  const checks=d.checks.length?d.checks.map(k=>`<li>${esc(k)}</li>`).join(''):`<li class="pd-ok">${esc(lb.none)}</li>`;
  const notify=d.notify.map(n=>`<tr><td><b>${esc(n.who)}</b></td><td>${esc(n.why)}</td></tr>`).join('');
  return`<article class="pack-doc" lang="${d.lang==='zh'?'zh-CN':'en'}">
<header class="pd-head"><span>RippleTwin · ${esc(d.head)}</span><span>${esc(x.date||'')}</span></header>
<div class="pd-title"><h1>${esc(d.title)}</h1>${d.status?`<span class="pd-pill">${esc(d.status.text)}</span>`:''}</div>
<p class="pd-sub">${esc(d.id||'')} · ${esc(d.where)}</p>
<div class="pd-facts">${facts.map(([k,v,n])=>`<div><span>${esc(k)}</span><b>${v}</b>${n?`<small>${n}</small>`:''}</div>`).join('')}</div>
${d.reason?`<blockquote class="pd-reason"><span>${esc(lb.reason)}</span>${esc(d.reason)}</blockquote>`:''}
${opts?`<section><h2>${esc(L('Plans compared','比较过的方案'))}</h2><div class="pd-scroll"><table class="pd-t"><thead><tr><th>${esc(L('Plan','方案'))}</th><th class="n">${esc(L('Car delay','车延误'))}<small>${esc(L('veh·min','车·分钟'))}</small></th><th class="n">${esc(L('Tram & bus','电车公交'))}<small>${esc(L('rider·min','人·分钟'))}</small></th><th class="n">${esc(L('On foot','行人'))}<small>${esc(L('ped·min','人·分钟'))}</small></th><th class="n">${esc(L('Hire','租金'))}<small>${esc(L('works period','整个工期'))}</small></th></tr></thead><tbody>${opts}</tbody></table></div><p class="pd-note">${esc(L(`Traffic numbers: simulation engine, weekday ${x.hour}, one hour. Hire: whole works period.`,`车流数字：仿真引擎，工作日 ${x.hour} 这一小时。租金：整个工期。`))}</p></section>`:''}
<section><h2>${esc(lb.quote)}</h2><div class="pd-scroll"><table class="pd-t"><thead><tr><th>${esc(c.item)}</th><th class="n">${esc(c.qty)}</th><th class="n">${esc(c.rate)}</th><th class="n">${esc(c.days)}</th><th class="n">${esc(c.cost)}</th></tr></thead><tbody>${eq}</tbody><tfoot><tr><td colspan="4">${esc(lb.total)}</td><td class="n">${d.quote.total_aud==null?esc(d.quote.at_least)+' '+aud(d.quote.partial_aud):aud(d.quote.total_aud)}</td></tr></tfoot></table></div><p class="pd-note">${esc(d.quote.note)}</p></section>
<section><h2>${esc(lb.vms)}</h2>${vms||`<p class="pd-note">${esc(lb.none)}</p>`}</section>
${signs?`<section><h2>${esc(lb.signs)}</h2><ul class="pd-list">${signs}</ul></section>`:''}
<section class="pd-two"><div><h2>${esc(lb.checks)}</h2><ul class="pd-list pd-checks">${checks}</ul></div><div><h2>${esc(lb.notify)}</h2><table class="pd-t pd-notify"><tbody>${notify}</tbody></table></div></section>
<footer class="pd-foot"><span>${esc(d.foot)}</span><span>RippleTwin</span></footer>
</article>`;
}
/* pure:end */

const CP={key:'',seq:0,busy:false,rows:[],src:'',pick:null,by:'contractor',reason:'',mod:null,inv:null,invErr:null,loading:null,exKey:'',exSeq:0,exBusy:false,explain:null,exError:false};

// Execution pack, AI explanation and inventory; all model text is rendered as textContent.
function cmpLoad(){
  if(CP.loading)return CP.loading;
  CP.loading=Promise.all([import('/api/public/js/pack.js'),import('/api/public/js/explain.js')])
    .then(async([pack,ex])=>{CP.mod={pack,ex};try{CP.inv=await pack.loadInventory();}catch(e){CP.invErr=e;console.warn('equipment inventory not loaded',e);}})
    .catch(e=>{CP.invErr=e;console.warn('pack module not loaded',e);});
  return CP.loading;
}
// The engine's own link records carry len_m / name / lanes / tram, which is all pack.js reads
function cmpLinks(ws){const net=engNet(),m=new Map();if(!net||!ws)return m;for(const id of ws.links||[]){const l=net.links.get(id);if(l)m.set(id,l);}return m;}
function cmpLabel(r){return r.kind==='kit'?L(r.label||r.tier,r.label_zh||r.label||r.tier):r.kind==='now'?L('Your plan','现在的方案'):r.kind==='text'?L('Reword the VMS','改屏上的字'):r.kind==='move'?L('Move the VMS','挪 VMS'):r.kind;}
function cmpWhat(r){ // textContent only
  if(r.kind==='move')return(r.equipment||'VMS')+' → '+r.at_m+' m '+L('upstream','上游');
  const v=cmpVms(r.plan)||L('No VMS','没有 VMS');if(r.kind!=='kit')return v;
  const k=cmpKit(r.plan);
  return v+' · '+[[k.vms,'VMS','VMS','VMS'],[k.barrier,'barrier','barriers','护栏'],[k.sign,'sign','signs','标志牌'],[k.arrow,'arrow board','arrow boards','箭头板']].filter(x=>x[0]>0).map(x=>x[0]+' '+L(x[0]===1?x[1]:x[2],x[3])).join(' · ');
}

async function cmpUpdate(){
  if(!engOn()||EP.badText)return;
  const plan=planFrom(EP),kits=typeof BE.api.options==='function';
  if(!kits&&!EP.adv)return; // fallback path waits for the advisor
  const key=JSON.stringify(plan)+(kits?'|kits':'|adv|'+JSON.stringify(EP.adv.options.map(o=>o.plan)));
  if(key===CP.key)return;
  CP.key=key;CP.rows=[];CP.pick=null;CP.busy=true;const seq=++CP.seq;
  let rows=null,src='';
  if(kits){try{rows=cmpFromOptions(await BE.api.options(plan,{n:CMP_MAX}));src='kits';}catch(e){console.warn('compare: options() failed, using the advisor instead',e);}}
  if(!rows||!rows.length){
    if(!EP.adv){if(seq===CP.seq){CP.key='';CP.busy=false;}return;} // retried when the advisor lands (engRender4 → cmpRender)
    rows=[];src='advisor';
    for(const x of cmpSources(plan,EP.adv)){let s=null;try{s=await BE.api.run(x.plan);}catch(e){console.warn('compare: run failed',e);}rows.push({...x,s});}
  }
  await cmpLoad();
  if(src==='advisor')for(const r of rows){
    const ws=r.plan.worksites[0];r.hire=null;r.days=null;
    if(CP.mod&&CP.inv){try{const q=CP.mod.pack.quote(ws,CP.inv,{links:cmpLinks(ws)});r.hire=q.total_aud;r.days=q.days;}catch(e){console.warn('compare: quote failed',e);}}
  }
  if(seq!==CP.seq)return;
  CP.rows=rows;CP.src=src;CP.busy=false;cmpRender();
}

// Independent of scoring: never delay choosing/exporting a plan for AI text.
function cmpExplainUpdate(){
  const lang=LANG.cur==='zh'?'zh':'en';
  const key=CP.key+'|'+lang;
  if(CP.busy||!CP.rows.length){
    if(CP.exKey){CP.exKey='';++CP.exSeq;CP.explain=null;CP.exBusy=false;}
    return;
  }
  if(!CP.mod||CP.exKey===key)return;
  CP.exKey=key;CP.explain=null;CP.exError=false;CP.exBusy=true;
  const seq=++CP.exSeq;
  const options=CP.rows.filter(r=>r.s).map(r=>CP.mod.ex.optionFromRun(r.id,cmpLabel(r),r.s,{hire_aud:r.hire,days:r.days}));
  Promise.resolve().then(()=>CP.mod.ex.explainOptions({lang,options})).then(result=>{
    if(seq!==CP.exSeq||key!==CP.key+'|'+(LANG.cur==='zh'?'zh':'en'))return;
    CP.explain=result;
  }).catch(e=>{if(seq===CP.exSeq)CP.exError=true;console.warn('compare: explanation unavailable',e);})
    .finally(()=>{if(seq===CP.exSeq){CP.exBusy=false;cmpRender();}});
}
function cmpExplainRender(el){
  const result=CP.explain;
  el.querySelectorAll('[data-cmpexplain]').forEach(box=>{
    box.replaceChildren();
    const r=CP.rows[+box.dataset.cmpexplain];
    const item=result?.options.find(o=>o.id===r.id);
    const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;box.appendChild(node);};
    add('b',L('AI explanation','AI 解读'));
    if(!item){add('p',CP.exBusy?L('Reading these plans…','正在解读这些方案…'):L('Explanation unavailable; you can still choose a plan.','解读暂不可用，仍可选择方案。'));return;}
    add('small',result.src==='rule'?L('Rule fallback','规则兜底'):result.src==='kv'?L('AI · cached','AI · 缓存'):L('AI interpretation','AI 解读'));
    add('p',item.summary);
    for(const [title,items] of [[L('Pros','优点'),item.pros],[L('Cons','缺点'),item.cons]]){
      add('b',title);const list=document.createElement('ul');
      for(const text of items.length?items:[L('None listed','未列出')]){const li=document.createElement('li');li.textContent=text;list.appendChild(li);}box.appendChild(list);
    }
  });
  const lean=el.querySelector('[data-cmplean]'),decide=el.querySelector('[data-cmpdecide]');
  if(lean){const row=CP.rows.find(r=>r.id===result?.lean?.option);lean.textContent=row?L('Leaning toward ','倾向 ')+cmpLabel(row)+' · '+result.lean.why:'';}
  if(decide)decide.textContent=result?.decide||L('This is advice only. The person responsible chooses the plan and records why.','这只是建议，由负责人选择方案并记录理由。');
}

function cmpHTML(){
  if(!engOn()||EP.badText)return'';
  const head=`<div class="between cmp-head"><span class="eyebrow" style="color:var(--sun-ink)">${L('Compare plans · choose one','方案对比 · 选一套')}</span><span class="eyebrow">${engHour(EP.hour)}</span></div>`;
  if(CP.busy||!CP.rows.length)return head+`<div class="card eng-note"><b>${CP.busy||EP.advBusy?L('Building plans from the RPM inventory and scoring each on the real CBD network…','正在按 RPM 库存配方案，并在真实 CBD 路网上逐套计算…'):L('No plans to compare yet','还没有可以对比的方案')}</b></div>`;
  if(CP.rows.length<2)return head+`<div class="card eng-note"><b>${L('The advisor found no alternative for this hour — only your plan to compare.','顾问这个时段没有别的改法 —— 只有现在这一套。')}</b></div>`;
  const nums=CP.rows.map(r=>({...cmpNumbers(r.s),hire:r.hire})),best=cmpBest(nums,['car','transit','peds','hire']);
  const mark=(k,i)=>best[k]&&best[k].includes(i)?`<i class="cmp-best">${L('lowest','最少')}</i>`:'';
  const cell=(k,i,v,unit)=>`<div><span class="eyebrow">${{car:L('Car delay','车延误'),transit:L('Tram & bus','电车公交'),peds:L('On foot','行人'),hire:L('Hire','租金')}[k]}</span><b>${v}</b><small>${unit}</small>${mark(k,i)}</div>`;
  const cards=CP.rows.map((r,i)=>{
    const n=nums[i],ok=!!r.s,picked=CP.pick===i,f=r.flags||{};
    const warn=[f.stock_ok===false?L('Not enough stock for this kit','库存不够配这一套'):'',f.inactive?L('No works this hour — numbers are 0','这个时段不施工 —— 数字是 0'):''].filter(Boolean);
    return`<div class="card cmp-card" aria-current="${picked}"><div class="cmp-hd"><b>${String.fromCharCode(65+i)} · ${esc(cmpLabel(r))}</b><span class="chips"><button type="button" data-cmppick="${i}" aria-pressed="${picked}" ${ok?'':'disabled'}>${picked?L('Chosen','已选'):L('Choose this','选这个')}</button></span></div>
      <span class="cmp-what" data-cmpwhat="${i}"></span>${warn.map(w=>`<span class="cmp-warn">! ${w}</span>`).join('')}
      ${ok?`<div class="cmp-nums">${cell('car',i,n.car==null?'—':fmtN(n.car),L('veh·min','车·分钟'))}${cell('transit',i,n.transit==null?'—':fmtN(n.transit),L('rider·min','人·分钟'))}${cell('peds',i,n.peds==null?'—':fmtN(n.peds),L('ped·min','人·分钟'))}${cell('hire',i,r.hire==null?'—':'A$'+fmtN(r.hire),r.days?L(`${fmtN(r.days)} days · assumed`,`${fmtN(r.days)} 天 · 假设值`):L('no inventory','无库存数据'))}</div>`
        :`<p class="small" style="color:var(--risk)">${L('The engine could not score this plan.','引擎算不了这套方案。')}</p>`}<div class="cmp-explain" data-cmpexplain="${i}"></div></div>`;}).join('');
  const planNote=CP.src==='kits'?L('Plans: engine T22, three kits from the RPM inventory (cheapest / standard / guided). ','方案：引擎 T22 按 RPM 库存配的三套（最省 / 标准 / 引导）。'):L('Plans: your plan + the advisor’s alternatives. ','方案：现在的方案 + 顾问的改法。');
  let h=head+`<div class="cmp-cards">${cards}</div><p class="cmp-lean" data-cmplean></p><p class="legend-src" data-cmpdecide></p>
    <p class="legend-src">${planNote}${L(`Car, tram & bus and on-foot numbers: engine, this hour (${engHour(EP.hour)}), person- or vehicle-minutes. Hire: RPM inventory × day rate × works days — day rates and stock are assumptions, RPM Hire’s formal quote applies.`,`车、电车公交、行人：引擎算的这一小时（${engHour(EP.hour)}），单位是车·分钟或人·分钟。租金：RPM 库存 × 日租价 × 施工天数 —— 日租价和库存件数是假设值，以 RPM Hire 正式报价为准。`)}</p>`;
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
  cmpUpdate();cmpExplainUpdate();
  const h=cmpHTML();if(el.dataset.sig===h){cmpExplainRender(el);return;}el.innerHTML=h;el.dataset.sig=h;cmpExplainRender(el);
  el.querySelectorAll('[data-cmpwhat]').forEach(x=>{const r=CP.rows[+x.dataset.cmpwhat];x.textContent=r?cmpWhat(r):'';});
  el.querySelectorAll('[data-cmppick]').forEach(b=>b.onclick=()=>{CP.pick=+b.dataset.cmppick;cmpRender();});
  el.querySelectorAll('[data-cmpby]').forEach(b=>b.onclick=()=>{CP.by=b.dataset.cmpby;cmpRender();});
  const ta=document.getElementById('cmpReason');if(ta){ta.value=CP.reason;ta.oninput=()=>{CP.reason=ta.value;};}
  const ex=document.getElementById('cmpExport');if(ex)ex.onclick=cmpExport;
}

// Chosen plan → pack.js execution pack → a print / copy sheet. Every string goes in with textContent.
function cmpExport(){
  const r=CP.rows[CP.pick];if(!r||!r.s||!CP.mod||!CP.inv)return;
  const ws=r.plan.worksites[0],lang=LANG.cur==='zh'?'zh':'en';let txt='',doc='';
  try{
    const impacts=CP.mod.ex.optionFromRun(r.id,'plan',r.s).metrics;
    const p=CP.mod.pack.buildPack({...ws,title:ws.name,status:'decided',decision:{option:r.id,by:CP.by,reason:CP.reason.trim(),at:new Date().toISOString()}},{inventory:CP.inv,links:cmpLinks(ws),impacts});
    txt=CP.mod.pack.packText(p,lang);
    if(typeof CP.mod.pack.packDoc==='function'){ // older pack.js (before packDoc) → plain text below
      const rows=CP.rows.map(x=>({id:x.id,label:cmpLabel(x),...cmpNumbers(x.s),hire:x.hire}));
      doc=cmpDocHTML(CP.mod.pack.packDoc(p,lang),{rows,pick:CP.pick,by:CP.by==='council'?L('Council','市政'):L('Contractor','施工方'),hour:engHour(EP.hour),date:new Date().toLocaleString(lang==='zh'?'zh-CN':'en-AU',{dateStyle:'medium',timeStyle:'short'})},{L,esc,fmt:fmtN});
    }
  }catch(e){console.warn('export failed',e);toast(L('Could not build the pack','执行包生成失败'));return;}
  let sh=document.getElementById('cmpSheet');
  if(!sh){sh=document.createElement('div');sh.id='cmpSheet';sh.className='cmp-sheet';sh.setAttribute('role','dialog');sh.setAttribute('aria-modal','true');document.body.appendChild(sh);}
  sh.innerHTML=`<div class="cmp-doc"><div class="between no-print cmp-bar"><b>${L('Execution pack','执行包')}</b><span class="cmp-acts"><button type="button" class="btn ghost" id="cmpCopy">${L('Copy text','复制文字')}</button><button type="button" class="btn" id="cmpPrint">${L('Print / save PDF','打印 / 存 PDF')}</button><button type="button" class="btn ghost" id="cmpClose">${L('Close','关闭')}</button></span></div><div id="cmpPaper"></div></div>`;
  const paper=document.getElementById('cmpPaper');
  if(doc)paper.innerHTML=doc; // cmpDocHTML esc()s every string it is given
  else{const pre=document.createElement('pre');pre.id='cmpText';pre.textContent=txt;paper.appendChild(pre);}
  const close=()=>{sh.hidden=true;document.removeEventListener('keydown',esc1);};
  const esc1=e=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',esc1);
  document.getElementById('cmpClose').onclick=close;
  sh.onclick=e=>{if(e.target===sh)close();};
  document.getElementById('cmpPrint').onclick=()=>window.print();
  document.getElementById('cmpCopy').onclick=()=>{const done=()=>toast(L('Pack copied','已复制执行包'));try{navigator.clipboard.writeText(txt).then(done,()=>toast(L('Copy failed — select the text and copy it','复制失败 —— 请手动选中复制')));}catch(e){toast(L('Copy failed — select the text and copy it','复制失败 —— 请手动选中复制'));}};
  sh.hidden=false;document.getElementById('cmpClose').focus();
}
