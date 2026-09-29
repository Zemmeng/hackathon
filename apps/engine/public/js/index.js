// index.js —— 引擎对外的全部接口（前端 T2 只 import 这个文件）。格式见 docs/contract.md「引擎」一节。
export { makeGrid } from './grid.js';
export { loadNetwork, shortestPath, linkTime, bearing } from './net.js';
export { isActive, overlaps, capFactors, shiftWorksite, windowWhens, dayType } from './worksite.js';
export { approaches, affected } from './routes.js';
export { buildCard, readSeconds } from './cards.js';
export { calibrate, makeAnchors, anchorsFor, anchorCard, REF_CARD, ANCHORS } from './calibrate.js';
export { evaluate } from './assign.js';
export { runScenario, windowDelay, conflictCost, MAX_ROUNDS } from './pipeline.js';
export { advise, advisorSummary, applySuggestion } from './advisor.js';
