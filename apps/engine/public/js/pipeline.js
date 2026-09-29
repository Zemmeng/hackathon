// pipeline.js —— 把第 ①–⑥ 步串起来（docs/arch/4-ai-flow.md）。引擎只认一个注入进来的 ask(场景卡)，不直接 import api 模块：
//   浏览器里：runScenario({ ..., ask: askPersonas })（askPersonas 来自 api 模块的 public/js/persona.js）
//   node 测试：传假的 ask，或 api 的 askPersonas(card, { force: 'rule' })
// 回头再算：⑤ 排队变长 → 把「司机看到前面排多长」放进场景卡回到 ③ 再问（最多 2 轮）；
//   第 2 轮和第 1 轮的分流取平均（逐次平均法 MSA）：第 1 轮的排队是「没人因为排队改道」时的排队，直接用第 2 轮会矫枉过正、来回摆。
// 输出给前端：哪里堵、堵多久、每类人受多大影响、每类人一句理由（格式见 docs/contract.md「引擎结果」）。

import { loadNetwork, isNet, pathTime } from './net.js';
import { isActive, capFactors, overlaps, windowWhens } from './worksite.js';
import { affected } from './routes.js';
import { buildCard, round1, bucket } from './cards.js';
import { canon } from './canon.js';
import { calibrate, anchorsFor } from './calibrate.js';
import { evaluate, pathNow, maxQueue } from './assign.js';

export const MAX_ROUNDS = 2;

const r1 = round1;
const avg3 = xs => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
const net0 = network => (isNet(network) ? network : loadNetwork(network));

function avgShare(list, keys) {
  const xs = list.filter(Boolean);
  const out = {};
  for (const k of keys) out[k] = xs.length ? xs.reduce((s, x) => s + (x[k] || 0), 0) / xs.length : 0;
  return out;
}

// ask 的回答至少要有 4 类人、每类的比例覆盖卡上所有路线
function validAnswer(ans, card) {
  if (!ans || typeof ans !== 'object' || !ans.mix || !ans.by_type) return false;
  return Object.keys(ans.mix).every(t => card.routes.every(r => Number.isFinite(ans.by_type[t]?.share?.[r.id])));
}

// 同一次对比里，同一张场景卡只问一次（换时刻时卡片经常一样：一段时间跑几十个时刻不会打出几万个请求）
export function memoAsk(ask) {
  if (ask && ask.memo) return ask;
  const cache = new Map();
  const f = (card, opts) => {
    const k = canon(card) + '|' + canon(opts || {});
    if (!cache.has(k)) {
      const p = Promise.resolve().then(() => ask(card, opts));
      p.catch(() => cache.delete(k));
      cache.set(k, p);
    }
    return cache.get(k);
  };
  f.memo = true;
  return f;
}

export async function runScenario({ network, flows, when, worksites = [], ask, maxRounds = MAX_ROUNDS }) {
  const net = net0(network);
  const active = worksites.filter(ws => isActive(ws, when));
  const base = evaluate(net, flows, when, [], []);
  const empty = { when, delay_min: 0, tt_base_min: r1(base.tt_s / 60), approaches: [], hot: [], rounds: 0, active: [] };
  if (!active.length) return empty;
  if (typeof ask !== 'function') throw new Error('runScenario 需要 ask(场景卡) 函数（浏览器里传 api 模块的 askPersonas）');

  const factors = capFactors(net, active);
  const aps = active.flatMap(ws => affected(net, flows, ws, when, factors).map(ap => ({ ap, ws })));
  const keysOf = ap => [ap.stay, ...ap.alts].filter(Boolean).map(r => r.id);
  const history = aps.map(() => []); // 每段 approach 每轮的 { card, ans, cal }
  let seenQ = aps.map(() => 0);
  let ev = base, rounds = 0;
  for (let k = 1; k <= maxRounds; k++) {
    rounds = k;
    const asked = await Promise.all(aps.map(async ({ ap, ws }, i) => {
      if (!ap.alts.length) return null; // 没有能绕的路：全部走原路
      const card = buildCard(ap, ws, { queue_m: seenQ[i] });
      let ans;
      try { ans = await ask(card); } catch { ans = null; }
      if (!validAnswer(ans, card)) ans = await ask(card, { force: 'rule' }); // ask 抛错或回了不认识的东西：退回规则，不让整个结果崩
      let anc;
      try { anc = await anchorsFor(ask, ans); } catch { anc = await anchorsFor(ask, { ...ans, src: 'rule' }); } // 锚点也问不到：用规则锚点（模型对不上会退回比例法）
      const cal = calibrate(ans, anc, card);
      return { card, ans, cal };
    }));
    asked.forEach((x, i) => { if (x) history[i].push(x); });
    const splits = aps.map(({ ap }, i) => ({
      ap,
      share: history[i].length ? avgShare(history[i].map(h => h.cal.share), keysOf(ap)) : { stay: 1 },
    }));
    ev = evaluate(net, flows, when, active, splits);
    const q = aps.map(({ ap }) => bucket(maxQueue(ev, ap.chain) / 2, 100)); // 司机平均看到的排队 ≈ 一小时末排队的一半
    if (q.every((x, i) => x === seenQ[i])) break;
    seenQ = q;
  }

  const approaches = aps.map(({ ap, ws }, i) => {
    const h = history[i];
    const last = h[h.length - 1];
    const keys = keysOf(ap);
    const share = h.length ? avgShare(h.map(x => x.cal.share), keys) : { stay: 1 };
    const F = ev.used?.[i] ?? ap.volume; // 实际分流的车（同一条街上前一个施工已经分走的不重复算）
    const stayBase = pathTime(net, ap.stayLinks, l => base.links.get(l.id).t);
    const routes = [ap.stay, ...ap.alts].filter(Boolean).map(r => {
      const now = pathNow(ev, r.links);
      return { id: r.id, name: r.name, usual_min: r1(r.usual_min), now_min: r1(now / 60), share: Math.round(share[r.id] * 1000) / 1000,
        flow: Math.round(share[r.id] * F), truck: r.truck, diverge_m: r.diverge_m, extra_min: (now - stayBase) / 60 };
    });
    const extraOf = sh => routes.reduce((s, r) => s + (sh[r.id] || 0) * r.extra_min, 0);
    const by_type = {};
    if (last) {
      for (const t of Object.keys(last.ans.mix)) {
        const sh = avgShare(h.map(x => x.cal.by_type[t].share), keys);
        const a = last.ans.by_type[t];
        by_type[t] = { share: sh, detour: r1((1 - (sh.stay ?? 0)) * 1000) / 1000, extra_min: r1(extraOf(sh)),
          notice: a.notice, understand: a.understand, why: a.why, lo: a.lo, hi: a.hi, src: a.src };
      }
    }
    return {
      worksite: ws.id, entry: ap.entry, street: ap.street, dir: ap.dir, to: ap.to, volume: Math.round(F), blocked: ap.blocked,
      queue_m: Math.round(maxQueue(ev, ap.chain)),
      delay_min: Math.round(F * extraOf(share)),
      share, routes: routes.map(({ extra_min, ...r }) => ({ ...r, extra_min: r1(extra_min) })), by_type,
      card: last?.card ?? null,
      src: last?.ans.src ?? null, model: last?.ans.model ?? null,
      // 校准：各轮平均（和 share 一致）；每一轮的明细在 per_round
      calib: last ? { method: last.cal.method, raw_detour: avg3(h.map(x => x.cal.raw_detour)), detour: avg3(h.map(x => x.cal.detour)),
        per_round: h.map(x => ({ queue_m: x.card.queue_m, raw_detour: avg3([x.cal.raw_detour]), detour: avg3([x.cal.detour]), src: x.ans.src })) } : null,
      rounds: h.length,
    };
  });

  const hot = [...ev.links].map(([id, x]) => {
    const b = base.links.get(id), l = net.links.get(id);
    return { id, name: l.name, from: l.from, to: l.to, extra_min: (x.v * x.t - b.v * b.t) / 60, v: Math.round(x.v), cap: Math.round(x.cap), queue_m: Math.round(x.queue_m) };
  }).filter(x => x.extra_min > 0.5).sort((a, b) => b.extra_min - a.extra_min).slice(0, 5).map(x => ({ ...x, extra_min: Math.round(x.extra_min) }));

  return {
    when,
    delay_min: Math.round((ev.tt_s - base.tt_s) / 60),
    tt_base_min: r1(base.tt_s / 60),
    blocked_vph: Math.round(ev.blocked_vph),
    approaches,
    hot,
    rounds,
    active: active.map(w => w.id),
  };
}

// 一段时间里（whens 列表）的总延误
export async function windowDelay({ network, flows, worksites, whens, ask }) {
  const net = net0(network);
  ask = memoAsk(ask);
  let total = 0;
  const per = [];
  for (const when of whens) {
    const r = await runScenario({ network: net, flows, when, worksites, ask });
    total += r.delay_min;
    per.push({ when, delay_min: r.delay_min });
  }
  return { delay_min: total, per };
}

// 第 ⑥ 步：冲突成本 = D(A+B) − D(A) − D(B)，D = 总延误（veh·min）。时段不重叠时每个时刻只有一个在施工，冲突成本正好是 0
export async function conflictCost({ network, flows, a, b, ask, whens, hours }) {
  const net = net0(network);
  ask = memoAsk(ask);
  const W = whens || windowWhens([a, b], hours);
  const [dA, dB, dAB] = [await windowDelay({ network: net, flows, worksites: [a], whens: W, ask }),
    await windowDelay({ network: net, flows, worksites: [b], whens: W, ask }),
    await windowDelay({ network: net, flows, worksites: [a, b], whens: W, ask })];
  return { a: dA.delay_min, b: dB.delay_min, ab: dAB.delay_min, cost: dAB.delay_min - dA.delay_min - dB.delay_min, overlap: overlaps(a, b), whens: W.length, truncated: Boolean(W.truncated) };
}
