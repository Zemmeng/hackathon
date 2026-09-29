// routes.js —— 第 ① 步：找出受影响的车，和能绕的路（平时各要多久）。纯函数。
// 做法：施工路段按行车方向连成一段（approach）；沿同一条街往上游走 UP_LINKS 段当起点、往下游走 DOWN_LINKS 段当终点，
// 起点 → 终点穿过施工的那条就是「原路」（stay）。绕行路线 = 在施工前的每个路口拐出去，再走最短路到终点；
// 按拐进去的那条街起名（「Russell St」= 在 Russell St 拐），同名只留最快的，最多 MAX_ALTS 条。
// 受影响的车 = 施工第一段路段上这个小时的车流（veh/h）。

import { bearing, headingDot, shortestPath, pathTime } from './net.js';
import { dayType } from './worksite.js';

export const UP_LINKS = 2; // 上游多远开始算（约 400 米，屏一般摆在这个范围里）
export const DOWN_LINKS = 2;
export const MAX_ALTS = 3;
export const MAX_RATIO = 3; // 比原路平时慢 3 倍以上的绕行不算

function sameStreetNext(net, link) {
  const c = (net.out.get(link.to) || []).filter(l => l.name === link.name && l.to !== link.from && headingDot(net, link, l) > 0.7);
  return c.sort((a, b) => headingDot(net, link, b) - headingDot(net, link, a))[0] || null;
}
function sameStreetPrev(net, link) {
  const c = (net.inn.get(link.from) || []).filter(l => l.name === link.name && l.from !== link.to && headingDot(net, l, link) > 0.7);
  return c.sort((a, b) => headingDot(net, b, link) - headingDot(net, a, link))[0] || null;
}

// 施工路段 → 若干段 approach（同一方向连着的施工路段算一段；双向施工就是两段）
export function approaches(net, ws) {
  const set = new Set((ws.links || []).filter(id => net.links.has(id)));
  const out = [];
  for (const id of set) {
    const entry = net.links.get(id);
    const p = sameStreetPrev(net, entry);
    if (p && set.has(p.id)) continue; // 不是这一段的第一个路段
    const chain = [entry];
    for (let n = sameStreetNext(net, entry); n && set.has(n.id) && !chain.includes(n); n = sameStreetNext(net, n)) chain.push(n);
    const up = [];
    for (let u = sameStreetPrev(net, entry); u && up.length < UP_LINKS && !set.has(u.id) && !up.includes(u); u = sameStreetPrev(net, u)) up.unshift(u);
    const down = [];
    for (let d = sameStreetNext(net, chain[chain.length - 1]); d && down.length < DOWN_LINKS && !set.has(d.id) && !down.includes(d); d = sameStreetNext(net, d)) down.push(d);
    out.push({ entry, chain, up, down });
  }
  return out.sort((a, b) => (a.entry.id < b.entry.id ? -1 : 1));
}

function crossName(net, node, street) {
  const ls = [...(net.out.get(node) || []), ...(net.inn.get(node) || [])].filter(l => l.name && l.name !== street);
  return ls.length ? ls.sort((a, b) => (a.name < b.name ? -1 : 1))[0].name : street;
}

const truckOk = (net, ids) => ids.every(id => net.links.get(id).truck !== false);

// factors = capFactors(生效中的全部施工)：全封的路段谁都不能走
export function affected(net, flows, ws, when, factors = new Map()) {
  const dt = dayType(when);
  const closedAll = new Set([...factors].filter(([, x]) => x.f === 0).map(([id]) => id));
  const res = [];
  for (const { entry, chain, up, down } of approaches(net, ws)) {
    const stayLinks = [...up, ...chain, ...down].map(l => l.id);
    const origin = (up[0] || entry).from;
    const dest = (down[down.length - 1] || chain[chain.length - 1]).to;
    const street = entry.name;
    const banned = new Set([...closedAll, ...(ws.links || [])]);
    const prefixNodes = [origin, ...up.map(l => l.to)]; // 施工前可以拐出去的路口，最后一个 = 施工起点
    const prefixSet = new Set(prefixNodes);
    const stayT = pathTime(net, stayLinks);
    const best = new Map();
    prefixNodes.forEach((u, k) => {
      const diverge_m = up.slice(k).reduce((s, l) => s + l.len_m, 0);
      for (const l of net.out.get(u) || []) {
        if (l.id === stayLinks[k] || banned.has(l.id)) continue;
        if (k > 0 && l.to === prefixNodes[k - 1]) continue; // 掉头
        if (prefixSet.has(l.to)) continue;
        const rest = shortestPath(net, l.to, dest, { banned, bannedNodes: prefixSet });
        if (!rest) continue;
        const links = [...stayLinks.slice(0, k), l.id, ...rest.links];
        const t = pathTime(net, links);
        if (t > MAX_RATIO * stayT) continue;
        let name = l.name && l.name !== street ? l.name : `${street} (${bearing(net, l)})`;
        const prev = best.get(name);
        if (!prev || t < prev.t) best.set(name, { name, links, t, diverge_m });
      }
    });
    const alts = [...best.values()].sort((a, b) => a.t - b.t || (a.name < b.name ? -1 : 1)).slice(0, MAX_ALTS)
      .map((r, i) => ({ id: 'r' + (i + 1), name: r.name, links: r.links, usual_min: r.t / 60, truck: truckOk(net, r.links), diverge_m: r.diverge_m }));
    const blocked = factors.get(entry.id)?.f === 0;
    res.push({
      ws: ws.id,
      entry: entry.id,
      chain: chain.map(l => l.id),
      street,
      dir: bearing(net, entry),
      kmh: entry.speed_kmh,
      to: crossName(net, dest, street),
      volume: flows?.days?.[dt]?.[entry.id]?.[when.hour] ?? 0,
      blocked,
      stayLinks,
      stay: blocked ? null : { id: 'stay', name: street, links: stayLinks, usual_min: stayT / 60, truck: truckOk(net, stayLinks), diverge_m: null },
      alts,
    });
  }
  return res;
}
