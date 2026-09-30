// options.js —— T22（D-0929-2011 ③）：按 RPM Hire 库存（apps/roads 的 equipment.json）给一处施工配 3 套交通管理方案、算租金。纯函数。
// 这里只管「摆什么设备、摆几件、摆在哪、多少钱、库存够不够」；每套方案的排队、延误由 backend.js 的 be.options() 交给引擎算（D-0929-1310：引擎算数字）。
// 🔒 库存件数和日租价是假设值（equipment.json 每条的 assumed、sources 写明官网没有公开价格）→ hire.assumed 恒为 true（D-0929-1536）
// 🔒 不超库存：方案里每种设备的件数（加上同一份方案里时间重叠的其他施工已经带走的）≤ 库存；不够的写进 short，不硬塞
// 设备条目带 item（equipment.json 的 id）和 qty（件数），和 docs/contract.md 的 equipment[].item / qty 同口径，api 的 pack.js 能按同一份方案报价
import { footpathOf, overlaps } from './worksite.js';
import { signsOn } from './reading.js';

// 三档：最省 = 护栏 + 静态标志；标准 = 再加箭头板 + 一块写「前方施工」的 VMS；引导 = 同一块 VMS 点名引擎算出的最快绕行
export const TIERS = [
  { id: 'o1', label: 'Minimum', label_zh: '最省', vms: false, arrow: false, guided: false },
  { id: 'o2', label: 'Standard', label_zh: '标准', vms: true, arrow: true, guided: false },
  { id: 'o3', label: 'Guided', label_zh: '引导绕行', vms: true, arrow: true, guided: true },
];
export const WARN_FRAME = ['ROADWORK', 'AHEAD'];
export const VMS_AT_M = 300; // 找不到更快的绕行时 VMS 摆在上游 300 米（和 backend.js 的演示方案一样）
export const AT_M = { ahead: 200, lane: 100, arrow: 60 }; // 静态标志 / 箭头板离施工起点多少米（工程假设，和演示方案同位置）
export const BARRIER_PREF = ['barrier_water', 'barrier_klemmfix', 'barrier_steel']; // 先用水马（官网：50 km/h 以下道路合适、对行人友好）
export const VMS_PREF = ['vms_a', 'vms_c'];
export const HIRE_NOTE = 'Stock and day rates are assumed values (RPM Hire publishes no prices); confirm with an RPM Hire quote.';

const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const okDate = s => DATE_RE.test(String(s)) && new Date(dayNum(s) * 86400000).toISOString().slice(0, 10) === s;
// time 写错会让租金悄悄按 1 天算、施工在 when 那个小时不生效 → be.options() 先拿它挡，抛 bad_plan
export function timeErrors(time, who = '施工') {
  if (time == null) return [];
  if (typeof time !== 'object' || Array.isArray(time)) return [`${who}：time 要是 { from, to, hours? } 对象`];
  const errs = [];
  if (!okDate(time.from) || !okDate(time.to)) errs.push(`${who}：time.from / to 要是真实日期 YYYY-MM-DD（现在是 ${JSON.stringify(time.from)} / ${JSON.stringify(time.to)}）`);
  else if (time.from > time.to) errs.push(`${who}：time.from ${time.from} 晚于 time.to ${time.to}`);
  const h = time.hours;
  if (h != null && !(Array.isArray(h) && h.length === 2 && h.every(Number.isFinite) && h[0] >= 0 && h[1] <= 24 && h[0] < h[1])) {
    errs.push(`${who}：time.hours 要是 [开始, 结束)，0 ≤ 开始 < 结束 ≤ 24（现在是 ${JSON.stringify(h)}）`);
  }
  return errs;
}
export function whenErrors(when) {
  const ok = when && typeof when === 'object' && okDate(when.date) && Number.isInteger(when.hour) && when.hour >= 0 && when.hour <= 23;
  return ok ? [] : [`when 要是 { date: 'YYYY-MM-DD', hour: 0–23 }（现在是 ${JSON.stringify(when ?? null)}）`];
}

// 租几天 = time.from 到 time.to 的日历天数（含两头）；没写日期按 1 天算（flags.no_time 标出来）。日期写错的输入 be.options() 已经用 timeErrors 挡掉
export function daysOf(time) {
  if (!time || !DATE_RE.test(String(time.from)) || !DATE_RE.test(String(time.to))) return 1;
  return Math.max(1, dayNum(time.to) - dayNum(time.from) + 1);
}

// 施工路段 → 封闭长度（各路段 len_m 相加）、最少几条车道、是不是全封、封哪侧人行道
export function siteOf(net, ws) {
  let len = 0, lanes = Infinity;
  const missing = [];
  for (const id of ws.links || []) {
    const l = net?.links?.get(id);
    if (!l) { missing.push(id); continue; }
    len += Number(l.len_m) || 0;
    lanes = Math.min(lanes, Number(l.lanes) || 0);
  }
  const close = Number(ws.closes?.lanes) || 0;
  return {
    len_m: Math.round(len), lanes: Number.isFinite(lanes) ? lanes : null, close_lanes: close,
    full: Number.isFinite(lanes) && close > 0 && close >= lanes, footpath: footpathOf(ws), missing,
  };
}

// 封的是哪一侧车道：原方案标志牌上写了 LEFT LANE CLOSED 就是左，否则按演示方案的右
export function laneSide(ws) {
  return (ws.equipment || []).some(e => /LEFT LANE CLOSED/i.test(String(e.text || ''))) ? 'left' : 'right';
}

// VMS 屏上文字规范（和 api 的 signs.js / advisor 的 checkSuggestion 同口径）：≤ 2 帧 × ≤ 4 行 × ≤ 10 字符、合计 ≤ 8 个词、大写
const LINE_RE = /^[A-Z0-9 .,'&/:+-]{1,10}$/;
export function vmsTextOk(frames) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 2) return false;
  const lines = frames.every(f => Array.isArray(f) && f.length >= 1 && f.length <= 4 && f.every(l => typeof l === 'string' && LINE_RE.test(l) && l.trim() === l));
  return lines && frames.flat().join(' ').split(/\s+/).filter(Boolean).length <= 8;
}

// 顾问规则给的引导帧（如 USE / RUSSELL ▸ SAVE / 9 MIN）→ VMS 上的帧。顾问给了两帧就原样用：屏最多两帧，「前方施工」由 S-1 静态牌说；
// 只给一帧（旧写法，也可以直接传一帧）就在前面加「前方施工」，超 8 个词就只留引导帧
export function guidedFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return null;
  const fs = Array.isArray(frames[0]) ? frames : [frames];
  if (fs.length > 1) return vmsTextOk(fs) ? fs.map(f => [...f]) : null;
  const two = [[...WARN_FRAME], [...fs[0]]];
  if (vmsTextOk(two)) return two;
  return vmsTextOk([[...fs[0]]]) ? [[...fs[0]]] : null;
}

// 一档 → 要摆的东西（还没对库存）：{ id, type, at_m, text? | frames?, items: [按优先顺序的库存 id], close?, len_m? | qty? }
export function tierNeeds(tier, ws, site, { vmsAt = VMS_AT_M, frames = [WARN_FRAME] } = {}) {
  const out = [];
  const lanes = site.close_lanes > 0;
  const sides = site.footpath === 'both' ? ['L', 'R'] : site.footpath === 'left' ? ['L'] : site.footpath === 'right' ? ['R'] : [];
  if (lanes) out.push({ id: 'B-1', type: 'barrier', at_m: 0, items: BARRIER_PREF, close: 'lane', len_m: site.len_m });
  for (const s of sides) out.push({ id: `B-F${s}`, type: 'barrier', at_m: 0, items: BARRIER_PREF, close: 'footpath', len_m: site.len_m });
  out.push({ id: 'S-1', type: 'sign', at_m: AT_M.ahead, text: 'ROADWORK AHEAD', items: ['sign_roadwork_ahead'] });
  if (lanes) {
    const side = laneSide(ws);
    out.push(site.full
      ? { id: 'S-2', type: 'sign', at_m: AT_M.lane, text: 'DETOUR AHEAD', items: ['sign_detour_straight'] }
      : { id: 'S-2', type: 'sign', at_m: AT_M.lane, text: `${side.toUpperCase()} LANE CLOSED`, items: [`sign_lane_closed_${side}`] });
  }
  for (const s of sides) out.push({ id: `S-F${s}`, type: 'sign', at_m: 0, text: 'FOOTPATH CLOSED', items: ['sign_footpath_closed'] });
  // 「施工结束」摆在施工段末端（at_m 为负 = 施工起点下游）：清单完整、要付租金；reading.js 的 signsOn() 只收 at_m ≥ 0 的牌，
  // 所以它不进读数请求、不占 T5 一次最多读 6 块的名额（上游最多 6 块：S-1、S-2、S-FL、S-FR、A-1、VMS-1）
  out.push({ id: 'S-9', type: 'sign', at_m: -Math.max(1, site.len_m), text: 'END ROADWORK', items: ['sign_end_roadwork'] });
  if (tier.arrow && lanes && !site.full) out.push({ id: 'A-1', type: 'arrow', at_m: AT_M.arrow, items: ['arrow_board'] });
  if (tier.vms) out.push({ id: 'VMS-1', type: 'vms', at_m: vmsAt, frames: frames.map(f => [...f]), items: VMS_PREF });
  return out;
}

// 同一批施工已经带走的设备件数（item → 件数）：库存是共用的，配这一处之前先扣掉时间重叠的其他施工
export function usageOf(worksites) {
  const m = new Map();
  for (const w of worksites || []) for (const e of w.equipment || []) if (e.item) m.set(e.item, (m.get(e.item) || 0) + (Number(e.qty) || 1));
  return m;
}
export const sharingWith = (worksites, ws) => (worksites || []).filter(w => w !== ws && overlaps(w, ws));

// VMS 会不会进读数请求：signsOn() 只把离施工最近的 6 块牌交给 T5，VMS 被挤掉就等于没摆（引导档悄悄变成和标准档一样）
export function vmsRead(equipment) {
  const seen = signsOn({ dir: null, kmh: 40 }, { equipment });
  return (equipment || []).filter(e => e.type === 'vms').every(v => seen.some(x => x.kind === 'vms' && x.m === (Number(v.at_m) || 0)));
}

// 对库存：每件按优先顺序挑第一个「剩下的库存够」的条目；都不够就用首选条目、只摆剩下那么多（0 件就不摆），缺口记进 short。
// 护栏件数 = ⌈封闭长度 ÷ 每节长度 unit_len_m⌉；封人行道只用 can_close 里有 footpath 的护栏。
// 先配可选条目少的（人行道只能用水马）：免得车道护栏先把水马拿光、人行道报缺而塑料隔板闲着；输出仍按 needs 的顺序。
// used0 = 别的施工已经占掉的件数（usageOf），从库存里先扣
export function resolveNeeds(needs, inventory, used0) {
  const inv = new Map((inventory?.items || []).map(i => [i.id, i]));
  const used = new Map(used0 || []);
  const eqAt = [], shortAt = [];
  const slots = needs.map((n, i) => ({ n, i, cands: n.items.map(id => inv.get(id)).filter(it => it && (!n.close || (it.can_close || []).includes(n.close))) }));
  for (const { n, i, cands } of [...slots].sort((a, b) => a.cands.length - b.cands.length || a.i - b.i)) {
    const want = it => (n.len_m != null ? Math.max(1, Math.ceil(n.len_m / (Number(it.unit_len_m) || 1))) : n.qty || 1);
    const left = it => Math.max(0, Math.floor(Number(it.qty) || 0) - (used.get(it.id) || 0));
    let it = cands.find(c => left(c) >= want(c));
    let qty = it ? want(it) : 0;
    if (!it) {
      it = cands[0];
      if (!it) { shortAt[i] = { equipment: n.id, item: n.items[0] ?? null, need: n.qty || 1, got: 0, stock: 0, why: 'not_in_inventory' }; continue; }
      qty = left(it);
      shortAt[i] = { equipment: n.id, item: it.id, need: want(it), got: qty, stock: Math.floor(Number(it.qty) || 0), why: 'over_stock' };
      if (!qty) continue;
    }
    used.set(it.id, (used.get(it.id) || 0) + qty);
    const { items, close, len_m, qty: _q, ...rest } = n;
    eqAt[i] = { ...rest, item: it.id, qty };
  }
  return { equipment: eqAt.filter(Boolean), short: shortAt.filter(Boolean) };
}

// 方案里的设备 → 租金明细（按首次出现的顺序，一种设备一行）：件数 × 日租价 × 天数。价钱、库存都是假设值
export function hireOf(equipment, inventory, days) {
  const inv = new Map((inventory?.items || []).map(i => [i.id, i]));
  const rows = new Map();
  for (const e of equipment) {
    if (!e.item) continue;
    const it = inv.get(e.item);
    const r = rows.get(e.item) || { item: e.item, name: it?.name ?? null, qty: 0, day_rate_aud: typeof it?.day_rate_aud === 'number' ? it.day_rate_aud : null, days };
    r.qty += Number(e.qty) || 1;
    rows.set(e.item, r);
  }
  const lines = [...rows.values()].map(r => ({ ...r, cost_aud: r.day_rate_aud == null ? null : r.qty * r.day_rate_aud * days }));
  const known = lines.filter(l => l.cost_aud != null);
  return {
    lines, days,
    per_day_aud: known.reduce((s, l) => s + l.qty * l.day_rate_aud, 0),
    total_aud: known.reduce((s, l) => s + l.cost_aud, 0),
    unpriced: lines.filter(l => l.cost_aud == null).map(l => l.item),
    assumed: true,
    note: HIRE_NOTE,
  };
}

// 方案用的件数 vs 库存：这一处的件数 + 时间重叠的其他施工已经带走的（used0）≤ 库存
export function stockOf(equipment, inventory, short = [], used0) {
  const inv = new Map((inventory?.items || []).map(i => [i.id, i]));
  const need = new Map();
  for (const e of equipment) if (e.item) need.set(e.item, (need.get(e.item) || 0) + (Number(e.qty) || 1));
  const tot = id => need.get(id) + ((used0 && used0.get(id)) || 0);
  const over = [...need.keys()].filter(id => tot(id) > (Number(inv.get(id)?.qty) || 0)).map(item => ({ item, need: tot(item), stock: Number(inv.get(item)?.qty) || 0 }));
  return { ok: !short.length && !over.length, short: [...short, ...over.map(o => ({ equipment: null, item: o.item, need: o.need, got: o.need, stock: o.stock, why: 'over_stock' }))] };
}
