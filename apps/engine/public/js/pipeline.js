// pipeline.js —— 引擎对外的唯一入口（D-0929-1435）：createEngine({ network, flows, readSigns }) →
//   await engine.prepare(方案)                先把要问的「读数」都问好（T5 的 readSigns，异步；同一句话每类人只问一次，一直缓存）
//   engine.evaluate(方案, { seed })           同步、纯计算：同样的输入（方案 + 已缓存的读数）同样的结果，可以反复跑
//   engine.window(worksites, whens)           一段时间的总延误；engine.conflict(a, b)：第 ⑥ 步冲突成本
// 方案 = { when: { date, hour, day? }, worksites: [施工方案] }，格式见 docs/contract.md §施工方案、§evaluate。
// 第 ①② 步 routes.js / reading.js，第 ④ 步 choice.js + calibrate.js，第 ⑤ 步 assign.js。
// 排队变长 → 引擎自己按「看得到的排队」重算选择（逐次平均 MSA），不再问大模型（读数只取决于字 + 人）。

import { loadNetwork, isNet } from './net.js';
import { isActive, capFactors, overlaps, windowWhens, dayType } from './worksite.js';
import { affected } from './routes.js';
import { round1, cleanName } from './cards.js';
import { canon } from './canon.js';
import { TYPES, MIX, PERSONAS, DEFAULT_AB, chooseShares, informed } from './choice.js';
import { calibrate, anchorRequest } from './calibrate.js';
import { requestsFor, requestKey } from './reading.js';
import { evaluate as assign, pathNow, maxQueue } from './assign.js';

export const MSA_ITERS = 6; // 排队反馈迭代次数（逐次平均）
export const OCCUPANCY = 1; // 每辆车算 1 个人（公交电车乘客还没建模）

const r3 = x => Math.round(x * 1000) / 1000;

export function createEngine({ network, flows, readSigns, personas = PERSONAS, mix = MIX } = {}) {
  const net = isNet(network) ? network : loadNetwork(network);
  const readings = new Map(); // requestKey → 读数
  const structCache = new Map();
  const baseCache = new Map();
  let calib = { ...DEFAULT_AB, method: 'default', ok: false };

  const get = req => (req ? readings.get(requestKey(req)) : undefined);

  function structure(ws, factors) {
    const closed = [...factors].filter(([, x]) => x.f === 0).map(([id]) => id).sort();
    const k = canon([ws.id, ws.links, ws.closes, closed]);
    if (!structCache.has(k)) structCache.set(k, affected(net, null, ws, { date: '2000-01-03', hour: 0 }, factors));
    return structCache.get(k);
  }

  function base(when) {
    const k = dayType(when) + ':' + when.hour;
    if (!baseCache.has(k)) baseCache.set(k, assign(net, flows, when, [], []));
    return baseCache.get(k);
  }

  function approachesAt(plan) {
    const active = (plan.worksites || []).filter(ws => isActive(ws, plan.when));
    const factors = capFactors(net, active);
    const dt = dayType(plan.when);
    const aps = active.flatMap(ws => structure(ws, factors).map(ap => ({
      ws,
      ap: { ...ap, volume: flows?.days?.[dt]?.[ap.entry]?.[plan.when.hour] ?? 0 },
    })));
    return { active, aps };
  }

  // 某段 approach、某类人：屏上说了什么（点名只对「拐口之前能看到」的屏算数）+ 被说动的比例
  function signFor(t, ap, reqs) {
    const full = get(reqs.full[t]);
    const street = cleanName(ap.street);
    const use = new Set(), avoid = new Set();
    for (const r of ap.alts) {
      const pre = get(reqs.prefix[t][r.id]);
      const a = pre?.advice?.[cleanName(r.name)];
      if (a === 'use') use.add(r.id);
      if (a === 'avoid') avoid.add(r.id);
    }
    if (full?.advice?.[street] === 'avoid') avoid.add('stay');
    return {
      sign: { use, avoid, saving_min: use.size ? full?.saving_min || 0 : 0, delay_min: full?.delay_min || 0 },
      I: informed(personas[t], full),
      reading: full || null,
    };
  }

  function missingFor(plan, out) {
    const { aps } = approachesAt(plan);
    for (const { ap, ws } of aps) {
      const reqs = requestsFor(ap, ws, TYPES);
      for (const t of TYPES) {
        for (const req of [reqs.full[t], ...Object.values(reqs.prefix[t])]) {
          if (req && !readings.has(requestKey(req))) out.set(requestKey(req), req);
        }
      }
    }
    return out;
  }

  async function prepare(plan, { whens } = {}) {
    const need = new Map();
    for (const which of ['lo', 'hi']) for (const t of TYPES) {
      const req = anchorRequest(which, t);
      if (!readings.has(requestKey(req))) need.set(requestKey(req), req);
    }
    for (const when of [plan.when, ...(whens || [])].filter(Boolean)) missingFor({ ...plan, when }, need);
    if (need.size && typeof readSigns !== 'function') throw new Error('prepare 需要 readSigns（浏览器里传 T5 的 readSigns；没有就传 mockReadSigns）');
    const got = await Promise.all([...need].map(async ([k, req]) => {
      try { return [k, await readSigns(req)]; } catch { return [k, null]; }
    }));
    for (const [k, r] of got) if (r) readings.set(k, r);
    const pick = which => Object.fromEntries(TYPES.map(t => [t, readings.get(requestKey(anchorRequest(which, t)))]));
    calib = calibrate(pick('lo'), pick('hi'), { personas, mix });
    return { asked: need.size, failed: got.filter(([, r]) => !r).length, calib: { ...calib } };
  }

  function overall(byT) {
    const o = {};
    for (const t of TYPES) for (const [id, v] of Object.entries(byT[t])) o[id] = (o[id] || 0) + (mix[t] || 0) * v;
    return o;
  }

  // seed：现在没有随机数，先留着（契约要求同样输入同样结果）
  function evaluate(plan, { seed = 0 } = {}) { // eslint-disable-line no-unused-vars
    const when = plan.when;
    const b = base(when);
    const { active, aps } = approachesAt(plan);
    const missing = missingFor(plan, new Map()).size;
    if (!active.length) {
      return { when, delay_min: 0, tt_base_min: round1(b.tt_s / 60), blocked_vph: 0, by_type: {}, others_min: 0, approaches: [], hot: [], links: [],
        active: [], calib: { ...calib }, missing };
    }

    const ctx = aps.map(({ ap, ws }) => {
      const reqs = requestsFor(ap, ws, TYPES);
      const routes = [ap.stay, ...ap.alts].filter(Boolean);
      const per = Object.fromEntries(TYPES.map(t => [t, signFor(t, ap, reqs)]));
      return { ap, ws, reqs, routes, per };
    });

    // 排队反馈：看得到的排队 → 选择 → 分流 → 新的排队 …… 各轮比例取平均（MSA）
    let q = ctx.map(() => 0);
    let avg = ctx.map(() => null);
    let ev = b;
    for (let k = 1; k <= MSA_ITERS; k++) {
      avg = ctx.map((c, i) => {
        if (!c.ap.alts.length) return null;
        const byT = {};
        for (const t of TYPES) {
          const { sign, I } = c.per[t];
          const s = chooseShares(personas[t], c.routes, sign, { A: calib.A, B: calib.B, I, queue_m: q[i] });
          const a = avg[i]?.[t];
          byT[t] = a ? Object.fromEntries(Object.keys(s).map(id => [id, a[id] + (s[id] - a[id]) / k])) : s;
        }
        return byT;
      });
      const splits = ctx.map((c, i) => ({ ap: c.ap, share: avg[i] ? overall(avg[i]) : { stay: 1 } }));
      ev = assign(net, flows, when, active, splits);
      q = ctx.map(c => maxQueue(ev, c.ap.chain) / 2); // 司机平均看到的排队 ≈ 一小时末排队的一半
    }

    const typeTot = Object.fromEntries(TYPES.map(t => [t, { delay_min: 0, vehicles: 0 }]));
    const approaches = ctx.map((c, i) => {
      const F = ev.used?.[i] ?? c.ap.volume;
      const stayBase = c.ap.stayLinks.reduce((s, id) => s + b.links.get(id).t, 0);
      const byT = avg[i] || Object.fromEntries(TYPES.map(t => [t, { stay: 1 }]));
      const share = overall(byT);
      const routes = c.routes.map(r => {
        const now = pathNow(ev, r.links);
        return { id: r.id, name: r.name, usual_min: round1(r.usual_min), now_min: round1(now / 60), share: r3(share[r.id] || 0),
          flow: Math.round((share[r.id] || 0) * F), truck: r.truck, turn_m: r.id === 'stay' ? null : Math.round(r.diverge_m), extra_min: (now - stayBase) / 60 };
      });
      const extraOf = sh => routes.reduce((s, r) => s + (sh[r.id] || 0) * r.extra_min, 0);
      const by_type = {};
      for (const t of TYPES) {
        const sh = byT[t];
        const ex = extraOf(sh);
        const veh = F * (mix[t] || 0);
        typeTot[t].delay_min += veh * ex * OCCUPANCY;
        typeTot[t].vehicles += veh;
        const R = c.per[t].reading;
        by_type[t] = {
          share: Object.fromEntries(Object.entries(sh).map(([k, v]) => [k, r3(v)])),
          detour: r3(1 - (sh.stay ?? 0)),
          extra_min: round1(ex),
          informed: r3(c.per[t].I),
          told: [...c.per[t].sign.use].map(id => c.routes.find(r => r.id === id)?.name),
          reading: R ? { notice: R.notice, understand: R.understand, trust: R.trust, advice: R.advice, saving_min: R.saving_min, delay_min: R.delay_min, why: R.why, src: R.src } : null,
        };
      }
      return {
        worksite: c.ws.id, entry: c.ap.entry, street: c.ap.street, dir: c.ap.dir, to: c.ap.to, volume: Math.round(F), blocked: c.ap.blocked,
        queue_m: Math.round(maxQueue(ev, c.ap.chain)), delay_min: Math.round(F * extraOf(share)),
        share: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, r3(v)])),
        routes: routes.map(r => ({ ...r, extra_min: round1(r.extra_min) })),
        by_type,
        signs: c.reqs.signs.map(s => ({ m: s.m, kind: s.kind, read_s: s.read_s, ...(s.frames ? { frames: s.frames } : { text: s.text }) })),
      };
    });

    const links = [];
    const hot = [];
    for (const [id, x] of ev.links) {
      const l = net.links.get(id), bx = b.links.get(id);
      links.push({ id, v: Math.round(x.v), cap: Math.round(x.cap), delay_s: round1(x.t - l.t0_s), queue_m: Math.round(x.queue_m) });
      const extra = (x.v * x.t - bx.v * bx.t) / 60;
      if (extra > 0.5) hot.push({ id, name: l.name, extra_min: Math.round(extra), v: Math.round(x.v), cap: Math.round(x.cap), queue_m: Math.round(x.queue_m) });
    }
    hot.sort((a, z) => z.extra_min - a.extra_min);
    const delay = Math.round((ev.tt_s - b.tt_s) / 60);
    const by_type = {};
    let typed = 0;
    for (const t of TYPES) {
      const x = typeTot[t];
      typed += x.delay_min;
      by_type[t] = { delay_min: Math.round(x.delay_min), vehicles: Math.round(x.vehicles), per_capita_min: x.vehicles ? round1(x.delay_min / x.vehicles) : 0 };
    }
    return {
      when, delay_min: delay, tt_base_min: round1(b.tt_s / 60), blocked_vph: Math.round(ev.blocked_vph),
      by_type, others_min: Math.round(delay - typed), // 没受影响、但被绕行车流拖慢的背景车流
      approaches, hot: hot.slice(0, 5), links, active: active.map(w => w.id), calib: { ...calib }, missing,
    };
  }

  function window(worksites, whens) {
    let total = 0;
    const per = [];
    for (const when of whens) { const r = evaluate({ when, worksites }); total += r.delay_min; per.push({ when, delay_min: r.delay_min }); }
    return { delay_min: total, per };
  }

  // 第 ⑥ 步：冲突成本 = D(A+B) − D(A) − D(B)。时段不重叠时每个时刻只有一个在施工，正好是 0
  function conflict(a, b, { whens, hours } = {}) {
    const W = whens || windowWhens([a, b], hours);
    const A = window([a], W), B = window([b], W), AB = window([a, b], W);
    return { a: A.delay_min, b: B.delay_min, ab: AB.delay_min, cost: AB.delay_min - A.delay_min - B.delay_min, overlap: overlaps(a, b), whens: W.length, truncated: Boolean(W.truncated) };
  }

  return { net, flows, prepare, evaluate, window, conflict, readings, get calib() { return { ...calib }; } };
}
