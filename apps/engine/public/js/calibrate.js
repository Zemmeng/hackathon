// calibrate.js —— 第 ④ 步：两点校准。大模型（和规则）给的比例是「表态」，会高估：伦敦实测真绕的只有问卷说的 1/5（Chatterjee 2002）。
// 做法（D-0929-1333、docs/arch/5-llm-api-detail.pdf 第 2 页）：在同一个参考场景（La Trobe St 西行）上问两块「标准屏」，
//   只写 ROADWORK / AHEAD      → 全体车辆约 3% 绕行 ［待核］
//   写推荐路线 USE / RUSSELL ST → 约 20% ［待核，Erke 2007 二手转述］
// 其他文案按两点连成的直线换算，全体上限 35%（工程假设）。大模型定「相对位置」，实地数据定「刻度」。
// 换算的是全体（按车流占比加权）的绕行比例；各类人之间的相对高低沿用表态，等比例缩放。
// 锚点必须和要校准的回答来自同一个模型；对不上（或两块标准屏的表态几乎一样）就退回「表态 × 1/5」。

export const ANCHORS = {
  lo: { frames: [['ROADWORK', 'AHEAD']], real: 0.03 },
  hi: { frames: [['USE', 'RUSSELL ST']], real: 0.2 },
  cap: 0.35,
  ratio: 0.2, // 退回方案：表态 × 1/5
  minSpread: 0.02,
};

export const REF_CARD = {
  trip: { on: 'La Trobe St', dir: 'W', to: 'Spencer St', kmh: 40 },
  signs: [
    { m: 400, kind: 'vms', read_s: 9, frames: [['ROADWORK', 'AHEAD']] },
    { m: 150, kind: 'sign', text: 'RIGHT LANE CLOSED' },
  ],
  routes: [
    { id: 'stay', name: 'La Trobe St', usual_min: 6 },
    { id: 'r1', name: 'Russell St', usual_min: 8 },
    { id: 'r2', name: 'Elizabeth St', usual_min: 9, truck: false },
  ],
  queue_m: 0,
};

export function anchorCard(which) {
  const c = JSON.parse(JSON.stringify(REF_CARD));
  c.signs[0].frames = ANCHORS[which].frames;
  return c;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const detourOf = share => 1 - (share?.stay ?? 0);

// 回答的全体（按车流占比加权）绕行比例
export function mixDetour(ans) {
  return Object.entries(ans.mix).reduce((s, [t, w]) => s + w * detourOf(ans.by_type[t]?.share), 0);
}

export function makeAnchors(loAns, hiAns) {
  const lo = mixDetour(loAns), hi = mixDetour(hiAns);
  const model = loAns.model === hiAns.model ? loAns.model : 'mixed';
  const ok = hi - lo >= ANCHORS.minSpread && model !== 'mixed';
  return {
    method: ok ? 'two_point' : 'ratio',
    lo: { raw: lo, real: ANCHORS.lo.real },
    hi: { raw: hi, real: ANCHORS.hi.real },
    cap: ANCHORS.cap,
    model,
    src: loAns.src === hiAns.src ? loAns.src : 'mixed',
  };
}

// 校准一份 askPersonas 的回答。card = 问的那张场景卡（要知道有没有原路、哪条禁货车、平时多久）
export function calibrate(ans, anchors, card) {
  const types = Object.keys(ans.mix);
  const hasStay = card.routes.some(r => r.id === 'stay');
  let method = anchors.method;
  if (anchors.model !== ans.model) method = 'ratio';
  if (!hasStay) method = 'forced'; // 全封：没有「不绕」这个选项，不校准
  const f = x => (method === 'two_point'
    ? anchors.lo.real + ((x - anchors.lo.raw) * (anchors.hi.real - anchors.lo.real)) / (anchors.hi.raw - anchors.lo.raw)
    : method === 'ratio' ? x * ANCHORS.ratio : x);
  // 只换算全体比例；各类人按「表态」的相对高低等比例缩放 —— 分别换算的话，低的那类会被截到 0，锚点就对不准
  const raw = {}, d = {};
  for (const t of types) raw[t] = detourOf(ans.by_type[t].share);
  const X = types.reduce((s, t) => s + ans.mix[t] * raw[t], 0);
  const D = hasStay ? clamp(f(X), 0, anchors.cap) : 1;
  for (const t of types) d[t] = !hasStay ? 1 : X > 0 ? Math.min(1, (raw[t] * D) / X) : D;
  const alts = card.routes.filter(r => r.id !== 'stay');
  const by_type = {};
  for (const t of types) {
    const ok = alts.filter(r => !(t === 'delivery' && r.truck === false));
    const pool = ok.length ? ok : alts;
    let w = pool.map(r => ans.by_type[t].share[r.id] || 0);
    if (!(w.reduce((a, b) => a + b, 0) > 0)) w = pool.map(r => 1 / Math.max(0.5, r.usual_min));
    const ws = w.reduce((a, b) => a + b, 0);
    const share = Object.fromEntries(card.routes.map(r => [r.id, 0]));
    if (hasStay) share.stay = 1 - d[t];
    pool.forEach((r, i) => { share[r.id] += (d[t] * w[i]) / ws; });
    by_type[t] = { share, detour: d[t], raw_detour: raw[t] };
  }
  const share = Object.fromEntries(card.routes.map(r => [r.id, types.reduce((s, t) => s + ans.mix[t] * by_type[t].share[r.id], 0)]));
  return {
    method,
    share,
    by_type,
    raw_detour: types.reduce((s, t) => s + ans.mix[t] * raw[t], 0),
    detour: types.reduce((s, t) => s + ans.mix[t] * d[t], 0),
    anchors,
  };
}

// 锚点缓存：同一个 ask 函数、同一个来源只问一次（两块标准屏 × 4 类人）
const cache = new WeakMap();
export async function anchorsFor(ask, ans) {
  const force = ans?.src === 'rule' ? 'rule' : null;
  let m = cache.get(ask);
  if (!m) cache.set(ask, (m = new Map()));
  const k = force || 'default';
  if (!m.has(k)) {
    const o = force ? { force } : undefined;
    const p = Promise.all([ask(anchorCard('lo'), o), ask(anchorCard('hi'), o)]).then(([lo, hi]) => makeAnchors(lo, hi));
    p.catch(() => m.delete(k)); // 失败了下次重问，不把失败缓存住
    m.set(k, p);
  }
  return m.get(k);
}
