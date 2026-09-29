// rules.js —— 关键词规则兜底（第 ③ 步和第 ⑦ 步的「估算」版）：MOCK、大模型挂了、超时、当天额度用完时用，界面标「估算」。
// 只认关键词，读不懂意思 —— 这正是演示里「为什么非要大模型」的对照（docs/arch/5-llm-api-detail.pdf 第 2 页）：
//   屏上有「USE / VIA + 路名」→ 那条路的比例提高；再有「SAVE N MIN」→ 再提高；AVOID、「15 MIN DELAY」这类认不出，当基线。
// 输出格式和大模型一样：每类人注意到没、看懂没、走每条路的比例、一句理由。比例是「校准前」的表态，引擎第 ④ 步再做两点校准。
// 纯函数、确定性：同一张场景卡永远同一个答案。浏览器、Worker、node 测试都直接 import。

import { normLine, words, checkVms } from './vms.js';

export const TYPES = ['commuter', 'local', 'tourist', 'delivery'];
// 4 类路人占车流的比例：先按假设写（docs/arch/2-agent-integration.pdf 第 2 页），T5 找数据校准
export const MIX = { commuter: 0.5, local: 0.25, tourist: 0.1, delivery: 0.15 };
export const RULE_MODEL = 'rule-v1';

// 每类人的参数（工程假设，表态口径，不是实测绕行率）：
//   notice 注意到标志的概率 · understand 看懂的概率 · base 知道前面施工后的一般绕行倾向
//   use 屏上点名路线后转去那条路的倾向 · save「SAVE N MIN」每 10 分钟的额外倾向 · queue 看到前面排 1.5 公里时的额外倾向
const P = {
  commuter: { notice: 0.85, understand: 0.9, base: 0.3, use: 0.35, save: 0.25, queue: 0.3 },
  local: { notice: 0.55, understand: 0.9, base: 0.25, use: 0.12, save: 0.1, queue: 0.4 },
  tourist: { notice: 0.8, understand: 0.75, base: 0.1, use: 0.3, save: 0.05, queue: 0.1 },
  delivery: { notice: 0.8, understand: 0.9, base: 0.15, use: 0.15, save: 0.1, queue: 0.2 },
};
// 非标准缩写：游客看不懂，其他人也打点折扣
const NONSTD = new Set(['RD', 'WKS', 'AHD', 'LN', 'CLSD', 'DET', 'ALT', 'RTE', 'XING', 'INT', 'TRF', 'CONG', 'DLY', 'NB', 'SB', 'EB', 'WB']);
const READ_OK_S = 4; // 读完一块屏大约要 4 秒，少于这个按比例打折
const QUEUE_FULL_M = 1500;
const MAX_DETOUR = 0.95;
const SAVE_RE = /\bSAVE\s+(\d{1,2})\s*(?:MIN|MINS|MINUTES)\b/;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r3 = x => Math.round(x * 1000) / 1000;

function signTokens(signs) {
  const parts = [];
  for (const s of signs) {
    if (Array.isArray(s.frames)) parts.push(...words(s.frames));
    if (s.text != null) parts.push(...normLine(s.text).split(' '));
  }
  return parts.filter(Boolean);
}

// 能读几秒决定注意到的概率：取最好读的那块屏；两帧时每帧时间减半，再打 8 折
function readFactor(signs) {
  if (!signs.length) return 0;
  let best = 0, anyVms = false;
  for (const s of signs) {
    if (s.kind !== 'vms') { best = Math.max(best, 1); continue; }
    anyVms = true;
    const rs = Number.isFinite(s.read_s) ? s.read_s : READ_OK_S;
    let f = Math.min(1, rs / READ_OK_S);
    if (Array.isArray(s.frames) && s.frames.length > 1 && rs < 6) f *= 0.8;
    best = Math.max(best, f);
  }
  return anyVms || best ? best : 1;
}

// 「USE / VIA」后面紧跟的词 = 某条绕行路线路名的第一个词，才算点名（原路不算）
function namedRoute(routes, tokens) {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] !== 'USE' && tokens[i] !== 'VIA') continue;
    const next = tokens[i + 1];
    const hit = routes.find(r => r.id !== 'stay' && normLine(r.name).split(' ')[0] === next);
    if (hit) return hit;
  }
  return null;
}

function saveMin(tokens) {
  const m = SAVE_RE.exec(tokens.join(' '));
  return m ? Number(m[1]) : 0;
}

function reason(type, { hasSigns, named, namedOk, n, nonstd, q }) {
  if (!hasSigns) return q > 0 ? 'No signs; the queue ahead makes some look for another way.' : 'No signs; most keep to their usual route.';
  if (type === 'tourist' && nonstd) return 'Abbreviations are unclear; mostly follows the car ahead.';
  if (named && !namedOk) return `${named.name} is not open to trucks; stays on a truck route.`;
  if (type === 'local') return 'Knows the area; often ignores signs and picks own shortcut.';
  if (named) return `Sign names ${named.name}${n ? ` and says it saves ${n} min` : ''}.`;
  if (n) return `Sign says ${n} min can be saved but not which way.`;
  return 'Sign only warns of roadwork; most keep to their usual route.';
}

// 一类人 × 一张场景卡 → { share: {路线 id: 比例}, lo, hi, notice, understand, why, n }
export function ruleAnswer(type, card) {
  const p = P[type];
  if (!p) throw new Error('unknown persona type: ' + type);
  const routes = Array.isArray(card.routes) ? card.routes : [];
  const signs = Array.isArray(card.signs) ? card.signs : [];
  const stay = routes.find(r => r.id === 'stay');
  const allowed = r => !(type === 'delivery' && r.truck === false);
  let alts = routes.filter(r => r.id !== 'stay' && allowed(r));
  const tokens = signTokens(signs);
  const hasSigns = signs.length > 0;
  const notice = hasSigns ? p.notice * readFactor(signs) : 0;
  const nonstd = tokens.some(t => NONSTD.has(t));
  const understand = p.understand * (nonstd ? (type === 'tourist' ? 0.45 : 0.9) : 1);
  const named = namedRoute(routes, tokens);
  const namedOk = named ? allowed(named) : false;
  const n = saveMin(tokens);
  const q = clamp(Number(card.queue_m) || 0, 0, QUEUE_FULL_M) / QUEUE_FULL_M;

  let generic = p.base * (hasSigns ? notice : 0.5) + p.queue * q;
  let toNamed = 0;
  if (named && namedOk) toNamed = (p.use + (n ? (p.save * Math.min(n, 15)) / 10 : 0)) * notice * understand;
  else if (!named && n) generic += (((p.save * Math.min(n, 15)) / 10) * notice * understand) / 2;

  if (!alts.length && !stay) alts = routes.filter(r => r.id !== 'stay'); // 全封且没有能走的路：只能硬走（界面会标出来）
  let d;
  if (!alts.length) d = 0;
  else if (!stay) d = 1;
  else d = clamp(generic + toNamed, 0, MAX_DETOUR);
  const namedPart = named && namedOk && alts.includes(named) ? Math.min(toNamed, d) : 0;
  const rest = d - namedPart;
  const minU = Math.min(...alts.map(r => Number(r.usual_min) || 0));
  const w = alts.map(r => Math.exp(-((Number(r.usual_min) || 0) - minU) / 3));
  const wSum = w.reduce((a, b) => a + b, 0) || 1;

  const share = {};
  for (const r of routes) share[r.id] = 0;
  if (stay) share.stay = 1 - d;
  alts.forEach((r, i) => { share[r.id] += (rest * w[i]) / wSum; });
  if (namedPart) share[named.id] += namedPart;
  for (const k of Object.keys(share)) share[k] = r3(share[k]);
  const dd = r3(stay ? 1 - share.stay : 1);
  return {
    share,
    lo: dd,
    hi: dd,
    notice: r3(notice),
    understand: r3(understand),
    why: reason(type, { hasSigns, named, namedOk, n, nonstd, q }),
    n: 1,
  };
}

// ---------- 第 ⑦ 步：规划顾问的规则版 ----------
// summary 由引擎生成（docs/contract.md「规划顾问」一节）；最多回 3 条：改屏上的字 · 挪设备 · 错开日期。
// 数字不在这里算：每条建议由引擎重算一遍（大模型出主意，引擎算数字）。

export function shortName(name) {
  let s = normLine(name);
  if (s.length <= 10) return s;
  s = s.replace(/\s+(STREET|ST|ROAD|RD|AVENUE|AVE|LANE|LN|PARADE|PDE)$/, '');
  if (s.length <= 10) return s;
  return s.split(' ')[0].slice(0, 10);
}

function saveLines(n) {
  if (!(n >= 1)) return [];
  n = Math.min(Math.round(n), 99);
  return n <= 9 ? [`SAVE ${n} MIN`] : ['SAVE', `${n} MIN`];
}

const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;

export function adviseRule(summary) {
  const out = [];
  const wsById = new Map((summary?.worksites || []).map(w => [w.id, w]));
  const aps = [...(summary?.approaches || [])].sort((a, b) => (b.delay_min || 0) - (a.delay_min || 0));
  const pick = ap => {
    const alts = (ap.routes || []).filter(r => r.id !== 'stay' && Number.isFinite(r.now_min));
    if (!alts.length) return null;
    return alts.reduce((a, b) => (b.now_min < a.now_min ? b : a));
  };
  const vmsOf = (ws, ap) => (ws.equipment || []).find(e => e.type === 'vms' && (!e.dir || e.dir === ap.dir));

  // 1 改屏上的字：点名最快的绕行路线，能省几分钟就写上
  for (const ap of aps) {
    const ws = wsById.get(ap.worksite), best = pick(ap);
    if (!ws || !best) continue;
    const stay = (ap.routes || []).find(r => r.id === 'stay');
    const save = stay ? Math.round(stay.now_min - best.now_min) : 0;
    const frames = [['USE', shortName(best.name), ...saveLines(save)]];
    const vms = vmsOf(ws, ap);
    if (vms && words(vms.frames).join(' ') === words(frames).join(' ')) continue;
    out.push({
      kind: 'text', worksite: ws.id, equipment: vms ? vms.id : null, frames,
      ...(vms ? {} : { at_m: Math.min(2000, Math.round(((best.diverge_m || 0) + 100) / 50) * 50) }),
      why: `Name the fastest detour (${best.name})${save >= 1 ? ` and the ${Math.round(save)} min it saves` : ''}; vague warnings are mostly ignored.`,
    });
    break;
  }
  // 2 挪设备：屏在岔路口之后，司机看到时已经拐不过去了
  for (const ap of aps) {
    const ws = wsById.get(ap.worksite), best = pick(ap);
    if (!ws || !best || !Number.isFinite(best.diverge_m)) continue;
    const vms = vmsOf(ws, ap);
    if (!vms || !(vms.at_m < best.diverge_m + 50)) continue;
    const at = Math.min(2000, Math.round((best.diverge_m + 100) / 50) * 50);
    out.push({ kind: 'move', worksite: ws.id, equipment: vms.id, at_m: at,
      why: `The sign is ${vms.at_m} m before the works but the turn into ${best.name} is ${best.diverge_m} m before; drivers see it too late.` });
    break;
  }
  // 3 错开日期：和别的施工同时段叠加有冲突成本 → 等前一个结束再开工
  for (const c of summary?.conflicts || []) {
    const a = wsById.get(c.a), b = wsById.get(c.b);
    if (!(c.cost_min > 0) || !a?.time?.to || !b?.time?.from) continue;
    const days = dayNum(a.time.to) - dayNum(b.time.from) + 1;
    if (!(days > 0)) continue;
    out.push({ kind: 'shift', worksite: b.id, days,
      why: `Overlaps ${a.id}; starting the day after it ends removes about ${Math.round(c.cost_min)} extra vehicle-minutes.` });
    break;
  }
  return out.slice(0, 3);
}

// 一条建议合不合格（Worker 校验大模型输出、浏览器校验 Worker 回的东西都用它）
export function checkSuggestion(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.worksite !== 'string' || !s.worksite) return false;
  if (s.why != null && typeof s.why !== 'string') return false;
  if (s.kind === 'text') return checkVms(s.frames).ok && (s.equipment === null || typeof s.equipment === 'string');
  if (s.kind === 'move') return typeof s.equipment === 'string' && Number.isFinite(s.at_m) && s.at_m >= 0 && s.at_m <= 2000;
  if (s.kind === 'shift') return Number.isInteger(s.days) && s.days !== 0 && Math.abs(s.days) <= 60;
  return false;
}

// 一类人的回答长得对不对：每条路线都有 0–1 的比例，合计约等于 1
export function validTypeAnswer(a, card) {
  if (!a || typeof a !== 'object' || !a.share || typeof a.share !== 'object') return false;
  let sum = 0;
  for (const r of card.routes || []) {
    const v = a.share[r.id];
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
    sum += v;
  }
  return Math.abs(sum - 1) < 0.02;
}
