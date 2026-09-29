// worksite.js —— 施工方案：什么时候生效、把哪些路段的通行能力降多少、挪日期。纯函数。
// 施工方案的格式见 docs/contract.md「施工方案」：
//   { id, name?, links: [路段 id，按行车方向], closes: { lanes }, time: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', hours: [开始, 结束) },
//     equipment: [{ id, type: 'vms'|'sign'|'arrow'|'barrier', at_m: 离施工起点多少米, dir?, frames?, text?, char_mm? }] }
// when = { date: 'YYYY-MM-DD', hour: 0–23, day?: 'wd'|'we' }（day 不给就按日期算周几）

export const WZ_FRICTION = 0.9; // 施工区旁边的车道也会变慢：剩下车道的通行能力再打 9 折（工程假设）

const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const fmt = n => new Date(n * 86400000).toISOString().slice(0, 10);

export function dayType(when) {
  if (when.day === 'wd' || when.day === 'we') return when.day;
  const dow = new Date(dayNum(when.date) * 86400000).getUTCDay();
  return dow === 0 || dow === 6 ? 'we' : 'wd';
}

export function isActive(ws, when) {
  const t = ws.time;
  if (!t) return true;
  if (when.date < t.from || when.date > t.to) return false;
  const [h0, h1] = t.hours || [0, 24];
  return when.hour >= h0 && when.hour < h1;
}

export function overlaps(a, b) {
  const ta = a.time, tb = b.time;
  if (!ta || !tb) return true;
  const [a0, a1] = ta.hours || [0, 24], [b0, b1] = tb.hours || [0, 24];
  return ta.from <= tb.to && tb.from <= ta.to && a0 < b1 && b0 < a1;
}

// 生效中的施工 → 每个路段 { f: 通行能力系数（0 = 全封）, open: 还开着几条车道 }
export function capFactors(net, worksites) {
  const closed = new Map();
  for (const ws of worksites) {
    for (const id of ws.links || []) closed.set(id, (closed.get(id) || 0) + (ws.closes?.lanes ?? 0));
  }
  const f = new Map();
  for (const [id, n] of closed) {
    const l = net.links.get(id);
    if (!l) continue;
    const open = Math.max(0, l.lanes - n);
    f.set(id, { f: open <= 0 ? 0 : n > 0 ? (open / l.lanes) * WZ_FRICTION : 1, open });
  }
  return f;
}

export function shiftWorksite(ws, days) {
  const t = ws.time;
  return { ...ws, time: { ...t, from: fmt(dayNum(t.from) + days), to: fmt(dayNum(t.to) + days) } };
}

// 两个施工日期范围的并集里，每天 × 给定小时 → when 列表（算叠加、错开对比用）
export function windowWhens(worksites, hours = [8, 17]) {
  const ts = worksites.map(w => w.time).filter(Boolean);
  if (!ts.length) return [];
  const d0 = Math.min(...ts.map(t => dayNum(t.from))), d1 = Math.max(...ts.map(t => dayNum(t.to)));
  const out = [];
  for (let d = d0; d <= d1 && out.length < 400; d++) for (const hour of hours) out.push({ date: fmt(d), hour });
  return out;
}
