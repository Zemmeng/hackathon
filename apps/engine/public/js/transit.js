// transit.js —— 电车、公交受施工影响多少（T16）。纯函数，不碰 DOM；backend.js 的 run() 调它，结果放在 summary.transit。
// 数据：T3 的 transit.json（PTV GTFS 时刻表：CBD 里 47 条电车 / 公交线路，每个方向匹配到的路段 links[]、站 stops[]、
// 每小时车次 trips.wd|we[24]；站的 road_link = 站在哪个路段上）。
// 模型（每一条都是假设，docs/contract.md §evaluate「summary.transit」、apps/engine/README.md 同步写着）：
//   1 只列「这个方向经过的路段变慢了或被全封」的线路；这个小时没有车次的不列。车次 = trips[wd|we][小时]，工作日 / 周末用引擎的 dayType。
//   2 公交跟车流一起走、线路固定：每趟多的秒数 = 线路上每个路段（这个方案下的通行时间 − 同一小时没有施工时的通行时间）加起来。
//     两个时间都用引擎的 linkTime（BPR + 确定性排队）：方案下取 result.links 的 v、cap，没施工时取 flows.json 这个小时的流量和原通行能力
//     （同样取整，没变的路段正好差 0）。result.links[].delay_s 是比「自由流」多的秒数，不是比「没施工」多的，不能直接加。
//   3 公交线路上有路段全封 → 必须绕：在封闭段前 DIVERT_M 米内的线路节点拐出去，走最短路（按这个方案下的通行时间，
//     不走全封的路段，不掉头走回线路上游），在封闭段后 DIVERT_M 米内回到线路上；挑全程最快的拐法。先只走主干道（BUS_ROADS），
//     绕不过去再放开到小街，小巷（NO_DETOUR）始终不走；附近绕不过去就在整条线路上找，还不行 = blocked。
//     每趟多的秒数 = 绕完的全程 − 没施工时的全程；diverted = true，detour_links = 绕的那段路，stops_skipped = 绕开的那段线路上的站。
//   4 电车在 CBD 走自己的轨道车道 / 路中间：封部分车道、旁边车流变慢都不耽误电车（不列）；
//     全封电车经过的路段 = blocked（电车不能绕），报这个小时停掉的车次 trips_h 和乘客 pax_h，分钟数给 null（不编）。
//   5 每趟车载多少人是假设值（PAX_PER_TRIP，没有 PTV 分线路分时段的载客数据）：工作日 7–9、16–18 点算高峰，其余算平峰；
//     pax_h = 车次 × 每趟人数，pax_min = pax_h × 每趟多的秒数 ÷ 60（乘客·分钟，这一小时）。
//   6 transit.json 的 links[] 是按 10 米采样匹配的，路口里很短的路段常被跳过：相邻两段接不上时，GAP_FILL_M 米内的最短路补上
//     （电车只走 tram = true 的路段补）；补不上（线路走到路网外、或者匹配到对向）就照原样，这一段不计时间。

import { linkTime, dijkstra, treePath } from './net.js';
import { dayType, isActive, capFactors } from './worksite.js';
import { NO_DETOUR } from './routes.js';

// 每趟车平均载多少人：假设值（D-0929-1536：界面标「假设值」并给区间）。高峰电车 60（E 级电车满载约 210）、公交 60 座的车坐 25
export const PAX_PER_TRIP = { peak: { tram: 60, bus: 25 }, offpeak: { tram: 30, bus: 12 } };
export const PAX_RANGE = { peak: { tram: [40, 120], bus: [15, 45] }, offpeak: { tram: [15, 60], bus: [5, 25] } };
export const TRANSIT_PEAK_HOURS = [7, 8, 9, 16, 17, 18]; // 只算工作日
export const GAP_FILL_M = 60; // 线路上相邻两段接不上时，这个距离内的最短路补上（路口里的短路段）
export const DIVERT_M = 400; // 公交绕行：封闭段前后多少米内拐出去 / 回到线路上（和 routes.js 的 UP_M 同一个量级）
export const SLOWER_S = 0.1; // 路段比没施工时慢超过这么多秒才算「变慢了」（result.links 精度 0.1 秒）
// 公交绕行先只走这些等级的路（OSM highway）；绕不过去再放开到 unclassified / residential 小街，NO_DETOUR 的小巷始终不走
export const BUS_ROADS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);

const round1 = x => Math.round(x * 10) / 10;
const TRAM = 'tram';
const NOTE = '每趟载客人数是假设值（没有 PTV 分线路载客数据）；电车在 CBD 走自己的车道，封部分车道不耽误电车，全封才停；公交跟车流走固定线路，全封就近绕行';

// 线路方向 → 路段序列（补上路口缺口）。按 transit 对象 × 路网缓存：同一份数据只算一次
const idxCache = new WeakMap();
function indexTransit(net, transit) {
  let byNet = idxCache.get(transit);
  if (!byNet) idxCache.set(transit, (byNet = new WeakMap()));
  if (byNet.has(net)) return byNet.get(net);
  const trees = new Map();
  // 电车只用有轨道的路段补（network.json 的 tram 字段；没这个字段的路网不限）
  const fill = (a, b, tram) => {
    const k = (tram ? 't|' : 'b|') + a;
    if (!trees.has(k)) trees.set(k, dijkstra(net, a, { cost: l => l.len_m, maxCost: GAP_FILL_M, linkOk: l => !tram || l.tram !== false }));
    return treePath(trees.get(k), a, b);
  };
  const dirs = [];
  for (const route of transit.routes || []) {
    for (const dir of route.dirs || []) {
      const path = [];
      for (const id of dir.links || []) {
        const l = net.links.get(id);
        if (!l) continue; // 不在这张路网上（换了路网也不崩）
        const last = path.length ? net.links.get(path[path.length - 1]) : null;
        if (last && last.to !== l.from) { const f = fill(last.to, l.from, route.mode === TRAM); if (f) path.push(...f); }
        path.push(id);
      }
      if (path.length) dirs.push({ route, dir, path });
    }
  }
  const idx = { dirs, stops: new Map((transit.stops || []).map(s => [s.id, s])) };
  byNet.set(net, idx);
  return idx;
}

export function isTransit(x) {
  return Boolean(x && Array.isArray(x.routes));
}

// 这个小时每趟车载多少人（假设值）
export function paxPerTrip(when) {
  const period = dayType(when) === 'wd' && TRANSIT_PEAK_HOURS.includes(when.hour) ? 'peak' : 'offpeak';
  return { period, ...PAX_PER_TRIP[period], range: PAX_RANGE[period] };
}

// net = loadNetwork() 的结果（engine.net）；flows = flows.json；transit = transit.json；plan = 方案；result = engine.evaluate(plan)
// → summary.transit（格式见文件头和 docs/contract.md）。transit 不合格 → { src: null }
export function transitImpact(net, flows, transit, plan, result) {
  if (!isTransit(transit)) return { src: null };
  const when = plan.when;
  const day = dayType(when), hour = when.hour;
  const P = paxPerTrip(when);
  const assumed = { pax_per_trip: { tram: P.tram, bus: P.bus }, period: P.period, range: P.range, note: NOTE };

  const active = (plan.worksites || []).filter(ws => isActive(ws, when));
  const factors = capFactors(net, active);
  const closed = new Set([...factors].filter(([, x]) => x.f === 0).map(([id]) => id));
  const X = new Map((result?.links || []).map(x => [x.id, x]));
  const memoB = new Map(), memoP = new Map();
  // 没施工时：flows.json 这个小时的流量 + 原通行能力。方案下：result.links 的 v、cap（没有这个路段 = 没变）
  const baseT = id => {
    if (!memoB.has(id)) {
      const l = net.links.get(id);
      memoB.set(id, linkTime(l.t0_s, Math.round(flows?.days?.[day]?.[id]?.[hour] ?? 0), Math.round(l.cap_vph)));
    }
    return memoB.get(id);
  };
  const planT = id => {
    if (!memoP.has(id)) {
      const x = X.get(id), l = net.links.get(id);
      memoP.set(id, x ? linkTime(l.t0_s, x.v, x.cap) : baseT(id));
    }
    return memoP.get(id);
  };
  // 绕行不许走的路：先只走主干道（strict），主干道绕不过去再放开到小街；全封的路段、小巷（NO_DETOUR）始终不走
  const ls = [...net.links.values()];
  const banned = {
    strict: new Set([...closed, ...ls.filter(l => !BUS_ROADS.has(l.highway)).map(l => l.id)]),
    relaxed: new Set([...closed, ...ls.filter(l => NO_DETOUR.has(l.highway)).map(l => l.id)]),
  };
  const trees = new Map(); // 绕行的最短路树：同一个起点 + 同样不许进的节点只算一次（很多公交走同一段 Lonsdale St）

  // 公交这一趟在这个方案下的全程时间（全封就绕）→ { t, detour: 绕的路段, skipped: 被绕开的线路路段 }；绕不过去 → null
  function busTrip(path) {
    const n = path.length;
    const L = path.map(id => net.links.get(id));
    const pt = path.map(id => (closed.has(id) ? 0 : planT(id)));
    const pre = [0];
    for (let i = 0; i < n; i++) pre.push(pre[i] + pt[i]);
    const sum = (a, b) => pre[b] - pre[a]; // path[a..b-1] 的时间
    const node = k => (k < n ? L[k].from : L[n - 1].to);
    let t = 0, q = 0, lo = 0;
    const detour = [], skipped = [];
    while (q < n) {
      if (!closed.has(path[q])) { t += pt[q]; q++; continue; }
      let j = q;
      while (j + 1 < n && closed.has(path[j + 1])) j++;
      const pick = (near, mode) => {
        // 拐出去：node(m)，m ∈ [lo, q]，跳过的线路 ≤ DIVERT_M 米；回来：node(k)，k ∈ (j, n]，跳过的 ≤ DIVERT_M 米、不越过下一段全封
        const ms = [], ks = [];
        for (let m = q, d = 0; m >= lo; m--) { if (m < q) d += L[m].len_m; if (near && d > DIVERT_M) break; ms.push(m); }
        for (let k = j + 1, d = 0; k <= n; k++) {
          if (k > j + 1) d += L[k - 1].len_m;
          if (near && d > DIVERT_M) break;
          ks.push(k);
          if (k < n && closed.has(path[k])) break;
        }
        const hi = ks[ks.length - 1];
        let best = null;
        for (const m of ms) {
          const s = node(m);
          const up = new Set(); // 不掉头走回线路上游：拐出点之前 DIVERT_M 米内的线路节点不许进
          for (let x = m - 1, d = 0; x >= 0 && d <= DIVERT_M; x--) { up.add(node(x)); d += L[x].len_m; }
          const key = mode + '|' + s + '|' + [...up].sort().join(',');
          if (!trees.has(key)) trees.set(key, dijkstra(net, s, { cost: l => planT(l.id), banned: banned[mode], bannedNodes: up }));
          const tree = trees.get(key);
          for (const k of ks) {
            const d = tree.dist.get(node(k));
            if (d == null) continue;
            const c = sum(m, q) + d + sum(k, hi);
            if (!best || c < best.c - 1e-9) best = { c, m, k, hi, tree, s };
          }
        }
        return best;
      };
      // 先在封闭段附近找主干道 → 附近的小街 → 整条线路上的主干道 → 整条线路上的小街
      const b = pick(true, 'strict') || pick(true, 'relaxed') || pick(false, 'strict') || pick(false, 'relaxed');
      if (!b) return null;
      t += b.c - sum(b.m, q); // path[m..q-1] 已经算进 t 了，换成绕行
      detour.push(...treePath(b.tree, b.s, node(b.k)));
      skipped.push(...path.slice(b.m, b.k));
      q = b.hi;
      lo = b.hi;
    }
    return { t, detour, skipped };
  }

  const idx = indexTransit(net, transit);
  const routes = [];
  for (const { route, dir, path } of idx.dirs) {
    const trips = dir.trips?.[day]?.[hour] ?? 0;
    if (!(trips > 0)) continue;
    const tram = route.mode === TRAM;
    const isClosed = path.some(id => closed.has(id));
    const slower = new Set(tram ? [] : path.filter(id => !closed.has(id) && planT(id) - baseT(id) > SLOWER_S));
    if (!isClosed && !slower.size) continue;
    const ppt = tram ? P.tram : P.bus;
    const pax_h = trips * ppt;
    const links = [...new Set(path.filter(id => closed.has(id) || slower.has(id)))];
    const stops = [...new Set(dir.stops || [])].map(id => idx.stops.get(id)).filter(Boolean);
    const stopsOn = set => stops.filter(s => set.has(s.road_link)).map(s => ({ id: s.id, name: s.name }));
    let delay = null, diverted = false, blocked = false, detour_links = [], stops_skipped = [];
    if (tram) blocked = isClosed; // 走到这里的电车一定碰到了全封
    else {
      const trip = busTrip(path);
      if (!trip) blocked = true;
      else {
        delay = trip.t - path.reduce((s, id) => s + baseT(id), 0);
        diverted = isClosed;
        detour_links = trip.detour;
        const on = new Set(trip.detour);
        stops_skipped = stopsOn(new Set(trip.skipped.filter(id => !on.has(id))));
      }
    }
    routes.push({
      id: route.id, short: route.short, mode: route.mode, dir: dir.dir, headsign: dir.headsign,
      trips_h: trips, pax_per_trip: ppt, pax_h,
      delay_s: delay == null ? null : round1(delay),
      pax_min: delay == null ? null : round1((pax_h * delay) / 60),
      diverted, blocked, stops_closed: stopsOn(closed), links, detour_links, stops_skipped,
    });
  }
  routes.sort((a, b) => (b.blocked - a.blocked) || (a.blocked ? b.pax_h - a.pax_h : b.pax_min - a.pax_min)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.dir - b.dir));
  const tot = k => routes.reduce((s, r) => s + (r[k] ?? 0), 0);
  const blockedR = routes.filter(r => r.blocked);
  return {
    src: 'gtfs', day, hour, routes,
    trips_h: tot('trips_h'), pax_h: tot('pax_h'), pax_min: Math.round(tot('pax_min')),
    blocked_routes: blockedR.length, blocked_pax_h: blockedR.reduce((s, r) => s + r.pax_h, 0),
    assumed,
  };
}
