// 大模型读屏（T19）：src/llm.js + src/worker.js。全部用假 fetch，一次真调用都没有
// 反向断言：默认不花钱（MOCK=1 或没 key 时 fetch 0 次）；key 不出现在任何响应、health、报错消息里
// 用法：node tests/llm.test.mjs
import { ok, eq, sec, done } from "./mini.mjs";
import worker from "../src/worker.js";
import {
  llmConfig, llmStatus, askOnce, combine, llmReading, serverReading, resetLlmState, requestBody, buildMessages, LlmError, cacheKey,
} from "../src/llm.js";
import { PROMPT } from "../src/prompt.js";
import { LlmBudget } from "../src/budget.js";
import { normalizeRequest } from "../public/js/signs.js";
import { ruleReading } from "../public/js/rules.js";

// 假 key：拼出来的，免得仓库里出现一整段像 key 的字符串（secret-scan）
const FAKE = ["fake", "k3y", "for", "tests", "7f3a9c"].join("-");

// 假的 Durable Object 命名空间：里面跑的是真的 LlmBudget 类（src/budget.js），存储换成 Map；clock 可以拨
function budgetNs(clock = () => Date.now()) {
  const data = new Map();
  const obj = new LlmBudget({ storage: { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => void data.set(k, structuredClone(v)) } }, {}, () => clock());
  const ns = {
    data,
    calls: 0,
    idFromName: (name) => ({ name }),
    get: (id) => ({
      fetch: async (u, init) => {
        ns.calls++;
        ns.ids = [...new Set([...(ns.ids || []), id.name])];
        return obj.fetch(new Request(u, init));
      },
    }),
  };
  return ns;
}
// 打开大模型（默认 DeepSeek 地址 + deepseek-flash），带全局每日计数（线上 wrangler.jsonc 绑的 BUDGET）
const ON = { MOCK: "0", LLM_API_KEY: FAKE, BUDGET: budgetNs() };

const REQ = {
  persona: "commuter",
  kmh: 40,
  signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST", "SAVE 8 MIN"]], read_s: 9 }],
  roads: ["La Trobe St", "Russell St", "Elizabeth St"],
};
const NREQ = normalizeRequest(REQ);
// 每次换一句屏上的字 = 新的缓存键（内存缓存不串味）
let seq = 0;
const fresh = () => ({ ...REQ, signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST", `SAVE ${++seq}`, "MIN"]], read_s: 9 }] });

const answer = (o) => ({
  notice: 0.8, understand: 0.9, advice: { "Russell St": "use" }, saving_min: 8, delay_min: null, trust: 0.7, why: "Sign says use Russell", ...o,
});
const chat = (content, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }),
});

// 假 fetch：第 i 次调用回 replies[i]（函数就调它）；记下 url / 请求头 / 请求体
function fakeLLM(replies) {
  const calls = [];
  const f = async (url, init) => {
    const i = calls.length;
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    const r = replies[Math.min(i, replies.length - 1)];
    return typeof r === "function" ? r(init, i) : r;
  };
  f.calls = calls;
  return f;
}

// 把 globalThis.fetch 换成假的跑 fn（Worker 用全局 fetch）
async function withFetch(f, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const call = async (path, init, env) => {
  const r = await worker.fetch(new Request(`https://api.test${path}`, init), env);
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
};
const post = (body, env) => call("/api/read", { method: "POST", body: JSON.stringify(body) }, env);

await sec("反向（计费）：默认不花钱 —— MOCK=1 或没配 MOCK，就算有 key，fetch 也 0 次", async () => {
  resetLlmState();
  const f = fakeLLM([chat(answer())]);
  await withFetch(f, async () => {
    const a = await post(REQ, { MOCK: "1", LLM_API_KEY: FAKE });
    const b = await post(REQ, { LLM_API_KEY: FAKE });
    eq([a.body.reading.src, b.body.reading.src], ["rule", "rule"], "都是规则读数");
    eq(a.body.reading, ruleReading(REQ), "和 T19 以前一模一样（纯规则，没有 note）");
  });
  eq(f.calls.length, 0, "外部 fetch 0 次");
  eq(llmConfig({ MOCK: "1", LLM_API_KEY: FAKE }).mode, "rules", "MOCK=1 → mode rules");
  eq(llmConfig({ LLM_API_KEY: FAKE }).mode, "rules", "没配 MOCK → mode rules");
});

await sec("MOCK=0 但没有 key：规则；health 说 key:false", async () => {
  resetLlmState();
  const f = fakeLLM([chat(answer())]);
  await withFetch(f, async () => {
    const r = await post(REQ, { MOCK: "0" });
    eq(r.body.reading.src, "rule", "规则读数");
    const h = await call("/api/health", {}, { MOCK: "0", LLM_API_KEY: "  " });
    eq([h.body.mock, h.body.llm.mode, h.body.llm.key], [false, "rules", false], "空白 key 也算没有");
  });
  eq(f.calls.length, 0, "fetch 0 次");
});

await sec("GET /api/health 的 llm 字段", async () => {
  const off = (await call("/api/health", {}, { MOCK: "1" })).body;
  eq(
    off.llm,
    { mode: "rules", model: "deepseek-flash", key: false, cache: "memory", prompt_v: PROMPT.v, explain_v: PROMPT.explain.v, provider: "deepseek", budget: false, per_day: 600, per_min: 60 },
    "默认：rules · deepseek-flash · 没 key · 只有内存缓存 · 没绑 BUDGET · 每天 600 / 每分钟 60",
  );
  eq((await call("/api/health", {}, ON)).body.llm.budget, true, "绑了 BUDGET → budget true");
  const on = await call("/api/health", {}, { ...ON, LLM_MODEL: "deepseek-flash" });
  eq([on.body.mock, on.body.llm.mode, on.body.llm.key], [false, "llm", true], "MOCK=0 + key → mode llm, key true");
  ok(!on.text.includes(FAKE), "反向：health 里没有 key 的值");
  const kv = { get: async () => null, put: async () => {} };
  eq((await call("/api/health", {}, { ...ON, READINGS: kv })).body.llm.cache, "kv", "有 READINGS 绑定 → cache kv");
  const bad = (await call("/api/health", {}, { ...ON, LLM_BASE_URL: "http://evil.example" })).body.llm;
  eq([bad.mode, bad.error], ["rules", "bad_base_url"], "非 https 地址 → 不调用，health 报 bad_base_url");
});

await sec("MOCK=0 + key + 假大模型：问 3 次、取平均、给区间、过 sanitize", async () => {
  resetLlmState();
  const f = fakeLLM([
    chat(answer({ notice: 0.8, understand: 0.9, trust: 0.6, saving_min: 8, why: "one" })),
    chat(answer({ notice: 0.9, understand: 0.8, trust: 0.7, saving_min: 10, why: "two\u0000 two", advice: { "Russell St": "use", "Fake Rd": "use" } })),
    chat("```json\n" + JSON.stringify(answer({ notice: 0.7, understand: 1, trust: 0.9, saving_min: 9, why: "three" })) + "\n```"),
  ]);
  const r = await withFetch(f, () => post(REQ, ON));
  const x = r.body.reading;
  eq(f.calls.length, 3, "3 次调用");
  eq([x.src, x.model, x.prompt_v], ["llm", "deepseek-flash", PROMPT.v], "src llm · model · prompt_v");
  eq([x.notice, x.understand, x.trust], [0.8, 0.9, 0.73], "三次平均");
  eq(x.range, { notice: [0.7, 0.9], understand: [0.8, 1], trust: [0.6, 0.9] }, "range = [最小, 最大]");
  eq(x.saving_min, 9, "saving_min 取中位数");
  eq(x.advice, { "Russell St": "use" }, "反向：请求里没有的路（Fake Rd）被丢掉");
  eq(x.why, "two two", "why 取 trust 最接近平均的那次，控制字符清掉");
  const c0 = f.calls[0];
  eq(c0.url, "https://api.deepseek.com/chat/completions", "POST {LLM_BASE_URL}/chat/completions");
  eq(c0.headers.authorization, `Bearer ${FAKE}`, "Authorization: Bearer <key>");
  eq([c0.body.model, c0.body.response_format, c0.body.stream], ["deepseek-flash", { type: "json_object" }, false], "只回 JSON、不流式");
  ok(c0.signal && typeof c0.signal.aborted === "boolean", "带 AbortController 的 signal（超时会 abort）");
  const users = f.calls.map((c) => c.body.messages[1].content);
  eq(new Set(users.map((u) => u.split("\n").pop())).size, 3, "三次三种问法");
  eq(new Set(users.map((u) => u.match(/Candidate roads[^\n]*/)[0])).size, 3, "三次三种路名顺序");
  ok(users.every((u) => u.includes("<sign>\nUSE\nRUSSELL ST\nSAVE 8 MIN\n</sign>")), "屏上的字原样放在 <sign> 标签里");
  ok(f.calls.every((c) => c.body.messages[0].content === PROMPT.system), "system 用 prompts.md 的原文");
});

await sec("DeepSeek 带 thinking disabled；别家不带（按地址 / 模型判断）", async () => {
  const m = buildMessages(NREQ, 0);
  eq(requestBody(llmConfig(ON), m).thinking, { type: "disabled" }, "默认 DeepSeek：thinking disabled（不关 content 是空串）");
  const oa = requestBody(llmConfig({ ...ON, LLM_BASE_URL: "https://api.openai.com/v1", LLM_MODEL: "gpt-4o-mini" }), m);
  ok(!("thinking" in oa) && !("enable_thinking" in oa), "OpenAI：不带 thinking / enable_thinking");
  const ds = requestBody(llmConfig({ ...ON, LLM_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", LLM_MODEL: "qwen-plus" }), m);
  eq([ds.enable_thinking, "thinking" in ds], [false, false], "百炼：enable_thinking false");
  const dsDeep = llmConfig({ ...ON, LLM_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1", LLM_MODEL: "deepseek-v3" });
  eq(dsDeep.provider, "dashscope", "百炼上的 deepseek-* 模型按百炼处理");
});

await sec("兜底：坏 JSON / 超时 / 500 / 3 次里只有 1 次有效 → 规则 + note", async () => {
  const cases = [
    ["坏 JSON", [chat("sure! here you go")], "bad_json"],
    ["HTTP 500", [chat("", 500)], "http_500"],
    ["空 content", [chat("")], "no_content"],
    ["字段不对", [chat({ notice: 2, understand: "x" })], "invalid"],
    ["1/3 有效", [chat(answer()), chat("nope"), chat("", 503)], "1/3 valid"],
    ["超时", [() => new Promise(() => {})], "timeout"],
  ];
  for (const [name, replies, want] of cases) {
    resetLlmState();
    const f = fakeLLM(replies);
    const r = await withFetch(f, () => post(fresh(), { ...ON, LLM_TIMEOUT_MS: "30" }));
    const x = r.body.reading;
    ok(r.status === 200 && x.src === "rule" && typeof x.note === "string" && x.note.includes(want), `${name} → 规则，note 含「${want}」（实际 ${x.src} · ${x.note}）`);
  }
  resetLlmState();
  const two = fakeLLM([chat(answer({ trust: 0.6 })), chat("nope"), chat(answer({ trust: 0.8 }))]);
  const r2 = await withFetch(two, () => post(fresh(), ON));
  eq([r2.body.reading.src, r2.body.reading.trust], ["llm", 0.7], "3 次里 2 次有效 → 仍用大模型（2 次平均）");
});

await sec("缓存：同一请求第二次不再调大模型（内存 → KV → Cache API）", async () => {
  resetLlmState();
  const f = fakeLLM([chat(answer())]);
  const a = await withFetch(f, () => post(REQ, ON));
  const b = await withFetch(f, () => post(REQ, ON));
  eq([f.calls.length, a.body.reading.src, b.body.reading.src], [3, "llm", "kv"], "内存缓存：第二次 0 次调用，src kv");

  resetLlmState();
  const store = new Map();
  const KV = { get: async (k) => store.get(k) ?? null, put: async (k, v, o) => void store.set(k, v) || (KV.ttl = o?.expirationTtl) };
  const g = fakeLLM([chat(answer())]);
  await withFetch(g, () => post(REQ, { ...ON, READINGS: KV }));
  eq([g.calls.length, store.size], [3, 1], "KV：第一次问 3 次、存 1 条");
  ok(KV.ttl > 0, "KV 存的时候带过期时间");
  ok(![...store.values()].some((v) => v.includes(FAKE)), "反向：KV 里没有 key");
  resetLlmState(); // 清内存，模拟换了一个 Worker 实例
  const c = await withFetch(g, () => post(REQ, { ...ON, READINGS: KV }));
  eq([g.calls.length, c.body.reading.src, c.body.reading.advice], [3, "kv", { "Russell St": "use" }], "KV 命中：没再调用，src kv");
  const other = await withFetch(g, () => post(REQ, { ...ON, READINGS: KV, LLM_MODEL: "deepseek-pro" }));
  eq([g.calls.length, other.body.reading.model], [6, "deepseek-pro"], "换模型 = 换缓存键，重新问");
  ok(
    (await cacheKey(NREQ, llmConfig(ON))) !== (await cacheKey(NREQ, llmConfig({ ...ON, LLM_MODEL: "x" }))),
    "缓存键含模型名",
  );

  resetLlmState();
  const cache = new Map();
  const realCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async (u) => (cache.has(u) ? new Response(cache.get(u)) : undefined),
      put: async (u, res) => void cache.set(u, await res.text()),
    },
  };
  try {
    const h = fakeLLM([chat(answer())]);
    eq(llmStatus(ON).cache, "cache-api", "没有 KV 时用 Workers 自带的 Cache API");
    await withFetch(h, () => post(REQ, ON));
    ok([...cache.keys()].every((u) => u.startsWith("https://api.test/__cache/llm-read/")), "Cache API 的键是同源的假网址");
    resetLlmState();
    const d = await withFetch(h, () => post(REQ, ON));
    eq([h.calls.length, d.body.reading.src], [3, "kv"], "Cache API 命中：没再调用");
  } finally {
    globalThis.caches = realCaches;
  }

  resetLlmState();
  const bad = fakeLLM([chat("nope")]);
  await withFetch(bad, () => post(fresh(), ON));
  const again = { ...REQ, signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST", `SAVE ${seq}`, "MIN"]], read_s: 9 }] };
  await withFetch(bad, () => post(again, ON));
  eq(bad.calls.length, 6, "规则兜底的读数不进缓存（下次还会再问）");
});

await sec("限流和熔断（每个实例尽力而为）", async () => {
  resetLlmState();
  const f = fakeLLM([chat(answer())]);
  const env = { ...ON, LLM_MAX_CALLS_PER_MIN: "3" };
  const a = await withFetch(f, () => post(fresh(), env));
  const b = await withFetch(f, () => post(fresh(), env));
  eq([a.body.reading.src, b.body.reading.src, b.body.reading.note, f.calls.length], ["llm", "rule", "llm_rate_limited", 3], "每分钟 3 次：第二条请求直接规则，不调用");

  resetLlmState();
  const g = fakeLLM([chat("", 401)]);
  for (let i = 0; i < 3; i++) await withFetch(g, () => post(fresh(), ON));
  const n = g.calls.length;
  const c = await withFetch(g, () => post(fresh(), ON));
  eq([n, g.calls.length, c.body.reading.note?.startsWith("llm_paused")], [9, 9, true], "连续 3 份整份失败 → 暂停问大模型（key 错了不让每个请求白等）");
});

await sec("没有标志的请求不问大模型", async () => {
  resetLlmState();
  const f = fakeLLM([chat(answer())]);
  const r = await withFetch(f, () => post({ ...REQ, signs: [] }, ON));
  eq([r.body.reading.src, r.body.reading.notice, f.calls.length], ["rule", 0, 0], "规则 notice 0，fetch 0 次");
});

await sec("反向（安全）：key 不出现在任何响应体、health、报错消息里", async () => {
  // 服务商把请求头回显在报错里 / fetch 抛出带 key 的异常 / 回显进 content
  const echo = (init) => ({ ok: false, status: 401, json: async () => ({ error: `bad key ${init.headers.authorization}` }), text: async () => init.headers.authorization });
  const thrower = (init) => {
    throw new Error(`connect failed with ${init.headers.authorization}`);
  };
  for (const [name, reply] of [["401 回显请求头", echo], ["fetch 抛带 key 的错", thrower]]) {
    resetLlmState();
    const f = fakeLLM([reply]);
    const r = await withFetch(f, () => post(fresh(), ON));
    ok(r.body.reading.src === "rule" && !r.text.includes(FAKE), `${name}：回规则，响应里没有 key`);
    let msg = "";
    try {
      await askOnce(ON, llmConfig(ON), buildMessages(NREQ, 0), { fetch: f });
    } catch (e) {
      msg = `${e.message} ${e.stack} ${JSON.stringify(e)}`;
      ok(e instanceof LlmError, `${name}：askOnce 抛 LlmError（${e.code}）`);
    }
    ok(msg && !msg.includes(FAKE), `${name}：报错消息 / 堆栈里没有 key`);
  }
  const h = await call("/api/health", {}, ON);
  ok(!h.text.includes(FAKE) && !JSON.stringify(llmConfig(ON)).includes(FAKE), "health 和配置对象里都没有 key 的值");
  resetLlmState();
  const f = fakeLLM([chat(answer())]);
  const r = await withFetch(f, () => post(fresh(), ON));
  ok(r.body.reading.src === "llm" && !r.text.includes(FAKE), "成功时的响应里也没有 key");
});

await sec("合成规则（prompts.md「三次怎么合成」）", async () => {
  const cfg = llmConfig(ON);
  const s = (o) => ({ ...answer(o), persona: "commuter", src: "llm" });
  const x = combine([s({ advice: { "Russell St": "use" } }), s({ advice: { "Russell St": "avoid" } }), s({ advice: {} })], NREQ, cfg);
  eq(x.advice, { "Russell St": "avoid" }, "use / avoid 各 1 次 → avoid");
  const y = combine([s({ advice: { "Russell St": "use", "Elizabeth St": "avoid" } }), s({ advice: { "Russell St": "use" } }), s({})], NREQ, cfg);
  eq(y.advice, { "Russell St": "use" }, "至少 2 次一致才算；只 1 次提到的不出现");
  const z = combine([s({ delay_min: 10 }), s({ delay_min: null }), s({ delay_min: null })], NREQ, cfg);
  eq(z.delay_min, null, "非 null 的不到 2 个 → null");
  eq(combine([s({})], NREQ, cfg), null, "只有 1 份 → null（调用方回规则）");
  const w = combine([s({ saving_min: 4 }), s({ saving_min: 7 })], NREQ, cfg);
  eq(w.saving_min, 6, "2 个取中间（5.5 四舍五入）");
});

await sec("llmReading（预计算工具用的同一条路）直接调", async () => {
  const f = fakeLLM([chat(answer())]);
  const out = await llmReading(NREQ, ON, { fetch: f });
  eq([out.valid, out.calls, out.errors, out.reading.src], [3, 3, [], "llm"], "3 次都有效");
  const off = await serverReading(NREQ, { MOCK: "1", LLM_API_KEY: FAKE }, { fetch: f });
  eq([off.src, f.calls.length], ["rule", 3], "serverReading 自己也查 MOCK：MOCK=1 不调用");
});

await sec("反向（计费）：全局每日封顶 —— 多实例、换 read_s 绕缓存也超不过 LLM_MAX_CALLS_PER_DAY", async () => {
  const f = fakeLLM([chat(answer())]);
  const BUDGET = budgetNs();
  const env = { ...ON, BUDGET, LLM_MAX_CALLS_PER_DAY: "30", LLM_MAX_CALLS_PER_MIN: "100000" };
  resetLlmState();
  const srcs = [];
  // 复现审查的打法：同一句屏上的字，只改 read_s，每条都是新缓存键；每 5 条清一次实例状态 = 换了一个 Worker 实例
  for (let i = 0; i < 40; i++) {
    if (i % 5 === 0) resetLlmState();
    const r = await withFetch(f, () => post({ ...REQ, signs: [{ kind: "vms", frames: [["ROAD", "CLOSED"]], read_s: i }] }, env));
    srcs.push(r.body.reading.note || r.body.reading.src);
  }
  eq(f.calls.length, 30, "外部调用正好 30 次（= 每日上限），之后一次都没有");
  eq(srcs.filter((x) => x === "llm").length, 10, "10 份大模型读数（每份 3 次）");
  ok(srcs.slice(10).every((x) => x === "llm_daily_cap"), `超了以后全是规则 + llm_daily_cap（${[...new Set(srcs.slice(10))].join(", ")}）`);
  eq(BUDGET.ids, ["global"], "所有实例记同一本账（idFromName(\"global\")）");

  const before = BUDGET.calls;
  await withFetch(f, () => post(fresh(), env));
  eq(BUDGET.calls, before, "本实例知道今天用完了：不再每次去问 DO");
});

await sec("每日计数到 UTC 第二天清零；0 = 一次都不许", async () => {
  let t = Date.parse("2026-09-30T23:59:00Z");
  const BUDGET = budgetNs(() => t);
  const f = fakeLLM([chat(answer())]);
  const env = { ...ON, BUDGET, LLM_MAX_CALLS_PER_DAY: "3" };
  resetLlmState();
  const a = await withFetch(f, () => post(fresh(), env));
  resetLlmState();
  const b = await withFetch(f, () => post(fresh(), env));
  t += 120_000; // 过了 UTC 0 点
  resetLlmState();
  const c = await withFetch(f, () => post(fresh(), env));
  eq([a.body.reading.src, b.body.reading.note, c.body.reading.src, f.calls.length], ["llm", "llm_daily_cap", "llm", 6], "当天第 2 份被拦，第二天又能问");
  eq([...BUDGET.data.keys()].length, 1, "DO 里只存一条（不会一天一条越存越多）");

  resetLlmState();
  const g = fakeLLM([chat(answer())]);
  const z = await withFetch(g, () => post(fresh(), { ...ON, BUDGET: budgetNs(), LLM_MAX_CALLS_PER_DAY: "0" }));
  eq([z.body.reading.note, g.calls.length], ["llm_daily_cap", 0], "LLM_MAX_CALLS_PER_DAY=0 → 不调用");
});

await sec("反向（计费）：没绑 BUDGET 或 DO 出错 → 不调用（不花没记账的钱）", async () => {
  const f = fakeLLM([chat(answer())]);
  resetLlmState();
  const env = { MOCK: "0", LLM_API_KEY: FAKE };
  const a = await withFetch(f, () => post(fresh(), env));
  const h = await call("/api/health", {}, env);
  eq([a.body.reading.src, a.body.reading.note, h.body.llm.mode, h.body.llm.budget], ["rule", "llm_no_budget", "llm", false], "没绑 BUDGET：规则 + llm_no_budget；health 说 budget false");
  const boom = { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error("do down"); } }) };
  const b = await withFetch(f, () => post(fresh(), { ...env, BUDGET: boom }));
  const bad = { idFromName: () => ({}), get: () => ({ fetch: async () => new Response("nope", { status: 500 }) }) };
  const c = await withFetch(f, () => post(fresh(), { ...env, BUDGET: bad }));
  eq([b.body.reading.note, c.body.reading.note], ["llm_budget_error", "llm_budget_error"], "DO 抛错 / 回 500 → llm_budget_error");
  eq(f.calls.length, 0, "外部 fetch 0 次");
});

await sec("LlmBudget（Durable Object 本体）", async () => {
  const data = new Map();
  const d = new LlmBudget({ storage: { get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v) } }, {}, () => Date.parse("2026-10-01T05:00:00Z"));
  const take = async (q) => (await d.fetch(new Request(`https://budget.internal/take?${q}`, { method: "POST" }))).json();
  eq(await take("n=3&max=5"), { ok: true, used: 3, max: 5, day: "2026-10-01" }, "预留 3 / 5");
  eq(await take("n=3&max=5"), { ok: false, used: 3, max: 5, day: "2026-10-01" }, "再要 3 次超了：拒，且不记账");
  eq((await take("n=2&max=5")).ok, true, "要 2 次还够");
  const bad = await d.fetch(new Request("https://budget.internal/take?n=-1&max=5", { method: "POST" }));
  eq(bad.status, 400, "n 不合法 → 400（调用方当出错，不调用）");
});

await sec("缓存种类：*.workers.dev 上 Cache API 不生效 → health 报 memory，也不去写它", async () => {
  const ops = [];
  const realCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async (u) => void ops.push(["match", u]),
      put: async (u) => void ops.push(["put", u]),
    },
  };
  try {
    const onDev = async (path, init, env) => {
      const r = await worker.fetch(new Request(`https://hackathon-site.example.workers.dev${path}`, init), env);
      return r.json();
    };
    eq((await onDev("/api/health", {}, ON)).llm.cache, "memory", "workers.dev：cache memory");
    eq((await call("/api/health", {}, ON)).body.llm.cache, "cache-api", "自己的域名：cache-api");
    const kv = { get: async () => null, put: async () => {} };
    eq((await onDev("/api/health", {}, { ...ON, READINGS: kv })).llm.cache, "kv", "绑了 KV 在哪都是 kv");
    resetLlmState();
    const f = fakeLLM([chat(answer())]);
    const r = await withFetch(f, () => onDev("/api/read", { method: "POST", body: JSON.stringify(fresh()) }, ON));
    eq([r.reading.src, ops.length], ["llm", 0], "workers.dev 上读数照常，Cache API 一次都没碰");
  } finally {
    globalThis.caches = realCaches;
  }
});

done();
