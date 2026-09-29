// advisor.js —— 第 ⑦ 步的引擎这一半：把结果摘要交给规划顾问（askAdvisor，来自 api 模块），拿回最多 3 个改法，
// 每个改法都回到第 ⑤ 步用引擎重算一遍，给前端做前后对比。大模型出主意，引擎算数字。

import { loadNetwork, isNet } from './net.js';
import { shiftWorksite, windowWhens } from './worksite.js';
import { runScenario, windowDelay, conflictCost } from './pipeline.js';

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

// whens：比较用的时段（默认 = 全部施工日期 × 早晚高峰）；错开日期的改法只有看整段时间才看得出好处
export async function advise({ network, flows, when, worksites, ask, askAdvisor, whens, hours = [8, 17] }) {
  const net = isNet(network) ? network : loadNetwork(network);
  const W = whens || windowWhens(worksites, hours);
  const before = await runScenario({ network: net, flows, when, worksites, ask });
  const conflicts = [];
  for (let i = 0; i < worksites.length; i++) {
    for (let j = i + 1; j < worksites.length; j++) {
      const c = await conflictCost({ network: net, flows, a: worksites[i], b: worksites[j], ask, whens: W });
      if (c.overlap) conflicts.push({ a: worksites[i].id, b: worksites[j].id, cost_min: c.cost });
    }
  }
  const summary = advisorSummary(before, worksites, conflicts);
  const adv = await askAdvisor(summary);
  const beforeW = await windowDelay({ network: net, flows, worksites, whens: W, ask });
  const options = [];
  for (const s of (adv.suggestions || []).slice(0, 3)) {
    const next = applySuggestion(worksites, s);
    if (!next) { options.push({ suggestion: s, skipped: 'no_such_worksite_or_equipment' }); continue; }
    const afterW = await windowDelay({ network: net, flows, worksites: next, whens: W, ask });
    const after = await runScenario({ network: net, flows, when, worksites: next, ask });
    options.push({ suggestion: s, worksites: next, delay_min: afterW.delay_min, delta_min: afterW.delay_min - beforeW.delay_min, result: after });
  }
  return { src: adv.src, summary, whens: W.length, before: { delay_min: beforeW.delay_min, result: before }, options };
}
