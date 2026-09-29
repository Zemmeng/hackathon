// assign.js —— 第 ⑤ 步：按校准后的比例把受影响的车分到各条路上，算每个路段的通行时间、排队和全网总行程时间。纯函数。
// 背景车流 = flows.json 这个小时的路段流量（已经包含受影响的车）。绕行的车从原路的路段上减掉、加到绕行路线的路段上；
// 共用的上游路段一减一加正好抵消。总延误 D = 全网总行程时间（veh·min）− 没有施工时的总行程时间。

import { linkTime, queueVeh, VEH_GAP_M } from './net.js';
import { capFactors, dayType } from './worksite.js';

// splits = [{ ap, share: { 路线 id: 比例 } }]（ap 来自 routes.js 的 affected）
export function evaluate(net, flows, when, active = [], splits = []) {
  const dt = dayType(when);
  const v = new Map();
  for (const l of net.links.values()) v.set(l.id, flows?.days?.[dt]?.[l.id]?.[when.hour] ?? 0);
  // 受影响的车 F 取「原路上现在还剩的最小流量」：同一路段 / 同一条街相邻的两个施工，第二个只能分还没被第一个分走的车（不重复减加）
  // 全封（blocked）例外：封死的路段上一辆车都不能留，F 取封闭路段上现在还剩的最大流量（从侧路拐进来的车也按走原路的起终点绕），
  // 否则只挪「从头走到尾」的那部分，其余的车被记成卡住、不算延误，全封反而比封一条道显得好（review-backend-logic）
  // 绕走的比例 = 各绕行路线份额之和：没有绕行路线（全封又无路可绕）时一辆都不挪，卡在原路上，报进 blocked_vph
  const used = [];
  for (const { ap, share } of splits) {
    const F = ap.blocked
      ? Math.max(0, ...ap.chain.map(id => v.get(id) ?? 0))
      : Math.min(ap.volume, ...ap.stayLinks.map(id => v.get(id)));
    const moved = ap.alts.reduce((s, r) => s + (share[r.id] || 0), 0);
    used.push(F);
    for (const id of ap.stayLinks) v.set(id, v.get(id) - moved * F);
    for (const r of ap.alts) {
      const p = share[r.id] || 0;
      if (p) for (const id of r.links) v.set(id, v.get(id) + p * F);
    }
  }
  // 全封时按封闭路段上的最大流量挪车，上游某段原本没这么多车（有车是从侧路拐进来的）就会减成负数：分完再截到 0。
  // 不能减的时候就截：共用的上游路段一减一加要先抵消，截早了上游会凭空多出车
  for (const [id, x] of v) if (x < 0) v.set(id, 0);
  const f = capFactors(net, active);
  const links = new Map();
  let tt = 0, blocked = 0;
  for (const l of net.links.values()) {
    const x = f.get(l.id);
    const cap = l.cap_vph * (x ? x.f : 1);
    const vol = v.get(l.id);
    let t = linkTime(l.t0_s, vol, cap);
    if (!Number.isFinite(t)) { blocked += vol; t = linkTime(l.t0_s, vol, l.cap_vph); } // 全封但还有车（无路可绕）：单独报出来，不算进延误
    // 排队排在施工段上游的整条路上：按这条路原本的车道数折算长度（不是施工段剩下的车道）
    links.set(l.id, { v: vol, cap, t, queue_m: Number.isFinite(queueVeh(vol, cap)) && cap > 0 ? (queueVeh(vol, cap) * VEH_GAP_M) / Math.max(1, l.lanes) : 0 });
    tt += vol * t;
  }
  return { tt_s: tt, links, blocked_vph: blocked, used };
}

export function pathNow(ev, ids) {
  return ids.reduce((s, id) => s + ev.links.get(id).t, 0);
}

export function maxQueue(ev, ids) {
  return ids.reduce((m, id) => Math.max(m, ev.links.get(id).queue_m), 0);
}
