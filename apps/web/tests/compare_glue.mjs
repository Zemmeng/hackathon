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
vm.runInContext(pure('6-engine.js') + '\n' + pure('8-compare.js') + '\n;globalThis.G={planFrom,cmpSources,cmpNumbers,cmpBest,cmpVms,cmpFromOptions,cmpKit,cmpDocHTML,cmpSameAs,cmpSpan,cmpClashOther,cmpClashWhen,cmpWin,cmpP,cmpSuParse,cmpSuNums,cmpSameP,cmpSuAsk,cmpSuKey,cmpLeaner,CMP_MAX};', ctx);
const { planFrom, cmpSources, cmpNumbers, cmpBest, cmpVms, cmpFromOptions, cmpKit, cmpDocHTML, cmpSameAs, cmpSpan, cmpClashOther, cmpClashWhen, cmpWin, cmpP, cmpSuParse, cmpSuNums, cmpSameP, cmpSuAsk, cmpSuKey, cmpLeaner, CMP_MAX } = ctx.G;

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

// 2b T43「结果一样、却多花钱」（纯函数）：交通数字（每车多等 / 排队 / 全网 / 电车公交 / 行人）和人行道都一样、租金更贵 → 标出便宜的那套和差价
const R = (md, q, car, hire, flags = {}) => ({ s: { mean_delay_s: md, queue_m: q, delay_min: car, transit: { src: 'gtfs', pax_min: 40 }, peds: { src: 'peds', extra_min: 0 } }, hire, flags: { footpath: 'none', ...flags } });
{
  const sa = cmpSameAs([R(60, 300, 900, 100), R(60, 300, 900.2, 340), R(12, 50, 200, 340)]);
  ok(sa[0] === null && sa[1] && sa[1].of === 0 && sa[1].extra === 240 && sa[2] === null, '贵的那套结果和便宜的一样（按屏上精度）→ 标「和 A 一样 · 多花差价」；便宜的、结果不同的都不标');
  const sb = cmpSameAs([R(60, 300, 900, 300), R(60, 300, 900, 100), R(60, 300, 900, 200)]);
  ok(sb[1] === null && sb[0].of === 1 && sb[0].extra === 200 && sb[2].of === 1 && sb[2].extra === 100, '几套都一样时对照最便宜的那套，差价逐列算（不是只认 B 列）');
  ok(cmpSameAs([R(60, 300, 900, 100), R(60, 300, 900, 100)]).every(x => x === null), '租金一样 → 不标');
  ok(cmpSameAs([R(60, 300, 900, 100), R(60, 300, 900, 200, { footpath: 'left' })])[1] === null, '人行道不一样 → 不算同样的结果');
  ok(cmpSameAs([R(0, 0, 0, 100, { inactive: true }), R(0, 0, 0, 200, { inactive: true })]).every(x => x === null), '这个时段不施工（全是 0）→ 不标');
  ok(cmpSameAs([R(60, 300, 900, null), { ...R(60, 300, 900, 200), s: null }, R(60, 300, 900, 200)]).every(x => x === null), '没有租金或没算出来 → 不参与比较');
  ok(cmpSpan('2026-10-07', '2026-10-09', false) === '7–9 Oct' && cmpSpan('2026-10-07', '2026-10-09', true) === '10/7–9', '重叠日期：英文日在前（墨尔本读法），中文 10/7–9');
  ok(cmpSpan('2026-09-30', '2026-10-02', false) === '30 Sep – 2 Oct' && cmpSpan('2026-09-30', '2026-10-02', true) === '9/30–10/2' && cmpSpan('2026-10-07', '2026-10-07', false) === '7 Oct' && cmpSpan(null, null, true) === '', '跨月、同一天、没有日期');
}

// 2c T46（lead 拍板）：04 叠加一行跟着 03 的「错开 N 天」走（纯函数）—— 用 03 的 stagger().worksite，行名写挪后的日期 + 已错开 N 天
{
  const hr = h => String(h).padStart(2, '0') + ':00';
  const x = { o: { id: 'W-X', title: 'X' }, ws: { id: 'W-X', links: ['x'], time: { from: '2026-10-07', to: '2026-10-12', hours: [7, 19] } }, r: { cost: 900, hours: [8, 17], overlap: { from: '2026-10-07', to: '2026-10-09', days: 3 } } };
  const moved = { ...x.ws, time: { ...x.ws.time, from: '2026-10-10', to: '2026-10-15' } };
  const st = { best: { days: 3, cost: 0, overlap_days: 0, reliable: true }, worksite: moved };
  const y = cmpClashOther(x, st);
  ok(y.ws === moved && y.days === 3 && y.o === x.o && y.r === x.r && x.ws.time.from === '2026-10-07', '03 错开了（可信）→ 04 用 03 挪好的同一个 worksite，记下 N；03 挑的那处施工本身不改');
  ok(cmpClashOther(x, null) === x && cmpClashOther(x, { best: null, worksite: null }) === x && cmpClashOther(x, { ...st, best: { ...st.best, reliable: false } }) === x && cmpClashOther(null, st) === null,
    '没错开 / 错开没找到可信的（03 写「没找到可信的错开方案」、日期不变）/ 没有同期施工 → 原样，不挪');
  ok(cmpClashWhen(x, false, hr) === '7–9 Oct · 08:00 & 17:00' && cmpClashWhen(x, true, hr) === '10/7–9 · 08:00 & 17:00', '没错开：行名照旧（重叠日期 · 采样小时）');
  ok(cmpClashWhen(y, false, hr) === '10–15 Oct · staggered 3 days' && cmpClashWhen(y, true, hr) === '10/10–15 · 已错开 3 天', '错开后：行名写那处施工挪后的日期 + staggered 3 days / 已错开 3 天（不再重叠就不写采样小时）');
  const y1 = cmpClashOther(x, { best: { days: 1, cost: 400, overlap_days: 2, reliable: true }, worksite: { ...x.ws, time: { ...x.ws.time, from: '2026-10-08', to: '2026-10-13' } } });
  ok(cmpClashWhen(y1, false, hr) === '8–13 Oct · 08:00 & 17:00 · staggered 1 day', '错开后还有重叠：采样小时照写，1 天用单数');
}

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

  // T43 → T50：原来标准那套的 VMS 只写 ROADWORK / AHEAD、结果和最省一样；现在标准档两块 VMS 报延误（T5 读得出分钟数），三套结果各不相同
  const sa = cmpSameAs(kits);
  ok(sa.every(x => x === null) && kits[1].s.delay_min !== kits[0].s.delay_min && kits[0].hire < kits[2].hire && kits[2].hire < kits[1].hire,
    `T50：A、B 结果不再一样（全网 ${Math.round(kits[0].s.delay_min)} / ${Math.round(kits[1].s.delay_min)} 车·分钟），谁都不标「结果和 A 一样」；租金 A < C < B（A$${kits.map(k => k.hire).join(' / ')}）`);
  // T43：对比表「和附近施工叠加」逐套算，和 03 页（表单里的方案）同一处施工、同一口径
  const wsUrl = APPS + 'api/public/js/worksites.js';
  if (!existsSync(wsUrl)) console.log('⏭ 跳过叠加一段：没有 apps/api 的 worksites.js');
  else {
    const W = await import(pathToFileURL(wsUrl).href), cur = plan.worksites[0];
    const same = o => o.links.length === cur.links.length && o.links.every(id => cur.links.includes(id));
    const sc = [];
    for (const o of W.overlapping(cur, W.SEEDS).filter(o => !same(o)).slice(0, 3)) { const ws = W.toEngineWorksite(o); sc.push({ o, ws, r: await be.clash(cur, ws) }); }
    sc.sort((x, y) => (y.r.flags.reliable - x.r.flags.reliable) || (y.r.cost - x.r.cost) || (x.o.id < y.o.id ? -1 : 1));
    const other = sc[0];
    ok(other && other.r.flags.reliable && other.r.cost > 0, `演示登记表里有和 Lonsdale 同期、叠加成本 > 0 的施工：${other ? other.o.id + ' +' + other.r.cost : '无'}`);
    if (other) {
      const cells = [];
      for (const k of kits) cells.push((await be.clash(k.plan.worksites[0], other.ws)).cost);
      ok(cells[0] === other.r.cost && cells[1] !== other.r.cost, `默认文案：03 页叠加 +${other.r.cost}，对比表 A 格一样；B 报延误（T50）叠加不同（${cells.join(' / ')}）`);
      const cf = kits[2].plan.worksites[0].equipment.find(e => e.type === 'vms').frames;
      const curC = planFrom({ ...EP, f1: cf[0].join('\n'), f2: (cf[1] || []).join('\n') }).worksites[0];
      const rc = await be.clash(curC, other.ws);
      ok(cells[2] === rc.cost && rc.cost < other.r.cost, `表单改成 C 的屏上文字后 03 页叠加 +${rc.cost}，和对比表 C 列一样，也比只写 ROADWORK / AHEAD 少`);

      // T46（lead 拍板）：03 点「错开 N 天」之后，04 的叠加一行按错开后的那处施工算，03 和 04 一个说法。跑页面上真的 03
      // （8-clash.js 整个文件：clashRun / clashStagger / clashHTML）和 04（8-compare.js 的 cmpClashUpdate / cmpClashRow），
      // 格式化函数用 6-engine.js 真的那几行，DOM 换成桩（getElementById → null）；cmpRender 桩只做真 cmpRender 里和这一行有关的事
      {
        const ENG = readFileSync(WEB + 'src/js/6-engine.js', 'utf8'), CLS = readFileSync(WEB + 'src/js/8-clash.js', 'utf8'), CMS = readFileSync(WEB + 'src/js/8-compare.js', 'utf8');
        const fmt = ENG.slice(ENG.indexOf('const esc='), ENG.indexOf('const TYPES4=')), rowFns = CMS.slice(CMS.indexOf('async function cmpClashUpdate()'), CMS.indexOf('// Independent of scoring'));
        const pend = [], drain = async () => { while (pend.length) await pend.shift(); };
        // T49：这一段测的是引擎那条路（SUMO 覆盖范围以外的方案照旧），suPlan 桩成 false；SUMO 方案那条路见文件末尾 T49 一节
        const c = { planFrom, cmpSpan, cmpBest, cmpClashOther, cmpClashWhen, cmpWin, suPlan: () => false, console, EP: { ...EP }, BE: { api: be }, S: { ui: 4 }, LANG: { cur: 'en' },
          CP: { key: 'k1', busy: false, rows: kits, cl: null }, document: { getElementById: () => null }, engOn: () => true, engNet: () => be.engine.net };
        c.L = (en, zh) => (c.LANG.cur === 'zh' ? zh : en);
        c.cmpRender = () => { pend.push(c.cmpClashUpdate()); };
        vm.createContext(c);
        vm.runInContext(fmt + '\n' + CLS + '\n' + rowFns + '\n;globalThis.T46={CL};', c);
        const CL = c.T46.CL;
        const costs = () => c.CP.cl.cells.map(r => (r && r !== 'err' ? r.cost : r));
        const row = () => c.cmpClashRow(() => '');
        const nums04 = () => [...row().matchAll(/<span class="cmp-num"[^>]*>([^<]+)<\/span>/g)].map(m => +m[1].replace(/[+,]/g, ''));
        const show = async () => { await c.cmpClashUpdate(); await drain(); }; // 翻到 04：renderPanel → cmpRender → cmpClashUpdate

        CL.m = W; CL.src = 'seed'; CL.listP = Promise.resolve(W.SEEDS); // 演示登记表（不联网）
        CL.key = JSON.stringify(c.clashCur()); await c.clashRun();      // 03 打开：clashMount() 做的就是这两步
        ok(CL.other && CL.other.o.id === other.o.id && CL.other.r.cost === other.r.cost, `T46：03 挑中 ${CL.other && CL.other.o.id}，叠加 +${CL.other && CL.other.r.cost}`);
        await show();
        const before = costs(), row0 = row(), span0 = cmpSpan(other.r.overlap.from, other.r.overlap.to, false);
        ok(before.join() === cells.join() && row0.includes(`${span0} · 08:00 & 17:00`) && !row0.includes('staggered'),
          `T46：没错开时 04 照旧 —— 逐格 ${before.join(' / ')}，行名「${span0} · 08:00 & 17:00」`);

        c.S.ui = 3; await c.clashStagger(); await drain(); // 在 03 点「错开 N 天」
        const st = CL.st, b = st && st.best, n = b && b.days;
        ok(b && b.reliable && n >= 1 && st.worksite && st.worksite.time.from > other.ws.time.from && !/No reliable stagger/.test(c.clashHTML()),
          `T46：03 错开 ${n} 天 → 叠加 ${b && b.cost}（原来 +${other.r.cost}），那处施工挪到 ${st && st.worksite.time.from} → ${st && st.worksite.time.to}`);
        c.S.ui = 4; await show(); // 翻到 04
        const m03 = /Stagger by \+(\d+) days? → clash cost ([\d,]+) veh·min/.exec(c.clashHTML()), v03 = m03 && +m03[2].replace(/,/g, ''), after = costs(), n04 = nums04();
        ok(c.CP.cl.other.ws === st.worksite && c.CP.cl.other.days === n, 'T46：04 用的就是 03 挪好的那一个 worksite（同一个对象，日期一样），N 一样');
        ok(m03 && +m03[1] === n && after[0] === b.cost && after[1] === b.cost && n04[0] === v03 && n04[1] === v03,
          `T46：04 == 03 —— 03 屏上「错开 +${n} 天 → 叠加 ${m03 && m03[2]}」，04 表里 A、B 两格 ${n04.slice(0, 2).join(' / ')}（错开前是 ${before.slice(0, 2).join(' / ')}）`);
        ok(after.every(v => typeof v === 'number') && after[0] !== before[0], `T46 反向断言：错开后 04 不再写错开前的 +${before[0]}（逐格 ${after.join(' / ')}）`);
        const span1 = cmpSpan(st.worksite.time.from, st.worksite.time.to, false), row1 = row();
        c.LANG.cur = 'zh'; const row1zh = row(); c.LANG.cur = 'en';
        ok(row1.includes(`${span1}${b.overlap_days ? ' · 08:00 & 17:00' : ''} · staggered ${n} day`) && !row1.includes(span0) && row1zh.includes(`${cmpSpan(st.worksite.time.from, st.worksite.time.to, true)}`) && row1zh.includes(`已错开 ${n} 天`),
          `T46：04 行名写挪后的日期 + 已错开 N 天（「${span1} · staggered ${n} day${n === 1 ? '' : 's'}」），不再是原来的 ${span0}`);

        await c.clashRun(); await show(); // 03 重算（CL.st 清掉，页面上没有单独的「撤销」按钮，只有这一条路）
        ok(!CL.st && costs().join() === before.join() && row().includes(`${span0} · 08:00 & 17:00`) && !row().includes('staggered'), 'T46：03 的错开没了 → 04 回到原来的日期和数');

        await c.clashStagger(); await drain(); // 已经翻到 04 了，03 的错开才算完：clashStagger 结尾的 cmpRender() 让 04 跟上
        ok(c.CP.cl.other.ws === CL.st.worksite && costs()[0] === CL.st.best.cost && row().includes(`staggered ${CL.st.best.days} day`), 'T46：错开算完时人已经在 04 → 04 自己跟上，不用再翻一次页');

        Object.assign(c.EP, { f1: cf[0].join('\n'), f2: (cf[1] || []).join('\n') }); c.CP.key = 'k2'; await show(); // 回 01 改了方案、没再进 03
        ok(c.CP.cl.other && c.CP.cl.other.ws.time.from === other.ws.time.from && c.CP.cl.other.days == null && c.CP.cl.other.o.id === other.o.id && !row().includes('staggered') && costs().join() === cells.join(),
          `T46 反向断言：方案改了（03 的错开是上一个方案的）→ 04 不套用，按那处施工原来的日期现挑现算（逐格 ${costs().join(' / ')}，和没错开时一样）`);
      }
    }
  }
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
  const c={CP:state,LANG:language,cmpLabel:()=>language.cur,cmpRender:()=>{},suPlan:()=>false,console};vm.createContext(c);
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

// 5 T49（lead D-0930「SUMO 为主，引擎退幕后」）：SUMO 覆盖的方案（Lonsdale 这段、只封 1 条道）在 04 对比 / 05 导出 / 03 附近施工
//   不出现引擎的交通结果数（排队 m、每车 s、车·分钟、人·分钟、叠加成本）：SUMO 有的用 SUMO 的，没有的写「SUMO 暂不覆盖」；
//   引擎只在幕后把牌上的字读成「会绕行的司机」比例 p（SUMO 的输入）。页面真的 8-compare.js / 8-clash.js 整个文件 + 6-engine.js
//   的格式化那几行，DOM 换成桩，SUMO 客户端换成假的 runOptions（sumo-client.js 的 runOptions 由 T49-a 另写，这里按约定的调用方式测）
{
  // 5a 纯函数
  ok(cmpP({ routes: [{ id: 'stay', share: 0.86 }, { id: 'r1', share: 0.14 }] }) === 0.14 && cmpP({ routes: [{ id: 'stay', share: 0.395 }] }) === 0.605
    && cmpP({ detour_share: 0.3, routes: [] }) === 0.3 && cmpP(null) === null && cmpP({}) === null, 'T49 p = 1 − 原路（stay）份额，没有 routes 用 detour_share，取到 0.1%；没读数 → null');
  const M1 = { works_queue_max_m: 1 };
  const shapes = [[{ id: 'A', metrics: M1 }], { options: [{ id: 'opt-A', metrics: M1 }] }, { index: { scenarios: [{ id: 'baseline', metrics: {} }, { id: 'option_A', metrics: M1 }] } }, { scenarios: [{ id: 'a', works_queue_max_m: 1 }] }, { metrics: { A: M1 } }];
  ok(shapes.every(s => { const r = cmpSuParse(s, ['A', 'B']); return r.A && r.A.works_queue_max_m === 1 && r.B === null; }) && JSON.stringify(cmpSuParse(null, ['A'])) === '{"A":null}',
    'T49 runOptions 的结果几种形状都认（数组 / options / index.scenarios / 指标直接写在条目里 / metrics 按 id），没有的方案 → null');
  const n1 = cmpSuNums({ works_queue_equiv_end_m: 120.4, works_queue_max_m: 160, works_traffic_extra_s: 38.3, mean_extra_s: 6.9, cohort_vehicles: 1565, vehicles: 1764, detour_vehicles: 5 });
  ok(n1.q === 120.4 && !n1.qMax && n1.ex === 38.3 && Math.abs(n1.tot - 6.9 * 1565 / 60) < 1e-9 && n1.totEst && n1.dv === 5, 'T49 09:00 排队用 works_queue_equiv_end_m；总延误 = mean_extra_s × cohort_vehicles / 60（车·分钟，标 ≈）');
  const n2 = cmpSuNums({ works_queue_max_m: 160.8, total_extra_veh_min: 200, detour_vehicles: 0 });
  ok(n2.q === 160.8 && n2.qMax && n2.tot === 200 && !n2.totEst && n2.ex === null && n2.dv === 0 && cmpSuNums(null) === null, 'T49 没有 09:00 排队 → 用本次最长（标出来）；SUMO 自己给了总数就用它；没有的是 null 不是 0');
  const sp = cmpSameP([{ p: 0.14, hire: 515 }, { p: 0.14, hire: 1765 }, { p: 0.605, hire: 1765 }]);
  ok(sp[0] === null && sp[1] && sp[1].of === 0 && sp[1].extra === 1765 - 515 && sp[2] === null, 'T49 p 一样 = SUMO 结果一样（按构造）→ 贵的那套对照便宜的、记差价');
  ok(cmpSameP([{ p: 0.14, hire: 515, flags: { inactive: true } }, { p: 0.14, hire: 900, flags: { inactive: true } }]).every(x => x === null) && cmpSameP([{ p: null, hire: 1 }, { p: null, hire: 2 }]).every(x => x === null), 'T49 不施工 / 没读数 → 不标');
  // T50 纯函数：SUMO 请求 + 缓存键；C 比 B 少一块 VMS、更便宜、绕行更多 → C 列一条中性说明
  const K = (tier, stay, hire, vms, flags = {}) => ({ id: { o1: 'A', o2: 'B', o3: 'C' }[tier], tier, s: { routes: [{ id: 'stay', share: stay }] }, hire, flags, plan: { worksites: [{ equipment: Array.from({ length: vms }, () => ({ type: 'vms' })) }] } });
  const kk = [K('o1', 0.86, 515, 0), K('o2', 0.508, 2515, 2), K('o3', 0.395, 1765, 1)];
  ok(JSON.stringify(cmpSuAsk(kk)) === '[{"id":"A","p":0.14},{"id":"B","p":0.492},{"id":"C","p":0.605}]' && cmpSuAsk([{ id: 'A', s: null }]).length === 0 && cmpSuKey(cmpSuAsk(kk), 42) === '42|A:0.14,B:0.492,C:0.605' && cmpSuKey(cmpSuAsk(kk), 7) !== cmpSuKey(cmpSuAsk(kk), 42),
    'T50 cmpSuAsk → [{id, p}]（没读数的不问）；缓存键 = 种子 + 每套 id:p（种子变了键就变）');
  const le = cmpLeaner(kk);
  ok(le[0] === null && le[1] === null && le[2] && le[2].of === 1 && le[2].save === 750 && le[2].fewer === 1, 'T50 C 比 B 便宜 A$750、少一块 VMS、绕行更多 → 只在 C 列标');
  ok(cmpLeaner([kk[0], kk[1], K('o3', 0.508, 1765, 1)]).every(x => x === null) && cmpLeaner([kk[0], kk[1], K('o3', 0.395, 2515, 1)]).every(x => x === null)
    && cmpLeaner([kk[0], kk[1], K('o3', 0.395, 1765, 1, { inactive: true })]).every(x => x === null) && cmpLeaner([kk[0], kk[2]]).every(x => x === null) && cmpLeaner(null).length === 0,
    'T50 反向：C 绕行不比 B 多 / 不比 B 便宜 / 不施工 / 没有 B → 不标');
  ok(cmpWin(3, 2, false) === '3 days × 2 peak hours' && cmpWin(1, 1, false) === '1 day × 1 peak hour' && cmpWin(3, 2, true) === '3 天 × 2 个高峰小时' && cmpWin(0, 2, false) === '', 'T49 叠加的窗口写成「3 days × 2 peak hours」（别的行是一小时）；错开后不重叠 → 空');

  // 5b 真路网 + 页面真的 04 / 03 代码
  const wsUrl = APPS + 'api/public/js/worksites.js';
  const W = existsSync(wsUrl) ? await import(pathToFileURL(wsUrl).href) : null;
  const res5 = await be.options(plan, { n: 3 }), kits5 = cmpFromOptions(res5);
  const ENG = readFileSync(WEB + 'src/js/6-engine.js', 'utf8'), CLS = readFileSync(WEB + 'src/js/8-clash.js', 'utf8'), CMS = readFileSync(WEB + 'src/js/8-compare.js', 'utf8');
  const fmt = ENG.slice(ENG.indexOf('const esc='), ENG.indexOf('const TYPES4='));
  const SUMO_LINK = 'l595594354_9756035316';
  ok(EP.link === SUMO_LINK && EP.lanes === 1 && kits5.length === 3, 'T49 演示方案就是 SUMO 覆盖的那段（Lonsdale、封 1 条道），options() 出 3 套');
  const page = (client, ep = EP) => {
    const c = { console, EP: { ...ep, all: false }, BE: { api: be }, S: { ui: 4, step: 4 }, LANG: { cur: 'en' }, SUMO_LINK, SU: { seed: 42, mod: null, index: null },
      document: { getElementById: () => null, querySelector: () => null }, compactPanel() {}, toast() {}, creditLines: () => [], engOn: () => true, engNet: () => be.engine.net,
      setInterval: () => 1, clearInterval() {}, sumoErr: e => String((e && e.message) || e), sumoReason: k => 'why:' + k, sumoClient: client };
    c.L = (en, zh) => (c.LANG.cur === 'zh' ? zh : en);
    vm.createContext(c);
    vm.runInContext(pure('6-engine.js') + '\n' + fmt + '\n' + CLS + '\n' + CMS + '\n;globalThis.X={CP,CL};', c);
    Object.assign(c.X.CP, { rows: kits5, key: 'k5', src: 'kits', busy: false });
    if (W) Object.assign(c.X.CL, { m: W, src: 'seed', listP: Promise.resolve(W.SEEDS) });
    return c;
  };
  // 屏上不许出现的引擎数：线上看到的那几个 + 这 3 套引擎算出来的（排队、每车多等、全网延误、电车公交、行人）
  const H = n => Math.round(Number(n) || 0).toLocaleString('en-AU');
  const engNums = new Set(['918', '509', '10,493', '18,693', '33,015', '79']);
  for (const k of kits5) { const s = k.s; for (const v of [s.queue_m, s.mean_delay_s, s.delay_min, s.transit && s.transit.pax_min, s.peds && s.peds.extra_min]) if (Number.isFinite(v) && Math.round(v) >= 10) engNums.add(H(v)); }
  const leaks = html => [...engNums].filter(n => new RegExp(`(?<![\\d,.$])${n}(?![\\d]|,\\d)`).test(html.replace(/A\$[\d,]+/g, 'A$')));
  const metricsFor = p => ({ works_queue_equiv_end_m: 300 - 200 * p + 0.4, works_queue_max_m: 400, works_traffic_extra_s: 40 - 10 * p, mean_extra_s: 7 + 2 * p, cohort_vehicles: 1565, detour_vehicles: Math.round(p * 100) });
  const calls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const cli = { runOptions: async (opts, params) => { calls.push({ opts, params }); await gate; return { source: 'live', runId: 'x', elapsedMs: 61234, index: { hour: 8, seed: params.seed, options: opts.map(o => ({ id: o.id, p: o.p, metrics: metricsFor(o.p) })) } }; } };
  const c = page(async () => cli);
  const pend = c.cmpSuUpdate();
  const busyHtml = c.cmpHTML();
  ok(/SUMO computing the options in the cloud · <span data-cmpsuel>\d+<\/span> s \(about 1 min\)/.test(busyHtml) && busyHtml.includes('class="spin"') && !leaks(busyHtml).length,
    `T49 SUMO 在算时：表里一行转圈「SUMO computing the options in the cloud · X s (about 1 min)」，没有引擎数${leaks(busyHtml).length ? '（漏了 ' + leaks(busyHtml) + '）' : ''}`);
  const pRow = /Drivers who detour \(AI sign reading\)[\s\S]*?<\/tr>/.exec(busyHtml);
  ok(pRow && pRow[0].includes('>14%<') && pRow[0].includes('>49%<') && pRow[0].includes('>61%<') && pRow[0].includes('SUMO’s input'), `T49 / T50 「AI 读牌 → 会绕行的司机」一行：引擎读牌得到的 p（14% / 49% / 61%），标明是 SUMO 的输入`);
  release(); await pend;
  ok(calls.length === 1 && JSON.stringify(calls[0].opts) === JSON.stringify([{ id: 'A', p: 0.14 }, { id: 'B', p: cmpP(kits5[1].s) }, { id: 'C', p: cmpP(kits5[2].s) }]) && calls[0].params.seed === 42,
    `T49 调 runOptions([{id,p}…], {seed: SU.seed})：${calls[0] && calls[0].opts.map(o => o.id + ' ' + o.p).join(' / ')} · seed ${calls[0] && calls[0].params.seed}`);
  const html = c.cmpHTML(), lk = leaks(html);
  ok(!lk.length, `T49 反向断言：04 表里没有任何引擎交通数（查了 ${[...engNums].join(' / ')}）${lk.length ? ' —— 漏了 ' + lk.join(', ') : ''}`);
  const cell = (row) => { const m = new RegExp(`${row}[\\s\\S]*?</tr>`).exec(html); return m ? [...m[0].matchAll(/<span class="cmp-num">([^<]+)<\/span>/g)].map(x => x[1]) : []; };
  const q = cell('Works queue at 09:00'), ex = cell('Extra per vehicle through the works'), tot = cell('Total extra delay in the SUMO area'), dv = cell('Detoured vehicles');
  const want = kits5.map(k => metricsFor(cmpP(k.s)));
  ok(q.join() === want.map(m => H(m.works_queue_equiv_end_m)).join() && ex.join() === want.map(m => H(m.works_traffic_extra_s)).join()
    && tot.join() === want.map(m => H(m.mean_extra_s * m.cohort_vehicles / 60)).join() && dv.join() === want.map(m => H(m.detour_vehicles)).join(),
    `T49 SUMO 的数逐格进表：09:00 排队 ${q.join(' / ')} m · 每车 ${ex.join(' / ')} s · 总延误 ${tot.join(' / ')} 车·分钟 · 绕行 ${dv.join(' / ')} 辆`);
  ok(html.includes('≈ mean × vehicles') && /Trams &amp; buses|Trams & buses/.test(html) && /Pedestrians/.test(html) && (html.match(/not covered by SUMO/g) || []).length >= 6,
    'T49 电车公交、行人两行每格写「not covered by SUMO」；总延误标「≈ mean × vehicles」');
  const amt = H(kits5[1].hire - kits5[2].hire);
  ok(html.includes(`<i class="cmp-dup" data-eq data-lean>One VMS fewer than B, A$${amt} cheaper · just better wording</i>`) && !html.includes('Same traffic effect') && !html.includes('Same result as'),
    `T50 C 的标记：「One VMS fewer than B, A$${amt} cheaper · just better wording」；p 各不相同 → 没有「Same traffic effect」`);
  ok(/SUMO computed live in the cloud · 61\.2 s · seed 42/.test(html) && html.includes('Traffic 08:00–09:00 weekday · SUMO on the real CBD network') && !/engine on real CBD flows|Car, tram &amp; bus and on-foot numbers|Car, tram & bus and on-foot numbers/.test(html),
    'T49 表尾写 SUMO（现场计算 · 秒 · seed），不再写「引擎在真实 CBD 车流上算」');
  c.LANG.cur = 'zh'; const zh = c.cmpHTML(); c.LANG.cur = 'en';
  ok(zh.includes(`比 B 少一块 VMS、便宜 A$${amt} · 只靠写对屏上的字`) && zh.includes('AI 读牌 → 会绕行的司机') && zh.includes('SUMO 暂不覆盖') && !leaks(zh).length, 'T50 中文：「比 B 少一块 VMS、便宜 A$… · 只靠写对屏上的字」、「AI 读牌 → 会绕行的司机」、「SUMO 暂不覆盖」');
  // T49-b 的「交通效果相同」只在 p 一样时出现（这里把 B 的读数换成 A 的）；B 比 A 多两块 VMS + 箭头板 → 说「多出来的设备」，不说只是箭头板
  const eqP = page(async () => cli); Object.assign(eqP.X.CP, { rows: [kits5[0], { ...kits5[1], s: kits5[0].s }, kits5[2]], key: 'k5eq' });
  const he2 = eqP.cmpHTML(), amtBA = H(kits5[1].hire - kits5[0].hire);
  ok(he2.includes(`<i class="cmp-dup" data-eq>Same traffic effect as A · models don't value the extra equipment's safety role · +A$${amtBA}</i>`) && !he2.includes('arrow board&#39;s') && !he2.includes("arrow board's"),
    `T50 p 一样才标「Same traffic effect as A」（B 多的是两块 VMS + 箭头板 → 说「extra equipment」，不说只是箭头板 · +A$${amtBA}）`);

  // 附近施工一行：列出哪处施工、日期、窗口、建议错开几天；不给引擎叠加成本，也不逐套跑 be.clash
  if (W) {
    await c.cmpClashUpdate();
    const x = c.X.CP.cl && c.X.CP.cl.other, row = c.cmpClashRow(() => '');
    const sug = x && Math.max(1, Math.min(14, (Date.parse(c.clashCur().time.to) - Date.parse(x.ws.time.from)) / 864e5 + 1));
    ok(x && x.r.flags.reliable && x.r.cost > 0 && c.X.CP.cl.cells.length === 0, `T49 04 叠加一行：挑中 ${x && x.o.id}（引擎在幕后挑），不再逐套算叠加成本`);
    ok(x && row.includes(cmpSpan(x.r.overlap.from, x.r.overlap.to, false)) && row.includes(cmpWin(x.r.overlap.days, x.r.hours.length, false)) && row.includes(`suggest staggering it ${sug} day`)
      && (row.match(/combined impact not covered by SUMO/g) || []).length === 3 && !row.includes(H(x.r.cost)) && !leaks(row).length,
      `T49 04 叠加一行：日期、「${x && cmpWin(x.r.overlap.days, x.r.hours.length, false)}」、建议错开 ${sug} 天、每格「combined impact not covered by SUMO」，没有 +${x && H(x.r.cost)}`);
    if (x) for (const v of [x.r.cost, x.r.a, x.r.b, x.r.ab]) if (Math.abs(v) >= 100) engNums.add(H(v));
    const full = c.cmpHTML();
    ok(!leaks(full).length && full.includes('combined impact not covered by SUMO'), `T49 反向断言：叠加一行填好后整张 04 表还是没有引擎数（加查叠加的 D(A) / D(B) / D(A+B) / 成本）${leaks(full).length ? ' —— 漏了 ' + leaks(full) : ''}`);
    // 03 附近施工页签（8-clash.js）同一口径
    c.S.ui = 3; c.X.CL.key = JSON.stringify(c.clashCur()); await c.clashRun();
    const h3 = c.clashHTML(), o3 = c.X.CL.other;
    ok(o3 && h3.includes(`Suggestion: stagger ${o3.o.title} by ${sug} day`) && h3.includes('Combined impact not covered by SUMO') && h3.includes(cmpWin(o3.r.overlap.days, o3.r.hours.length, false))
      && ![o3.r.cost, o3.r.a, o3.r.b, o3.r.ab].filter(v => Math.abs(v) >= 100).some(v => new RegExp(`(?<![\\d,])${H(v)}(?![\\d]|,\\d)`).test(h3)) && !/veh·min/.test(h3) && c.clashBtnHTML() === '',
      `T49 03 附近施工：名称、日期、窗口、建议错开 ${sug} 天，不给 D(A) / D(B) / D(A+B) / 叠加成本，也没有引擎的「错开」按钮`);
    const e3 = page(async () => cli, { ...EP, lanes: 2 });
    Object.assign(e3.X.CL, { other: o3, more: [], key: 'x' });
    const h3e = e3.clashHTML();
    ok(h3e.includes('Engine estimate.') && h3e.includes(H(o3.r.cost)) && e3.clashBtnHTML().includes('Stagger by'), 'T49 SUMO 范围以外的方案：03 照旧给引擎叠加成本和错开按钮，标「Engine estimate」');
    c.S.ui = 4;
  } else console.log('⏭ 跳过叠加一段：没有 apps/api 的 worksites.js');

  // 05 导出（选中 C）：卡片上是 SUMO 的总延误，电车公交 / 行人「SUMO 暂不覆盖」
  c.S.ui = 5; c.X.CP.pick = 2;
  const h5 = c.cmpHTML();
  ok(h5.includes('Extra delay · SUMO area') && h5.includes(H(want[2].mean_extra_s * 1565 / 60)) && (h5.match(/not covered by SUMO/g) || []).length >= 2 && !leaks(h5).length && h5.includes('Traffic numbers: SUMO'),
    `T49 05 导出卡片：SUMO 范围延误增量 ${H(want[2].mean_extra_s * 1565 / 60)} 车·分钟，电车公交 / 行人 SUMO 暂不覆盖，没有引擎数`);
  c.S.ui = 4; c.X.CP.pick = null;
  // AI 解读：SUMO 方案不去要（explain.js 读的是引擎的数），「倾向」也不出
  let asked = 0; c.X.CP.mod = { ex: { explainOptions: () => { asked++; return Promise.resolve({}); }, optionFromRun: () => ({}) } };
  c.cmpExplainUpdate(); await new Promise(r => setImmediate(r));
  ok(asked === 0 && c.X.CP.explain === null, 'T49 SUMO 方案不调 explainOptions（会引用引擎的数）——藏起来，不喂');
  // 执行包的「比较过的方案」表（cmpDocHTML src:'sumo'）
  const packUrl5 = APPS + 'api/public/js/pack.js';
  if (existsSync(packUrl5)) {
    const pack = await import(pathToFileURL(packUrl5).href);
    if (typeof pack.packDoc === 'function') {
      const inventory = await pack.loadInventory({ fetch: fakeFetch }), net = be.engine.net, ws = kits5[2].plan.worksites[0];
      const pk = pack.buildPack({ ...ws, title: ws.name, status: 'decided', decision: { option: 'C', by: 'council', reason: 'r', at: '2026-10-01T00:00:00.000Z' } }, { inventory, links: new Map(ws.links.map(id => [id, net.links.get(id)])) });
      const Hh = { L: en => en, esc: x => String(x == null ? '' : x).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])), fmt: H };
      const rowsX = kits5.map((k, i) => ({ id: k.id, label: k.label, car: want[i].mean_extra_s * 1565 / 60, transit: null, peds: null, hire: k.hire }));
      const doc = cmpDocHTML(pack.packDoc(pk, 'en'), { rows: rowsX, src: 'sumo', pick: 2, by: 'Council', hour: '08:00', date: '1 Oct 2026' }, Hh);
      ok(doc.includes('Extra delay · SUMO area') && (doc.match(/not covered by SUMO/g) || []).length >= 6 && doc.includes('Traffic numbers: SUMO') && !doc.includes('simulation engine') && !leaks(doc).length,
        'T49 执行包「比较过的方案」：SUMO 范围延误增量，电车公交 / 行人写「not covered by SUMO」，注明 SUMO 不是引擎');
    }
  }

  // runOptions 还没有（T49-a 没上线）/ 抛错 / 客户端没加载 / 没结果 → 每格 —，写原因，绝不拿引擎的数顶上
  const bad = async (client, re, what) => {
    const f = page(client); await f.cmpSuUpdate(); const h = f.cmpHTML(), q5 = /Works queue at 09:00[\s\S]*?<\/tr>/.exec(h);
    ok(re.test(h) && q5 && [...q5[0].matchAll(/<span class="cmp-num">([^<]+)<\/span>/g)].every(m => m[1] === '—') && h.includes('data-cmpsure') && !leaks(h).length && !/<b>boom/.test(h),
      `T49 ${what} → SUMO 那几行是 —，写原因、给「重试」，没有引擎数`);
  };
  await bad(async () => ({ runReal() {} }), /SUMO numbers unavailable: this SUMO client has no runOptions yet/, '客户端还没有 runOptions');
  await bad(async () => ({ runOptions: async () => { throw new Error('<b>boom</b>'); } }), /the SUMO options run failed \(&lt;b&gt;boom&lt;\/b&gt;\)/, 'runOptions 抛错（报错文字转义）');
  await bad(async () => { throw new Error('404'); }, /the SUMO client did not load \(404\)/, 'sumo-client.js 没加载上');
  await bad(async () => ({ runOptions: async () => ({ source: 'none', reason: 'health_down', index: null }) }), /SUMO gave no result for these plans \(why:health_down\)/, 'runOptions 回来没有这几套的结果');
  await bad(undefined, /this SUMO client has no runOptions yet/, '页面没有 sumoClient（5-app.js 没装上）');

  // SUMO 范围以外的方案（这里只把封道数改成 2）：04 照旧是引擎的数、「结果和 A 一样」，标「engine estimate」，不调 runOptions
  const n = [];
  const e = page(async () => ({ runOptions: async () => { n.push(1); return {}; } }), { ...EP, lanes: 2 });
  await e.cmpSuUpdate();
  const he = e.cmpHTML();
  ok(n.length === 0 && he.includes(`>${H(kits5[0].s.queue_m)}<`) && he.includes(`>${H(kits5[0].s.delay_min)}<`) && !he.includes('Same result as A') && he.includes(`One VMS fewer than B, A$${amt} cheaper · just better wording`) && he.includes('engine estimate on real CBD flows') && !he.includes('not covered by SUMO'),
    `T49 SUMO 范围以外：照旧引擎的数（排队 ${H(kits5[0].s.queue_m)} m、全网 ${H(kits5[0].s.delay_min)} 车·分钟），C 也标「One VMS fewer than B…」，标「engine estimate」，不调 runOptions`);

  // 6 T50 后台预取：第 2 步现场 SUMO 算成功（5-app.js sumoRerun）→ 马上按 04 的做法配三套、读 p、调 runOptions（不渲染）；04 打开时
  //   缓存命中就立刻出数、还在算就接上（转圈从已过去的秒数接着数）；第 2 步还在算 → 04 排在它后面；页面同时最多一个云端任务。
  //   跑页面真的 8-compare.js + 5-app.js 的 sumoLane / sumoRerun，SUMO 客户端换成假的（runReal / runOptions 都能卡住、数并发）
  {
    const APPX = readFileSync(WEB + 'src/js/5-app.js', 'utf8');
    const laneSrc = APPX.slice(APPX.indexOf('let sumoTail='), APPX.indexOf('\n', APPX.indexOf('function sumoLane(')) + 1);
    const i0 = APPX.indexOf('async function sumoRerun(){'), rerunSrc = APPX.slice(i0, APPX.indexOf('\n}\n', i0) + 3);
    ok(laneSrc.includes('function sumoLane(fn)') && rerunSrc.includes('cmpPrefetch(seed)'), 'T50 5-app.js 有 sumoLane / sumoRerun（这一节跑的就是它们）');
    const settle = async (n = 30, until = () => false) => { for (let i = 0; i < n && !until(); i++) await new Promise(r => setImmediate(r)); };
    const mkCli = () => {
      const log = { real: 0, opts: 0, active: 0, max: 0, last: null }, gates = [];
      const busy = async () => { log.active++; log.max = Math.max(log.max, log.active); await new Promise(r => gates.push(r)); log.active--; };
      const cli = {
        runReal: async params => { log.real++; await busy(); return { source: 'live', runId: 'r' + log.real, elapsedMs: 50000, index: { hour: 8, seed: params.seed } }; },
        runOptions: async (opts, params) => { log.opts++; log.last = { opts, params }; await busy(); return { source: 'live', runId: 'o' + log.opts, elapsedMs: 61234, index: { hour: 8, seed: params.seed, options: opts.map(o => ({ id: o.id, p: o.p, metrics: metricsFor(o.p) })) } }; },
      };
      return { cli, log, open: () => { const g = gates.shift(); if (g) g(); return !!g; } };
    };
    const nOpt = { n: 0 }, beApi = { ...be, options: (...a) => { nOpt.n++; return be.options(...a); } };
    const page2 = cli => {
      const c = { console, EP: { ...EP, all: false }, BE: { api: beApi }, S: { ui: 2, step: 2, sim: null }, LANG: { cur: 'en' }, SUMO_LINK,
        SU: { cli, seed: 42, mod: null, index: null, busy: false, tok: 0, ref: { source: 'baked' }, src: { source: 'baked' }, failed: false },
        document: { getElementById: () => null, querySelector: () => null }, compactPanel() {}, toast() {}, creditLines: () => [], engOn: () => true, engNet: () => be.engine.net,
        setInterval: () => 1, clearInterval() {}, sumoErr: e => String((e && e.message) || e), sumoReason: k => 'why:' + k, sumoClient: async () => cli,
        sumoWant: () => true, renderPanel() {}, gridShown: () => false, sumoPAi: () => 0.53, sumoKey: () => 'k', performance: { now: () => Date.now() }, sumoBaked: async () => {}, sumoPlay: async () => {} };
      c.L = (en, zh) => (c.LANG.cur === 'zh' ? zh : en);
      vm.createContext(c);
      vm.runInContext(pure('6-engine.js') + '\n' + fmt + '\n' + CLS + '\n' + CMS + '\n' + laneSrc + '\n' + rerunSrc + '\n;globalThis.X={CP,CL,CSU};', c);
      const pf = [], orig = c.cmpPrefetch; c.cmpPrefetch = seed => { const p = orig(seed); pf.push({ seed, p }); return p; }; // 记下 sumoRerun 调了几次预取
      return { c, pf };
    };
    const open04 = c => { Object.assign(c.X.CP, { rows: kits5, key: 'k5', src: 'kits', busy: false }); c.S.ui = 4; };
    const nums04 = html => { const m = /Works queue at 09:00[\s\S]*?<\/tr>/.exec(html); return m ? [...m[0].matchAll(/<span class="cmp-num">([^<]+)<\/span>/g)].map(x => x[1]) : []; };
    const wantQ = kits5.map(k => H(metricsFor(cmpP(k.s)).works_queue_equiv_end_m)).join();

    // 6a 第 2 步算成功 → 预取一次；04 打开时它还在算 → 接上；之后再来 04 → 缓存命中立刻出数
    {
      const f = mkCli(), { c, pf } = page2(f.cli);
      const run = c.sumoRerun(); await settle(30, () => f.log.real === 1);
      ok(f.log.real === 1 && c.SU.busy && pf.length === 0, 'T50 第 2 步在云端算时还不预取');
      f.open(); await run;
      ok(pf.length === 1 && pf[0].seed === 42, 'T50 第 2 步现场算成功（source live）→ 调一次 cmpPrefetch(这次的 seed 42)，不等它');
      const job = await pf[0].p; await settle(60, () => f.log.opts === 1);
      ok(job && f.log.opts === 1 && JSON.stringify(f.log.last.opts) === JSON.stringify(cmpSuAsk(kits5)) && f.log.last.params.seed === 42 && nOpt.n === 1,
        `T50 预取：按 04 的做法配三套（be.options 一次）、p = 1 − 原路份额，后台调 runOptions(${f.log.last && f.log.last.opts.map(o => o.id + ' ' + o.p).join(' / ')}, {seed: 42})`);
      ok(await c.cmpOptions(c.planFrom(c.EP)) && nOpt.n === 1, 'T50 04 配方案用同一份 be.options() 结果（cmpOptions），不再算一遍');
      const run2 = c.sumoRerun(); await settle(30);
      ok(f.log.real === 1 && c.SU.busy, 'T50 预取还在云端算时再点「运行 SUMO」→ 第 2 步排在它后面，不同时发第二个任务');
      open04(c); job.t1 -= 30000; // 预取已经算了 30 秒
      const u = c.cmpSuUpdate(), h = c.cmpHTML();
      ok(c.X.CP.su.job === job && /SUMO computing the options in the cloud · <span data-cmpsuel>3\d<\/span> s/.test(h) && f.log.opts === 1,
        'T50 04 打开时预取还在算 → 接上同一个任务：转圈从已经过去的 30 s 接着数，不再发 runOptions');
      f.open(); await u; await settle(30, () => f.log.real === 2);
      const h2 = c.cmpHTML();
      ok(f.log.opts === 1 && nums04(h2).join() === wantQ && !h2.includes('class="spin"'), `T50 预取算完 → 04 直接出 SUMO 的数（09:00 排队 ${nums04(h2).join(' / ')} m），runOptions 一共 1 次`);
      ok(f.log.real === 2, 'T50 预取算完才轮到第 2 步重跑的 runReal');
      f.open(); await run2; await settle(60);
      ok(pf.length === 2 && f.log.opts === 1, 'T50 第 2 步重跑（同一种子、同一组 p）后又预取一次 → 缓存命中，不再跑');
      c.X.CP.su = null; c.X.CP.key = 'k5b';
      c.cmpSuUpdate(); const h3 = c.cmpHTML();
      ok(nums04(h3).join() === wantQ && !h3.includes('class="spin"') && f.log.opts === 1, 'T50 再进 04（缓存命中）→ 立刻出数：不转圈、不再调 runOptions');
      c.SU.seed = 7; c.X.CP.su = null; const u7 = c.cmpSuUpdate(); await settle(30, () => f.log.opts === 2);
      ok(f.log.opts === 2 && f.log.last.params.seed === 7 && c.cmpHTML().includes('class="spin"'), 'T50 种子改了 → 新的键 → 重新算');
      f.open(); await u7;
      ok(f.log.max === 1, `T50 整个过程云端同时最多 1 个任务（最多 ${f.log.max} 个）`);
    }

    // 6b 第 2 步还在算时进 04 → 04 排队等它（写明在等第 2 步）；第 2 步算完 04 才跑；预取算出同一个键 → 接上，不跑第二次
    {
      const f = mkCli(), { c, pf } = page2(f.cli);
      const run = c.sumoRerun(); await settle(30, () => f.log.real === 1);
      open04(c);
      const drew = [], r0 = c.cmpRender; c.cmpRender = () => { drew.push(!!(c.X.CP.su && c.X.CP.su.job && c.X.CP.su.job.wait)); return r0(); }; // 真页面靠重绘换字
      const u = c.cmpSuUpdate(); await settle(30, () => c.X.CP.su.job && c.X.CP.su.job.wait);
      const h = c.cmpHTML();
      ok(f.log.opts === 0 && c.X.CP.su.job.wait && drew.includes(true) && h.includes('Waiting for step 2’s SUMO run to finish, then these plans') && h.includes('(one cloud run at a time)'),
        'T50 第 2 步还在云端算 → 04 排在它后面（开始排队时重绘一次），写「等第 2 步的 SUMO 算完，再算这几套方案」，不同时发第二个任务');
      c.LANG.cur = 'zh'; ok(c.cmpHTML().includes('等第 2 步的 SUMO 算完，再算这几套方案'), 'T50 中文：等第 2 步的 SUMO 算完，再算这几套方案'); c.LANG.cur = 'en';
      f.open(); await run; await settle(30, () => f.log.opts === 1);
      ok(f.log.opts === 1 && !c.X.CP.su.job.wait && c.X.CP.su.job.t1 > 0 && c.cmpHTML().includes('SUMO computing the options in the cloud'), 'T50 第 2 步算完 → 04 的任务开始（转圈改成「SUMO 正在云端计算这几套方案」）');
      const pj = await pf[0].p; await settle(30);
      ok(pf.length === 1 && pj === c.X.CP.su.job && f.log.opts === 1, 'T50 第 2 步算完触发的预取算出同一个键（种子 + p）→ 接上 04 的任务，不跑第二次');
      f.open(); await u;
      ok(nums04(c.cmpHTML()).join() === wantQ && f.log.real === 1 && f.log.opts === 1 && f.log.max === 1, 'T50 出数；runReal 1 次、runOptions 1 次，同时最多 1 个');
    }

    // 6c 预取失败不进缓存（04 的「重试」真的重跑）；第 2 步没算成（预跑兜底）不预取
    {
      const f = mkCli(), { c, pf } = page2(f.cli);
      let fails = 1; const ro = f.cli.runOptions; f.cli.runOptions = async (o, p) => (fails-- > 0 ? (f.log.opts++, { source: 'none', reason: 'sumo_busy', index: null }) : ro(o, p));
      const j = await c.cmpPrefetch(42); await j.p;
      ok(j.out && !j.out.r.index && !c.X.CSU.has(j.key), 'T50 预取没算成（source none）→ 不留在缓存里');
      open04(c); const u = c.cmpSuUpdate(); await settle(30, () => f.log.opts === 2);
      ok(f.log.opts === 2 && c.X.CP.su.job !== j, 'T50 之后进 04 → 重新算，不拿失败的那次');
      f.open(); await u;
      const g = mkCli(), p2 = page2(g.cli); g.cli.runReal = async () => { g.log.real++; return { source: 'baked', reason: 'sumo_busy', index: { hour: 8, seed: 42 } }; };
      await p2.c.sumoRerun(); await settle(10);
      ok(g.log.real === 1 && p2.pf.length === 0 && g.log.opts === 0, 'T50 第 2 步用的是预跑（云端没算成）→ 不预取');
    }
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
