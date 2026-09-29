// net.js —— 路网索引、最短路、路段通行时间（BPR + 确定性排队）。纯函数，浏览器和 node 都能直接 import。
// 用法：const net = loadNetwork(network); shortestPath(net, 'n0_8', 'n0_3', { banned });

export const BPR = { alpha: 0.15, beta: 4 }; // 美国公路局（BPR）容量函数的常用参数
export const PERIOD_S = 3600; // 按一小时算
export const VEH_GAP_M = 7; // 排队时每辆车占的长度（车长 + 间距）

export function loadNetwork(network) {
  if (!network || !Array.isArray(network.nodes) || !Array.isArray(network.links)) throw new Error('network 要有 nodes[] 和 links[]');
  const nodes = new Map(network.nodes.map(n => [n.id, n]));
  const links = new Map();
  const out = new Map(), inn = new Map();
  for (const l of network.links) {
    for (const k of ['id', 'from', 'to', 'name', 'len_m', 'lanes', 'speed_kmh', 'cap_vph', 't0_s']) {
      if (l[k] == null) throw new Error(`路段 ${l.id ?? '?'} 缺字段 ${k}`);
    }
    if (!nodes.has(l.from) || !nodes.has(l.to)) throw new Error(`路段 ${l.id} 的端点不在 nodes 里`);
    links.set(l.id, l);
    if (!out.has(l.from)) out.set(l.from, []);
    out.get(l.from).push(l);
    if (!inn.has(l.to)) inn.set(l.to, []);
    inn.get(l.to).push(l);
  }
  for (const m of [out, inn]) for (const arr of m.values()) arr.sort((a, b) => (a.id < b.id ? -1 : 1)); // 遍历顺序固定 → 结果确定
  return { nodes, links, out, inn, raw: network };
}

export function isNet(x) {
  return x && x.links instanceof Map && x.out instanceof Map;
}

// 路段方向：N / E / S / W（按经纬度算方位角）
export function bearing(net, link) {
  const a = net.nodes.get(link.from), b = net.nodes.get(link.to);
  const dy = b.lat - a.lat, dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return ['N', 'E', 'S', 'W'][Math.round(deg / 90) % 4];
}

// 两条路段的朝向夹角余弦（判断「同一条街往前接着走」）
export function headingDot(net, a, b) {
  const v = l => {
    const p = net.nodes.get(l.from), q = net.nodes.get(l.to);
    const x = (q.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180), y = q.lat - p.lat, n = Math.hypot(x, y) || 1;
    return [x / n, y / n];
  };
  const [ax, ay] = v(a), [bx, by] = v(b);
  return ax * bx + ay * by;
}

// 确定性排队：一小时里到达 v、放行 c，排队线性变长。平均每辆车多等 (v−c)·T/(2v) 秒
export function queueDelayS(v, c, T = PERIOD_S) {
  return v > c && v > 0 ? ((v - c) * T) / (2 * v) : 0;
}
export function queueVeh(v, c, T = PERIOD_S) {
  return v > c ? ((v - c) * T) / 3600 : 0;
}

// 路段通行时间（秒）：没饱和用 BPR；超过通行能力的部分按确定性排队加时间
export function linkTime(t0, v, c) {
  if (!(c > 0)) return v > 0 ? Infinity : t0;
  const x = v / c;
  return t0 * (1 + BPR.alpha * Math.pow(Math.min(x, 1), BPR.beta)) + queueDelayS(v, c);
}

// 小顶堆（按 [cost, 次序] 比较，同价时先进先出 → 结果确定）
class Heap {
  constructor() { this.a = []; this.n = 0; }
  push(cost, item) { this.a.push([cost, this.n++, item]); this.up(this.a.length - 1); }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; this.down(0); }
    return top;
  }
  get size() { return this.a.length; }
  less(i, j) { const x = this.a[i], y = this.a[j]; return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  up(i) { while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; [this.a[i], this.a[p]] = [this.a[p], this.a[i]]; i = p; } }
  down(i) {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.a.length && this.less(l, m)) m = l;
      if (r < this.a.length && this.less(r, m)) m = r;
      if (m === i) break;
      [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
      i = m;
    }
  }
}

// Dijkstra。cost(link) 默认 t0_s；banned = 不许走的路段 id 集合；bannedNodes = 不许经过的节点
export function shortestPath(net, from, to, { cost = l => l.t0_s, banned = new Set(), bannedNodes = new Set(), linkOk = () => true } = {}) {
  if (from === to) return { links: [], cost: 0 };
  const dist = new Map([[from, 0]]), prev = new Map();
  const h = new Heap();
  h.push(0, from);
  while (h.size) {
    const [d, , u] = h.pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u === to) break;
    for (const l of net.out.get(u) || []) {
      if (banned.has(l.id) || (bannedNodes.has(l.to) && l.to !== to) || !linkOk(l)) continue;
      const c = cost(l);
      if (!Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd < (dist.get(l.to) ?? Infinity)) { dist.set(l.to, nd); prev.set(l.to, l); h.push(nd, l.to); }
    }
  }
  if (!dist.has(to)) return null;
  const links = [];
  for (let n = to; n !== from; ) { const l = prev.get(n); links.push(l.id); n = l.from; }
  links.reverse();
  return { links, cost: dist.get(to) };
}

export function pathTime(net, ids, time = l => l.t0_s) {
  let s = 0;
  for (const id of ids) s += time(net.links.get(id));
  return s;
}
