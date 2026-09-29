// app.js —— api 模块的 Worker 逻辑（第 ③ ⑦ 步 + 施工清单）。worker.js 只把 prompts.md 塞进来；node 测试直接 import 本文件。
// 接口见 docs/contract.md「HTTP API」和「路人 agent」两节：
//   GET  /api/health                   { ok, v, mock, llm, prompt_v }
//   POST /api/persona   {type, card}   一类人 × 一张场景卡 → { ok, src: kv|llm|rule, type, answer, model, prompt_v, fallback? }
//   POST /api/advisor   {summary}      规划顾问 → { ok, src: llm|rule, suggestions[≤3], fallback? }
//   GET/POST/DELETE /api/worksites     施工清单（绑了 D1 就存 D1，没绑就存在这个 Worker 实例的内存里，persist:false）
// 🔒 花钱保险丝：MOCK 不是 "0" 就永远不调大模型；没绑 D1（没有原子的当天计数）也不调；当天调用数到 LLM_DAILY_CAP 就只回规则估算。KV 只做问答缓存。
// 🔒 key 只从 env 读、只在 llm.js 里用；任何响应（包括报错）都不回显 env 的值和异常原文。

import { TYPES, RULE_MODEL, ruleAnswer, adviseRule, checkSuggestion, validTypeAnswer } from '../public/js/rules.js';
import { checkVms, checkSignText, normFrames, normLine } from '../public/js/vms.js';
import { cardKey, canon, sha256Hex } from '../public/js/cardkey.js';
import { parsePrompts, renderPersona, renderAdvisor, PERSONA_SCHEMA, ADVISOR_SCHEMA } from './prompts.js';
import { callModel as realCallModel, providerReady, modelName, LlmError } from './llm.js';

export const VERSION = '0.1.0';
export const MAX_BODY = 8 * 1024; // 请求体 ≤ 8 KB
export const RUNS = 3; // 每类人问 3 次（每次打乱路线顺序），取平均并给区间
export const LLM_TIMEOUT_MS = 20000;
export const DEFAULT_CAP = 300; // 每天最多真调用次数（env.LLM_DAILY_CAP 可改）
export const MAX_WORKSITES = 200;

const DIRS = new Set(['N', 'S', 'E', 'W']);
const ROUTE_ID = /^(stay|r[1-9])$/;
const NAME_RE = /^[A-Za-z0-9 .,'&/()-]{1,40}$/; // 路名进提示词但不在 <sign> 里，不许尖括号
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const LINK_RE = /^[A-Za-z0-9:_>.+-]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, error, msg) { super(msg); this.status = status; this.error = error; this.msg = msg; }
}

export function isMock(env) {
  return String(env?.MOCK ?? '1') !== '0';
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
const fail = (status, error, msg, extra = {}, headers = {}) => json({ ok: false, error, msg, ...extra }, status, headers);

// 边读边数，超过 8 KB 立刻停，不把大包整个读进内存
async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large', `请求体最多 ${MAX_BODY / 1024} KB`);
  let text = '';
  if (request.body) {
    const reader = request.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > MAX_BODY) {
        try { await reader.cancel(); } catch { /* 已经在报错了 */ }
        throw new HttpError(413, 'too_large', `请求体最多 ${MAX_BODY / 1024} KB`);
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
    text = new TextDecoder().decode(buf);
  }
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad_json', '请求体不是合法的 JSON'); }
}

const isName = s => typeof s === 'string' && NAME_RE.test(s) && s === s.trim() && !/\s{2,}/.test(s); // 原样检查：前后空白、换行、连续空白都不许
const inRange = (x, a, b) => typeof x === 'number' && Number.isFinite(x) && x >= a && x <= b;

// 场景卡合不合规（引擎造的卡都应该过；超规范直接 400）
export function validateCard(card) {
  const issues = [];
  const bad = (code, msg) => issues.push({ code, msg });
  if (!card || typeof card !== 'object' || Array.isArray(card)) { bad('no_card', '缺场景卡'); return { ok: false, issues }; }
  const t = card.trip;
  if (!t || typeof t !== 'object') bad('no_trip', '缺 trip');
  else {
    if (!isName(t.on)) bad('bad_trip_on', 'trip.on 要是 1–40 个字符的路名');
    if (!isName(t.to)) bad('bad_trip_to', 'trip.to 要是 1–40 个字符的路名');
    if (!DIRS.has(t.dir)) bad('bad_dir', 'trip.dir 只能是 N / S / E / W');
    if (!inRange(t.kmh, 5, 110)) bad('bad_kmh', 'trip.kmh 要在 5–110 之间');
  }
  const signs = card.signs;
  if (!Array.isArray(signs) || signs.length > 6) bad('bad_signs', 'signs 要是数组，最多 6 块');
  else signs.forEach((s, i) => {
    if (!s || typeof s !== 'object') { bad('bad_sign', `第 ${i + 1} 块标志不是对象`); return; }
    if (!inRange(s.m, 0, 3000)) bad('bad_sign_m', `第 ${i + 1} 块标志的 m 要在 0–3000 米之间`);
    if (s.kind === 'vms') {
      if (s.read_s != null && !inRange(s.read_s, 0, 120)) bad('bad_read_s', `第 ${i + 1} 块屏的 read_s 要在 0–120 秒之间`);
      for (const e of checkVms(s.frames, { read_s: s.read_s }).errors) bad(e.code, `第 ${i + 1} 块屏：${e.msg}`);
    } else if (s.kind === 'sign' || s.kind === 'arrow') {
      for (const e of checkSignText(s.text).errors) bad(e.code, `第 ${i + 1} 块标志：${e.msg}`);
    } else bad('bad_kind', `第 ${i + 1} 块标志的 kind 只能是 vms / sign / arrow`);
  });
  const routes = card.routes;
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > 6) bad('bad_routes', 'routes 要是 1–6 条路线的数组');
  else {
    const ids = new Set(), names = new Set();
    routes.forEach((r, i) => {
      if (!r || typeof r !== 'object') { bad('bad_route', `第 ${i + 1} 条路线不是对象`); return; }
      if (!ROUTE_ID.test(String(r.id)) || ids.has(r.id)) bad('bad_route_id', `第 ${i + 1} 条路线的 id 要是 stay 或 r1–r9，且不重复`);
      if (!isName(r.name) || names.has(normLine(r.name))) bad('bad_route_name', `第 ${i + 1} 条路线的 name 要是不重复的路名`);
      if (!inRange(r.usual_min, 0, 180)) bad('bad_usual_min', `第 ${i + 1} 条路线的 usual_min 要在 0–180 之间`);
      if (r.truck != null && typeof r.truck !== 'boolean') bad('bad_truck', `第 ${i + 1} 条路线的 truck 只能是 true / false`);
      if (r.turn_m != null && (!inRange(r.turn_m, 0, 3000) || r.id === 'stay')) bad('bad_turn_m', `第 ${i + 1} 条路线的 turn_m 要在 0–3000 米之间，原路不写`);
      ids.add(r.id); names.add(normLine(r.name));
    });
    const alts = routes.filter(r => r && r.id !== 'stay').length;
    if (alts < 1) bad('no_alternative', '至少要有 1 条绕行路线');
  }
  if (card.queue_m != null && !inRange(card.queue_m, 0, 10000)) bad('bad_queue', 'queue_m 要在 0–10000 米之间');
  return { ok: issues.length === 0, issues };
}

export function validateWorksite(ws) {
  const issues = [];
  const bad = (code, msg) => issues.push({ code, msg });
  if (!ws || typeof ws !== 'object' || Array.isArray(ws)) return { ok: false, issues: [{ code: 'no_worksite', msg: '缺施工对象' }] };
  if (!ID_RE.test(String(ws.id))) bad('bad_id', 'id 只能用字母、数字、_ 和 -，最多 40 个');
  if (ws.name != null && !isName(ws.name)) bad('bad_name', 'name 最多 40 个字符');
  if (!Array.isArray(ws.links) || !ws.links.length || ws.links.length > 20 || !ws.links.every(l => LINK_RE.test(String(l)))) {
    bad('bad_links', 'links 要是 1–20 个路段 id');
  }
  const c = ws.closes;
  if (!c || !Number.isInteger(c.lanes) || c.lanes < 0 || c.lanes > 8) bad('bad_closes', 'closes.lanes 要是 0–8 的整数');
  const t = ws.time;
  if (!t || !DATE_RE.test(String(t.from)) || !DATE_RE.test(String(t.to)) || t.to < t.from) bad('bad_time', 'time.from / time.to 要是 YYYY-MM-DD，且 to 不早于 from');
  else if (!Array.isArray(t.hours) || t.hours.length !== 2 || !Number.isInteger(t.hours[0]) || !Number.isInteger(t.hours[1]) || t.hours[0] < 0 || t.hours[1] > 24 || t.hours[0] >= t.hours[1]) {
    bad('bad_hours', 'time.hours 要是 [开始, 结束) 两个 0–24 的整数');
  }
  const eq = ws.equipment ?? [];
  if (!Array.isArray(eq) || eq.length > 10) bad('bad_equipment', 'equipment 最多 10 件');
  else eq.forEach((e, i) => {
    if (!e || !ID_RE.test(String(e.id))) { bad('bad_equipment_id', `第 ${i + 1} 件设备的 id 不对`); return; }
    if (!['vms', 'sign', 'arrow', 'barrier'].includes(e.type)) bad('bad_equipment_type', `第 ${i + 1} 件设备的 type 只能是 vms / sign / arrow / barrier`);
    if (!inRange(e.at_m, 0, 3000)) bad('bad_at_m', `第 ${i + 1} 件设备的 at_m 要在 0–3000 米之间`);
    if (e.dir != null && !DIRS.has(e.dir)) bad('bad_dir', `第 ${i + 1} 件设备的 dir 只能是 N / S / E / W`);
    if (e.type === 'vms') for (const x of checkVms(e.frames).errors) bad(x.code, `第 ${i + 1} 件设备（屏）：${x.msg}`);
    if (e.type === 'sign' || e.type === 'arrow') for (const x of checkSignText(e.text).errors) bad(x.code, `第 ${i + 1} 件设备：${x.msg}`);
  });
  return { ok: issues.length === 0, issues, worksite: issues.length ? null : pickWorksite(ws) };
}

// 只留认识的字段（多余的字段不存、不分发、不进提示词）
function pickWorksite(ws) {
  const o = { id: ws.id, links: ws.links.map(String), closes: { lanes: ws.closes.lanes }, time: { from: ws.time.from, to: ws.time.to, hours: [ws.time.hours[0], ws.time.hours[1]] } };
  if (ws.name != null) o.name = ws.name;
  o.equipment = (ws.equipment || []).map(e => {
    const x = { id: e.id, type: e.type, at_m: e.at_m };
    if (e.dir != null) x.dir = e.dir;
    if (e.type === 'vms') { x.frames = normFrames(e.frames); if (Number.isFinite(e.char_mm)) x.char_mm = e.char_mm; }
    if (e.type === 'sign' || e.type === 'arrow') x.text = normLine(e.text);
    return x;
  });
  return o;
}

// ---------- 花钱保险丝：D1 里一条原子语句记当天（UTC）真调用次数 ----------
// KV 做不到原子计数（先读再写，并发请求会一起越过上限；同一个键每秒只能写 1 次），所以计数放 D1 的 quota 表：
// 一条 INSERT … ON CONFLICT DO UPDATE … WHERE n + 本次 ≤ 上限 RETURNING n，没回行 = 超限。并发也不会超。
// 没绑 D1 就一次都不真调（no_db）；LLM_DAILY_CAP = "0" 就是一次都不调；D1 出错一律当作超限（fuse_error，不花钱，回规则）。
export function dailyCap(env) {
  const c = Number.parseInt(env?.LLM_DAILY_CAP, 10);
  return Number.isInteger(c) && c >= 0 ? c : DEFAULT_CAP;
}
const QUOTA_SQL = 'INSERT INTO quota (day, n) SELECT ?1, ?2 WHERE ?2 <= ?3 ON CONFLICT(day) DO UPDATE SET n = n + excluded.n WHERE n + excluded.n <= ?3 RETURNING n';
async function reserve(env, n, now) {
  if (!env.DB) return 'no_db';
  try {
    const row = await env.DB.prepare(QUOTA_SQL).bind(now.toISOString().slice(0, 10), n, dailyCap(env)).first();
    return row ? 'ok' : 'cap';
  } catch {
    return 'fuse_error';
  }
}

function timeout(promise, ms, ctrl) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => { ctrl?.abort(); reject(new LlmError('timeout', 'LLM timed out')); }, ms); }),
  ]);
}

const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const clamp01 = x => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const r3 = x => Math.round(x * 1000) / 1000;

// 大模型一次回答 → 各路线比例（按路名对回 id；货车永远不上禁货车的路）
export function parseRun(out, card, type) {
  if (!out || typeof out !== 'object' || !Array.isArray(out.routes)) return null;
  const byName = new Map(card.routes.map(r => [normLine(r.name), r]));
  const share = Object.fromEntries(card.routes.map(r => [r.id, 0]));
  for (const it of out.routes) {
    const r = byName.get(normLine(it?.route));
    const v = Number(it?.share);
    if (r && Number.isFinite(v) && v > 0) share[r.id] += v;
  }
  if (type === 'delivery') for (const r of card.routes) if (r.truck === false && r.id !== 'stay') share[r.id] = 0; // 已经在原路上的车不算「选」禁货车的路
  const sum = Object.values(share).reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  for (const k of Object.keys(share)) share[k] /= sum;
  return { share, notice: clamp01(Number(out.notice)), understand: clamp01(Number(out.understand)), why: clean(out.why) };
}

async function askModel(env, deps, type, card) {
  const ids = card.routes.map(r => r.id);
  const orders = [ids, [...ids].reverse(), [...ids.slice(1), ids[0]]];
  const settled = await Promise.allSettled(orders.map(order => {
    const ctrl = new AbortController();
    const req = { ...renderPersona(deps.prompts, type, card, order), schema: PERSONA_SCHEMA, maxTokens: 2000, signal: ctrl.signal };
    return timeout(Promise.resolve().then(() => deps.callModel(env, req)), LLM_TIMEOUT_MS, ctrl);
  }));
  const runs = settled.filter(s => s.status === 'fulfilled').map(s => parseRun(s.value?.json, card, type)).filter(Boolean);
  if (runs.length < 2) {
    const firstErr = settled.find(s => s.status === 'rejected')?.reason;
    throw firstErr instanceof LlmError ? firstErr : new LlmError('llm_failed', 'not enough valid LLM runs');
  }
  const share = {};
  for (const id of ids) share[id] = r3(runs.reduce((a, r) => a + r.share[id], 0) / runs.length);
  const detours = runs.map(r => (card.routes.some(x => x.id === 'stay') ? 1 - r.share.stay : 1));
  return {
    share,
    lo: r3(Math.min(...detours)),
    hi: r3(Math.max(...detours)),
    notice: r3(runs.reduce((a, r) => a + r.notice, 0) / runs.length),
    understand: r3(runs.reduce((a, r) => a + r.understand, 0) / runs.length),
    why: runs[0].why,
    n: runs.length,
  };
}

async function kvJson(kv, key) {
  try { return await kv.get(key, 'json'); } catch { return null; }
}

// ---------- 路由 ----------

async function health(request, env, deps) {
  return json({ ok: true, v: VERSION, mock: isMock(env), llm: modelName(env) || null, prompt_v: deps.prompts.version });
}

async function persona(request, env, deps) {
  const body = await readJson(request);
  const type = body?.type, card = body?.card;
  if (!TYPES.includes(type)) return fail(400, 'bad_type', `type 只能是 ${TYPES.join(' / ')}`);
  const v = validateCard(card);
  if (!v.ok) return fail(400, 'bad_card', '场景卡不合规', { issues: v.issues });
  const model = modelName(env);
  const kv = env.PERSONA_KV;
  const key = 'p:' + (await cardKey(card, `${deps.prompts.version}|${model}|${type}`));
  const rule = code => json({ ok: true, src: 'rule', type, answer: ruleAnswer(type, card), model: RULE_MODEL, prompt_v: '-', fallback: code });
  if (kv && model) {
    const hit = await kvJson(kv, key);
    if (hit && validTypeAnswer(hit.answer, card)) return json({ ok: true, src: 'kv', type, answer: hit.answer, model: hit.model, prompt_v: hit.prompt_v });
  }
  if (isMock(env)) return rule('mock');
  if (!providerReady(env)) return rule('no_provider');
  const fuse = await reserve(env, RUNS, deps.now());
  if (fuse !== 'ok') return rule(fuse);
  let answer;
  try { answer = await askModel(env, deps, type, card); } catch (e) { return rule(e instanceof LlmError ? e.code : 'llm_error'); }
  if (kv) try { await kv.put(key, JSON.stringify({ answer, model, prompt_v: deps.prompts.version, at: deps.now().toISOString() })); } catch { /* 缓存写失败不影响这次回答 */ }
  return json({ ok: true, src: 'llm', type, answer, model, prompt_v: deps.prompts.version });
}

function normSuggestion(s) {
  if (!s || typeof s !== 'object') return null;
  const o = { kind: s.kind, worksite: String(s.worksite ?? ''), why: clean(s.why) };
  if (s.kind === 'text') { o.equipment = s.equipment ?? null; o.frames = normFrames(s.frames); if (Number.isFinite(s.at_m)) o.at_m = s.at_m; }
  if (s.kind === 'move') { o.equipment = s.equipment; o.at_m = Number(s.at_m); }
  if (s.kind === 'shift') o.days = Number(s.days);
  return o;
}

// 摘要的外形：三个数组、施工 id 合规、日期是字符串（错了回 400，不让规则版在里面抛 500）
export function validateSummary(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  for (const k of ['worksites', 'approaches', 'conflicts']) if (s[k] != null && !Array.isArray(s[k])) return false;
  for (const w of s.worksites || []) {
    if (!w || !ID_RE.test(String(w.id))) return false;
    if (w.time != null && (typeof w.time !== 'object' || (w.time.from != null && !DATE_RE.test(String(w.time.from))) || (w.time.to != null && !DATE_RE.test(String(w.time.to))))) return false;
    if (w.equipment != null && !Array.isArray(w.equipment)) return false;
  }
  for (const a of s.approaches || []) if (!a || typeof a !== 'object' || (a.routes != null && !Array.isArray(a.routes))) return false;
  for (const c of s.conflicts || []) if (!c || typeof c !== 'object') return false;
  return true;
}

async function advisor(request, env, deps) {
  const body = await readJson(request);
  const summary = body?.summary;
  if (!validateSummary(summary)) return fail(400, 'bad_summary', 'summary（引擎生成的结果摘要）格式不对');
  const ids = new Set((summary.worksites || []).map(w => w.id));
  const keep = s => checkSuggestion(s) && ids.has(s.worksite); // 只认摘要里有的施工
  const rule = code => {
    let sug = [];
    try { sug = adviseRule(summary).filter(keep).map(s => ({ ...s, why: clean(s.why) })); } catch { /* 摘要里有怪东西：不给建议 */ }
    return json({ ok: true, src: 'rule', suggestions: sug, fallback: code });
  };
  if (isMock(env)) return rule('mock');
  if (!providerReady(env)) return rule('no_provider');
  const kv = env.PERSONA_KV;
  const model = modelName(env);
  const key = 'a:' + (await sha256Hex(`${deps.prompts.version}|${model}|${canon(summary)}`));
  const hit = kv ? await kvJson(kv, key) : null;
  if (hit && Array.isArray(hit.suggestions) && hit.suggestions.every(keep)) return json({ ok: true, src: 'kv', suggestions: hit.suggestions, model });
  const fuse = await reserve(env, 1, deps.now());
  if (fuse !== 'ok') return rule(fuse);
  try {
    const ctrl = new AbortController();
    const req = { ...renderAdvisor(deps.prompts, summary), schema: ADVISOR_SCHEMA, maxTokens: 3000, signal: ctrl.signal };
    const out = await timeout(Promise.resolve().then(() => deps.callModel(env, req)), LLM_TIMEOUT_MS, ctrl);
    const sug = (out?.json?.suggestions || []).map(normSuggestion).filter(keep).slice(0, 3);
    if (!sug.length) return rule('llm_empty');
    if (kv) try { await kv.put(key, JSON.stringify({ suggestions: sug, model, at: deps.now().toISOString() })); } catch { /* 缓存写失败不影响这次回答 */ }
    return json({ ok: true, src: 'llm', suggestions: sug, model });
  } catch (e) {
    return rule(e instanceof LlmError ? e.code : 'llm_error');
  }
}

async function worksites(request, env, deps, url) {
  const db = env.DB;
  const persist = Boolean(db);
  if (request.method === 'GET') {
    const list = db
      ? ((await db.prepare('SELECT body FROM worksites ORDER BY id').all()).results || []).map(r => JSON.parse(r.body))
      : [...deps.mem.values()];
    return json({ ok: true, worksites: list, persist });
  }
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!ID_RE.test(id)) return fail(400, 'bad_id', '要删的 id 不对');
    if (db) await db.prepare('DELETE FROM worksites WHERE id = ?1').bind(id).run();
    else deps.mem.delete(id);
    return json({ ok: true, id, persist });
  }
  const v = validateWorksite((await readJson(request))?.worksite);
  if (!v.ok) return fail(400, 'bad_worksite', '施工方案不合规', { issues: v.issues });
  const ws = v.worksite;
  const full = () => fail(409, 'too_many', `施工清单最多 ${MAX_WORKSITES} 条`);
  if (db) {
    // 一条语句里判断上限：并发 POST 也不会超过 200 条（覆盖已有 id 不算新增）
    const r = await db.prepare('INSERT INTO worksites (id, body, updated_at) SELECT ?1, ?2, ?3 WHERE (SELECT COUNT(*) FROM worksites) < ?4 OR EXISTS (SELECT 1 FROM worksites WHERE id = ?1) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
      .bind(ws.id, JSON.stringify(ws), deps.now().toISOString(), MAX_WORKSITES).run();
    if (!(r?.meta?.changes > 0)) return full();
  } else {
    if (!deps.mem.has(ws.id) && deps.mem.size >= MAX_WORKSITES) return full();
    deps.mem.set(ws.id, ws);
  }
  return json({ ok: true, worksite: ws, persist });
}

const ROUTES = {
  '/api/health': { GET: health },
  '/api/persona': { POST: persona },
  '/api/advisor': { POST: advisor },
  '/api/worksites': { GET: worksites, POST: worksites, DELETE: worksites },
};

export function makeApp({ promptsMd, callModel = realCallModel, now = () => new Date() } = {}) {
  const deps = { prompts: parsePrompts(promptsMd), callModel, now, mem: new Map() };
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      try {
        // 合并部署时各模块的 public/ 挂在 /<模块>/public/ 下：把 /api/public/* 转给静态资源
        if (url.pathname.startsWith('/api/public/') && env.ASSETS) {
          return env.ASSETS.fetch(new Request(new URL(url.pathname.slice('/api/public'.length) + url.search, url), request));
        }
        if (!url.pathname.startsWith('/api/')) {
          return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, 'not_found', '没有这个地址');
        }
        const route = ROUTES[url.pathname];
        if (!route) return fail(404, 'not_found', '没有这个接口');
        const h = route[request.method];
        if (!h) return fail(405, 'method_not_allowed', `只支持 ${Object.keys(route).join(' / ')}`, {}, { allow: Object.keys(route).join(', ') });
        return await h(request, env, deps, url);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.error, e.msg);
        return fail(500, 'internal', '服务器出错了'); // 不回显异常原文：可能带内部信息
      }
    },
  };
}
