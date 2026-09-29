// backend.js —— 后端接线层（lead 做，D-0929-1540）：网页（T2）只 import 这一个文件，不用自己拼引擎。
// 一次加载 T3 路网 + 车流、T12 参数、T5 读屏（readSigns / checkSigns），建好引擎；页面调 run / compare / advise / check，
// 拿回能直接显示的数字（summary），引擎原始结果在 .raw。任何一样没加载上都不抛（路网除外）：
//   参数 → 假设值；T5 读屏 → 引擎自带的关键词规则；checkSigns → 不检查。status() 里写清楚每样用的是什么。
// 用法（浏览器，和 /engine/ /roads/ /api/ /params/ 同源）：
//   const be = await (await import('/engine/public/js/backend.js')).connect();
//   const s = await be.run(be.demo('lonsdale'));     // s.queue_m、s.mean_delay_s、s.routes、s.by_type、s.flags …
//   const c = await be.compare(be.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), be.demo('lonsdale'));  // 前后对比
// 引擎核心（index.js 导出的那些）仍然不 import api 模块；只有这个接线层按 URL 动态加载 T5 的文件。

import {
  createEngine, mockReadSigns, mockAdvise, advise as adviseCore, loadParams, PARAMS_URL, TYPES,
  requestsFor, affected, capFactors, isActive,
} from './index.js';

export const PATHS = {
  network: '/roads/public/cbd/network.json',
  flows: '/roads/public/cbd/flows.json',
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
    worksite: a.worksite, street: a.street, dir: a.dir, to: a.to, volume: a.volume, blocked: a.blocked,
    queue_m: a.queue_m, delay_min: a.delay_min, detour_share: +(1 - (a.share?.stay ?? 0)).toFixed(3),
    routes: a.routes.map(r => ({ id: r.id, name: r.name, share: r.share, usual_min: r.usual_min, now_min: r.now_min, extra_min: r.extra_min, turn_m: r.turn_m, truck: r.truck })),
    by_type: Object.fromEntries(TYPES.map(t => [t, {
      detour: a.by_type[t]?.detour ?? 0, informed: a.by_type[t]?.informed ?? 0, extra_min: a.by_type[t]?.extra_min ?? 0,
      why: a.by_type[t]?.reading?.why ?? null, // 显示时用 textContent
    }])),
  }));
  const main = approaches.slice().sort((a, b) => (b.delay_min || 0) - (a.delay_min || 0))[0] || null;
  const signErrors = (signCheck || []).filter(c => !c.ok);
  return {
    when: res.when,
    delay_min: res.delay_min, // 全网总延误（veh·min，含背景车流）
    affected_min: Math.round(affectedMin), // 受影响的车的总延误
    others_min: res.others_min, // 没受影响、被绕行车流拖慢的背景车流
    vehicles: Math.round(veh),
    mean_delay_s: veh ? Math.round((affectedMin / veh) * 60) : 0, // 受影响的车平均每辆多几秒
    queue_m: main ? main.queue_m : 0,
    detour_share: main ? main.detour_share : 0,
    routes: main ? main.routes : [],
    blocked_vph: res.blocked_vph,
    by_type: Object.fromEntries(TYPES.map(t => [t, { per_capita_min: res.by_type[t]?.per_capita_min ?? 0, vehicles: res.by_type[t]?.vehicles ?? 0, delay_min: res.by_type[t]?.delay_min ?? 0 }])),
    approaches,
    hot: res.hot,
    flags: {
      // ok = 数字可以当真（读数都拿到、校准命中、屏上文字合规范）；false 时界面标黄
      ok: !res.missing && !failed && res.calib.ok && !signErrors.length,
      missing: res.missing, failed,
      reading_src: res.calib.src, // rule = 关键词规则估算；换成大模型后是 file / model 名
      calib_ok: res.calib.ok,
      params: params ? params.src : null, // params = 有出处（T12）；default = 假设值
      sign_errors: signErrors.map(c => ({ worksite: c.worksite, street: c.street, code: c.error?.code, msg: c.error?.msg })),
      sign_warnings: (signCheck || []).flatMap(c => (c.warnings || []).map(w => ({ worksite: c.worksite, street: c.street, ...w }))),
    },
    raw: res,
  };
}

// opts：base（前缀，默认同源）、fetch、importer（动态 import，测试里注入）；也可以直接给 network / flows / params / readSigns / checkSigns
export async function connect(opts = {}) {
  const base = opts.base ?? '';
  const f = 'fetch' in opts ? opts.fetch : globalThis.fetch;
  const importer = opts.importer || (u => import(u));
  const status = { network: 'given', params: null, reader: null, check: null, errors: [], reader_errors: {} };

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
  // 读屏抛错时记下原因（引擎会把这类人按「没人被说动」算，summary.flags.failed 报条数）
  const reader = async req => {
    try { return await rs(req); } catch (e) {
      const k = e?.code || e?.message || String(e);
      status.reader_errors[k] = (status.reader_errors[k] || 0) + 1;
      throw e;
    }
  };
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

  // 屏上文字合不合规范：按引擎实际会发的请求查（每段受影响的路 × 通勤者那一份「全部标志」）
  function checkPlan(plan) {
    const active = (plan.worksites || []).filter(ws => isActive(ws, plan.when));
    const factors = capFactors(engine.net, active);
    const out = [];
    for (const ws of active) {
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
    const prep = await engine.prepare(plan);
    const res = engine.evaluate(plan);
    return summarize(res, { failed: prep.failed, params: engine.params, signCheck: checkPlan(plan) });
  }

  // 前后对比（第 4 步）：同一时段两份方案，负数 = 变好
  async function compare(before, after) {
    const [a, b] = [await run(before), await run(after)];
    const d = k => +(b[k] - a[k]).toFixed(3);
    return { before: a, after: b, delta: { delay_min: d('delay_min'), affected_min: d('affected_min'), mean_delay_s: d('mean_delay_s'), queue_m: d('queue_m'), detour_share: d('detour_share') } };
  }

  // 规划顾问（第 ⑦ 步）：大模型顾问还没定，先用规则顾问；每个改法都用引擎重算。数字是整个施工期（按天 × 采样小时）加总
  async function advise(plan, { askAdvisor = mockAdvise } = {}) {
    const r = await adviseCore(engine, plan, { askAdvisor });
    return {
      src: r.src,
      window: { whens: r.whens, truncated: r.truncated },
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
    run, compare, advise, check: checkPlan,
    demo: demoPlan, demos: DEMO_NAMES,
  };
}
