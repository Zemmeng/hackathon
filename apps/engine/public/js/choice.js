// choice.js —— 第 ④ 步：选择模型（D-0929-1435）。大模型只给「读数」（看到没、看懂没、叫走哪条 / 别走哪条、说省或堵几分钟、信不信），
// 各条路走多少人由这里按每类人明写的参数算。纯函数、确定性。
//
// 每类人分两群：被标志「说动」的 I = 看到 × 看懂 × 相信（× 这类人对屏的信任倾向），和没被说动的 1 − I。
//   两群都按 logit 选路：效用 = −β × 赶不赶时间 × 分钟数（原路再加上看得到的排队）；绕行路线另有「习惯惰性」−A 和「熟不熟路」ln(熟悉度)
//   被说动的那群：标志叫走的路 +B（不受熟悉度限制），叫别走的 −B；说能省 N 分钟 → 那条路再 +β × 赶时间 × N；说原路堵 N 分钟 → 原路 −β × 赶时间 × N
//   只能走货车路的（送货司机）看不到禁货车的绕行路线
// A、B 两个全局参数由两点校准定（calibrate.js）；其余参数是工程假设［待核］，改这里就行。

export const TYPES = ['commuter', 'local', 'tourist', 'delivery'];
// 4 类路人占车流的比例（假设，docs/arch/2-agent-integration.pdf 第 2 页）
export const MIX = { commuter: 0.5, local: 0.25, tourist: 0.1, delivery: 0.15 };
// 每类人明写的参数（D-0929-1435 列的五项）：hurry 赶不赶时间 · familiar 熟不熟路（会不会自己想到绕行，0–1）·
// trust 信不信屏（乘在读数的 trust 上）· queue_averse 怕不怕堵 · truck_only 只能走货车路
export const PERSONAS = {
  commuter: { hurry: 1.0, familiar: 0.6, trust: 1.0, queue_averse: 1.0, truck_only: false },
  local: { hurry: 0.8, familiar: 1.0, trust: 0.6, queue_averse: 1.2, truck_only: false },
  tourist: { hurry: 0.5, familiar: 0.1, trust: 1.1, queue_averse: 0.5, truck_only: false },
  delivery: { hurry: 0.9, familiar: 0.7, trust: 0.8, queue_averse: 0.8, truck_only: true },
};
export const BETA = 0.4; // 每分钟的效用（工程假设）
export const QUEUE_MIN_PER_M = 0.004; // 看到前面排 1 公里 ≈ 觉得要多堵 4 分钟（工程假设）
export const DEFAULT_AB = { A: 4, B: 3 }; // 没有校准时的默认值（校准后会被覆盖）

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

function softmax(ids, u) {
  const m = Math.max(...ids.map(id => u[id]));
  const e = ids.map(id => Math.exp(u[id] - m));
  const s = e.reduce((a, b) => a + b, 0);
  const out = {};
  ids.forEach((id, i) => { out[id] = e[i] / s; });
  return out;
}

// 一类人被说动的比例
export function informed(p, reading) {
  if (!reading) return 0;
  return clamp01((reading.notice ?? 0) * (reading.understand ?? 0) * clamp01((reading.trust ?? 0) * p.trust));
}

// routes: [{ id, usual_min, truck }]（id 'stay' 是原路）；sign: { use: Set(id), avoid: Set(id), saving_min, delay_min }
// ctx: { A, B, I, queue_m } → { 路线 id: 比例 }
export function chooseShares(p, routes, sign, ctx) {
  const ok = routes.filter(r => r.id === 'stay' || !(p.truck_only && r.truck === false));
  const ids = ok.map(r => r.id);
  const hasStay = ids.includes('stay');
  const base = {}, told = {};
  for (const r of ok) {
    let t = r.usual_min;
    if (r.id === 'stay') t += (ctx.queue_m || 0) * QUEUE_MIN_PER_M * p.queue_averse;
    base[r.id] = -BETA * p.hurry * t;
    told[r.id] = base[r.id];
    if (r.id !== 'stay') {
      const fam = Math.log(Math.max(0.02, p.familiar));
      base[r.id] += -ctx.A + fam;
      told[r.id] += -ctx.A + (sign.use.has(r.id) ? ctx.B + BETA * p.hurry * (sign.saving_min || 0) : fam);
      if (sign.avoid.has(r.id)) told[r.id] -= ctx.B;
    } else {
      if (sign.avoid.has('stay')) told.stay -= ctx.B;
      if (sign.delay_min) told.stay -= BETA * p.hurry * sign.delay_min;
    }
  }
  if (!ids.length) return {};
  if (!hasStay && ids.length === 0) return {};
  const a = softmax(ids, told), b = softmax(ids, base);
  const I = ctx.I || 0;
  const out = {};
  for (const r of routes) out[r.id] = 0;
  for (const id of ids) out[id] = I * a[id] + (1 - I) * b[id];
  return out;
}
