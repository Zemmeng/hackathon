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
// A plan that buys nothing (T43): every traffic number the table shows (extra per vehicle, queue, network delay, trams &
// buses, on foot) and the footpath are the same as a cheaper plan's, at the precision on screen → { of: that plan's index,
// extra: hire difference A$ }, else null. The cheapest such plan is named (then the first). Needs an engine result and a hire
// figure; an hour with no works (all zeros) is never flagged.
function cmpSameAs(rows){
  const sig=r=>{const s=r&&r.s,f=(r&&r.flags)||{};if(!s||!Number.isFinite(r.hire)||f.inactive)return null;
    const n=cmpNumbers(s),v=x=>Number.isFinite(x)?Math.round(x):null;
    return JSON.stringify([v(s.mean_delay_s),v(s.queue_m),v(n.car),v(n.transit),v(n.peds),f.footpath==null?null:f.footpath]);};
  const k=rows.map(sig);
  return rows.map((r,j)=>{if(k[j]==null)return null;let of=-1;
    rows.forEach((x,i)=>{if(i!==j&&k[i]===k[j]&&x.hire<r.hire&&(of<0||x.hire<rows[of].hire))of=i;});
    return of<0?null:{of,extra:r.hire-rows[of].hire};});
}
// Overlap dates, short: en "7–9 Oct" (day first, as read in Melbourne), zh "10/7–9". from / to are yyyy-mm-dd
function cmpSpan(from,to,zh){
  if(!from||!to)return'';
  const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],p=s=>[+s.slice(5,7),+s.slice(8,10)],[m0,d0]=p(from),[m1,d1]=p(to),one=from.slice(0,7)===to.slice(0,7);
  if(zh)return from===to?`${m0}/${d0}`:one?`${m0}/${d0}–${d1}`:`${m0}/${d0}–${m1}/${d1}`;
  return from===to?`${d0} ${M[m0-1]}`:one?`${d0}–${d1} ${M[m0-1]}`:`${d0} ${M[m0-1]} – ${d1} ${M[m1-1]}`;
}
// 04 "Nearby works" follows 03 (T46, lead): once 03 has staggered the other works ("Stagger by N days" gave a reliable
// be.stagger() best), every plan is scored against the same shifted works 03 shows (stagger().worksite), not the register's
// dates. x = 03's pick { o, ws, r }, st = its be.stagger() result (CL.st). No stagger, or none reliable (03 keeps the dates) → x
function cmpClashOther(x,st){
  const b=st&&st.best;
  return x&&b&&b.reliable&&st.worksite?{...x,ws:st.worksite,days:b.days,overlapDays:b.overlap_days}:x;
}
// Under the row name, after the street: overlap dates · sampled hours; once staggered, the other works' shifted dates
// (· hours if they still overlap) · "staggered N days". hour = engHour
function cmpClashWhen(x,zh,hour){
  const hrs=x.r.hours.map(hour).join(' & ');
  if(x.days==null)return`${cmpSpan(x.r.overlap.from,x.r.overlap.to,zh)} · ${hrs}`;
  const t=x.ws.time,n=x.days;
  return`${cmpSpan(t.from,t.to,zh)}${x.overlapDays>0&&hrs?' · '+hrs:''} · ${zh?`已错开 ${n} 天`:`staggered ${n} day${Math.abs(n)===1?'':'s'}`}`;
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
// Execution pack → one printable page. d = pack.js packDoc(p, lang); x = { rows: [{ id, label, car, transit, peds, hire }], pick, by, hour, date, credits }
// (credits = creditLines(): data attribution the licences ask for, printed above the footer)
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
${(x.credits||[]).length?`<section class="pd-src"><h2>${esc(L('Data sources','数据来源'))}</h2><ul class="pd-list">${x.credits.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></section>`:''}
<footer class="pd-foot"><span>${esc(d.foot)}</span><span>RippleTwin</span></footer>
</article>`;
}
/* pure:end */

const CP={key:'',seq:0,busy:false,rows:[],src:'',pick:null,cl:null,by:'contractor',reason:'',mod:null,inv:null,invErr:null,loading:null,exKey:'',exSeq:0,exBusy:false,explain:null,exError:false};

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
function cmpLabel(r){return r.kind==='kit'?L(r.label||r.tier,r.label_zh||r.label||r.tier):r.kind==='now'?L('Your plan','现在的方案'):r.kind==='text'?L('Edit the sign text','改屏上的字'):r.kind==='move'?L('Move the VMS','挪 VMS'):r.kind;}
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

// 04 Compare, "Nearby works" row (T43): each plan against the one overlapping works 03 Impact shows for this plan (same pick,
// clashPick in 8-clash.js), by be.clash(). Filled in after the table is on screen, cell by cell; never holds the table up.
// CP.cl = { key, other: undefined (still picking) | null (none overlap) | { o, ws, r, days? }, cells: [clash result | 'err'], err }
// T46: 03 staggered the other works → other.ws is 03's shifted works and other.days its N (cmpClashOther); the key carries N,
// so staggering in 03 re-scores this row, and 03 dropping the stagger (re-scored, CL.st = null) puts the original dates back
async function cmpClashUpdate(){
  if(S.ui!==4||CP.busy||CP.rows.length<2||!engOn()||EP.badText)return;
  const cur=clashCur(),in3=CL.m&&CL.key===JSON.stringify(cur)&&!CL.busy&&!CL.err; // 03 already picked it for this same plan
  const x3=in3?cmpClashOther(CL.other,CL.st):null,key=CP.key+(x3&&x3.days!=null?`|+${x3.days}`:'');
  if(CP.cl&&CP.cl.key===key)return;
  const st=CP.cl={key,other:undefined,cells:[],err:false},alive=()=>CP.cl===st;
  try{
    let x;
    if(in3)x=x3; // 03's pick, shifted if 03 staggered it
    else{const sc=await clashPick(cur,alive);if(!sc)return;x=sc[0]||null;}
    st.other=x;cmpRender();
    for(let i=0;x&&i<CP.rows.length;i++){
      const r=CP.rows[i];let v='err';
      if(r.s)try{v=await BE.api.clash(r.plan.worksites[0],x.ws);}catch(e){console.warn('compare: clash check failed for plan',r.id,e);}
      if(!alive())return;st.cells[i]=v;cmpRender();
    }
  }catch(e){if(!alive())return;st.err=true;console.warn('compare: nearby works check failed',e);cmpRender();}
}
function cmpClashRow(rc){
  const c=CP.cl,x=c&&c.other,U=L('veh·min','车·分钟');
  const vals=CP.rows.map((_,i)=>{const r=c&&c.cells[i];return r&&r!=='err'&&r.flags.reliable?r.cost:null;}),best=cmpBest(vals.map(v=>({v})),['v']);
  let wlab='…';
  if(c&&c.err)wlab='—';
  else if(x===null)wlab=L('no other registered works overlap','登记表里没有同期的其他施工');
  else if(x){const net=engNet(),l=net&&net.links.get(x.ws.links[0]);wlab=`${esc(shortSt(l&&l.name||x.o.title))} · ${cmpClashWhen(x,LANG.cur==='zh',engHour)}`;}
  const cell=i=>{
    if(c&&c.err)return'—';
    if(x===null)return L('none','无');
    const r=x&&c.cells[i];if(!r)return'…';if(r==='err')return'—';
    if(!r.flags.reliable)return`<span class="cmp-num">≈ 0</span><small class="cmp-u">${L('not reliable','结果不可信')}</small>`;
    return`<span class="cmp-num"${r.cost>0?' style="color:var(--risk)"':''}>${r.cost>0?'+':''}${fmtN(r.cost)}</span><small class="cmp-u">${U}</small>${best.v&&best.v.includes(i)?`<i class="cmp-best">${L('lowest','最少')}</i>`:''}`;
  };
  return`<tr><th scope="row"${x?` title="${esc(x.o.title)}"`:''}>${L('Nearby works','和附近施工叠加')}<small>${wlab}</small></th>${CP.rows.map((r,i)=>`<td${rc(i)}>${cell(i)}</td>`).join('')}</tr>`;
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
  // the pick in bold; its reason (model text, often long) only in Details mode (.cmp-lean-why, styles.css)
  if(lean){const row=CP.rows.find(r=>r.id===result?.lean?.option);lean.replaceChildren();
    if(row){const b=document.createElement('b'),w=document.createElement('span');b.textContent=L('Leaning toward ','倾向：')+cmpLabel(row);w.className='cmp-lean-why';w.textContent=' · '+result.lean.why;lean.append(b,w);}
    const hd=el.querySelector('[data-cmphead]');if(hd)hd.textContent=row?L('Leaning: ','倾向：')+cmpLabel(row):engHour(EP.hour);} // the folded header says the pick
  if(decide)decide.textContent=result?.decide||L('This is advice only. The person responsible chooses the plan and records why.','这只是建议，由负责人选择方案并记录理由。');
}

function cmpHTML(){
  if(!engOn()||EP.badText)return'';
  const exp=S.ui===5; // 05 Export (6-step UI) shows the picked plan + the decision; 04 Compare shows all of them
  const head=`<div class="row between cmp-head"><span class="eyebrow" style="color:var(--sun-ink)">${exp?L('Confirm & export','确认导出'):L('Compare plans · choose one','方案对比 · 选一套')}</span><span class="eyebrow" data-cmphead>${engHour(EP.hour)}</span></div>`;
  if(CP.busy||!CP.rows.length)return head+`<div class="card eng-note"><b>${CP.busy||EP.advBusy?L('Building plans from the RPM inventory and scoring each on the real CBD network…','正在按 RPM 库存配方案，并在真实 CBD 路网上逐套计算…'):L('No plans to compare yet','还没有可以对比的方案')}</b></div>`;
  if(CP.rows.length<2)return head+`<div class="card eng-note"><b>${L('The advisor found no alternative for this hour — only your plan to compare.','顾问这个时段没有别的改法 —— 只有现在这一套。')}</b></div>`;
  const nums=CP.rows.map(r=>({...cmpNumbers(r.s),hire:r.hire})),best=cmpBest(nums,['car','transit','peds','hire']);
  const mark=(k,i)=>best[k]&&best[k].includes(i)?`<i class="cmp-best">${L('lowest','最少')}</i>`:'';
  const cell=(k,i,v,unit)=>`<div><span class="eyebrow">${{car:L('Car delay','车延误'),transit:L('Tram & bus','电车公交'),peds:L('On foot','行人'),hire:L('Hire','租金')}[k]}</span><b>${v}</b><small>${unit}</small>${mark(k,i)}</div>`;
  const cardsA=CP.rows.map((r,i)=>{
    const n=nums[i],ok=!!r.s,picked=CP.pick===i,f=r.flags||{};
    const warn=[f.stock_ok===false?L('Not enough stock for this kit','库存不够配这一套'):'',f.inactive?L('No works this hour — numbers are 0','这个时段不施工 —— 数字是 0'):''].filter(Boolean);
    return`<div class="card cmp-card" aria-current="${picked}"><div class="cmp-hd"><b>${String.fromCharCode(65+i)} · ${esc(cmpLabel(r))}</b><span class="chips"><button type="button" data-cmppick="${i}" aria-pressed="${picked}" ${ok?'':'disabled'}>${picked?L('Chosen','已选'):L('Choose this','选这个')}</button></span></div>
      <span class="cmp-what" data-cmpwhat="${i}"></span>${warn.map(w=>`<span class="cmp-warn">! ${w}</span>`).join('')}
      ${ok?`<div class="cmp-nums">${cell('car',i,n.car==null?'—':fmtN(n.car),L('veh·min','车·分钟'))}${cell('transit',i,n.transit==null?'—':fmtN(n.transit),L('rider·min','人·分钟'))}${cell('peds',i,n.peds==null?'—':fmtN(n.peds),L('ped·min','人·分钟'))}${cell('hire',i,r.hire==null?'—':'A$'+fmtN(r.hire),r.days?L(`${fmtN(r.days)} days · assumed`,`${fmtN(r.days)} 天 · 假设值`):L('no inventory','无库存数据'))}</div>`
        :`<p class="small" style="color:var(--risk)">${L('The engine could not score this plan.','引擎算不了这套方案。')}</p>`}<div class="cmp-explain" data-cmpexplain="${i}"></div></div>`;}),cards=cardsA.join('');
  // 04 Compare: one table, plans across and measures down (the team template's horizontal comparison); the panel widens for it
  const lean=CP.explain&&CP.explain.lean?CP.explain.lean.option:null,budget=+EP.budget||0,lo=(B,k,i)=>!!(B[k]&&B[k].includes(i));
  const ext=CP.rows.map(r=>({md:r.s&&Number.isFinite(r.s.mean_delay_s)?r.s.mean_delay_s:null,q:r.s&&Number.isFinite(r.s.queue_m)?r.s.queue_m:null})),best2=cmpBest(ext,['md','q']);
  // marks under a plan's name, all in the same small teal as "lowest": Recommended / Baseline here, Cheapest below
  const tag=(r,i)=>r.id===lean?L('Recommended','综合推荐'):i===0&&!lo(best,'hire',i)?L('Baseline','比较基准'):'';
  // the highlighted column: the plan picked (click anywhere in its column), else the recommended one
  const sel=CP.pick!=null&&CP.rows[CP.pick]?CP.pick:CP.rows.findIndex(r=>r.id===lean),rc=i=>` data-cmpcol="${i}"${i===sel?' class="cmp-sel"':''}`;
  const mRows=[[L('Extra per vehicle','每车多等'),'s',i=>ext[i].md,i=>lo(best2,'md',i)],[L('Queue','最长排队'),'m',i=>ext[i].q,i=>lo(best2,'q',i)],
    [L('Network delay','全网延误'),L('veh·min','车·分钟'),i=>nums[i].car,i=>lo(best,'car',i)],[L('Trams & buses','电车公交'),L('rider·min','人·分钟'),i=>nums[i].transit,i=>lo(best,'transit',i)]];
  const days=CP.rows[0].days,dup=cmpSameAs(CP.rows),dupL=d=>{const a=String.fromCharCode(65+d.of),amt=fmtN(d.extra);return L(`Same result as ${a} · +A$${amt}`,`结果和 ${a} 一样 · 多花 A$${amt}`);};
  const table=`<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr><th scope="col">${L('Measure','评价维度')}</th>${CP.rows.map((r,i)=>`<th scope="col"${rc(i)}><b>${String.fromCharCode(65+i)} · ${esc(cmpLabel(r))}</b><small class="cmp-what" data-cmpwhat="${i}"></small>${tag(r,i)?`<i class="cmp-best">${tag(r,i)}</i>`:''}${lo(best,'hire',i)?`<i class="cmp-best">${L('Cheapest','最省')}</i>`:''}${dup[i]?`<i class="cmp-dup">${dupL(dup[i])}</i>`:''}${(r.flags||{}).stock_ok===false?`<i class="cmp-over">${L('not enough stock','库存不够')}</i>`:''}</th>`).join('')}</tr></thead><tbody>
    ${mRows.map(([n,u,g,l])=>`<tr><th scope="row">${n}<small>${u}</small></th>${CP.rows.map((r,i)=>{const v=g(i);return`<td${rc(i)}><span class="cmp-num">${v==null?'—':fmtN(v)}</span>${v!=null&&l(i)?`<i class="cmp-best">${L('lowest','最少')}</i>`:''}</td>`;}).join('')}</tr>`).join('')}
    ${cmpClashRow(rc)}
    <tr><th scope="row">${L('Hire','租金')}<small>${days?L(`A$ · ${fmtN(days)} days · rates assumed`,`澳元 · ${fmtN(days)} 天 · 日租价为假设`):'A$'}</small></th>${CP.rows.map((r,i)=>{const over=budget>0&&r.hire!=null&&r.hire>budget;return`<td${rc(i)}><span class="cmp-num"${over?' style="color:var(--risk)"':''}>${r.hire==null?'—':'A$'+fmtN(r.hire)}</span>${over?`<i class="cmp-over">${L('over budget','超预算')}</i>`:lo(best,'hire',i)?`<i class="cmp-best">${L('lowest','最少')}</i>`:''}</td>`;}).join('')}</tr>
    <tr><th scope="row">${L('Footpath','行人通道')}</th>${CP.rows.map((r,i)=>`<td${rc(i)}>${(r.flags||{}).footpath==='none'?L('kept','保留'):L('closed','封闭')}</td>`).join('')}</tr>
    <tr><th scope="row">${L('Choose','选定方案')}</th>${CP.rows.map((r,i)=>`<td${rc(i)}><button type="button" class="cmp-pickbtn" data-cmppick="${i}" aria-pressed="${CP.pick===i}" ${r.s?'':'disabled'}>${CP.pick===i?L('Chosen','已选择'):L('Choose','选择')}</button></td>`).join('')}</tr>
  </tbody></table><div class="cmp-cap">${L(`Traffic ${engHour(EP.hour)}–${engHour(EP.hour+1)} · engine on real CBD flows · hire over the works period${budget?` · budget A$${fmtN(budget)}`:''}`,`交通 ${engHour(EP.hour)}–${engHour(EP.hour+1)} · 引擎在真实 CBD 车流上算 · 租金按整个施工期${budget?` · 预算 A$${fmtN(budget)}`:''}`)}</div></div>`;
  if(exp&&!(CP.pick!=null&&CP.rows[CP.pick]))return head+`<div class="card eng-note"><b>${L('Choose a plan first','先选一套方案')}</b><span>${L('Pick one in 04 Compare, or here:','在 04 比较方案里选，或者直接在这里选：')}</span></div><div class="chips">${CP.rows.map((x,i)=>`<button type="button" data-cmppick="${i}" aria-pressed="false">${String.fromCharCode(65+i)} · ${esc(cmpLabel(x))}</button>`).join('')}</div><p class="cmp-lean" data-cmplean></p>`;
  const planNote=CP.src==='kits'?L('Plans: engine T22, three kits from the RPM inventory (cheapest / standard / guided). ','方案：引擎 T22 按 RPM 库存配的三套（最省 / 标准 / 引导）。'):L('Plans: your plan + the advisor’s alternatives. ','方案：现在的方案 + 顾问的改法。');
  let h=head+`${exp?`<div class="cmp-cards">${cardsA[CP.pick]}</div>`:table}<p class="cmp-lean" data-cmplean></p><p class="legend-src" data-cmpdecide></p>
    <p class="legend-src">${planNote}${L(`Car, tram & bus and on-foot numbers: engine, this hour (${engHour(EP.hour)}), person- or vehicle-minutes. Hire: RPM inventory × day rate × works days — day rates and stock are assumptions, RPM Hire’s formal quote applies.`,`车、电车公交、行人：引擎算的这一小时（${engHour(EP.hour)}），单位是车·分钟或人·分钟。租金：RPM 库存 × 日租价 × 施工天数 —— 日租价和库存件数是假设值，以 RPM Hire 正式报价为准。`)}</p>`;
  if(exp&&CP.pick!=null&&CP.rows[CP.pick]){
    h+=`<div class="stack cmp-choose"><div class="between cmp-head"><span class="eyebrow">${L('Decision','决定')} · ${String.fromCharCode(65+CP.pick)}</span><span class="eyebrow">${L('a person decides, not the tool','由人拍板，工具只给数字')}</span></div>
      <div class="chips">${[['contractor',L('Contractor','施工方')],['council',L('Council','市政')]].map(([k,t])=>`<button type="button" data-cmpby="${k}" aria-pressed="${CP.by===k}">${t}</button>`).join('')}</div>
      <textarea id="cmpReason" rows="2" maxlength="280" aria-label="${L('Why this plan','为什么选这套')}" placeholder="${L('Why this plan? e.g. shortest queue, trams keep running','为什么选这套？例如排队最短、电车照常运行')}"></textarea>
      <button type="button" class="btn" id="cmpExport" ${CP.mod&&CP.inv?'':'disabled'}>${L('Export one-page pack →','导出一页执行包 →')}</button>
      ${CP.invErr?`<p class="small" style="color:var(--risk)">${L('Equipment inventory not loaded — the pack needs it for the equipment list and hire quote.','设备库存没加载上 —— 执行包要用它列设备清单和报价。')}</p>`:''}</div>`;
  }
  if(exp){const row=(t,ok)=>`<div><i class="dot" style="background:${ok?'var(--accent)':'var(--works)'}"></i><span class="grow">${t}</span></div>`;
    h+=`<div class="stack"><div class="row between"><span class="eyebrow">${L('Before handing over','交付前确认')}</span><span class="eyebrow">${L('a person signs off','由人确认')}</span></div><div class="list eng-evd">
      ${row(L(`Numbers: engine, ${engHour(EP.hour)}, real CBD flows — model estimates, not field-validated`,`数字：引擎在真实 CBD 车流上算的 ${engHour(EP.hour)} —— 模型估算，未经实地验证`),1)}
      ${row(L('Trust in signs, riders per trip and hire day rates are assumed values','对标志的信任度、每班乘客、日租价是假设值'),0)}
      ${row(L('Traffic management plan and site checks by the responsible engineer','交通组织方案和现场条件由负责工程师复核'),0)}</div></div>`;}
  return h;
}

function cmpRender(){
  const el=document.getElementById('cmp4');if(!el)return;
  cmpUpdate();cmpExplainUpdate();cmpClashUpdate();
  const h=cmpHTML();if(el.dataset.sig===h){cmpExplainRender(el);return;}el.innerHTML=h;el.dataset.sig=h;cmpExplainRender(el);compactPanel(); // filled in after the panel was laid out: let the folding see it
  el.querySelectorAll('[data-cmpwhat]').forEach(x=>{const r=CP.rows[+x.dataset.cmpwhat];x.textContent=r?cmpWhat(r):'';});
  el.querySelectorAll('[data-cmppick]').forEach(b=>b.onclick=()=>{CP.pick=+b.dataset.cmppick;cmpRender();});
  el.querySelectorAll('[data-cmpcol]').forEach(c=>c.onclick=()=>{const i=+c.dataset.cmpcol;if(CP.pick!==i&&CP.rows[i]&&CP.rows[i].s){CP.pick=i;cmpRender();}});
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
    txt=CP.mod.pack.packText(p,lang)+`\n\n${L('Data sources','数据来源')}\n`+creditLines().map(s=>'- '+s).join('\n');
    if(typeof CP.mod.pack.packDoc==='function'){ // older pack.js (before packDoc) → plain text below
      const rows=CP.rows.map(x=>({id:x.id,label:cmpLabel(x),...cmpNumbers(x.s),hire:x.hire}));
      doc=cmpDocHTML(CP.mod.pack.packDoc(p,lang),{rows,pick:CP.pick,by:CP.by==='council'?L('Council','市政'):L('Contractor','施工方'),hour:engHour(EP.hour),date:new Date().toLocaleString(lang==='zh'?'zh-CN':'en-AU',{dateStyle:'medium',timeStyle:'short'}),credits:creditLines()},{L,esc,fmt:fmtN});
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
