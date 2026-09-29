// persona.js —— 第 ③ 步的唯一入口：引擎（T4）只调 askPersonas(场景卡)，大模型、缓存、失败处理全在这里。
// 查答案的顺序（docs/arch/5-llm-api-detail.pdf 第 1 页）：
//   ② 随网页发布的答案文件（演示文案提前问好，马上出、0 元）
//   ③④ Cloudflare Worker /api/persona：先查 KV 缓存，没有才问大模型（每类人问 3 次）；浏览器按类发 4 个请求
//   ⑤ 任一类失败、超过 20 秒、Worker 回了不认识的东西 → 这一类用关键词规则估算，src 标 rule，界面标「估算」
// 回答（docs/contract.md「路人 agent」一节）：by_type 是每类人校准前的比例，raw 是按车流占比加权后的全体比例；
// 两点校准是引擎第 ④ 步的事，这里不做。
// 用法：import { askPersonas } from '<api>/js/persona.js'; const ans = await askPersonas(card);
//      node 测试：askPersonas(card, { fetch: 假 fetch, base: 'http://x/api' })；只要规则：{ force: 'rule' }

import { TYPES, MIX, RULE_MODEL, ruleAnswer, adviseRule, checkSuggestion, validTypeAnswer } from './rules.js';
import { cardKey } from './cardkey.js';

export { TYPES, MIX, RULE_MODEL, validTypeAnswer };
export const TIMEOUT_MS = 20000;
// 答案文件和本文件一起发布：按本文件的地址找，挂在哪个路径下都对（拿不到 import.meta.url 时退回合并部署的路径）
const ANSWERS_URL = (() => {
  try { return new URL('../answers/answers.json', import.meta.url).href; } catch { return '/api/public/answers/answers.json'; }
})();
const RANK = { rule: 0, llm: 1, kv: 2, file: 3 }; // 顶层 src 取最「估算」的那一类，界面据此标「估算」

const fileCache = new Map(); // 答案文件 URL → Promise<文件 | null>，一个页面只拉一次

function loadAnswers(f, url) {
  if (!fileCache.has(url)) {
    fileCache.set(url, (async () => {
      try {
        const res = await f(url);
        if (!res || !res.ok) return null;
        const j = await res.json();
        return j && typeof j.entries === 'object' && j.entries ? j : null;
      } catch { return null; }
    })());
  }
  return fileCache.get(url);
}

// 测试用：清掉已经拉过的答案文件
export function _resetAnswers() { fileCache.clear(); }

function withTimeout(promise, ms, onTimeout) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise(resolve => { t = setTimeout(() => resolve(onTimeout()), ms); }),
  ]);
}

async function askOne(f, base, type, card, timeoutMs) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const fallback = code => ({ ...ruleAnswer(type, card), src: 'rule', fallback: code });
  return withTimeout((async () => {
    let res;
    try {
      res = await f(`${base}/persona`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, card }),
        signal: ctrl?.signal,
      });
    } catch { return fallback('network'); }
    if (!res || !res.ok) return fallback('http_' + (res ? res.status : 0));
    let j;
    try { j = await res.json(); } catch { return fallback('bad_json'); }
    if (!j || j.ok !== true || !validTypeAnswer(j.answer, card) || !(j.src in RANK)) return fallback('bad_response');
    return { ...j.answer, src: j.src, model: j.model, prompt_v: j.prompt_v, ...(j.fallback ? { fallback: j.fallback } : {}) };
  })(), timeoutMs, () => { ctrl?.abort(); return fallback('timeout'); });
}

// 4 类人的回答合成一份：raw = 按车流占比加权的全体比例（校准前）
export function combine(byType, card, meta = {}, mix = MIX) {
  const raw = {};
  for (const r of card.routes || []) raw[r.id] = 0;
  for (const t of TYPES) for (const id of Object.keys(raw)) raw[id] += (mix[t] || 0) * (byType[t]?.share?.[id] || 0);
  for (const id of Object.keys(raw)) raw[id] = Math.round(raw[id] * 1000) / 1000;
  const srcs = TYPES.map(t => byType[t]?.src || meta.src || 'rule');
  const src = srcs.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
  const firstReal = TYPES.map(t => byType[t]).find(a => a && a.src !== 'rule' && a.model);
  return {
    src,
    by_type: byType,
    raw,
    mix: { ...mix },
    model: meta.model || firstReal?.model || RULE_MODEL,
    prompt_v: meta.prompt_v || firstReal?.prompt_v || '-',
  };
}

export async function askPersonas(card, opts = {}) {
  const f = 'fetch' in opts ? opts.fetch : globalThis.fetch; // 显式传 null = 不联网
  const base = opts.base ?? '/api';
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const mix = opts.mix || MIX;
  if (opts.force !== 'rule' && typeof f === 'function') {
    // ② 答案文件
    const file = await loadAnswers(f, opts.answersUrl || ANSWERS_URL);
    if (file) {
      const e = file.entries[await cardKey(card, file.prompt_v)];
      if (e && e.by_type && TYPES.every(t => validTypeAnswer(e.by_type[t], card))) {
        const bt = {};
        for (const t of TYPES) bt[t] = { ...e.by_type[t], src: 'file' };
        return combine(bt, card, { src: 'file', model: file.model, prompt_v: file.prompt_v }, mix);
      }
    }
    // ③④⑤ Worker，每类人一个请求，失败的那一类单独兜底
    const answers = await Promise.all(TYPES.map(t => askOne(f, base, t, card, timeoutMs)));
    const bt = {};
    TYPES.forEach((t, i) => { bt[t] = answers[i]; });
    return combine(bt, card, {}, mix);
  }
  const bt = {};
  for (const t of TYPES) bt[t] = { ...ruleAnswer(t, card), src: 'rule', ...(opts.force === 'rule' ? {} : { fallback: 'no_fetch' }) };
  return combine(bt, card, {}, mix);
}

// 第 ⑦ 步：规划顾问。summary 由引擎生成；失败就用规则版。回 { src, suggestions }
export async function askAdvisor(summary, opts = {}) {
  const f = 'fetch' in opts ? opts.fetch : globalThis.fetch; // 显式传 null = 不联网
  const base = opts.base ?? '/api';
  const rule = code => ({ src: 'rule', suggestions: adviseRule(summary), ...(code ? { fallback: code } : {}) });
  if (opts.force === 'rule' || typeof f !== 'function') return rule(opts.force === 'rule' ? '' : 'no_fetch');
  return withTimeout((async () => {
    try {
      const res = await f(`${base}/advisor`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary }),
      });
      if (!res || !res.ok) return rule('http_' + (res ? res.status : 0));
      const j = await res.json();
      if (!j || j.ok !== true || !Array.isArray(j.suggestions) || !j.suggestions.every(checkSuggestion)) return rule('bad_response');
      return { src: j.src, suggestions: j.suggestions.slice(0, 3) };
    } catch { return rule('network'); }
  })(), opts.timeoutMs ?? TIMEOUT_MS, () => rule('timeout'));
}
