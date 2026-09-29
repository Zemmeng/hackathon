// backend.js —— 后端接线层（lead 做，D-0929-1540）：网页（T2）只 import 这一个文件，不用自己拼引擎。
// 一次加载 T3 路网 + 车流、T12 参数、T5 读屏（readSigns / checkSigns），建好引擎；页面调 run / compare / advise / check，
// 拿回能直接显示的数字（summary），引擎原始结果在 .raw。任何一样没加载上都不抛（路网除外）：
//   参数 → 假设值；T5 读屏 → 引擎自带的关键词规则；checkSigns → 不检查。status() 里写清楚每样用的是什么。
// T17：另外加载人行道路网 walk.json + 行人流量 peds.json，方案里封了人行道（closes.footpath）就算行人绕行 → summary.peds；
//   这两个文件拿不到不抛，summary.peds = { src: null, footpath }，status().peds = 'none'。
// 用法（浏览器，和 /engine/ /roads/ /api/ /params/ 同源）：
//   const be = await (await import('/engine/public/js/backend.js')).connect();
//   const s = await be.run(be.demo('lonsdale'));     // s.queue_m、s.mean_delay_s、s.routes、s.by_type、s.flags …
//   const c = await be.compare(be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), be.demo('lonsdale'));  // 前后对比
// 引擎核心（index.js 导出的那些）仍然不 import api 模块；只有这个接线层按 URL 动态加载 T5 的文件。

import {
  createEngine, mockReadSigns, mockAdvise, advise as adviseCore, loadParams, PARAMS_URL, TYPES,
  requestsFor, affected, capFactors, windowWhens, validatePlan, pedImpact, pedsUnavailable,
} from './index.js';

export const PATHS = {
  network: '/roads/public/cbd/network.json',
  flows: '/roads/public/cbd/flows.json',
  walk: '/roads/public/cbd/walk.json', // T17 人行道路网
  peds: '/roads/public/cbd/peds.json', // T17 每条人行道每小时多少人
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
export function summarize(res, { failed = 0, params = null, signCheck = null } = {}) {
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

// opts：base（前缀，默认同源）、fetch、importer（动态 import，测试里注入）；也可以直接给 network / flows / params / readSigns / checkSigns / walk / peds
export async function connect(opts = {}) {
  const base = opts.base ?? '';
  const f = 'fetch' in opts ? opts.fetch : globalThis.fetch;
  const importer = opts.importer || (u => import(u));
  const status = { network: 'given', params: null, reader: null, check: null, peds: null, errors: [], reader_errors: {} };
  const pedsP = loadPeds(opts, base, f); // 和路网一起取，不拖慢 connect

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

  const engine = createEngine({ network, flows, readSigns: reader, params });
  status.params = engine.params.src;
  if (engine.params.errors.length) status.errors.push(...engine.params.errors.map(e => '参数：' + e));

  // 5 人行道 + 行人（T17）
  const pd = await pedsP;
  status.peds = pd.st;
  if (pd.err) status.errors.push(pd.err);
  function pedsOf(plan) {
    if (!pd.walk) return pedsUnavailable(plan);
    try { return pedImpact(pd.walk, pd.peds, plan, { net: engine.net }); }
    catch (e) { return { ...pedsUnavailable(plan), error: String(e?.message || e) }; } // 数据有毛病也不拖垮车的数字
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

  async function run(plan) {
    const errs = validate(plan);
    if (errs.length) throw planError(errs);
    const prep = await engine.prepare(plan);
    const res = engine.evaluate(plan);
    const s = summarize(res, { failed: prep.failed, params: engine.params, signCheck: checkPlan(plan) });
    s.peds = pedsOf(plan); // 封人行道的行人绕行（T17）；没封 / 不在施工时段 = 全 0，数据没加载上 = { src: null }
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

  return {
    engine,
    status: () => JSON.parse(JSON.stringify({ ...status, calib: engine.calib, params_used: engine.params.used })),
    run, compare, advise, check: checkPlan, validate,
    demo: demoPlan, demos: DEMO_NAMES,
  };
}
