// cardkey.js —— 场景卡规范化 + 缓存键（浏览器、Worker、node 共用；只用 Web Crypto，不用 npm 包）
// 缓存键 = SHA-256(前缀 | 规范化后的场景卡)。规范化：文字大写、分钟取整、距离按 50 米一档、排队按 100 米一档、
// 车速按 5 km/h 一档、路线按 id 排序、标志按距离从远到近排序 —— 同一个场景换个写法也能命中缓存。
// 用法：await cardKey(card, 'p1|claude-opus-5-5|commuter') → 64 位十六进制串

const up = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const step = (x, d) => Math.round((Number(x) || 0) / d) * d;

export function normCard(card) {
  const c = card || {}, t = c.trip || {};
  const signs = (Array.isArray(c.signs) ? c.signs : []).map(s => {
    const o = { m: step(s.m, 50), kind: String(s.kind || ''), read_s: Math.round(Number(s.read_s) || 0) };
    if (Array.isArray(s.frames)) o.frames = s.frames.map(f => (Array.isArray(f) ? f.map(up) : []));
    if (s.text != null) o.text = up(s.text);
    return o;
  });
  signs.sort((a, b) => b.m - a.m || (canon(a) < canon(b) ? -1 : canon(a) > canon(b) ? 1 : 0));
  const routes = (Array.isArray(c.routes) ? c.routes : []).map(r => {
    const o = { id: String(r.id), name: up(r.name), usual_min: Math.round(Number(r.usual_min) || 0) };
    if (r.truck === false) o.truck = false;
    return o;
  });
  routes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    trip: { on: up(t.on), dir: up(t.dir), to: up(t.to), kmh: step(t.kmh, 5) },
    signs,
    routes,
    queue_m: step(c.queue_m, 100),
  };
}

// 键排好序的 JSON：同一个对象不管字段顺序怎么写，输出都一样
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  }
  return JSON.stringify(x ?? null);
}

export async function sha256Hex(str) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

export async function cardKey(card, prefix = '') {
  return sha256Hex(prefix + '|' + canon(normCard(card)));
}
