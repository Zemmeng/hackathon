// calibrate.js —— 两点校准（D-0929-1435：保留，改成校引擎参数）。
// 大模型（和规则）读懂屏上的字，但「多少人真绕」是引擎的选择模型算的；选择模型里有两个没法拍脑袋定的全局参数：
//   A = 绕行的习惯惰性（越大越不愿意离开原路）   B = 屏上点名一条路的推荐力度
// 在同一个参考场景（La Trobe St 西行）上用两块「标准屏」定刻度：
//   只写 ROADWORK / AHEAD      → 全体车辆约 3% 绕行 ［待核］   —— 只和 A 有关（屏没点名路），先解 A
//   写推荐路线 USE / RUSSELL ST → 约 20% ［待核，Erke 2007 二手转述］ —— A 定了再解 B
// 其他文案、排队、每类人的差别都由选择模型按参数算，不再单独换算。两块标准屏的读数要从同一个 readSigns 来。

import { TYPES, MIX, PERSONAS, DEFAULT_AB, chooseShares, informed } from './choice.js';

export const ANCHORS = {
  lo: { frames: [['ROADWORK', 'AHEAD']], real: 0.03 },
  hi: { frames: [['USE', 'RUSSELL ST']], real: 0.2 },
};

// 参考场景（docs/arch/5-llm-api-detail.pdf 第 3 页）：屏在 400 米、200 mm 字高 40 km/h 能读 9 秒；两条绕行都在施工起点拐
export const REF = {
  street: 'La Trobe Street',
  kmh: 40,
  routes: [
    { id: 'stay', name: 'La Trobe Street', usual_min: 6 },
    { id: 'r1', name: 'Russell Street', usual_min: 8, diverge_m: 0 },
    { id: 'r2', name: 'Elizabeth Street', usual_min: 9, truck: false, diverge_m: 0 },
  ],
};

export function anchorRequest(which, persona) {
  return {
    persona,
    kmh: REF.kmh,
    signs: [
      { kind: 'vms', frames: ANCHORS[which].frames, read_s: 9 },
      { kind: 'sign', text: 'RIGHT LANE CLOSED', read_s: 9 },
    ],
    roads: REF.routes.map(r => r.name),
  };
}

// 读数 → 选择模型要的「屏上说了什么」（参考场景里两条绕行都在屏之后拐，全都看得到）
export function signOf(reading, street, routes) {
  const use = new Set(), avoid = new Set();
  const adv = reading?.advice || {};
  for (const r of routes) {
    if (r.id === 'stay') { if (adv[street] === 'avoid') avoid.add('stay'); continue; }
    if (adv[r.name] === 'use') use.add(r.id);
    if (adv[r.name] === 'avoid') avoid.add(r.id);
  }
  return { use, avoid, saving_min: reading?.saving_min || 0, delay_min: reading?.delay_min || 0 };
}

export function refDetour(readings, A, B, { personas = PERSONAS, mix = MIX } = {}) {
  let d = 0;
  for (const t of TYPES) {
    const R = readings[t];
    const p = personas[t];
    const sh = chooseShares(p, REF.routes, signOf(R, REF.street, REF.routes), { A, B, I: informed(p, R), queue_m: 0 });
    d += (mix[t] || 0) * (1 - (sh.stay ?? 0));
  }
  return d;
}

function bisect(f, lo, hi, target, increasing, iters = 60) {
  let a = lo, b = hi;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    if ((f(m) < target) === increasing) a = m; else b = m;
  }
  return (a + b) / 2;
}

// lo / hi：每类人对两块标准屏的读数 { persona: reading }。缺任何一类就不校准（method: 'default'）
// opts.anchors = { lo, hi }：两块标准屏的目标绕行比例（T12 params.json 的 anchors；不给就用 ANCHORS 里的假设值）
export function calibrate(lo, hi, opts = {}) {
  const have = x => x && TYPES.every(t => x[t]);
  if (!have(lo) || !have(hi)) return { ...DEFAULT_AB, method: 'default', ok: false };
  const tLo = opts.anchors?.lo ?? ANCHORS.lo.real;
  const tHi = opts.anchors?.hi ?? ANCHORS.hi.real;
  const A = bisect(a => refDetour(lo, a, 0, opts), -10, 20, tLo, false);
  const dMax = refDetour(hi, A, 40, opts);
  const B = dMax < tHi ? 40 : bisect(b => refDetour(hi, A, b, opts), 0, 40, tHi, true);
  const loD = refDetour(lo, A, B, opts), hiD = refDetour(hi, A, B, opts);
  const srcs = new Set(TYPES.flatMap(t => [lo[t].src, hi[t].src]));
  const models = new Set(TYPES.flatMap(t => [lo[t].model, hi[t].model]));
  return {
    A: +A.toFixed(4),
    B: +B.toFixed(4),
    method: 'two_point',
    // false = 两个目标至少有一个够不着：比如读数里「点名路线」的力度不够，推荐力度顶到上限也到不了高点；或者目标本身离谱
    ok: Math.abs(loD - tLo) < 0.005 && Math.abs(hiD - tHi) < 0.005,
    target: { lo: tLo, hi: tHi },
    lo_detour: +loD.toFixed(4),
    hi_detour: +hiD.toFixed(4),
    src: srcs.size === 1 ? [...srcs][0] : 'mixed',
    model: models.size === 1 ? [...models][0] : 'mixed',
  };
}
