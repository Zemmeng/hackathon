// advisor.js —— 第 ⑦ 步的引擎这一半：把结果摘要交给规划顾问（askAdvisor，来自 api 模块），拿回最多 3 个改法，
// 每个改法都回到第 ⑤ 步用引擎重算一遍，给前端做前后对比。大模型出主意，引擎算数字。

import { loadNetwork, isNet } from './net.js';
import { shiftWorksite, windowWhens } from './worksite.js';
import { runScenario, windowDelay, conflictCost, memoAsk } from './pipeline.js';

const clone = x => JSON.parse(JSON.stringify(x));

export function advisorSummary(result, worksites, conflicts = []) {
  return {
    when: result.when,
    worksites: worksites.map(w => ({ id: w.id, name: w.name, links: w.links, closes: w.closes, time: w.time, equipment: w.equipment || [] })),
    approaches: result.approaches.map(a => ({
      worksite: a.worksite, street: a.street, dir: a.dir, queue_m: a.queue_m, delay_min: a.delay_min,
      routes: a.routes.map(r => ({ id: r.id, name: r.name, usual_min: r.usual_min, now_min: r.now_min, share: r.share, truck: r.truck, diverge_m: r.diverge_m })),
    })),
    conflicts,
  };
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
export async function advise({ network, flows, when, worksites, ask, askAdvisor, whens, hours }) {
  const net = isNet(network) ? network : loadNetwork(network);
  ask = memoAsk(ask);
  const before = await runScenario({ network: net, flows, when, worksites, ask });
  const W0 = whens || windowWhens(worksites, hours);
  const conflicts = [];
  for (let i = 0; i < worksites.length; i++) {
    for (let j = i + 1; j < worksites.length; j++) {
      const c = await conflictCost({ network: net, flows, a: worksites[i], b: worksites[j], ask, whens: W0 });
      if (c.overlap) conflicts.push({ a: worksites[i].id, b: worksites[j].id, cost_min: c.cost });
    }
  }
  const summary = advisorSummary(before, worksites, conflicts);
  const adv = await askAdvisor(summary);
  const sugg = (adv.suggestions || []).slice(0, 3).map(s => ({ s, next: applySuggestion(worksites, s) }));
  const W = whens || windowWhens([worksites, ...sugg.map(x => x.next || [])].flat(), hours);
  const beforeW = await windowDelay({ network: net, flows, worksites, whens: W, ask });
  const options = [];
  for (const { s, next } of sugg) {
    if (!next) { options.push({ suggestion: s, skipped: 'no_such_worksite_or_equipment' }); continue; }
    const afterW = await windowDelay({ network: net, flows, worksites: next, whens: W, ask });
    const after = await runScenario({ network: net, flows, when, worksites: next, ask });
    const delta = afterW.delay_min - beforeW.delay_min;
    // better：引擎重算后真的变好才算；大模型 / 规则的主意变差了照样列出来，界面标「不建议」
    options.push({ suggestion: s, worksites: next, delay_min: afterW.delay_min, delta_min: delta, better: delta < 0, result: after });
  }
  return { src: adv.src, ...(adv.fallback ? { fallback: adv.fallback } : {}), summary, whens: W.length, truncated: Boolean(W.truncated),
    before: { delay_min: beforeW.delay_min, result: before }, options };
}
