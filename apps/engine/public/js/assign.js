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
  for (const { ap, share } of splits) {
    const F = ap.volume;
    const moved = ap.stay ? 1 - (share.stay ?? 0) : 1;
    for (const id of ap.stayLinks) v.set(id, Math.max(0, v.get(id) - moved * F));
    for (const r of ap.alts) {
      const p = share[r.id] || 0;
      if (p) for (const id of r.links) v.set(id, v.get(id) + p * F);
    }
  }
  const f = capFactors(net, active);
  const links = new Map();
  let tt = 0, blocked = 0;
  for (const l of net.links.values()) {
    const x = f.get(l.id);
    const cap = l.cap_vph * (x ? x.f : 1);
    const vol = v.get(l.id);
    let t = linkTime(l.t0_s, vol, cap);
    if (!Number.isFinite(t)) { blocked += vol; t = l.t0_s; } // 全封但还有车（没有绕行路线）：单独报出来，不算进延误
    const open = x ? x.open : l.lanes;
    links.set(l.id, { v: vol, cap, t, queue_m: (queueVeh(vol, cap) * VEH_GAP_M) / Math.max(1, open) });
    tt += vol * t;
  }
  return { tt_s: tt, links, blocked_vph: blocked };
}

export function pathNow(ev, ids) {
  return ids.reduce((s, id) => s + ev.links.get(id).t, 0);
}

export function maxQueue(ev, ids) {
  return ids.reduce((m, id) => Math.max(m, ev.links.get(id).queue_m), 0);
}
