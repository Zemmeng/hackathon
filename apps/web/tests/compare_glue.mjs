// T23 方案对比（src/js/8-compare.js 的 pure:begin…pure:end）+ 真的 backend.js / 顾问 + T5 的 pack.js 执行包，全在 node 里跑。
// 由 tests/test_compare.py 调：node tests/compare_glue.mjs；每条断言打一行 ✅ / ❌，不联网
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = HERE + '../';
const APPS = WEB + '../';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✅ ' + msg); } else { fail++; console.log('❌ ' + msg); } };
const pure = f => { const m = readFileSync(WEB + 'src/js/' + f, 'utf8').match(/\/\* pure:begin[^\n]*\n([\s\S]*?)\/\* pure:end \*\//); ok(!!m, `${f} 有 pure:begin / pure:end 段`); return m ? m[1] : ''; };

const ctx = {};
vm.createContext(ctx);
vm.runInContext(pure('6-engine.js') + '\n' + pure('8-compare.js') + '\n;globalThis.G={planFrom,cmpSources,cmpNumbers,cmpBest,cmpVms,cmpFromOptions,cmpKit,cmpDocHTML,CMP_MAX};', ctx);
const { planFrom, cmpSources, cmpNumbers, cmpBest, cmpVms, cmpFromOptions, cmpKit, cmpDocHTML, CMP_MAX } = ctx.G;

// 1 选哪几套来比（纯函数）
const P = { worksites: [{ id: 'W-1', links: ['x'], equipment: [{ id: 'VMS-1', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] }] }] };
const adv = { options: [
  { kind: 'shift', plan: P, days: 5 },
  { kind: 'text', plan: P, frames: [['USE', 'RUSSELL ST']] },
  { kind: 'move', plan: null, skipped: 'no_vms' },
  { kind: 'move', plan: P, equipment: 'VMS-1', at_m: 450 },
  { kind: 'text', plan: P, frames: [['A']] },
] };
const src = cmpSources(P, adv);
ok(CMP_MAX === 3 && src.length === 3, '最多 3 套');
ok(src.map(x => x.id).join('') === 'ABC' && src[0].kind === 'now', '第一套是表单里现在的方案，编号 A B C');
ok(!src.some(x => x.kind === 'shift'), '错开日期不进对比（它按整个施工期算，不是这一小时）');
ok(src[1].kind === 'text' && src[2].kind === 'move' && src[2].at_m === 450, '跳过没方案的改法（skipped / plan 为空）');
ok(cmpSources(P, null).length === 1, '顾问没结果时只有 A');
ok(cmpVms(P) === 'ROADWORK / AHEAD  ▸  USE / RUSSELL ST' && cmpVms({ worksites: [{ equipment: [] }] }) === '', 'VMS 每一帧用 / 连、帧之间 ▸；没有 VMS 给空串');

// 1b be.options()（T22）的结果 → 卡片
const fake = { days: 5, options: [
  { id: 'o1', label: 'Cheapest', label_zh: '最省', plan: P, result: { delay_min: 9 }, hire: { total_aud: 100 }, flags: { stock_ok: true } },
  { id: 'o2', label: 'Standard', label_zh: '标准', plan: P, result: { delay_min: 8 }, hire: { total_aud: 150 }, flags: { stock_ok: false } },
  { id: 'o3', label: 'Guided', label_zh: '引导', plan: P, result: null, hire: null },
  { id: 'o4', label: 'x', plan: P, result: {}, hire: {} },
] };
const kr = cmpFromOptions(fake);
ok(kr.length === 3 && kr.map(r => r.id).join('') === 'ABC' && kr[0].tier === 'o1' && kr[0].kind === 'kit', 'options() → 最多 3 张卡，编号 A B C，记下原来的档位');
ok(kr[0].hire === 100 && kr[0].days === 5 && kr[2].hire === null && kr[2].s === null, '租金和天数照引擎给的；没算出来的是 null');
ok(kr[1].flags.stock_ok === false && JSON.stringify(kr[2].flags) === '{}', '库存检查的标记带过来');
ok(cmpFromOptions(null).length === 0, 'options() 没结果 → 没有卡');
const kit = cmpKit({ worksites: [{ equipment: [{ type: 'vms' }, { type: 'barrier', qty: 22 }, { type: 'sign', qty: 2 }, { type: 'sign' }, { type: 'arrow' }] }] });
ok(kit.vms === 1 && kit.barrier === 22 && kit.sign === 3 && kit.arrow === 1, '设备按类型数件数（有 qty 按 qty）');

// 2 数字和「最少」标记（纯函数）
ok(JSON.stringify(cmpNumbers(null)) === '{"car":null,"transit":null,"peds":null}', '没算出来 → 全 null');
ok(cmpNumbers({ delay_min: 12, transit: { src: null }, peds: { src: 'peds', extra_min: 0 } }).transit === null, '没有公交数据 → null（不是 0）');
ok(cmpNumbers({ delay_min: 12, transit: { src: null }, peds: { src: 'peds', extra_min: 0 } }).peds === 0, '人行道照常 → 行人 0');
const b = cmpBest([{ car: 10, hire: 5 }, { car: 4, hire: 5 }, { car: 4, hire: null }], ['car', 'hire', 'peds']);
ok(JSON.stringify(b.car) === '[1,2]', '并列最少的都标');
ok(!('hire' in b), '两套一样多：不标');
ok(!('peds' in b), '都没有这个数：不标');

// 3 真路网：页面默认方案（只写 ROADWORK / AHEAD）→ 顾问 → 逐套 run() → pack.js 执行包
const file = p => APPS + p.replace(/^\//, '');
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const importer = async url => { if (!existsSync(file(url))) throw new Error('404 ' + url); return import(pathToFileURL(file(url)).href); };
const { connect } = await import(pathToFileURL(APPS + 'engine/public/js/backend.js').href);
const be = await connect({ fetch: fakeFetch, importer });
const EP = { link: 'l595594354_9756035316', street: 'Lonsdale Street', lanes: 1, hour: 8, f1: 'ROADWORK\nAHEAD', f2: '', vmsAt: 300, sign: 'RIGHT LANE CLOSED', signAt: 100, arrowAt: 60, foot: 'none' };
const plan = planFrom(EP);
const a = await be.advise(plan);
const rows = cmpSources(plan, a);
ok(rows.length >= 2, `Lonsdale 早 8 点：顾问给出可比的改法，共 ${rows.length} 套`);
for (const r of rows) r.s = await be.run(r.plan);
const nums = rows.map(r => cmpNumbers(r.s));
ok(nums.every(n => Number.isFinite(n.car) && n.car > 0), `每套都有车延误：${nums.map(n => Math.round(n.car)).join(' / ')} 车·分钟`);
ok(nums.every(n => n.transit !== null && n.peds !== null), '电车公交、行人都有数（数据都加载上了）');
const best = cmpBest(nums, ['car']);
ok(best.car && !best.car.includes(0), `顾问的改法车延误比现在的方案少（最少的是 ${best.car && best.car.map(i => rows[i].id).join(',')}）`);

const packUrl = APPS + 'api/public/js/pack.js', exUrl = APPS + 'api/public/js/explain.js';
if (!existsSync(packUrl) || !existsSync(exUrl)) {
  console.log('⏭ 跳过执行包一节：没有 apps/api 的 pack.js / explain.js');
} else {
  const pack = await import(pathToFileURL(packUrl).href), ex = await import(pathToFileURL(exUrl).href);
  const inventory = await pack.loadInventory({ fetch: fakeFetch });
  const net = be.engine.net, ws = rows[1].plan.worksites[0];
  const links = new Map(ws.links.map(id => [id, net.links.get(id)]));
  const q = pack.quote(ws, inventory, { links });
  ok(q.total_aud > 0 && q.days === 5 && q.unmatched.length === 0, `选定方案的租金：A$${q.total_aud}（5 天，设备都对上了库存）`);
  const impacts = ex.optionFromRun(rows[1].id, 'plan', rows[1].s).metrics;
  const p = pack.buildPack({ ...ws, title: ws.name, status: 'decided', decision: { option: rows[1].id, by: 'council', reason: 'shorter queue', at: '2026-09-30T00:00:00.000Z' } }, { inventory, links, impacts });
  const zh = pack.packText(p, 'zh'), en = pack.packText(p, 'en');
  ok(/选 B（市政，2026-09-30）：shorter queue/.test(zh), '执行包写上选了 B、谁选的、理由');
  ok(/假设值，以 RPM Hire 正式报价为准/.test(zh) && /assumptions; RPM Hire's formal quote applies/.test(en), '反向断言：执行包里写明日租价是假设值');
  ok(/Frame 1:/.test(en) && /Lonsdale Street/.test(en), '执行包有 VMS 排程和路名');
  ok(p.notify.some(n => n.who === 'transit'), '有电车公交乘客受影响 → 通知运营方');
}

// 4 T22 真的出 3 套方案（按库存配设备、带租金）→ 卡片 → 和 pack.js 报价对得上 → 导出
if (typeof be.options !== 'function') {
  ok(false, 'backend.js 有 options()（T22）');
} else {
  const res = await be.options(plan, { n: 3 });
  const kits = cmpFromOptions(res);
  ok(kits.length === 3 && kits.every(k => k.s && Number.isFinite(k.s.delay_min)), `options() 出 3 套，每套都有引擎算的延误：${kits.map(k => `${k.tier} ${Math.round(k.s.delay_min)}`).join(' / ')}`);
  ok(kits.every(k => Number.isFinite(k.hire) && k.hire > 0), `每套都有租金：${kits.map(k => 'A$' + k.hire).join(' / ')}`);
  const kn = kits.map(k => cmpNumbers(k.s));
  ok(kn.every(n => n.transit !== null && n.peds !== null), 'options() 的结果里电车公交、行人也有数');
  if (existsSync(packUrl)) {
    const pack = await import(pathToFileURL(packUrl).href), ex = await import(pathToFileURL(exUrl).href);
    const inventory = await pack.loadInventory({ fetch: fakeFetch });
    const net = be.engine.net;
    const same = kits.every(k => { const ws = k.plan.worksites[0]; const q = pack.quote(ws, inventory, { links: new Map(ws.links.map(id => [id, net.links.get(id)])) }); return q.total_aud === k.hire && q.unmatched.length === 0; });
    ok(same, '反向断言：T22 的租金和 pack.js 报价逐套一样（同一份库存、同一个日租价，导出不会出现两个数）');
    const g = kits[2], ws = g.plan.worksites[0];
    const p = pack.buildPack({ ...ws, title: ws.name, status: 'decided', decision: { option: g.id, by: 'contractor', reason: 'guided detour', at: '2026-09-30T00:00:00.000Z' } }, { inventory, links: new Map(ws.links.map(id => [id, net.links.get(id)])), impacts: ex.optionFromRun(g.id, 'plan', g.s).metrics });
    const txt = pack.packText(p, 'en');
    // 排版版执行包（网页的「导出」）：真 packDoc → cmpDocHTML（packDoc 在 api 的另一个 PR 里；还没合进来时跳过这一段）
    if (typeof pack.packDoc !== 'function') console.log('⏭ 跳过排版版一段：apps/api 的 pack.js 还没有 packDoc');
    else {
    const H = { L: (en) => en, esc: (x) => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), fmt: (n) => Math.round(Number(n) || 0).toLocaleString('en-AU') };
    const rowsX = kits.map((k, i) => ({ id: k.id, label: ['Minimum', 'Standard', 'Guided'][i], ...cmpNumbers(k.s), hire: k.hire }));
    const html = cmpDocHTML(pack.packDoc(p, 'en'), { rows: rowsX, pick: 2, by: 'Contractor', hour: '08:00', date: '30 Sep 2026' }, H);
    ok(html.includes('<b>C · Guided</b><small>Contractor</small>') && /<b>2026-10-\d\d to 2026-10-\d\d \(\d+ days\)<\/b><small>daily 07:00–19:00<\/small>/.test(html), '决定格写「C · Guided」+ 谁选的；时间格日期和每天时段分两行');
    ok(html.includes(`A$${H.fmt(g.hire)}`) && (html.match(/class="pd-led"/g) || []).length === 2 && html.includes('USE<br>RUSSELL'), `排版版：合计 A$${H.fmt(g.hire)}、VMS 两屏画成电子屏样式`);
    ok(/<tr class="pick"><td>C · Guided <em>chosen<\/em>/.test(html) && (html.match(/<tr/g) || []).length >= 3 + p.quote.lines.length, '比较过的 3 套方案一张表，选中的那行高亮；设备逐行');
    ok(/assumptions; RPM Hire&#39;s formal quote applies/.test(html) && /not field measurements/.test(html), '反向断言：排版版也写明假设值和仿真');
    const evil = pack.packDoc(pack.buildPack({ ...ws, name: '<img src=x onerror=alert(1)>', title: '<script>alert(1)</script>', status: 'decided', decision: { option: 'C', by: 'council', reason: '</blockquote><script>alert(2)</script>' } }, { inventory, links: new Map(ws.links.map(id => [id, net.links.get(id)])) }), 'en');
    const evilHtml = cmpDocHTML(evil, { rows: [{ id: 'A', label: '<b>x</b>', car: 1, transit: null, peds: null, hire: null }], pick: 0, hour: '08:00', date: '<i>' }, H);
    ok(!/<script|<img|<b>x|<i>/.test(evilHtml) && evilHtml.includes('&lt;script&gt;alert(2)'), '反向断言：施工名、理由、方案名、日期里的 < > 全被转义，不会变成可执行的网页代码');
    }
    ok(/chose C \(contractor, 2026-09-30\): guided detour/.test(txt) && new RegExp(`Total: A\\$${g.hire.toLocaleString('en-US')}`).test(txt), `选 C（引导档）导出：决定和合计 A$${g.hire} 都在执行包里`);
  }
}

// Asynchronous explanation: repaint dedupe and out-of-order language responses.
{
  const source=readFileSync(WEB+'src/js/8-compare.js','utf8');
  const pending=[],requests=[];
  const state={key:'plan',rows:[{id:'a',s:{delay_min:937},hire:1765,days:5}],exSeq:0,mod:{ex:{
    optionFromRun:(id,label,run,extra)=>({id,label,metrics:{delay_veh_min:run.delay_min,...extra}}),
    explainOptions:req=>{requests.push(req);return new Promise(resolve=>pending.push(resolve));}
  }}};
  const language={cur:'en'};
  const c={CP:state,LANG:language,cmpLabel:()=>language.cur,cmpRender:()=>{},console};vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function cmpExplainUpdate()'),source.indexOf('function cmpExplainRender(')),c);
  c.cmpExplainUpdate();c.cmpExplainUpdate();await new Promise(r=>setImmediate(r));
  ok(requests.length===1&&requests[0].options[0].metrics.hire_aud===1765,'AI 解读重绘不重复请求，租金来自现有方案');
  language.cur='zh';c.cmpExplainUpdate();await new Promise(r=>setImmediate(r));
  pending[0]({lang:'en'});await new Promise(r=>setImmediate(r));
  ok(state.explain===null,'切换语言后的过期响应不能覆盖新解读');
  pending[1]({lang:'zh',src:'rule'});await new Promise(r=>setImmediate(r));
  ok(state.explain.lang==='zh'&&!state.exBusy,'当前语言的规则兜底正常完成');
  state.key='new plan';state.busy=true;c.cmpExplainUpdate();
  ok(state.explain===null&&!state.exKey,'重新计算方案立即清除旧解读');
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
