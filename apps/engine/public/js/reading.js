// reading.js —— 第 ② 步的产物改成 D-0929-1435 的「读数请求」：引擎把每类人路上看到的标志交给 T5 的 readSigns()，
// T5 只回读数（看到没、看懂没、叫走哪条 / 别走哪条、说省或堵几分钟、信不信），格式见 docs/contract.md §路人读数。
// 每类人每段 approach 要两种请求：
//   full   —— 这段路上所有标志（按经过顺序）：定「被说动的比例」和原路的建议
//   prefix —— 某条绕行路线拐口之前能看到的那几块（sign.m ≥ turn_m）：屏要在拐口之前才算点名了这条路
// 请求只取决于「字 + 人」（不含耗时和排队），所以同一句话每类人只问一次，缓存一直有效。

import { canon } from './canon.js';
import { readSeconds, cleanName } from './cards.js';

export function signsOn(ap, ws) {
  return (ws.equipment || [])
    // at_m < 0 = 施工起点下游（如施工段末端的 END ROADWORK）：开到那里已经没法改道，不交给读屏，也不占 6 块的名额
    .filter(e => (e.type === 'vms' || e.type === 'sign' || e.type === 'arrow') && (!e.dir || e.dir === ap.dir) && (Number(e.at_m) || 0) >= 0)
    .map(e => ({ m: Number(e.at_m) || 0, kind: e.type, ...(e.type === 'vms' ? { frames: e.frames } : { text: e.text }), read_s: readSeconds(ap.kmh, e.type === 'vms' ? e.char_mm : 200) }))
    .sort((a, b) => b.m - a.m)
    .slice(-6); // T5 的请求最多收 6 块：多的只留离施工最近的 6 块
}

export function request(persona, ap, signs) {
  return {
    persona,
    kmh: ap.kmh,
    signs: signs.map(({ m, ...s }) => s), // 读数只看「字 + 人」：位置不交出去，引擎自己用
    roads: [ap.street, ...ap.alts.map(r => r.name)].map(cleanName),
  };
}

export const requestKey = req => canon(req);

// 一段 approach 需要的全部请求：{ full: {persona: req}, prefix: {persona: {routeId: req | null}} }
export function requestsFor(ap, ws, types) {
  const signs = signsOn(ap, ws);
  const out = { signs, full: {}, prefix: {} };
  for (const t of types) {
    out.full[t] = signs.length ? request(t, ap, signs) : null;
    out.prefix[t] = {};
    for (const r of ap.alts) {
      const seen = signs.filter(s => s.m >= (r.diverge_m ?? 0));
      out.prefix[t][r.id] = seen.length ? request(t, ap, seen) : null;
    }
  }
  return out;
}

// ---------- MOCK 读数器：T5 的 readSigns() 到之前，演示和测试用它（只认关键词，读不懂意思；界面标「估算」）----------
const NOTICE = { commuter: 0.85, local: 0.55, tourist: 0.8, delivery: 0.8 };
const UNDERSTAND = { commuter: 0.9, local: 0.9, tourist: 0.75, delivery: 0.9 };
const TRUST = { commuter: 0.8, local: 0.5, tourist: 0.9, delivery: 0.7 };
const NONSTD = new Set(['RD', 'WKS', 'AHD', 'LN', 'CLSD', 'DET', 'ALT', 'RTE', 'XING', 'CONG', 'DLY']);

const words = s => (s.frames ? s.frames.flat() : [s.text || '']).join(' ').toUpperCase().split(/\s+/).filter(Boolean);

export async function mockReadSigns(req) {
  const toks = req.signs.flatMap(words);
  const readF = Math.max(0, ...req.signs.map(s => Math.min(1, (s.read_s ?? 4) / 4)));
  const nonstd = toks.some(t => NONSTD.has(t));
  const road = w => req.roads.find(r => r.toUpperCase().split(' ')[0] === w);
  const advice = {};
  for (let i = 0; i < toks.length - 1; i++) {
    const r = road(toks[i + 1]);
    if (!r) continue;
    if (toks[i] === 'USE' || toks[i] === 'VIA') advice[r] = 'use';
    if (toks[i] === 'AVOID') advice[r] = 'avoid';
  }
  const text = toks.join(' ');
  const save = /\bSAVE\s+(\d{1,2})\s*MIN/.exec(text);
  const delay = /\b(\d{1,2})\s*MIN\s+DELAY/.exec(text);
  const p = req.persona;
  return {
    persona: p,
    notice: +(NOTICE[p] * readF).toFixed(3),
    understand: +(UNDERSTAND[p] * (nonstd ? (p === 'tourist' ? 0.45 : 0.9) : 1)).toFixed(3),
    advice,
    saving_min: save ? Number(save[1]) : null,
    delay_min: delay ? Number(delay[1]) : null,
    trust: TRUST[p],
    why: Object.keys(advice).length ? `Sign says ${Object.entries(advice).map(([k, v]) => `${v} ${k}`).join(', ')}.` : 'Sign only warns of roadwork.',
    src: 'rule',
    model: 'engine-mock',
    prompt_v: '-',
  };
}
