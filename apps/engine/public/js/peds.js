// peds.js —— 封人行道对行人的影响（T17）。纯函数，不碰 DOM，浏览器和 node 都能直接 import。
// 输入：T3 的 walk.json（人行道路网）、peds.json（每条人行道每小时多少人）、方案、车行路网（找对面那幅路的人行道用，可省）。
//   pedImpact(walk, peds, plan, { net }) → { src: 'peds', footpath, day, hour, closed, closed_m, ped_h, detour_m, extra_min, crossings,
//                                            blocked, step_free: null, measured, sensor, detour, assumed, … }（字段表见 docs/contract.md §evaluate）
// 模型（全部是假设，写在 assumed 里）：
//   1 封哪几段：施工路段挂着的人行道（walk.json 的 road_link = 施工路段、side 对得上，kind 是 sidewalk / other / path）。
//     'left' / 'right' 相对施工路段的行车方向，和 walk.json 的 side 同一个口径（靠左行驶，left = 挨着被封车道那边的路缘）。
//     双幅路（OSM 里两个方向是两条线，Lonsdale / La Trobe 都是）：右边那条人行道挂在对面那幅路上、记作它的 left，
//     所以还要找对面那幅路（同名、方向相反、离得近），它的 left = 施工路段的 right；
//     只取「贴着施工路段走了 ≥ min(5 米, 自身长度一半)」的那几条（按和施工路段并排的长度算，不按中点）。
//   2 每一段（施工 × 哪一侧 × 一串首尾相接、方向差 < 60° 的施工路段）：起点、终点 = 这段封掉的人行道里离得最远、
//     而且避开封闭段还能走到大路网（不是死胡同、不是几条线围成的小孤岛）的两个节点；
//     绕行 = 人行道路网（不分方向）上避开所有封掉的人行道、从起点到终点的最短路；多走的米数 = 绕行长度 − 平时最短路长度。
//     这样的节点不到 2 个 = 死胡同（dead_end）：没有「穿过去」的人，不算绕行，也不算 blocked。
//   3 ped_h = 这一段封掉的人行道里这个小时人最多的那条（peds.json，下标 = 小时）；假设这些人都要走完整段（上限）。
//   4 extra_min = ped_h × 多走的米数 ÷ (步速 × 60)，人·分钟 / 小时，和车的 delay_min 同一个单位口径。等红灯的时间没算。
//   5 没路可绕（起点到终点不通）= blocked，这些人不算进 extra_min，单独报 blocked_ped_h（和车的 blocked_vph 一样）。
//   6 walk.json 没有台阶 / 坡道数据，不判断轮椅能不能走：step_free 一律 null。
//   7 过几次马路：绕行路线上连着的几段过街（安全岛把一条过街切成好几段）算一次，除非它们是不同名字的街。
//   8 方案要封的那一侧在 walk.json 里找不到人行道 → unmatched = true + note，不假装「没影响」。

import { isActive, dayType, footpathOf, validateWorksite } from './worksite.js';

export const WALK_MPS = 1.3; // 步速 m/s［假设值：成年人平均步速；Austroads 配信号用 1.2，老人、推婴儿车更慢］
export const CLOSABLE_KINDS = new Set(['sidewalk', 'other', 'path']); // 能被施工封掉的人行道；过街（crossing）、步行街（mall）不封
export const OPPOSITE_M = 40; // 对面那幅路离施工路段多远以内算「同一条街的另一个方向」［假设值：CBD 双幅路两条中心线相距约 10–25 米］
export const SENSOR_NEAR_M = 40; // 真计数器离封掉的人行道多远以内算「就在这段」（peds.json assumptions.sensor_m 有就用它），还要在同一侧
export const OVERLAP_MIN_M = 5; // 对面那幅路的人行道贴着施工路段走了 ≥ min(5 米, 自身长度一半) 才算被封［假设值：少于这个是拐角处擦边的碎段］
export const MIN_REACH = 60; // 避开封闭段后能走到的人行道节点不到 60 个 = 死胡同 / 小孤岛，不当绕行的起点终点［假设值：CBD 一个街区四周约 20–40 个节点］
const OPP_LAT_M = OPPOSITE_M + 25; // 对面人行道离施工路段中心线最远多少米（对面那幅路 ≤ 40 米 + 路面 / 人行道宽度）
const STEP_M = 1; // 量「并排多长」时把人行道折线切成 ≤ 1 米的小段

export const PEDS_NOTE = 'Assumes everyone counted on the closed footpath walks its full length (upper bound). Detour = shortest path on the OSM walk network avoiding the closed footpath; waiting at signals is not included. walk.json has no step or kerb-ramp data, so step-free access is not assessed (step_free: null).';
export const PEDS_NOTE_ZH = '假设封掉的这段人行道上数到的人都要走完整段（上限）。绕行 = OSM 人行道路网上避开封闭段的最短路，等红灯的时间没算。walk.json 没有台阶 / 坡道数据，不判断轮椅能不能走（step_free: null）。';

export const UNMATCHED_NOTE = 'walk.json has no footpath on this side of this link, so the closure could not be scored (not the same as "footpath open").';
export const UNMATCHED_NOTE_ZH = 'walk.json 里这条路段的这一侧没有人行道，封了也算不出来（不等于「人行道照常通行」）。';
export const DEAD_END_NOTE = 'The closed footpath is a dead end in walk.json (one end reaches no other footpath), so nobody walks through it and no detour is counted.';
export const DEAD_END_NOTE_ZH = '封掉的人行道在 walk.json 里是死胡同（有一头连不到别的人行道），没有穿过去的人，不算绕行。';

const DEG = Math.PI / 180;
const KY = 110574; // 每纬度多少米（墨尔本附近，局部平面近似够用）
const r1 = x => Math.round(x * 10) / 10;

// ---------- 人行道路网索引（同一份 walk 只建一次） ----------
const walkCache = new WeakMap();
function indexWalk(walk) {
  if (walkCache.has(walk)) return walkCache.get(walk);
  if (!walk || !Array.isArray(walk.nodes) || !Array.isArray(walk.links)) throw new Error('walk 要有 nodes[] 和 links[]');
  const nodes = new Map(walk.nodes.map(n => [n.id, n]));
  const links = new Map(), adj = new Map(), byRoad = new Map();
  for (const l of walk.links) {
    if (!nodes.has(l.a) || !nodes.has(l.b) || !(l.len_m >= 0)) continue;
    links.set(l.id, l);
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
      if (!adj.has(x)) adj.set(x, []);
      adj.get(x).push({ to: y, link: l });
    }
    if (l.road_link) {
      if (!byRoad.has(l.road_link)) byRoad.set(l.road_link, []);
      byRoad.get(l.road_link).push(l);
    }
  }
  for (const arr of adj.values()) arr.sort((p, q) => (p.link.id < q.link.id ? -1 : p.link.id > q.link.id ? 1 : 0)); // 遍历顺序固定 → 结果确定
  const ix = { nodes, links, adj, byRoad };
  walkCache.set(walk, ix);
  return ix;
}

// 车行路网：接受 loadNetwork() 的结果（links 是 Map）或原始 network.json
const netCache = new WeakMap();
function roadIndex(net) {
  if (!net) return null;
  if (netCache.has(net)) return netCache.get(net);
  const links = net.links instanceof Map ? net.links : new Map((net.links || []).map(l => [l.id, l]));
  const nodes = net.nodes instanceof Map ? net.nodes : new Map((net.nodes || []).map(n => [n.id, n]));
  const ix = { links, nodes, all: [...links.values()] };
  netCache.set(net, ix);
  return ix;
}
function roadPts(rix, l) {
  if (Array.isArray(l.geometry) && l.geometry.length >= 2) return l.geometry;
  const a = rix.nodes.get(l.from), b = rix.nodes.get(l.to);
  return a && b ? [[a.lat, a.lon], [b.lat, b.lon]] : null;
}

// ---------- 平面几何（局部等距投影，米） ----------
const xy = kx => ([lat, lon]) => [lon * kx, lat * KY];
function onSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, len = Math.sqrt(L2);
  const t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  const tc = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy)), t, len };
}
// 点到折线：最近距离 + 沿线位置（不截断，可以 < 0 或 > 总长）
function onLine(p, pts) {
  let best = null, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const s = onSeg(p, pts[i], pts[i + 1]);
    if (!best || s.d < best.d) best = { d: s.d, along: acc + s.t * s.len, i };
    acc += s.len;
  }
  return best ? { ...best, total: acc } : null;
}
function lineLen(pts) { let s = 0; for (let i = 0; i + 1 < pts.length; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return s; }
function midpoint(pts) {
  const half = lineLen(pts) / 2;
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + d >= half && d > 0) { const t = (half - acc) / d; return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]; }
    acc += d;
  }
  return pts[0];
}
const heading = pts => { const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; };
const compass = h => ['N', 'E', 'S', 'W'][Math.round((((Math.atan2(h[0], h[1]) / DEG) + 360) % 360) / 90) % 4];
// 点在折线的哪一侧：> 0 左、< 0 右（相对折线走向），看离它最近的那一小段
function sideOf(p, lines) {
  let best = null;
  for (const pts of lines) for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], s = onSeg(p, a, b);
    if (!best || s.d < best.d) best = { d: s.d, c: (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) };
  }
  return best ? Math.sign(best.c) : 0;
}
// 折线 g 有多长是「贴着」折线 lp 走的：切成 ≤ 1 米的小段，小段中点投影落在 lp 的 [0, 总长] 内、离 lp ≤ lat 米、
// 而且和 lp 那一小段大致平行（夹角 < 45°，拐角处横着的那截不算）的长度加起来
function besideM(g, lp, total, lat) {
  let m = 0;
  for (let i = 0; i + 1 < g.length; i++) {
    const a = g[i], b = g[i + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!d) continue;
    const n = Math.max(1, Math.ceil(d / STEP_M));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, q = onLine([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], lp);
      if (!q || q.along < 0 || q.along > total || q.d > lat) continue;
      const s0 = lp[q.i], s1 = lp[q.i + 1], sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
      if (Math.abs(((b[0] - a[0]) * (s1[0] - s0[0]) + (b[1] - a[1]) * (s1[1] - s0[1])) / (d * sl)) >= 0.7) m += d / n;
    }
  }
  return m;
}

// ---------- 最短路（不分方向，Dijkstra + 二叉堆） ----------
function dijkstra(ix, from, to, banned) {
  if (from === to) return { m: 0, links: [] };
  const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
  const heap = [[0, from]];
  const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const { to: v, link } of ix.adj.get(u) || []) {
      if (banned && banned.has(link.id)) continue;
      const nd = d + link.len_m;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { u, link }); push([nd, v]); }
    }
  }
  if (!done.has(to)) return null;
  const links = [];
  for (let v = to; v !== from; v = prev.get(v).u) links.push(prev.get(v).link);
  return { m: dist.get(to), links: links.reverse() };
}
const isCrossing = l => l.kind === 'crossing' || l.crossing != null;
// 过几次马路：路线上连着的过街段算一次（安全岛把一条过街切成好几段），除非前后两段都知道街名而且不一样（拐角处连着过两条街）
function countCrossings(links, nameOf) {
  let n = 0, prev = null;
  for (const l of links) {
    if (!isCrossing(l)) { prev = null; continue; }
    const nm = nameOf(l);
    if (!prev || (prev.nm && nm && prev.nm !== nm)) n++;
    prev = { nm: nm ?? prev?.nm ?? null };
  }
  return n;
}
// 从 n 出发、避开封闭段，能不能走到至少 cap 个节点（走不到 = 死胡同 / 小孤岛）
function reachesMain(ix, n, banned, cap) {
  const seen = new Set([n]), stack = [n];
  while (stack.length && seen.size < cap) {
    for (const { to, link } of ix.adj.get(stack.pop()) || []) {
      if (banned.has(link.id) || seen.has(to)) continue;
      seen.add(to);
      stack.push(to);
    }
  }
  return seen.size >= cap;
}
const walkPts = (ix, l) => (Array.isArray(l.geometry) && l.geometry.length >= 2 ? l.geometry : [ix.nodes.get(l.a), ix.nodes.get(l.b)].map(n => [n.lat, n.lon]));

// ---------- 封哪几段 ----------
// 对面那幅路：同名（都有名字时）、方向相反、离施工路段 OPPOSITE_M 米以内、沿线有重叠
function oppositeLinks(rix, L, P, toXY) {
  const lp = P.map(toXY), h = heading(lp), total = lineLen(lp);
  const out = [];
  for (const M of rix.all) {
    if (M.id === L.id) continue;
    if (L.name && M.name && L.name !== M.name) continue;
    const mp0 = roadPts(rix, M);
    if (!mp0) continue;
    const mp = mp0.map(toXY), hm = heading(mp);
    if (h[0] * hm[0] + h[1] * hm[1] > -0.87) continue; // 夹角 < 150° 不算反向
    const near = mp.map(p => onLine(p, lp)).filter(Boolean);
    if (!near.some(q => q.d <= OPPOSITE_M)) continue;
    const alongs = near.map(q => q.along);
    if (Math.max(...alongs) < 0 || Math.min(...alongs) > total) continue;
    out.push(M);
  }
  return out;
}

// 一个施工里的路段按「首尾相接、方向差 < 60°」连成串：同一串是一段连续的封闭，不会因为街道方位跨过 45° 被拆成两段；
// 掉头回来的（对面那幅路）方向相反，单独成串。没有车行路网时整个施工算一串（和以前一样）
function chainsOf(rix, ws, toXY) {
  const ids = ws.links || [];
  const info = ids.map(id => {
    const L = rix?.links.get(id), P = L && roadPts(rix, L);
    return P ? { L, P, lp: P.map(toXY), h: heading(P.map(toXY)) } : null;
  });
  const up = ids.map((_, i) => i);
  const root = i => (up[i] === i ? i : (up[i] = root(up[i])));
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = info[i], b = info[j];
    if (!a || !b) { if (!a && !b) up[root(j)] = root(i); continue; }
    const share = [a.L.from, a.L.to].some(n => n != null && (n === b.L.from || n === b.L.to));
    if (share && a.h[0] * b.h[0] + a.h[1] * b.h[1] >= 0.5) up[root(j)] = root(i);
  }
  return ids.map((id, i) => ({ id, chain: root(i), ...(info[i] || {}) }));
}

// → [{ key, ws, worksite, side, dir, road, lines: [施工路段折线 XY], links: [walk link] }]；一条人行道只归一段
function closedStretches(ix, rix, worksites, toXY) {
  const groups = new Map(), taken = new Set();
  const group = (wi, ws, side, c, chains) => {
    const key = `${wi}:${side}:${c.chain}`;
    if (!groups.has(key)) {
      const first = chains.find(x => x.chain === c.chain);
      groups.set(key, {
        key, ws, worksite: ws.id ?? null, side, dir: first.h ? compass(first.h) : '?', road: first.L?.name ?? null,
        lines: chains.filter(x => x.chain === c.chain && x.lp).map(x => x.lp), links: [],
      });
    }
    return groups.get(key);
  };
  const add = (g, wl) => { if (taken.has(wl.id)) return; taken.add(wl.id); g.links.push(wl); };
  const want = fp => (fp === 'both' ? ['left', 'right'] : [fp]);
  const chainsAll = worksites.map(ws => chainsOf(rix, ws, toXY));
  // 先挂在施工路段自己身上的（数据里的 side 就是相对它的行车方向）
  worksites.forEach((ws, wi) => {
    const sides = want(footpathOf(ws)), chains = chainsAll[wi];
    for (const c of chains) {
      for (const wl of ix.byRoad.get(c.id) || []) if (CLOSABLE_KINDS.has(wl.kind) && sides.includes(wl.side)) add(group(wi, ws, wl.side, c, chains), wl);
    }
  });
  // 再找对面那幅路上的：它的 left = 施工路段的 right，反过来一样；只取贴着施工路段并排走够长的那几条
  if (rix) {
    const flip = { left: 'right', right: 'left' };
    worksites.forEach((ws, wi) => {
      const sides = want(footpathOf(ws)), chains = chainsAll[wi];
      for (const c of chains) {
        if (!c.P) continue;
        const total = lineLen(c.lp);
        for (const M of oppositeLinks(rix, c.L, c.P, toXY)) {
          for (const wl of ix.byRoad.get(M.id) || []) {
            const side = flip[wl.side];
            if (!side || !sides.includes(side) || !CLOSABLE_KINDS.has(wl.kind) || taken.has(wl.id)) continue;
            const g = walkPts(ix, wl).map(toXY);
            if (besideM(g, c.lp, total, OPP_LAT_M) >= Math.min(OVERLAP_MIN_M, 0.5 * lineLen(g))) add(group(wi, ws, side, c, chains), wl);
          }
        }
      }
    });
  }
  return [...groups.values()].filter(g => g.links.length);
}

// ---------- 一段的影响 ----------
function stretchImpact(ix, g, closedSet, volOf, methodOf, nameOf, toXY) {
  const ids = g.links.map(l => l.id);
  const nodes = [...new Set(g.links.flatMap(l => [l.a, l.b]))];
  // 起点、终点：避开封闭段还能走到大路网的节点里离得最远的两个。
  // 只有一头连着（另一头是死胡同 / 几个节点的小孤岛）= 没有穿过去的人：dead_end，不算绕行，也不算 blocked
  const cap = Math.max(2, Math.min(MIN_REACH, Math.floor(ix.nodes.size / 2)));
  const anchors = nodes.filter(n => reachesMain(ix, n, closedSet, cap));
  const pool = anchors.length >= 2 ? anchors : nodes;
  const pt = n => toXY([ix.nodes.get(n).lat, ix.nodes.get(n).lon]);
  let from = pool[0], to = pool[1] ?? pool[0], far = -1;
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pt(pool[i]), b = pt(pool[j]), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d > far) { far = d; from = pool[i]; to = pool[j]; }
  }
  let top = null;
  for (const l of g.links) { const v = volOf(l.id); if (!top || v > top.v) top = { v, id: l.id }; }
  const ped_h = top ? top.v : 0;
  const measured = g.links.some(l => methodOf(l.id) === 'sensor');
  const closed_m = g.links.reduce((s, l) => s + l.len_m, 0);
  const dead_end = anchors.length < 2;
  const base = dijkstra(ix, from, to, null);
  const alt = dead_end ? null : dijkstra(ix, from, to, closedSet);
  const blocked = !dead_end && !alt;
  const detour_m = !alt || !base ? 0 : Math.max(0, alt.m - base.m);
  return {
    worksite: g.worksite, side: g.side, dir: g.dir, street: g.road,
    closed: ids, closed_m: r1(closed_m), from, to,
    ped_h, method: top ? methodOf(top.id) : null, measured,
    base_m: base ? r1(base.m) : null, path_m: alt ? r1(alt.m) : null, detour_m: r1(detour_m),
    extra_min: alt ? r1((ped_h * detour_m) / (WALK_MPS * 60)) : 0,
    crossings: alt ? countCrossings(alt.links, nameOf) : 0,
    base_crossings: base ? countCrossings(base.links, nameOf) : 0,
    blocked, dead_end, detour: alt ? alt.links.map(l => l.id) : [],
  };
}

// 最近的真计数器：先认就装在封掉的人行道上的；否则要离封闭段 ≤ 40 米、而且和它在施工路段中心线的同一侧
// （马路对面那条人行道上的计数器数的是另一拨人，不能当这段的实测）；都没有 = null
function nearestSensor(ix, peds, groups, closedSet, day, hour, toXY) {
  const lim = Number.isFinite(peds?.assumptions?.sensor_m) ? peds.assumptions.sensor_m : SENSOR_NEAR_M;
  const closed = groups.flatMap(g => g.links.map(l => ({ l, g, line: walkPts(ix, l).map(toXY) })));
  let best = null;
  for (const s of peds?.sensors || []) {
    if (!s.walk_link || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const v = peds.days?.[day]?.[s.walk_link]?.[hour];
    if (!Number.isFinite(v)) continue;
    const p = toXY([s.lat, s.lon]);
    let near = null;
    for (const c of closed) { const d = onLine(p, c.line)?.d ?? Infinity; if (!near || d < near.d) near = { d, c }; }
    if (!near) continue;
    const on = closedSet.has(s.walk_link);
    if (!on) {
      if (near.d > lim || !near.c.g.lines.length) continue;
      const own = ix.links.get(s.walk_link), sp = own ? midpoint(walkPts(ix, own).map(toXY)) : p;
      const want = sideOf(midpoint(near.c.line), near.c.g.lines);
      if (!want || sideOf(sp, near.c.g.lines) !== want) continue;
    }
    const cand = { on, d: near.d, name: s.name ?? String(s.id), ped_h: v, id: s.id ?? null };
    if (!best || (cand.on && !best.on) || (cand.on === best.on && cand.d < best.d)) best = cand;
  }
  return best && { name: best.name, ped_h: best.ped_h, id: best.id, dist_m: r1(best.d), on_closed: best.on };
}

// 方案里声明的封人行道（不管这个小时在不在施工）：none / left / right / both
export function plannedFootpath(worksites) {
  const s = new Set();
  for (const ws of worksites || []) { const f = footpathOf(ws); if (f === 'both') { s.add('left'); s.add('right'); } else if (f !== 'none') s.add(f); }
  return s.size === 2 ? 'both' : s.size === 1 ? [...s][0] : 'none';
}

// 这个小时有没有正在封人行道的施工（没有 = 行人影响一定是 0，不用人行道数据）
export function footpathActive(plan) {
  return (plan?.worksites || []).some(w => footpathOf(w) !== 'none' && plan?.when && isActive(w, plan.when));
}

// 没加载到 walk / peds 时 summary.peds 的样子
export function pedsUnavailable(plan) {
  return { src: null, footpath: plannedFootpath(plan?.worksites) };
}

export function pedImpact(walk, peds, plan, { net = null } = {}) {
  const all = plan?.worksites || [];
  const bad = all.flatMap(validateWorksite).filter(e => e.includes('footpath'));
  if (bad.length) throw new Error(bad.join('；')); // 直接调 pedImpact 也挡住写错的 footpath（backend.run 在这之前就用 validatePlan 抛 bad_plan）
  const when = plan.when;
  const day = dayType(when), hour = when.hour;
  const footpath = plannedFootpath(all);
  const ws = all.filter(w => footpathOf(w) !== 'none' && isActive(w, when));
  const out = {
    src: 'peds', footpath, active: ws.length > 0, day, hour,
    closed: [], closed_m: 0, ped_h: 0, detour_m: 0, extra_min: 0, crossings: 0, blocked: false, blocked_ped_h: 0,
    dead_end: false, unmatched: false, unmatched_sides: [], note: null, note_zh: null,
    step_free: null, measured: false, method: null, sensor: null, detour: [], stretches: [],
    assumed: { walk_mps: WALK_MPS, note: PEDS_NOTE, note_zh: PEDS_NOTE_ZH },
  };
  if (!ws.length) return out; // 人行道没封、或者这个小时不施工 → 全是 0（不用人行道数据）
  const ix = indexWalk(walk);
  const rix = roadIndex(net);
  const firstPts = rix && ws.flatMap(w => w.links || []).map(id => rix.links.get(id)).filter(Boolean).map(l => roadPts(rix, l)).find(Boolean);
  const lat0 = firstPts ? firstPts[0][0] : (walk.nodes[0]?.lat ?? -37.81);
  const toXY = xy(111320 * Math.cos(lat0 * DEG));
  const groups = closedStretches(ix, rix, ws, toXY);
  // 要封的那一侧在 walk.json 里一条人行道都没找到：报 unmatched，别让页面当成「人行道照常通行」
  const want = fp => (fp === 'both' ? ['left', 'right'] : [fp]);
  out.unmatched_sides = ws.flatMap(w => want(footpathOf(w)).filter(sd => !groups.some(g => g.ws === w && g.side === sd)).map(sd => ({ worksite: w.id ?? null, side: sd })));
  out.unmatched = out.unmatched_sides.length > 0;
  const notes = [], notesZh = [];
  if (out.unmatched) { notes.push(UNMATCHED_NOTE); notesZh.push(UNMATCHED_NOTE_ZH); }
  const finish = () => { out.note = notes.length ? notes.join(' ') : null; out.note_zh = notesZh.length ? notesZh.join('') : null; return out; };
  if (!groups.length) return finish();
  const closedLinks = groups.flatMap(g => g.links);
  const closedSet = new Set(closedLinks.map(l => l.id));
  const volOf = id => { const v = peds?.days?.[day]?.[id]?.[hour]; return Number.isFinite(v) ? v : 0; };
  const methodOf = id => peds?.method?.[id] ?? null;
  const nameOf = l => (l.road_link && rix?.links.get(l.road_link)?.name) || null;
  const st = groups.map(g => stretchImpact(ix, g, closedSet, volOf, methodOf, nameOf, toXY));
  const open = st.filter(s => !s.blocked && !s.dead_end);
  const pedOpen = open.reduce((a, s) => a + s.ped_h, 0);
  const main = st.reduce((b, s) => (s.ped_h > b.ped_h ? s : b), st[0]);
  if (st.some(s => s.dead_end)) { notes.push(DEAD_END_NOTE); notesZh.push(DEAD_END_NOTE_ZH); }
  Object.assign(out, {
    closed: closedLinks.map(l => l.id),
    closed_m: r1(closedLinks.reduce((a, l) => a + l.len_m, 0)),
    ped_h: st.reduce((a, s) => a + s.ped_h, 0), // 各段（各侧）的人加起来：两侧都封时是两拨人
    detour_m: pedOpen ? r1(open.reduce((a, s) => a + s.ped_h * s.detour_m, 0) / pedOpen) : open.length ? r1(Math.max(...open.map(s => s.detour_m))) : 0, // 按人数加权
    extra_min: r1(open.reduce((a, s) => a + s.extra_min, 0)),
    crossings: open.length ? Math.max(...open.map(s => s.crossings)) : 0, // 最坏那段绕行要过几次马路
    blocked: st.some(s => s.blocked),
    blocked_ped_h: st.filter(s => s.blocked).reduce((a, s) => a + s.ped_h, 0),
    dead_end: st.some(s => s.dead_end),
    measured: st.some(s => s.measured),
    method: main.method,
    sensor: nearestSensor(ix, peds, groups, closedSet, day, hour, toXY),
    detour: [...new Set(open.flatMap(s => s.detour))],
    stretches: st,
  });
  return finish();
}
