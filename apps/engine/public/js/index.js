// index.js —— 引擎对外的全部接口（前端 T2 只 import 这个文件）。用法和结果格式见 docs/contract.md §evaluate。
//   const engine = createEngine({ network, flows, readSigns, params: await loadParams() });   // readSigns 来自 T5（apps/api/public/js/reader.js）；没好之前用 mockReadSigns；params 读不到就用假设值
//   await engine.prepare(方案);  const 结果 = engine.evaluate(方案);
export { createEngine, MSA_ITERS, OCCUPANCY } from './pipeline.js';
export { advise, mockAdvise, advisorSummary, applySuggestion, checkSuggestion } from './advisor.js';
export { mockReadSigns, requestsFor, signsOn } from './reading.js';
export { TYPES, MIX, PERSONAS, chooseShares, informed } from './choice.js';
export { calibrate, anchorRequest, ANCHORS, REF } from './calibrate.js';
export { loadParams, applyParams, PARAMS_URL } from './params.js';
export { makeGrid } from './grid.js';
export { loadNetwork, shortestPath, dijkstra, treePath, linkTime, bearing } from './net.js';
export { isActive, overlaps, capFactors, shiftWorksite, windowWhens, sampleHours, dayType, FOOTPATH_SIDES, footpathOf, validateWorksite, validatePlan } from './worksite.js';
export { pedImpact, pedsUnavailable, plannedFootpath, WALK_MPS, CLOSABLE_KINDS, OPPOSITE_M, SENSOR_NEAR_M } from './peds.js';
export { approaches, affected, NO_DETOUR } from './routes.js';
export { readSeconds, cleanName } from './cards.js';
export { transitImpact, paxPerTrip, isTransit, routePaths, PAX_PER_TRIP, PAX_RANGE } from './transit.js';
