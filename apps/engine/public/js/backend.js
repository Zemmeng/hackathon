// backend.js —— 后端接线层（lead 做，D-0929-1540）：网页（T2）只 import 这一个文件，不用自己拼引擎。
// 一次加载 T3 路网 + 车流 + 公交电车（transit.json）、T12 参数、T5 读屏（readSigns / checkSigns），建好引擎；页面调 run / compare / advise / check，
// 拿回能直接显示的数字（summary），引擎原始结果在 .raw。任何一样没加载上都不抛（路网除外）：
//   参数 → 假设值；T5 读屏 → 引擎自带的关键词规则；checkSigns → 不检查；公交电车 → 不算（summary.transit = { src: null }）。
//   status() 里写清楚每样用的是什么。
// T17：另外加载人行道路网 walk.json + 行人流量 peds.json，方案里封了人行道（closes.footpath）就算行人绕行 → summary.peds；
//   这两个文件（3.6 MB）在后台取，connect() 不等它们（车的数字不被行人数据拖慢）：status().peds = 'loading' → fetched / given / none；
//   run() 只有在这个小时真的封了人行道时才等它们（最多 PEDS_WAIT_MS），等不到 / 拿不到都不抛，summary.peds = { src: null, footpath }。
// 用法（浏览器，和 /engine/ /roads/ /api/ /params/ 同源）：
//   const be = await (await import('/engine/public/js/backend.js')).connect();
//   const s = await be.run(be.demo('lonsdale'));     // s.queue_m、s.mean_delay_s、s.routes、s.by_type、s.flags、s.transit（电车公交，T16）…
//   const c = await be.compare(be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), be.demo('lonsdale'));  // 前后对比
// 引擎核心（index.js 导出的那些）仍然不 import api 模块；只有这个接线层按 URL 动态加载 T5 的文件。

import {
  createEngine, mockReadSigns, mockAdvise, advise as adviseCore, loadParams, PARAMS_URL, TYPES,
  requestsFor, affected, capFactors, windowWhens, transitImpact, isTransit, validatePlan, pedImpact, pedsUnavailable, footpathActive,
  advisorSummary, sampleHours,
} from './index.js';
import { TIERS, VMS_AT_M, WARN_FRAME, daysOf, siteOf, tierNeeds, resolveNeeds, hireOf, stockOf, guidedFrames, vmsTextOk, timeErrors, whenErrors, usageOf, sharingWith, vmsRead } from './options.js';
import { isActive } from './worksite.js';

export const PEDS_WAIT_MS = 8000; // 封了人行道、行人数据还在路上时 run() 最多等几毫秒（再慢就先给车的数字，summary.peds.src = null、pending = true）

export const PATHS = {
  network: '/roads/public/cbd/network.json',
  flows: '/roads/public/cbd/flows.json',
  transit: '/roads/public/cbd/transit.json',
  walk: '/roads/public/cbd/walk.json', // T17 人行道路网
  peds: '/roads/public/cbd/peds.json', // T17 每条人行道每小时多少人
  equipment: '/roads/public/cbd/equipment.json', // T7 RPM Hire 设备库存 + 日租价（假设值）；be.options() 第一次调用时才取（T22）
  params: PARAMS_URL,
  reader: '/api/public/js/reader.js',
  check: '/api/public/js/check.js',
};

// 演示方案：真路网上实测过（docs/arch/T13-web-wiring-PRD.md 第 3 节）。at_m = 在施工起点上游多少米
const WEEK = { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] };
const DEMOS = {
  // 主演示：Lonsdale St 西行、离 La Trobe / Swanston 路口一个街区，早 8 点约 1100 veh/h，封 1 条就排队
  lonsdale: {
    when: { date: '2026-10-06', hour: 8 },
    worksites: [{
      id: 'B-12', name: 'Lonsdale St westbound lane closure', links: ['l595594354_9756035316'], closes: { lanes: 1 }, time: WEEK,
      equipment: [
        { id: 'VMS-1', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] },
        { id: 'S-1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' },
        { id: 'A-1', type: 'arrow', at_m: 60 },
        { id: 'B-1', type: 'barrier', at_m: 0 },
      ],
    }],
  },
  // 网页现在的场景：La Trobe St 西行、Swanston 路口西边，17 点。车少，封一条几乎不堵（这本身是结论）
  latrobe: {
    when: { date: '2026-10-06', hour: 17 },
    worksites: [{
      id: 'B-12', name: 'La Trobe St westbound lane closure at Swanston St', links: ['l2187770692_2190483583'], closes: { lanes: 1 }, time: WEEK,
      equipment: [
        { id: 'VMS-1', type: 'vms', at_m: 260, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] },
        { id: 'S-1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' },
        { id: 'A-1', type: 'arrow', at_m: 60 },
        { id: 'B-1', type: 'barrier', at_m: 0 },
      ],
    }],
  },
};
const clone = x => JSON.parse(JSON.stringify(x));

// demo('lonsdale', { frames, at_m, hour }) → 一份新的方案（改 VMS-1 的字 / 位置、换小时）
export function demoPlan(name, { frames, at_m, hour } = {}) {
  if (!DEMOS[name]) throw new Error(`没有演示方案 ${name}（有：${Object.keys(DEMOS).join(' / ')}）`);
  const plan = clone(DEMOS[name]);
  const vms = plan.worksites[0].equipment.find(e => e.id === 'VMS-1');
  if (frames) vms.frames = clone(frames);
  if (Number.isFinite(at_m)) vms.at_m = at_m;
  if (Number.isInteger(hour)) plan.when.hour = hour;
  return plan;
}
export const DEMO_NAMES = Object.keys(DEMOS);

async function getJSON(url, f) {
  if (typeof f !== 'function') throw new Error(`读 ${url} 需要 fetch`);
  const res = await f(url);
  if (!res || !res.ok) throw new Error(`读 ${url} 失败：HTTP ${res ? res.status : '无响应'}`);
  return res.json();
}

// 引擎结果 → 页面要的数字。受影响的车 = 各类人的车（by_type），背景车流被拖慢的另算（others_min）
// transit = transitImpact() 的结果（电车公交，T16）；没给 = 没加载公交数据 → { src: null }
export function summarize(res, { failed = 0, params = null, signCheck = null, transit = null } = {}) {
  const veh = TYPES.reduce((s, t) => s + (res.by_type[t]?.vehicles || 0), 0);
  const affectedMin = TYPES.reduce((s, t) => s + (res.by_type[t]?.delay_min || 0), 0);
  const approaches = res.approaches.map(a => ({
    worksite: a.worksite, entry: a.entry, street: a.street, dir: a.dir, to: a.to, volume: a.volume, blocked: a.blocked,
    queue_m: a.queue_m, delay_min: a.delay_min, detour_share: +(1 - (a.share?.stay ?? 0)).toFixed(3),
    routes: a.routes.map(r => ({ id: r.id, name: r.name, share: r.share, usual_min: r.usual_min, now_min: r.now_min, extra_min: r.extra_min, turn_m: r.turn_m, truck: r.truck })),
    by_type: Object.fromEntries(TYPES.map(t => [t, {
      detour: a.by_type[t]?.detour ?? 0, informed: a.by_type[t]?.informed ?? 0, extra_min: a.by_type[t]?.extra_min ?? 0,
      why: a.by_type[t]?.reading?.why ?? null, // 显示时用 textContent
    }])),
  }));
  // 主路段 = 延误最大的那段：排队、分流、「为什么」都取它，别从不同路段拼（多个施工时）
  const mainIdx = approaches.reduce((bi, a, i) => ((a.delay_min || 0) > (approaches[bi]?.delay_min || 0) ? i : bi), 0);
  const main = approaches[mainIdx] || null;
  const signErrors = (signCheck || []).filter(c => !c.ok);
  return {
    when: res.when,
    delay_min: res.delay_min, // 全网总延误（veh·min，含背景车流）
    affected_min: Math.round(affectedMin), // 受影响的车的总延误
    others_min: res.others_min, // 没受影响、被绕行车流拖慢的背景车流
    vehicles: Math.round(veh),
    mean_delay_s: veh ? Math.round((affectedMin / veh) * 60) : 0, // 受影响的车平均每辆多几秒
    main: main ? mainIdx : null, // approaches 里哪一段是主路段
    street: main ? main.street : null,
    queue_m: main ? main.queue_m : 0,
    detour_share: main ? main.detour_share : 0,
    routes: main ? main.routes : [],
    why: Object.fromEntries(TYPES.map(t => [t, main ? main.by_type[t].why : null])), // 每类人一句理由（主路段的；用 textContent 显示）
    blocked_vph: res.blocked_vph, // 全封又无路可绕、卡住的车（veh/h），不算进延误
    active: res.active, // 这个时段在施工的施工 id；空 = 此时不施工，数字全是 0
    by_type: Object.fromEntries(TYPES.map(t => [t, { per_capita_min: res.by_type[t]?.per_capita_min ?? 0, vehicles: res.by_type[t]?.vehicles ?? 0, delay_min: res.by_type[t]?.delay_min ?? 0 }])),
    approaches,
    hot: res.hot,
    transit: transit || { src: null }, // 电车公交受影响的线路、乘客·分钟（transit.js；每趟载客人数是假设值，见 transit.assumed）
    flags: {
      // ok = 数字可以当真（读数都拿到、校准命中、屏上文字合规范）；false 时界面标黄
      ok: !res.missing && !failed && res.calib.ok && !signErrors.length && !(res.blocked_vph > 0),
      missing: res.missing, failed,
      blocked_vph: res.blocked_vph,
      inactive: !res.active.length, // true = 方案里的施工这个时段都不在做
      reading_src: res.calib.src, // rule = 关键词规则估算；换成大模型后是 file / model 名
      calib_ok: res.calib.ok,
      params: params ? params.src : null, // params = 有出处（T12）；default = 假设值
      sign_errors: signErrors.map(c => ({ worksite: c.worksite, street: c.street, code: c.error?.code, msg: c.error?.msg })),
      sign_warnings: (signCheck || []).flatMap(c => (c.warnings || []).map(w => ({ worksite: c.worksite, street: c.street, ...w }))),
    },
    raw: res,
  };
}

// 方案不合格（比如 closes.footpath 写错）→ 抛这个错：.code = 'bad_plan'，.errors = 每条原因。页面可以先调 be.validate(方案) 挡住
function planError(errs) {
  const e = new Error('方案不合格：' + errs.join('；'));
  e.code = 'bad_plan';
  e.errors = errs;
  return e;
}

// T17 人行道路网 + 行人流量：给了就用，没给就按同源路径取；取不到、格式不对都不抛（→ status.peds = 'none'）
async function loadPeds(opts, base, f) {
  if (opts.walk && opts.peds) return { walk: opts.walk, peds: opts.peds, st: 'given' };
  try {
    const [walk, peds] = await Promise.all([opts.walk || getJSON(base + PATHS.walk, f), opts.peds || getJSON(base + PATHS.peds, f)]);
    if (!Array.isArray(walk?.nodes) || !Array.isArray(walk?.links)) throw new Error('walk.json 要有 nodes[] 和 links[]');
    if (!peds?.days || typeof peds.days !== 'object') throw new Error('peds.json 要有 days');
    return { walk, peds, st: 'fetched' };
  } catch (e) {
    return { walk: null, peds: null, st: 'none', err: `人行道 / 行人数据没加载上，行人影响不算（summary.peds.src = null）：${e?.message || e}` };
  }
}

// opts：base（前缀，默认同源）、fetch、importer（动态 import，测试里注入）；也可以直接给 network / flows / transit / params / readSigns / checkSigns / walk / peds
export async function connect(opts = {}) {
  const base = opts.base ?? '';
  const f = 'fetch' in opts ? opts.fetch : globalThis.fetch;
  const importer = opts.importer || (u => import(u));
  const status = { network: 'given', transit: null, params: null, reader: null, check: null, peds: 'loading', errors: [], reader_errors: {} };
  // 0 公交电车（T3 的 transit.json）：和路网一起开始下载；拿不到不抛，只是不算公交电车
  const transitP = opts.transit ? Promise.resolve(opts.transit) : getJSON(base + PATHS.transit, f);
  transitP.catch(() => {}); // 先接住，下面再 await（路网先失败抛出时不留未处理的 rejection）
  // 5 人行道 + 行人（T17）：后台取，connect 不等（不在车的数字的关键路径上）
  let pd = opts.walk && opts.peds ? { walk: opts.walk, peds: opts.peds, st: 'given' } : { st: 'loading' };
  status.peds = pd.st;
  const pedsP = (pd.st === 'given' ? Promise.resolve(pd) : loadPeds(opts, base, f)).then(r => {
    pd = r; status.peds = r.st;
    if (r.err) status.errors.push(r.err);
    return r.st;
  });
  const waitMs = Number.isFinite(opts.pedsWaitMs) ? opts.pedsWaitMs : PEDS_WAIT_MS;
  function waitPeds() {
    if (pd.st !== 'loading') return Promise.resolve();
    let tm;
    return Promise.race([pedsP, new Promise(r => { tm = setTimeout(r, waitMs); })]).finally(() => clearTimeout(tm));
  }

  // 1 路网 + 车流：没有就什么都算不了，这一步失败照样抛
  let { network, flows } = opts;
  if (!network || !flows) {
    [network, flows] = await Promise.all([getJSON(base + PATHS.network, f), getJSON(base + PATHS.flows, f)]);
    status.network = 'fetched';
  }
  // 2 参数（T12）
  const params = opts.params ?? await loadParams({ url: base + PATHS.params, fetch: f });
  // 3 读屏（T5）：拿不到就用引擎自带的规则读数
  let rs = opts.readSigns;
  if (rs) status.reader = 'given';
  else {
    try { rs = (await importer(base + PATHS.reader)).readSigns; if (typeof rs !== 'function') throw new Error('reader.js 没有导出 readSigns'); status.reader = 't5'; }
    catch (e) { rs = mockReadSigns; status.reader = 'engine-mock'; status.errors.push(`T5 读屏没加载上，用引擎自带规则：${e?.message || e}`); }
  }
  // 读屏抛错：请求不合规范（SignError，带 .code）→ 照抛，引擎把这类人按「没人被说动」算，summary.flags.failed 报条数；
  // 其他错（比如非 https 页面上没有 crypto.subtle，T5 算缓存键就抛）→ 这一条改用引擎自带的规则读数，不让数字悄悄变差
  const reader = async req => {
    try { return await rs(req); } catch (e) {
      const k = e?.code || 'fallback: ' + (e?.message || String(e));
      status.reader_errors[k] = (status.reader_errors[k] || 0) + 1;
      if (!e?.code && rs !== mockReadSigns) return mockReadSigns(req);
      throw e;
    }
  };
  const errCount = () => Object.entries(status.reader_errors).filter(([k]) => !k.startsWith('fallback')).reduce((n, [, c]) => n + c, 0);
  // 4 屏上文字规范检查（T5 checkSigns）
  let check = opts.checkSigns;
  if (check) status.check = 'given';
  else {
    try { check = (await importer(base + PATHS.check)).checkSigns; if (typeof check !== 'function') throw new Error('check.js 没有导出 checkSigns'); status.check = 't5'; }
    catch (e) { check = null; status.check = 'none'; status.errors.push(`T5 checkSigns 没加载上，屏上文字不检查：${e?.message || e}`); }
  }

  let transit = null;
  try {
    transit = await transitP;
    if (!isTransit(transit)) throw new Error('transit.json 没有 routes[]');
    status.transit = opts.transit ? 'given' : 'gtfs';
  } catch (e) { transit = null; status.transit = 'none'; status.errors.push(`公交电车数据没加载上，不算公交电车：${e?.message || e}`); }

  const engine = createEngine({ network, flows, readSigns: reader, params });
  status.params = engine.params.src;
  if (engine.params.errors.length) status.errors.push(...engine.params.errors.map(e => '参数：' + e));

  // 行人影响（T17）：这个小时没封人行道 → 不用数据，直接全 0（数据还在路上也不等）；封了 → 等数据（最多 waitMs）
  async function pedsOf(plan) {
    try {
      if (pd.st === 'loading') {
        if (!footpathActive(plan)) return pedImpact(null, null, plan);
        await waitPeds();
        if (pd.st === 'loading') return { ...pedsUnavailable(plan), pending: true, error: `人行道 / 行人数据 ${waitMs} 毫秒内没取到，这次先不算行人` };
      }
      if (!pd.walk) return pedsUnavailable(plan);
      return pedImpact(pd.walk, pd.peds, plan, { net: engine.net });
    } catch (e) { return { ...pedsUnavailable(plan), error: String(e?.message || e) }; } // 数据有毛病也不拖垮车的数字（也不留没人接的 rejected promise）
  }
  const validate = plan => validatePlan(plan);

  // 屏上文字合不合规范：按引擎实际会发的请求查（每段受影响的路 × 通勤者那一份「全部标志」）。
  // 文字合不合规范和时段无关：方案里所有施工都查，不只查这个时段在做的
  function checkPlan(plan) {
    const all = plan.worksites || [];
    const factors = capFactors(engine.net, all);
    const out = [];
    for (const ws of all) {
      for (const ap of affected(engine.net, engine.flows, ws, plan.when, factors)) {
        const req = requestsFor(ap, ws, ['commuter']).full.commuter;
        if (!req) continue;
        if (!check) { out.push({ worksite: ws.id, street: ap.street, ok: true, warnings: [], unchecked: true }); continue; }
        let r;
        try { r = check(req); } catch (e) { r = { ok: false, error: { code: 'check_threw', msg: String(e?.message || e) }, warnings: [] }; }
        out.push({ worksite: ws.id, street: ap.street, ...r });
      }
    }
    return out;
  }

  // 电车公交（T16）：算挂了不能拖垮整页，报在 transit.error 里
  function transitFor(plan, res) {
    if (!transit) return { src: null };
    try { return transitImpact(engine.net, engine.flows, transit, plan, res); } catch (e) { return { src: null, error: String(e?.message || e) }; }
  }

  async function run(plan) {
    const errs = validate(plan);
    if (errs.length) throw planError(errs);
    const pedsP1 = pedsOf(plan); // 和车的计算一起等
    const prep = await engine.prepare(plan);
    const res = engine.evaluate(plan);
    const s = summarize(res, { failed: prep.failed, params: engine.params, signCheck: checkPlan(plan), transit: transitFor(plan, res) });
    s.peds = await pedsP1; // 封人行道的行人绕行（T17）；没封 / 不在施工时段 = 全 0，数据没加载上 = { src: null }
    return s;
  }

  // 前后对比（第 4 步）：同一时段两份方案，负数 = 变好
  // 排队、绕行比例按「改之前的主路段」对齐比：改完以后主路段换成别的街，也还是比同一段路（main_changed 标出来）
  async function compare(before, after) {
    const [a, b] = [await run(before), await run(after)];
    const am = a.main == null ? null : a.approaches[a.main];
    const bm = am ? b.approaches.find(x => x.worksite === am.worksite && x.entry === am.entry) : null;
    // 同一段路：改之前的主路段在改之后的结果里（改之后这段路不在了 = 不堵了，按 0 算）
    const pick = (x, k) => (am ? (x === a ? am[k] : bm ? bm[k] : 0) : x[k]);
    const same = k => +(pick(b, k) - pick(a, k)).toFixed(3);
    const d = k => +(b[k] - a[k]).toFixed(3);
    return {
      before: a, after: b,
      delta: {
        delay_min: d('delay_min'), affected_min: d('affected_min'), mean_delay_s: d('mean_delay_s'),
        queue_m: same('queue_m'), detour_share: same('detour_share'),
        street: am ? am.street : null, main_changed: Boolean(am && b.main != null && b.approaches[b.main] !== bm),
        // 电车公交乘客·分钟（后 − 前，负数 = 变好）；没加载公交数据 = null。停掉的电车不算分钟，看 before / after 的 transit.blocked_pax_h
        transit_pax_min: a.transit.src && b.transit.src ? b.transit.pax_min - a.transit.pax_min : null,
        // 行人多花的人·分钟（T17）；行人数据没加载上 = null
        peds_extra_min: a.peds?.src && b.peds?.src ? +(b.peds.extra_min - a.peds.extra_min).toFixed(3) : null,
      },
    };
  }

  // 规划顾问（第 ⑦ 步）：大模型顾问还没定，先用规则顾问；每个改法都用引擎重算。数字是整个施工期（按天 × 采样小时）加总
  // 施工没写日期（time）时施工期是空的：就只比 plan.when 这一个小时，不然每个改法都算成 0、标成「不建议」
  async function advise(plan, { askAdvisor = mockAdvise } = {}) {
    const errs = validate(plan);
    if (errs.length) throw planError(errs);
    const e0 = errCount();
    const whens = windowWhens(plan.worksites || []).length ? undefined : [plan.when];
    const r = await adviseCore(engine, plan, { askAdvisor, whens });
    const missing = (r.before.result?.missing || 0) + r.options.reduce((n, o) => n + (o.result?.missing || 0), 0);
    const failed = errCount() - e0;
    return {
      src: r.src,
      window: { whens: r.whens, truncated: r.truncated, single_hour: Boolean(whens) },
      flags: { ok: !missing && !failed && engine.calib.ok, missing, failed, reading_src: engine.calib.src },
      before_min: r.before.delay_min,
      options: r.options.map(o => ({
        kind: o.suggestion.kind, worksite: o.suggestion.worksite, why: o.suggestion.why ?? null,
        frames: o.suggestion.frames ?? null, equipment: o.suggestion.equipment ?? null, at_m: o.suggestion.at_m ?? null, days: o.suggestion.days ?? null,
        skipped: o.skipped ?? null, after_min: o.delay_min ?? null, delta_min: o.delta_min ?? null, better: Boolean(o.better),
        plan: o.worksites ? { when: plan.when, worksites: o.worksites } : null,
      })),
    };
  }

  // 按库存出方案（T22，D-0929-2011 ③）：一处施工 → 最省 / 标准 / 引导 3 套交通管理方案，每套都用引擎跑同一个小时，带租金和库存检查。
  // 输入：一条施工方案（要给 when，或施工写了 time → 默认开工那天、时段里第一个采样小时），或整份方案 { when, worksites }（配 worksites[0]，
  // 或 opts.worksite 指定哪一条；别的施工原样留着一起算，时间重叠的施工带走的设备先从库存里扣）。不改输入。
  // options() 自己不调大模型（引导那一帧用规则顾问 mockAdvise 的写法）；每套的读数走 run() 同一条读屏链（T5 答案文件 → /api/read → 规则），
  // 读数一样时结果逐字一样。演示前要把 options() 生成的屏上文字预算进 T5 答案文件，否则正式环境会现场问 /api/read。
  let inventory = opts.equipment || null;
  let invSrc = inventory ? 'given' : null;
  async function inventoryOf() {
    if (!inventory) {
      try {
        const inv = await getJSON(base + PATHS.equipment, f);
        if (!Array.isArray(inv?.items)) throw new Error('equipment.json 没有 items[]');
        inventory = inv; invSrc = 'fetched';
      } catch (e) {
        const err = new Error(`设备库存没加载上，出不了方案：${e?.message || e}`);
        err.code = 'no_inventory';
        throw err;
      }
    }
    return inventory;
  }
  const brief = s => ({
    when: s.when, street: s.street, queue_m: s.queue_m, delay_min: s.delay_min, affected_min: s.affected_min, others_min: s.others_min,
    vehicles: s.vehicles, mean_delay_s: s.mean_delay_s, detour_share: s.detour_share, blocked_vph: s.blocked_vph,
    routes: s.routes.map(r => ({ id: r.id, name: r.name, share: r.share, extra_min: r.extra_min })),
    transit: s.transit?.src ? { src: s.transit.src, pax_min: s.transit.pax_min, blocked_pax_h: s.transit.blocked_pax_h } : null,
    peds: s.peds?.src ? { src: s.peds.src, extra_min: s.peds.extra_min } : null,
  });

  async function options(input, { n = 3, when, worksite } = {}) {
    const inv = await inventoryOf();
    const isPlan = Boolean(input && Array.isArray(input.worksites));
    const plan0 = clone(isPlan ? input : { when: null, worksites: [input] });
    const errs = validate(plan0);
    if (errs.length) throw planError(errs);
    const idx = worksite != null ? plan0.worksites.findIndex(w => w.id === worksite) : 0;
    if (idx < 0 || !plan0.worksites[idx]) throw planError([worksite != null ? `方案里没有施工 ${worksite}` : '方案里没有施工']);
    const ws = plan0.worksites[idx];
    const tErrs = timeErrors(ws.time, `施工 ${ws.id ?? '?'}`);
    if (tErrs.length) throw planError(tErrs);
    if (when) plan0.when = clone(when);
    if (!plan0.when && ws.time?.from) plan0.when = { date: ws.time.from, hour: sampleHours([ws])[0] };
    if (!plan0.when) throw planError(['施工没写 time，要给 when（{ date, hour }）']);
    const wErrs = whenErrors(plan0.when);
    if (wErrs.length) throw planError(wErrs);
    const site = siteOf(engine.net, ws);
    if (site.missing.length) throw planError([`施工 ${ws.id ?? '?'}：路段不在路网里：${site.missing.join(', ')}（长度按 0 算会少算护栏）`]);
    if (site.lanes == null) throw planError([`施工 ${ws.id ?? '?'}：links 是空的`]);
    const active = isActive(ws, plan0.when); // false = 这处施工在 when 那个小时不施工，三套的数字都是 0，不能当真
    const shared = sharingWith(plan0.worksites, ws); // 时间重叠的其他施工：库存共用
    const used0 = usageOf(shared);
    const days = daysOf(ws.time);
    const count = Math.max(1, Math.min(TIERS.length, Math.floor(Number(n)) || TIERS.length));
    const planWith = equipment => ({ when: clone(plan0.when), worksites: plan0.worksites.map((w, i) => (i === idx ? { ...clone(w), equipment } : clone(w))) });

    const out = [];
    let guide = null; // 由「最省」那套的引擎结果定：最快的绕行叫什么、省几分钟、VMS 摆在拐口前多远
    for (const tier of TIERS.slice(0, count)) {
      const frames = tier.guided && guide?.frames ? guide.frames : [WARN_FRAME];
      const needs = tierNeeds(tier, ws, site, { vmsAt: guide?.at_m ?? VMS_AT_M, frames });
      const { equipment, short } = resolveNeeds(needs, inv, used0);
      const plan = planWith(equipment);
      const s = await run(plan);
      if (tier.id === 'o1' && count > 1) {
        const adv = await mockAdvise(advisorSummary(s.raw, [plan.worksites[idx]]));
        const sug = (adv?.suggestions || []).find(x => x.kind === 'text' && x.worksite === ws.id);
        const fr = sug ? guidedFrames(sug.frames?.[0]) : null;
        guide = { frames: fr, at_m: Number.isFinite(sug?.at_m) ? sug.at_m : VMS_AT_M, why: sug?.why ?? null };
      }
      const vms = equipment.find(e => e.type === 'vms');
      const stock = { ...stockOf(equipment, inv, short, used0), shared_with: shared.map(w => w.id ?? null) };
      const read = vms ? vmsRead(equipment) : null; // VMS 有没有进读数请求（没被 6 块上限挤掉）
      const flags = {
        ok: s.flags.ok && active && stock.ok && (!vms || (vmsTextOk(vms.frames) && read)),
        stock_ok: stock.ok,
        vms_text_ok: vms ? vmsTextOk(vms.frames) : null,
        vms_read: read,
        guided: Boolean(tier.guided && guide?.frames && vms && read),
        no_faster_detour: Boolean(tier.guided && !guide?.frames), // 引擎算下来没有哪条绕行更快：引导档的屏上文字和标准档一样
        sign_errors: s.flags.sign_errors, reading_src: s.flags.reading_src, params: s.flags.params, failed: s.flags.failed, missing: s.flags.missing,
        inactive: !active, full_closure: site.full, footpath: site.footpath, no_time: !ws.time, missing_links: site.missing,
        assumed: ['hire.day_rate_aud', 'stock.qty'], // D-0929-1536：租金和库存是假设值，界面标「假设值」
      };
      const hire = hireOf(equipment, inv, days), result = brief(s), first = out[0];
      out.push({
        id: tier.id, label: tier.label, label_zh: tier.label_zh,
        plan, hire, stock, result, flags,
        // 和最省那套比（后 − 前，负数 = 少堵）；引擎算出来一样就是一样，不硬凑差别
        vs: first ? { id: first.id, delay_min: +(result.delay_min - first.result.delay_min).toFixed(3), affected_min: result.affected_min - first.result.affected_min,
          queue_m: result.queue_m - first.result.queue_m, hire_aud: hire.total_aud - first.hire.total_aud } : null,
        ...(tier.guided ? { guide: { frames: guide?.frames ?? null, at_m: guide?.at_m ?? null, why: guide?.why ?? null } } : {}),
      });
    }
    return {
      worksite: ws.id ?? null, when: clone(plan0.when), days,
      site: { len_m: site.len_m, lanes: site.lanes, close_lanes: site.close_lanes, full: site.full, footpath: site.footpath },
      inventory: { src: invSrc, version: inventory.version ?? null, assumed: true }, options: out,
    };
  }

  return {
    engine,
    options,
    status: () => JSON.parse(JSON.stringify({ ...status, calib: engine.calib, params_used: engine.params.used })),
    run, compare, advise, check: checkPlan, validate,
    pedsReady: () => pedsP, // 行人数据取完（不管成没成）→ status().peds：fetched / given / none
    demo: demoPlan, demos: DEMO_NAMES,
  };
}
