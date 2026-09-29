// 大模型读屏（T19）：可替换的调用层 + 问 3 次合成 + 服务端缓存。Worker（src/worker.js）和预计算工具（tools/precompute.mjs）共用
// AI 解读（D-0929-2307）：serverExplain() 复用同一套调用、缓存、限流、熔断、每日上限，只问 1 次，回来的字过 sanitizeExplain()
// 提示词只在 prompts.md（经 tools/gen-prompt.mjs 生成 src/prompt.js）；怎么问、怎么合成也照 prompts.md 写
// 任何 OpenAI 兼容的 POST {LLM_BASE_URL}/chat/completions 都能接：DeepSeek（默认）、百炼 DashScope 兼容模式、OpenAI 等
// 🔒 key 只在发请求那一刻从 env.LLM_API_KEY 读，不进配置对象、不进日志、不进报错消息、不进响应（tests/llm.test.mjs 反向断言）
// 🔒 默认不花钱：只有 MOCK === "0" 且有 key 才会真调用；任何一步出错都回规则
// 🔒 花钱有全局封顶：每次调用前先向 Durable Object BUDGET 预留（src/budget.js），超了当天就只用规则
import { PROMPT } from "./prompt.js";
import { takeBudget } from "./budget.js";
import { canonical, sha256Hex, sanitizeReading } from "../public/js/signs.js";
import { ruleReading } from "../public/js/rules.js";
import { normalizeExplainRequest, ruleExplain, sanitizeExplain } from "../public/js/explain.js";

export const DEFAULTS = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  maxCallsPerMin: 60, // 每个 Worker 实例每分钟最多几次调用（尽力而为，见 guard()）；演示方案一页约 20 条请求 × 3 次 = 60
  maxCallsPerDay: 600, // 全局每天最多几次调用（BUDGET 计数，真封顶）：DeepSeek 约 ¥0.002 / 次 → 每天约 ¥1.2，最坏约 ¥2.4
  timeoutMs: 6000, // 每次调用的超时；浏览器端 reader.js 等 8 秒，要比它短
};
export const SAMPLES = 3; // 每类人每句话问几次（prompts.md）
const MAX_TOKENS = 300; // 回一个 JSON 读数约 80–120 token
const MEM_MAX = 500; // 实例内存缓存最多几条
const CACHE_TTL_S = 30 * 24 * 3600; // KV / Cache API 存 30 天：同一句话同一类人的读数不会变（prompt_v、模型都进键）
const BREAKER_FAILS = 3; // 连续几份读数整份失败（有效的不到 2 次）……
const BREAKER_MS = 60_000; // ……就这么久不再问大模型，直接规则：key 错了或服务商挂了时，别让每个请求都白等 6 秒
export const EXPLAIN_CALLS = 1; // 一次解读问几次（不做三次合成）= 向每日计数预留几次
const EXPLAIN_MAX_TOKENS = 1500; // 3–5 套方案的优缺点、风险、倾向；中文约 600–900 token
export const EXPLAIN_TIMEOUT_MS = 20_000; // 解读输出长，6 秒不够；LLM_TIMEOUT_MS 更大就用它。浏览器端 explainOptions() 等 25 秒

export class LlmError extends Error {
  // 消息只有固定短码，不带服务商回的内容（可能回显请求头）
  constructor(code) {
    super(`llm: ${code}`);
    this.name = "LlmError";
    this.code = code;
  }
}

// ---------------------------------------------------------------- 配置

const str = (x) => (typeof x === "string" ? x.trim() : "");
const hasKey = (env) => str(env?.LLM_API_KEY) !== "";

function baseOf(x) {
  const raw = str(x) || DEFAULTS.baseUrl;
  try {
    const u = new URL(raw);
    const local = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
    if ((u.protocol !== "https:" && !local) || u.username || u.password || u.search || u.hash) return { url: raw, ok: false, host: "" };
    return { url: u.href.replace(/\/+$/, ""), ok: true, host: u.hostname };
  } catch {
    return { url: raw, ok: false, host: "" };
  }
}

// 服务商只决定额外带什么参数；不认识的一律按普通 OpenAI 兼容处理
function providerOf(host, model) {
  if (host.includes("dashscope")) return "dashscope"; // 百炼上也有 deepseek-* 模型：按地址算百炼
  if (host === "api.deepseek.com" || host.endsWith(".deepseek.com") || model.startsWith("deepseek")) return "deepseek";
  return "openai-compatible";
}

// env → 配置（不含 key 的值）。mode = "llm" 只在 MOCK === "0"、有 key、地址合法时
export function llmConfig(env = {}) {
  const base = baseOf(env.LLM_BASE_URL);
  const m = str(env.LLM_MODEL);
  const model = /^[A-Za-z0-9._:/-]{1,80}$/.test(m) ? m : DEFAULTS.model;
  const n = num(env.LLM_MAX_CALLS_PER_MIN);
  const d = num(env.LLM_MAX_CALLS_PER_DAY);
  const t = num(env.LLM_TIMEOUT_MS);
  const mock = env.MOCK !== "0";
  const key = hasKey(env);
  return {
    mode: !mock && key && base.ok ? "llm" : "rules",
    mock,
    key,
    baseUrl: base.url,
    baseOk: base.ok,
    provider: providerOf(base.host, model),
    model,
    maxCallsPerMin: Number.isInteger(n) && n > 0 ? n : DEFAULTS.maxCallsPerMin,
    maxCallsPerDay: Number.isInteger(d) && d >= 0 ? d : DEFAULTS.maxCallsPerDay, // 0 = 一次都不许
    timeoutMs: Number.isFinite(t) && t > 0 && t <= 30_000 ? t : DEFAULTS.timeoutMs,
  };
}

const num = (x) => (typeof x === "number" ? x : Number(str(x) || NaN));

// 跨请求的读数缓存用哪个：kv（有 READINGS 绑定，跨实例）> cache-api（本机房共享）> memory（只有本实例内存 500 条）
// host = 请求的主机名：Cloudflare 的 Cache API 按域名（zone）存，*.workers.dev 上 put / match 不生效（官方文档），那里只剩内存
export const isWorkersDev = (host) => /(^|\.)workers\.dev$/i.test(str(host));
export function cacheKind(env = {}, host = "") {
  const kv = env.READINGS;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function") return "kv";
  if (!isWorkersDev(host) && globalThis.caches?.default && typeof globalThis.caches.default.match === "function") return "cache-api";
  return "memory";
}

const hasBudget = (env) => typeof env?.BUDGET?.idFromName === "function";

// GET /api/health 的 llm 字段：只说有没有 key，不给值。host 同 cacheKind
export function llmStatus(env = {}, host = "") {
  const c = llmConfig(env);
  const out = {
    mode: c.mode,
    model: c.model,
    key: c.key,
    cache: cacheKind(env, host),
    prompt_v: PROMPT.v,
    explain_v: PROMPT.explain.v, // AI 解读提示词的版本（prompts.md「AI 解读」）
    provider: c.provider,
    budget: hasBudget(env), // 有没有全局每日计数（没有就算 mode 是 llm 也不会调用）
    per_day: c.maxCallsPerDay,
    per_min: c.maxCallsPerMin,
  };
  if (!c.baseOk) out.error = "bad_base_url";
  return out;
}

// ---------------------------------------------------------------- 提示词

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

function signBlock(s, n) {
  const kind_label = PROMPT.kinds[s.kind];
  const lines = s.kind === "vms" ? s.frames.map((f) => f.join("\n")).join("\n---\n") : s.text;
  if (!lines) return fill(PROMPT.arrowEmpty, { n, kind_label, read_s: s.read_s });
  return fill(PROMPT.sign, { n, kind_label, read_s: s.read_s, sign_lines: lines });
}

// 第 i 次（0 起）的消息；roads = 这一次的路名顺序
export function buildMessages(req, i, roads = req.roads) {
  const user = fill(PROMPT.user, {
    persona_line: PROMPT.personas[req.persona],
    kmh: req.kmh,
    signs: req.signs.map((s, j) => signBlock(s, j + 1)).join("\n"),
    roads: roads.join("; "),
    ask: PROMPT.asks[i % PROMPT.asks.length],
  });
  return [
    { role: "system", content: PROMPT.system },
    { role: "user", content: user },
  ];
}

// 按种子（请求规范串的 SHA-256）洗牌，同一请求每次一样；尽量三次三种顺序（2 条路只有 2 种，第 3 次同第 1 次）
function rng(seedHex) {
  let a = parseInt(String(seedHex).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function roadOrders(roads, seedHex, n = SAMPLES) {
  const rand = rng(seedHex);
  const shuffle = () => {
    const a = [...roads];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const distinct = roads.length <= 1 ? 1 : roads.length === 2 ? 2 : Infinity;
  const orders = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    let o;
    if (seen.size >= distinct) o = [...orders[i % distinct]];
    else {
      for (let t = 0; t < 30; t++) {
        o = shuffle();
        if (!seen.has(o.join("\n"))) break;
      }
      if (seen.has(o.join("\n"))) o = [...roads.slice(i % roads.length), ...roads.slice(0, i % roads.length)]; // 兜底：轮转
    }
    seen.add(o.join("\n"));
    orders.push(o);
  }
  return orders;
}

// ---------------------------------------------------------------- 调用

export function chatUrl(cfg) {
  return `${cfg.baseUrl}/chat/completions`;
}

export function requestBody(cfg, messages, maxTokens = MAX_TOKENS) {
  const body = { model: cfg.model, messages, response_format: { type: "json_object" }, max_tokens: maxTokens, stream: false };
  if (cfg.provider === "deepseek") body.thinking = { type: "disabled" }; // 不关的话 content 是空串（jinmingq-deepseek.md §5）
  if (cfg.provider === "dashscope") body.enable_thinking = false;
  return body;
}

// 回答文本 → 对象。容忍 ```json 围栏和前后多余的字；不是 JSON 对象就抛 bad_json
export function parseJsonObject(content) {
  const t = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const tries = [t];
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      // 试下一个
    }
  }
  throw new LlmError("bad_json");
}

// 一次调用 → 解析好的对象；失败抛 LlmError（只带短码）
export async function askOnce(env, cfg, messages, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== "function") throw new LlmError("no_fetch");
  const ms = opts.timeoutMs ?? cfg.timeoutMs ?? DEFAULTS.timeoutMs;
  const ctl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new LlmError("timeout"));
    }, ms);
  });
  try {
    const res = await Promise.race([
      f(chatUrl(cfg), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${str(env.LLM_API_KEY)}` },
        body: JSON.stringify(requestBody(cfg, messages, opts.maxTokens)),
        signal: ctl.signal,
      }),
      timeout,
    ]);
    if (!res || !res.ok) throw new LlmError(`http_${Number(res?.status) || 0}`);
    const data = await Promise.race([res.json(), timeout]);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new LlmError("no_content");
    return parseJsonObject(content);
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(ctl.signal.aborted ? "timeout" : "network"); // 不透传原始报错
  } finally {
    clearTimeout(timer);
  }
}

// 数字写成字符串（"0.8"）的宽容一下；别的不猜
function coerce(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };
  for (const k of ["notice", "understand", "trust", "saving_min", "delay_min"]) {
    if (typeof out[k] === "string" && out[k].trim() !== "" && Number.isFinite(Number(out[k]))) out[k] = Number(out[k]);
  }
  return out;
}

// ---------------------------------------------------------------- 三次合成一份（prompts.md「三次怎么合成一份读数」）

const r2 = (x) => Math.round(x * 100) / 100;

function median(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function combine(samples, req, cfg) {
  if (samples.length < 2) return null;
  const mean = (k) => r2(samples.reduce((s, r) => s + r[k], 0) / samples.length);
  const range = {};
  for (const k of ["notice", "understand", "trust"]) {
    const v = samples.map((r) => r[k]);
    range[k] = [Math.min(...v), Math.max(...v)];
  }
  const advice = {};
  for (const road of new Set(samples.flatMap((r) => Object.keys(r.advice)))) {
    const said = samples.map((r) => r.advice[road]);
    const use = said.filter((x) => x === "use").length;
    const avoid = said.filter((x) => x === "avoid").length;
    if (avoid >= 2 || (use >= 1 && avoid >= 1)) advice[road] = "avoid";
    else if (use >= 2) advice[road] = "use";
  }
  const trust = mean("trust");
  const why = samples.reduce((best, r) => (Math.abs(r.trust - trust) < Math.abs(best.trust - trust) ? r : best)).why;
  return sanitizeReading(
    {
      notice: mean("notice"),
      understand: mean("understand"),
      advice,
      saving_min: median(samples.map((r) => r.saving_min)),
      delay_min: median(samples.map((r) => r.delay_min)),
      trust,
      why,
      range,
      model: cfg.model,
      prompt_v: PROMPT.v,
    },
    req,
    "llm",
  );
}

// 不带缓存：问 3 次（并行）→ 合成。预计算工具直接用这个
// 返回 { reading | null, valid, errors[], calls }；errors 只有短码
export async function llmReading(req, env, opts = {}) {
  const cfg = opts.cfg || llmConfig(env);
  const seed = await sha256Hex(canonical(req));
  const orders = roadOrders(req.roads, seed);
  const results = await Promise.allSettled(orders.map((roads, i) => askOnce(env, cfg, buildMessages(req, i, roads), opts)));
  const valid = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "rejected") {
      errors.push(r.reason instanceof LlmError ? r.reason.code : "error");
      continue;
    }
    const s = sanitizeReading(coerce(r.value), req, "llm");
    if (s) valid.push(s);
    else errors.push("invalid");
  }
  return { reading: combine(valid, req, cfg), valid: valid.length, errors, calls: orders.length };
}

// ---------------------------------------------------------------- Worker 用：缓存 + 限流 + 熔断

const state = { mem: new Map(), win: { start: 0, n: 0 }, breaker: { fails: 0, until: 0 }, capUntil: 0 };

// 测试用：清掉实例内的内存缓存、限流计数和熔断
export function resetLlmState() {
  state.mem.clear();
  state.win = { start: 0, n: 0 };
  state.breaker = { fails: 0, until: 0 };
  state.capUntil = 0;
}

export const cacheKey = (req, cfg) => sha256Hex(`${PROMPT.v}|${cfg.model}|${canonical(req)}`);

// 每个 Worker 实例一个计数器，尽力而为：Cloudflare 会同时开多个实例、也会随时回收，所以这不是账单上限
// （账单上限是 src/budget.js 的全局每日计数 + 服务商那边少充值）。它只负责别在一分钟里把一天的额度用光
function guard(n, max, now) {
  if (now - state.win.start >= 60_000) state.win = { start: now, n: 0 };
  if (state.win.n + n > max) return false;
  state.win.n += n;
  return true;
}

function memSet(key, reading) {
  if (state.mem.size >= MEM_MAX) state.mem.delete(state.mem.keys().next().value);
  state.mem.set(key, reading);
}

// KV（有 READINGS 绑定时）或 Cache API（Workers 自带；*.workers.dev 上不生效，那里 cacheKind 回 memory，不去碰它）
// ns：读数 "read"、解读 "explain"，键前缀分开（KV 里是 read:<哈希> / explain:<哈希>）
function store(env, origin, ns = "read") {
  let host = "";
  try {
    host = origin ? new URL(origin).hostname : "";
  } catch {
    // 坏 origin 当没有
  }
  const kind = cacheKind(env, host);
  if (kind === "kv") {
    const kv = env.READINGS;
    return {
      get: async (k) => {
        const t = await kv.get(`${ns}:${k}`);
        return t ? JSON.parse(t) : null;
      },
      put: (k, v) => kv.put(`${ns}:${k}`, JSON.stringify(v), { expirationTtl: CACHE_TTL_S }),
    };
  }
  if (kind === "cache-api") {
    const cache = globalThis.caches.default;
    const url = (k) => new URL(`/__cache/llm-${ns}/${k}`, origin || "https://hackathon-api.internal").href;
    return {
      get: async (k) => {
        const r = await cache.match(url(k));
        return r ? r.json() : null;
      },
      put: (k, v) =>
        cache.put(
          url(k),
          new Response(JSON.stringify(v), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_TTL_S}` } }),
        ),
    };
  }
  return { get: async () => null, put: async () => {} };
}

const fallback = (req, note) => ({ ...ruleReading(req), note: String(note).slice(0, 120) });

// 一次（读数整份 / 解读）失败记一笔；连续 BREAKER_FAILS 次就暂停 BREAKER_MS。读屏和解读同一个服务商、同一把 key，共用一个熔断
function trip(now) {
  if (++state.breaker.fails >= BREAKER_FAILS) state.breaker = { fails: 0, until: now + BREAKER_MS };
}

// 调用前的三道闸（熔断 → 本实例已知今天用完 → 每分钟 → 全局每日预留 n 次）；放行回 null，否则回 note 短码
async function admit(env, cfg, n, now) {
  if (now < state.breaker.until) return "llm_paused: recent calls failed";
  if (now < state.capUntil) return "llm_daily_cap"; // 本实例已知今天用完了：不再每次去问 DO
  if (!guard(n, cfg.maxCallsPerMin, now)) return "llm_rate_limited";
  // 全局每日封顶：先预留，拿不到就不调用（没绑 BUDGET / DO 出错也一样，不花没记账的钱）
  const budget = await takeBudget(env, n, cfg.maxCallsPerDay);
  if (budget === "over") state.capUntil = (Math.floor(now / 86_400_000) + 1) * 86_400_000; // 到下一个 UTC 0 点
  if (budget !== "ok") return { over: "llm_daily_cap", no_budget: "llm_no_budget" }[budget] || "llm_budget_error";
  return null;
}

// Worker 的读法：内存 → KV / Cache API → 大模型（3 次）→ 存缓存；拿不到就规则 + note。调用方已确认 mode === "llm"
// opts：{ origin, fetch, timeoutMs, now }（测试注入）
export async function serverReading(req, env, opts = {}) {
  const cfg = llmConfig(env);
  if (cfg.mode !== "llm") return ruleReading(req);
  if (!req.signs.length) return ruleReading(req); // 没有标志：没东西可读
  const now = opts.now ?? Date.now();
  const key = await cacheKey(req, cfg);

  const hot = state.mem.get(key);
  if (hot) return sanitizeReading(hot, req, "kv");
  const st = store(env, opts.origin);
  try {
    const hit = await st.get(key);
    const r = hit && sanitizeReading(hit, req, "kv");
    if (r) {
      memSet(key, r);
      return r;
    }
  } catch {
    // 缓存坏了不影响读数
  }

  const shut = await admit(env, cfg, SAMPLES, now); // 一份读数问 3 次 = 预留 3 次
  if (shut) return fallback(req, shut);

  const out = await llmReading(req, env, { ...opts, cfg });
  if (!out.reading) {
    trip(now);
    return fallback(req, `llm_fallback: ${out.valid}/${out.calls} valid (${[...new Set(out.errors)].join(", ")})`);
  }
  state.breaker.fails = 0;
  memSet(key, out.reading);
  try {
    await st.put(key, out.reading);
  } catch {
    // 存不进去下次再问
  }
  return out.reading;
}

// ---------------------------------------------------------------- AI 解读（POST /api/explain，prompts.md「AI 解读」）

// 规范化后的请求 → 消息。user 里只有 normalizeExplainRequest() 的输出（方案 id / label / metrics / per_capita_min / flags）和语言
export function buildExplainMessages(req) {
  const E = PROMPT.explain;
  return [
    { role: "system", content: E.system },
    { role: "user", content: fill(E.user, { lang_name: E.langs[req.lang], options_json: JSON.stringify(req.options) }) },
  ];
}

// 规范化请求的键顺序是固定的（normalizeExplainRequest 按固定顺序拼），JSON.stringify 就是规范串
export const explainKey = (req, cfg) => sha256Hex(`explain|${PROMPT.explain.v}|${cfg.model}|${JSON.stringify(req)}`);

const explainFallback = (req, note) => ({ ...ruleExplain(req), note: String(note).slice(0, 120) });

// 清洗后还剩几处模型写的字（换回规则版的 summary、规则版本来就有的风险不算）；0 = 等于没回答
function authored(clean, rule) {
  let n = clean.lean ? 1 : 0;
  clean.options.forEach((o, i) => {
    const r = rule.options[i];
    n += (o.summary !== r.summary ? 1 : 0) + o.pros.length + o.cons.length + Math.max(0, o.risks.length - r.risks.length);
  });
  return n;
}

// 缓存里的解读也当不可信数据：再过一遍 sanitizeExplain（谁最吃亏、规则风险照样重算）
const explainFromCache = (hit, req) => sanitizeExplain(hit, req, "kv");

// Worker 的解读：规则（没开大模型）或 内存 → KV / Cache API → 大模型（1 次）→ 清洗 → 存缓存；拿不到就规则版 + note
// opts：{ origin, fetch, timeoutMs, now }（测试注入）。请求不合规范抛 ExplainError（路由回 400）
export async function serverExplain(input, env, opts = {}) {
  const req = normalizeExplainRequest(input);
  const cfg = llmConfig(env);
  if (cfg.mode !== "llm") return ruleExplain(req);
  const now = opts.now ?? Date.now();
  const key = await explainKey(req, cfg);
  const memKey = `explain:${key}`;

  const hot = state.mem.get(memKey);
  const warm = hot && explainFromCache(hot, req);
  if (warm) return warm;
  const st = store(env, opts.origin, "explain");
  try {
    const hit = await st.get(key);
    const r = hit && explainFromCache(hit, req);
    if (r) {
      memSet(memKey, hit);
      return r;
    }
  } catch {
    // 缓存坏了不影响解读
  }

  const shut = await admit(env, cfg, EXPLAIN_CALLS, now);
  if (shut) return explainFallback(req, shut);

  let raw;
  try {
    const timeoutMs = opts.timeoutMs ?? Math.max(cfg.timeoutMs, EXPLAIN_TIMEOUT_MS);
    raw = await askOnce(env, cfg, buildExplainMessages(req), { ...opts, timeoutMs, maxTokens: EXPLAIN_MAX_TOKENS });
  } catch (e) {
    trip(now);
    return explainFallback(req, `llm_fallback: ${e instanceof LlmError ? e.code : "error"}`);
  }
  // 只取 options / lean：模型自己写的 note、model、hardest_hit、decide 之类一概不认
  const clean = sanitizeExplain({ options: raw.options, lean: raw.lean }, req, "llm");
  const why = !clean ? "invalid" : !authored(clean, ruleExplain(req)) ? "empty" : null;
  if (why) {
    trip(now);
    return explainFallback(req, `llm_fallback: ${why}`);
  }
  state.breaker.fails = 0;
  const out = { ...clean, model: cfg.model, prompt_v: PROMPT.explain.v };
  memSet(memKey, out);
  try {
    await st.put(key, out);
  } catch {
    // 存不进去下次再问
  }
  return out;
}
