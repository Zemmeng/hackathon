'use strict';
/* ============================================================
   AI panel (lead · D-0929-2307): show what the LLM actually did.
   Step 3 · "AI road users · what each one read": for the main approach of the latest run, each of the 4 personas'
   sign reading from T5 (readSigns: answer file → /api/read (KV cache / live LLM) → keyword rules): the signs they saw
   in order, noticed / understood / trusts with the reader's range, the route advice, the one-sentence why, and where
   the reading came from. Below it the AI call log: every readSigns call this session (backend.js aiLog(), oldest
   first), downloadable as JSON built in the browser (nothing is uploaded).
   The LLM only interprets (D-0929-1435): every number here comes from the engine or from the reading itself.
   Sign text, road names and model text are untrusted: esc() in templates, textContent for why / summary / pros / cons.
   ============================================================ */

/* pure:begin — tests/ai_glue.mjs runs this block in node */
const AI_LOG_KEEP=200; // same bound as backend.js AI_LOG_MAX
const AI_SRC={file:['LLM · precomputed','大模型 · 预先算好'],kv:['LLM · cached','大模型 · 缓存'],llm:['LLM · live','大模型 · 现场'],
  rule:['Rules · fallback','规则 · 兜底'],mixed:['Mixed sources','多种来源'],error:['Not read','没读成'],none:['None this hour','这个小时没有']};
// reading src → friendly label (plain text: esc() it in templates). llm + ms → "LLM · live · 840 ms"
function aiSrcLabel(src,ms){
  const k=AI_SRC[src];if(!k)return src?String(src).slice(0,32):L('Unknown','未知');
  const t=L(k[0],k[1]);
  return src==='llm'&&Number.isFinite(ms)?`${t} · ${Math.round(ms)} ms`:t;
}
function aiSrcTone(src){return src==='file'||src==='kv'||src==='llm'?'ok':src==='error'?'risk':'warn';}
// Where THIS plan's sign readings came from (6-engine.js badge + legend), from readingsOf(s) — not flags.reading_src, which
// is the 8 fixed calibration readings only. All 4 agree → that source; else 'mixed' (green only when every one is an LLM
// source; any rule / missing reading → yellow). rd null → null (caller decides); no persona with signs → 'none'
function aiSrcOf(rd){
  if(!rd||!rd.personas||typeof rd.personas!=='object')return null;
  const ss=Object.values(rd.personas).filter(Boolean).map(p=>p.reading?String(p.src||'error'):'error');
  if(!ss.length)return{src:'none',tone:'',rule:false};
  const llm=ss.every(x=>x==='file'||x==='kv'||x==='llm');
  return{src:ss.every(x=>x===ss[0])?ss[0]:'mixed',tone:llm?'ok':'warn',rule:ss.includes('rule')};
}
// Same rule as engPanel3 (6-engine.js): the panel has current numbers only in 'ok'. Anything else → no persona cards,
// so a failed run never shows the previous plan's readings. ep = EP
function aiState(ep){return!ep?'wait':ep.badText?'bad':ep.runErr&&!ep.busy?'err':!ep.sum?'wait':'ok';}
const AI_EX={llm:['AI explanation · LLM','AI 解读 · 大模型'],kv:['AI explanation · LLM cached','AI 解读 · 大模型缓存'],rule:['AI explanation · rules','AI 解读 · 规则'],api:['AI explanation · API','AI 解读 · 接口']};
function aiExplainLabel(src){const k=AI_EX[src]||AI_EX.api;return L(k[0],k[1]);}
function aiExplainTone(src){return src==='llm'||src==='kv'?'ok':'warn';}
// 0–1 → whole percent, clamped; anything else → null (never lets model text into a style attribute)
function aiPct(x){if(x===null||x===undefined||x==='')return null;const n=Number(x);return Number.isFinite(n)?Math.round(Math.min(1,Math.max(0,n))*100):null;}
// Signs in the order they are passed → [{ kind, text }]; a VMS's frames are joined with ▸
function aiSigns(signs){
  return (Array.isArray(signs)?signs:[]).map(s=>({kind:String(s&&s.kind||''),
    text:s&&Array.isArray(s.frames)?s.frames.map(f=>(Array.isArray(f)?f:[f]).join(' ')).join(' ▸ '):String(s&&s.text||'')}));
}
function aiKind(k){return k==='vms'?'VMS':k==='arrow'?L('Arrow','箭头板'):L('Sign','标志牌');}
const aiSt=n=>String(n).replace(/ Street\b/,' St');
const aiWho=t=>Object.prototype.hasOwnProperty.call(TYPE_L,t)?L(TYPE_L[t][0],TYPE_L[t][1]):String(t==null?'?':t);
// A reading's route advice → one plain-text line: "use Russell St · save 9 min" / "no route advice"
function aiAdvice(r){
  if(!r)return L('no reading','没有读数');
  const a=r.advice&&typeof r.advice==='object'?Object.entries(r.advice).filter(([,v])=>v==='use'||v==='avoid'):[];
  const parts=a.map(([road,v])=>v==='use'?L(`use ${aiSt(road)}`,`走 ${aiSt(road)}`):L(`avoid ${aiSt(road)}`,`别走 ${aiSt(road)}`));
  const sv=r.saving_min==null?NaN:Number(r.saving_min),dl=r.delay_min==null?NaN:Number(r.delay_min);
  if(parts.length&&Number.isFinite(sv)&&sv>0)parts.push(L(`save ${Math.round(sv)} min`,`省 ${Math.round(sv)} 分钟`));
  if(Number.isFinite(dl)&&dl>0)parts.push(L(`${Math.round(dl)} min delay`,`堵 ${Math.round(dl)} 分钟`));
  return parts.length?parts.join(' · '):L('no route advice','没给路线建议');
}
// explain.js label rule: no < >, ≤ 60 characters
function aiLabel(x){return String(x==null?'':x).replace(/[<>]/g,'').slice(0,60)||'plan';}
function aiBar(label,v,rg){
  const p=aiPct(v),lo=Array.isArray(rg)?aiPct(rg[0]):null,hi=Array.isArray(rg)?aiPct(rg[1]):null,has=lo!=null&&hi!=null&&hi>=lo;
  return`<div class="ai-bar"><span class="k">${label}</span><span class="tr">${p==null?'':`<i class="v" style="width:${p}%"></i>`}${has?`<i class="rg" style="left:${lo}%;width:${hi-lo}%"></i>`:''}</span><span class="n">${p==null?'—':p+'%'}${has?`<small>${lo}–${hi}%</small>`:''}</span></div>`;
}
// One persona card. p = backend readingsOf(s).personas[t]; the why goes in later with textContent (data-aiwhy)
function aiPersonaHTML(t,p){
  const nm=esc(aiWho(t));
  if(!p)return`<div class="card ai-p"><div class="ai-ph"><b>${nm}</b><span class="pill">${L('No signs on this road','这段路上没有屏')}</span></div></div>`;
  const r=p.reading,rg=r&&r.range&&typeof r.range==='object'?r.range:{};
  const signs=aiSigns(p.signs).map(s=>`<div class="ai-sign"><span class="kd">${esc(aiKind(s.kind))}</span><span class="tx">${esc(s.text)}</span></div>`).join('');
  return`<div class="card ai-p"><div class="ai-ph"><b>${nm}</b><span class="pill ${aiSrcTone(p.src)}">${esc(aiSrcLabel(p.src,p.ms))}</span></div>
    <div class="ai-signs">${signs}</div>
    ${r?`<div class="ai-bars">${aiBar(L('Noticed','看到'),r.notice,rg.notice)}${aiBar(L('Understood','看懂'),r.understand,rg.understand)}${aiBar(L('Trusts','相信'),r.trust,rg.trust)}</div>
    <div class="ai-adv">→ ${esc(aiAdvice(r))}</div><q class="ai-why" data-aiwhy="${esc(t)}"></q>${p.fallback?`<span class="small muted">${L('Reader error → keyword rules','读屏出错 → 改用关键词规则')}</span>`:''}`
    :`<p class="small muted">${L('No reading for this road user — the engine counts them as not persuaded.','这类人没读成 —— 引擎按没被说动算。')}</p>`}</div>`;
}
// One small tile per road user (2 × 2, same look as the metric tiles): the reading's three numbers and the route advice.
// A button: tap → that persona's full card (aiPersonaHTML) opens under the tiles; sel = it is the one open
function aiTileHTML(t,p,sel){
  const nm=esc(aiWho(t)),r=p&&p.reading;
  const n=(k,v)=>{const x=aiPct(v);return`<span class="ai-n"><b>${x==null?'—':`${x}<small>%</small>`}</b><em>${k}</em></span>`;};
  const body=!p?`<span class="ai-tnote">${L('No signs on this road','这段路上没有屏')}</span>`
    :!r?`<span class="ai-tnote">${L('Not read · counted as not persuaded','没读成 · 按没被说动算')}</span>`
    :`<span class="ai-ns">${n(L('Seen','看到'),r.notice)}${n(L('Got it','看懂'),r.understand)}${n(L('Trusts','相信'),r.trust)}</span><span class="ai-tadv">→ ${esc(aiAdvice(r))}</span>`;
  const dot=p?`<i class="ai-dot ${aiSrcTone(p.src)}" title="${esc(aiSrcLabel(p.src,p.ms))}"></i>`:'';
  return`<button type="button" class="metric ai-tile${sel?' on':''}" data-aip="${esc(t)}" aria-expanded="${sel?'true':'false'}"${p?'':' disabled'}><span class="ai-th"><span class="eyebrow">${nm}</span>${dot}</span>${body}</button>`;
}
function aiTime(t){const d=new Date(t);return Number.isNaN(d.getTime())?'—':d.toTimeString().slice(0,8);}
// One call-log row (every string through esc())
function aiLogRowHTML(e){
  const who=aiWho(e.persona);
  const txt=aiSigns(e.signs).map(s=>s.text).join(' | ');
  const adv=e.reading?aiAdvice(e.reading):e.error?L('error: ','出错：')+e.error:L('no reading','没有读数');
  return`<div class="ai-row"><div class="hd"><span class="tm">${esc(aiTime(e.t))}</span><b>${esc(who)}</b><span class="pill ${aiSrcTone(e.src)}">${esc(aiSrcLabel(e.src))}</span><span class="ms">${Number.isFinite(e.ms)?Math.round(e.ms)+' ms':'—'}</span></div><span class="tx">${esc(txt)}</span><span class="adv">→ ${esc(adv)}${e.fallback?' · '+esc(L('reader error → rules','读屏出错 → 规则')):''}</span></div>`;
}
// Download: whitelisted fields only (persona, signs, reading) — no headers, keys or anything else a log entry might carry
const AI_READING_KEYS=['notice','understand','advice','saving_min','delay_min','trust','why','range','src','model','prompt_v','note'];
function aiPick(o,keys){const out={};if(!o||typeof o!=='object')return out;for(const k of keys)if(o[k]!==undefined)out[k]=o[k];return out;}
function aiLogJSON(log,meta){
  const entries=(Array.isArray(log)?log:[]).map(e=>({...aiPick(e,['seq','t','persona','kmh','read_s','src','model','ms','fallback','error']),
    roads:Array.isArray(e&&e.roads)?e.roads.map(String):[],
    signs:(Array.isArray(e&&e.signs)?e.signs:[]).map(s=>aiPick(s,['kind','frames','text','read_s'])),
    reading:e&&e.reading?aiPick(e.reading,AI_READING_KEYS):null}));
  return JSON.stringify({app:'RippleTwin',kind:'ai-call-log',...aiPick(meta,['exported_at','lang']),count:entries.length,
    note:'Sign-reading calls only: persona, sign text as seen, the reading and its source. Numbers on the page come from the engine.',entries},null,2);
}
/* pure:end */

const AI={log:[],open:false,sel:'',timer:0,ex:{key:'',seq:0,busy:false,res:null,err:false}};

// Subscribe once the backend is up: snapshot + subscribe in the same tick, so no call is missed
BE.ready.then(()=>{
  const api=BE.api;if(!api||typeof api.aiLog!=='function'||typeof api.onAiLog!=='function')return;
  AI.log=api.aiLog();
  api.onAiLog(e=>{AI.log.push(e);if(AI.log.length>AI_LOG_KEEP)AI.log.splice(0,AI.log.length-AI_LOG_KEEP);aiRenderSoon();});
  aiRender();
});
function aiRenderSoon(){clearTimeout(AI.timer);AI.timer=setTimeout(aiRender,120);} // a run asks ~20 readings at once: one repaint

// Step 3: renderPanel() → aiMount() after the network panel is built; the section goes under "Who is hit · and why"
function aiMount(){
  const P=document.getElementById('panel');if(!P||S.step!==3||EP.tab3!=='net'||!BE.api)return;
  const old=document.getElementById('aiBox');if(old)old.remove();
  const box=document.createElement('div');box.id='aiBox';box.className='stack ai-box';
  const who=P.querySelector('.eng-types'),sec=who&&who.closest('.stack');
  if(sec&&sec.parentNode)sec.parentNode.insertBefore(box,sec.nextSibling);
  else{const cta=P.querySelector('.cta');if(cta&&cta.parentNode)cta.parentNode.insertBefore(box,cta);else P.appendChild(box);}
  aiRender();
}
function aiReadings(){
  if(aiState(EP)!=='ok'||!BE.api||typeof BE.api.readingsOf!=='function')return null; // same guard as engPanel3
  try{return BE.api.readingsOf(EP.sum);}catch(e){console.warn('readingsOf failed',e);return null;}
}
// Badge / legend source for summary s (6-engine.js engBadges, engPanel3). Older backend without readingsOf → calibration flag
function aiPlanSrc(s,f){
  const api=BE.api;f=f||(s&&s.flags)||{};
  if(s&&api&&typeof api.readingsOf==='function'){let rd=null;try{rd=api.readingsOf(s);}catch(e){rd=null;}return aiSrcOf(rd)||{src:'none',tone:'',rule:false};}
  return{src:f.reading_src,tone:aiSrcTone(f.reading_src)==='ok'?'ok':'warn',rule:f.reading_src==='rule'};
}
const AI_NO={err:['No readings — the engine could not score this plan.','没有读数 —— 引擎算不了这个方案。'],
  bad:['No readings — fix the sign text in step 1 first.','没有读数 —— 先回第 1 步把屏上文字改合规范。'],
  wait:['Readings appear once the engine has scored this plan.','引擎算完这个方案后，这里显示各类路人的读数。']};
function aiHTML(rd,st){
  const so=rd&&st==='ok'?aiSrcOf(rd):null;
  const head=`<div class="row between"><span class="eyebrow">${L('AI road users · what each one read','AI 路人 · 各自读到了什么')}</span>${so&&so.src!=='none'?`<span class="pill ${so.tone}">${esc(aiSrcLabel(so.src))}</span>`:`<span class="eyebrow">${rd?esc(aiSt(rd.street||'')):''}</span>`}</div>`;
  if(st&&st!=='ok'){const m=AI_NO[st]||AI_NO.wait;return head+`<p class="small muted">${L(m[0],m[1])}</p>`+aiLogHTML();} // matches the panel above: no stale cards
  const ps=rd&&rd.personas||{},sel=AI.sel&&ps[AI.sel]?AI.sel:''; // four tiles; the tapped one's full card opens under them
  const body=rd?`<div class="ai-tiles" role="group">${TYPES4.map(t=>aiTileHTML(t,ps[t],t===sel)).join('')}</div>
    ${sel?`<div class="ai-detail" id="aiDetail">${aiPersonaHTML(sel,ps[sel])}</div>`:''}
    <p class="ai-note">${L(`The LLM only reads the signs · the engine computes every number · ${sel?'bar = reading, box = range · tap again to close':'tap a tile for details'}`,`大模型只读屏上的字 · 数字都由引擎算 · ${sel?'条 = 读数，框 = 区间 · 再点一次收起':'点方块看详情'}`)}</p>`
    :`<p class="small muted">${L('No sign readings for this hour — no works, or no signs on the approach.','这个小时没有读屏 —— 不施工，或这段路上没有屏。')}</p>`;
  return head+body+aiLogHTML();
}
function aiLogHTML(){
  const n=AI.log.length;
  return`<details class="ai-log" id="aiLogBox"${AI.open?' open':''}><summary>${L(`AI call log (${n})`,`AI 调用日志（${n}）`)}</summary>
    <div class="ai-log-bar"><span class="small muted">${L('Every sign-reading call this session, oldest first. Kept in this tab only.','这次打开页面以来的每次读屏调用，按时间排。只留在这个页面里。')}</span><button type="button" class="btn ghost" id="aiDl" ${n?'':'disabled'}>${L('Download JSON','下载 JSON')}</button></div>
    ${n?`<div class="ai-rows">${AI.log.map(aiLogRowHTML).join('')}</div>`:`<p class="small muted ai-none">${L('No calls yet.','还没有调用。')}</p>`}</details>`;
}
function aiRender(){
  const el=document.getElementById('aiBox');if(!el)return;
  const st=aiState(EP),rd=aiReadings(),h=aiHTML(rd,st);
  const whys=rd?TYPES4.map(t=>{const p=rd.personas&&rd.personas[t];return p&&p.reading&&p.reading.why||'';}).join('\u0001'):'';
  const sig=h+'\u0000'+whys;
  if(el.dataset.sig===sig)return; // signature guard: same state → keep the DOM (open log, scroll position, button under the pointer)
  const rows=el.querySelector('.ai-rows'),keepScroll=rows?rows.scrollTop:0;
  el.innerHTML=h;el.dataset.sig=sig;
  el.querySelectorAll('[data-aiwhy]').forEach(q=>{const p=rd&&rd.personas&&rd.personas[q.dataset.aiwhy];q.textContent=p&&p.reading&&p.reading.why||'';});
  const d=el.querySelector('#aiLogBox');if(d)d.addEventListener('toggle',()=>{AI.open=d.open;});
  const nr=el.querySelector('.ai-rows');if(nr)nr.scrollTop=keepScroll;
  const b=el.querySelector('#aiDl');if(b)b.onclick=aiDownload;
  el.querySelectorAll('[data-aip]').forEach(x=>x.onclick=()=>{
    AI.sel=AI.sel===x.dataset.aip?'':x.dataset.aip;aiRender();
    const d=el.querySelector('#aiDetail');if(d)d.scrollIntoView({block:'nearest',behavior:'smooth'}); // bring the opened card into view
  });
}
// JSON built here and handed to the browser as a file: no upload, no network
function aiDownload(){
  try{
    const txt=aiLogJSON(AI.log,{exported_at:new Date().toISOString(),lang:LANG.cur});
    const url=URL.createObjectURL(new Blob([txt],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`rippletwin-ai-log-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }catch(e){console.warn('AI log download failed',e);toast(L('Download failed','下载失败'));}
}
