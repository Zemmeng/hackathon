// advisor.js —— 第 ⑦ 步的引擎这一半：把结果摘要交给规划顾问（askAdvisor，注入进来；大模型版谁做待定），拿回最多 3 个改法，
// 每个改法都回到第 ⑤ 步用引擎重算，给前端做前后对比。大模型出主意，引擎算数字。
// 用法：const res = await advise(engine, 方案, { askAdvisor: mockAdvise });

import { shiftWorksite, windowWhens } from './worksite.js';

const clone = x => JSON.parse(JSON.stringify(x));
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function advisorSummary(result, worksites, conflicts = []) {
  return {
    when: result.when,
    worksites: worksites.map(w => ({ id: w.id, name: w.name, links: w.links, closes: w.closes, time: w.time, equipment: w.equipment || [] })),
    approaches: result.approaches.map(a => ({
      worksite: a.worksite, street: a.street, dir: a.dir, queue_m: a.queue_m, delay_min: a.delay_min,
      routes: a.routes.map(r => ({ id: r.id, name: r.name, usual_min: r.usual_min, now_min: r.now_min, share: r.share, truck: r.truck, turn_m: r.turn_m })),
    })),
    conflicts,
  };
}

// 一条建议合不合格：改字（屏上文字）/ 挪设备（at_m 0–2000）/ 错开日期（整天数，≤ 60）
export function checkSuggestion(s) {
  if (!s || typeof s !== 'object' || !ID_RE.test(String(s.worksite))) return false;
  if (s.kind === 'text') return Array.isArray(s.frames) && s.frames.length >= 1 && s.frames.length <= 2 && s.frames.every(f => Array.isArray(f) && f.length >= 1 && f.length <= 4 && f.every(l => typeof l === 'string' && /^[A-Z0-9 .,'&/:+-]{1,10}$/.test(l)))
    && (s.equipment === null || ID_RE.test(String(s.equipment)));
  if (s.kind === 'move') return ID_RE.test(String(s.equipment)) && Number.isFinite(s.at_m) && s.at_m >= 0 && s.at_m <= 2000;
  if (s.kind === 'shift') return Number.isInteger(s.days) && s.days !== 0 && Math.abs(s.days) <= 60;
  return false;
}

// 一条建议 → 新的施工方案列表；建议对不上（施工 / 设备不存在）回 null
export function applySuggestion(worksites, s) {
  const list = clone(worksites);
  const ws = list.find(w => w.id === s.worksite);
  if (!ws) return null;
  if (s.kind === 'shift') {
    if (!ws.time) return null; // 没有时段的施工谈不上错开
    const i = list.indexOf(ws);
    list[i] = shiftWorksite(ws, s.days);
    return list;
  }
  ws.equipment = ws.equipment || [];
  if (s.kind === 'text') {
    if (s.equipment == null) {
      ws.equipment.push({ id: 'vms-new', type: 'vms', at_m: Number.isFinite(s.at_m) ? s.at_m : 300, frames: s.frames });
      return list;
    }
    const e = ws.equipment.find(x => x.id === s.equipment && x.type === 'vms');
    if (!e) return null;
    e.frames = s.frames;
    return list;
  }
  if (s.kind === 'move') {
    const e = ws.equipment.find(x => x.id === s.equipment);
    if (!e) return null;
    e.at_m = s.at_m;
    return list;
  }
  return null;
}

// whens：比较用的时段（默认 = 改前改后所有施工从最早开工到最晚完工的每一天 × 各施工时段里的采样小时）。
// 改前、改后用同一段时间比：错开日期的改法要把挪出去的那几天也算进来，不然好处会被高估
export async function advise(engine, plan, { askAdvisor, whens, hours } = {}) {
  const { when, worksites } = plan;
  const W0 = whens || windowWhens(worksites, hours);
  await engine.prepare(plan, { whens: W0 });
  const before = engine.evaluate(plan);
  const conflicts = [];
  for (let i = 0; i < worksites.length; i++) {
    for (let j = i + 1; j < worksites.length; j++) {
      const c = engine.conflict(worksites[i], worksites[j], { whens: W0 });
      if (c.overlap) conflicts.push({ a: worksites[i].id, b: worksites[j].id, cost_min: c.cost });
    }
  }
  const summary = advisorSummary(before, worksites, conflicts);
  const adv = await askAdvisor(summary);
  const sugg = (adv?.suggestions || []).filter(checkSuggestion).slice(0, 3).map(s => ({ s, next: applySuggestion(worksites, s) }));
  const W = whens || windowWhens([worksites, ...sugg.map(x => x.next || [])].flat(), hours);
  for (const { next } of sugg) if (next) await engine.prepare({ when, worksites: next }, { whens: W });
  await engine.prepare(plan, { whens: W });
  const beforeW = engine.window(worksites, W);
  const options = sugg.map(({ s, next }) => {
    if (!next) return { suggestion: s, skipped: 'no_such_worksite_or_equipment' };
    const afterW = engine.window(next, W);
    const delta = afterW.delay_min - beforeW.delay_min;
    // better：引擎重算后真的变好才算；主意变差了照样列出来，界面标「不建议」
    return { suggestion: s, worksites: next, delay_min: afterW.delay_min, delta_min: delta, better: delta < 0, result: engine.evaluate({ when, worksites: next }) };
  });
  return { src: adv?.src || 'unknown', summary, whens: W.length, truncated: Boolean(W.truncated), before: { delay_min: beforeW.delay_min, result: before }, options };
}

// ---------- MOCK 顾问：大模型版到之前演示和测试用（规则：点名最快的绕行 · 屏摆在拐口之后就往前挪 · 叠加就错开）----------
const up = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
function shortName(name) {
  let s = up(name).replace(/[^A-Z0-9 .,'&/:+-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= 10) return s;
  s = s.replace(/\s+(STREET|ST|ROAD|RD|AVENUE|AVE|LANE|LN|PARADE|PDE)$/, '');
  return s.length <= 10 ? s : s.split(' ')[0].slice(0, 10);
}
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;

export async function mockAdvise(summary) {
  const out = [];
  const wsById = new Map((summary.worksites || []).map(w => [w.id, w]));
  const aps = [...(summary.approaches || [])].sort((a, b) => (b.delay_min || 0) - (a.delay_min || 0));
  const pick = ap => {
    const alts = (ap.routes || []).filter(r => r.id !== 'stay' && Number.isFinite(r.now_min));
    return alts.length ? alts.reduce((a, b) => (b.now_min < a.now_min || (b.now_min === a.now_min && (b.turn_m ?? 0) < (a.turn_m ?? 0)) ? b : a)) : null;
  };
  const vmsOf = (ws, ap) => (ws.equipment || []).find(e => e.type === 'vms' && (!e.dir || e.dir === ap.dir));
  for (const ap of aps) { // 1 改字：绕行现在确实更快才劝人绕
    const ws = wsById.get(ap.worksite), best = pick(ap), stay = (ap.routes || []).find(r => r.id === 'stay');
    if (!ws || !best || !stay) continue;
    const save = Math.round(stay.now_min - best.now_min);
    if (!(save >= 1)) continue;
    // 两帧、每帧 ≤ 3 行、每行 ≤ 8 字符（路名除外），过 T5 checkSigns 的软警告：原来一帧「SAVE 9 MIN」一行 10 个字符、省 10 分钟以上拆成 4 行，顾问自己的建议被自己的检查警告
    const frames = [['USE', shortName(best.name)], ['SAVE', `${Math.min(save, 99)} MIN`]];
    const vms = vmsOf(ws, ap);
    if (vms && up(vms.frames?.flat().join(' ')) === up(frames.flat().join(' '))) continue;
    out.push({ kind: 'text', worksite: ws.id, equipment: vms ? vms.id : null, frames, ...(vms ? {} : { at_m: Math.min(2000, Math.round(((best.turn_m || 0) + 100) / 50) * 50) }),
      why: `Name the fastest detour (${best.name}) and the ${save} min it saves.` });
    break;
  }
  for (const ap of aps) { // 2 挪设备：屏在推荐路线的拐口之后
    const ws = wsById.get(ap.worksite), best = pick(ap), vms = ws && vmsOf(ws, ap);
    if (!vms || !best || !(vms.at_m < (best.turn_m || 0))) continue;
    out.push({ kind: 'move', worksite: ws.id, equipment: vms.id, at_m: Math.min(2000, Math.round(((best.turn_m || 0) + 100) / 50) * 50),
      why: `The sign is ${vms.at_m} m before the works but the turn into ${best.name} is ${best.turn_m} m before; drivers see it too late.` });
    break;
  }
  for (const c of summary.conflicts || []) { // 3 错开日期
    const a = wsById.get(c.a), b = wsById.get(c.b);
    if (!(c.cost_min > 0) || !a?.time?.to || !b?.time?.from) continue;
    const days = dayNum(a.time.to) - dayNum(b.time.from) + 1;
    if (!(days > 0 && days <= 60)) continue;
    out.push({ kind: 'shift', worksite: b.id, days, why: `Overlaps ${a.id}; starting the day after it ends removes about ${Math.round(c.cost_min)} extra vehicle-minutes.` });
    break;
  }
  return { src: 'rule', suggestions: out.slice(0, 3) };
}
