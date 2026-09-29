// 大模型读屏（T19）：可替换的调用层 + 问 3 次合成 + 服务端缓存。Worker（src/worker.js）和预计算工具（tools/precompute.mjs）共用
// 提示词只在 prompts.md（经 tools/gen-prompt.mjs 生成 src/prompt.js）；怎么问、怎么合成也照 prompts.md 写
// 任何 OpenAI 兼容的 POST {LLM_BASE_URL}/chat/completions 都能接：DeepSeek（默认）、百炼 DashScope 兼容模式、OpenAI 等
// 🔒 key 只在发请求那一刻从 env.LLM_API_KEY 读，不进配置对象、不进日志、不进报错消息、不进响应（tests/llm.test.mjs 反向断言）
// 🔒 默认不花钱：只有 MOCK === "0" 且有 key 才会真调用；任何一步出错都回规则
import { PROMPT } from "./prompt.js";
import { canonical, sha256Hex, sanitizeReading } from "../public/js/signs.js";
import { ruleReading } from "../public/js/rules.js";

export const DEFAULTS = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  maxCallsPerMin: 240, // 每个 Worker 实例每分钟最多几次调用（尽力而为，见 guard()）；演示方案一页约 20 条请求 × 3 次
  timeoutMs: 6000, // 每次调用的超时；浏览器端 reader.js 等 8 秒，要比它短
};
export const SAMPLES = 3; // 每类人每句话问几次（prompts.md）
const MAX_TOKENS = 300; // 回一个 JSON 读数约 80–120 token
const MEM_MAX = 500; // 实例内存缓存最多几条
const CACHE_TTL_S = 30 * 24 * 3600; // KV / Cache API 存 30 天：同一句话同一类人的读数不会变（prompt_v、模型都进键）
const BREAKER_FAILS = 3; // 连续几份读数整份失败（有效的不到 2 次）……
const BREAKER_MS = 60_000; // ……就这么久不再问大模型，直接规则：key 错了或服务商挂了时，别让每个请求都白等 6 秒

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
    timeoutMs: Number.isFinite(t) && t > 0 && t <= 30_000 ? t : DEFAULTS.timeoutMs,
  };
}

const num = (x) => (typeof x === "number" ? x : Number(str(x) || NaN));

export function cacheKind(env = {}) {
  const kv = env.READINGS;
  if (kv && typeof kv.get === "function" && typeof kv.put === "function") return "kv";
  if (globalThis.caches?.default && typeof globalThis.caches.default.match === "function") return "cache-api";
  return "none";
}

// GET /api/health 的 llm 字段：只说有没有 key，不给值
export function llmStatus(env = {}) {
  const c = llmConfig(env);
  const out = { mode: c.mode, model: c.model, key: c.key, cache: cacheKind(env), prompt_v: PROMPT.v, provider: c.provider };
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

export function requestBody(cfg, messages) {
  const body = { model: cfg.model, messages, response_format: { type: "json_object" }, max_tokens: MAX_TOKENS, stream: false };
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
        body: JSON.stringify(requestBody(cfg, messages)),
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

const state = { mem: new Map(), win: { start: 0, n: 0 }, breaker: { fails: 0, until: 0 } };

// 测试用：清掉实例内的内存缓存、限流计数和熔断
export function resetLlmState() {
  state.mem.clear();
  state.win = { start: 0, n: 0 };
  state.breaker = { fails: 0, until: 0 };
}

export const cacheKey = (req, cfg) => sha256Hex(`${PROMPT.v}|${cfg.model}|${canonical(req)}`);

// 每个 Worker 实例一个计数器，尽力而为：Cloudflare 会同时开多个实例、也会随时回收，所以这不是账单上限。
// 真要封顶去服务商后台设额度 / 充值少一点
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

// KV（有 READINGS 绑定时）或 Cache API（Workers 自带；workers.dev 上可能不生效，见 README）
function store(env, origin) {
  const kind = cacheKind(env);
  if (kind === "kv") {
    const kv = env.READINGS;
    return {
      get: async (k) => {
        const t = await kv.get(`read:${k}`);
        return t ? JSON.parse(t) : null;
      },
      put: (k, v) => kv.put(`read:${k}`, JSON.stringify(v), { expirationTtl: CACHE_TTL_S }),
    };
  }
  if (kind === "cache-api") {
    const cache = globalThis.caches.default;
    const url = (k) => new URL(`/__cache/llm-read/${k}`, origin || "https://hackathon-api.internal").href;
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

  if (now < state.breaker.until) return fallback(req, "llm_paused: recent calls failed");
  if (!guard(SAMPLES, cfg.maxCallsPerMin, now)) return fallback(req, "llm_rate_limited");

  const out = await llmReading(req, env, { ...opts, cfg });
  if (!out.reading) {
    if (++state.breaker.fails >= BREAKER_FAILS) state.breaker = { fails: 0, until: now + BREAKER_MS };
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
