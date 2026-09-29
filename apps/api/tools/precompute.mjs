// 预计算演示读数 → public/answers/demo.json（浏览器的 readSigns() 先查这个文件：断网也能演、演示时不花钱不等待）
// 请求来源：fixtures/demo-signs.json（8 句 × 4 类人）+ 引擎两个演示方案（backend.js 的 lonsdale / latrobe：run、前后对比、规划顾问）实际会发的请求
// 调大模型走的是 Worker 同一条路（src/llm.js 的 llmReading：问 3 次、合成、sanitize）
//
// 用法（D-09：默认不花钱）：
//   node apps/api/tools/precompute.mjs                 dry-run：只打印要问几条、调几次、大概多少钱
//   node --env-file=apps/api/.dev.vars apps/api/tools/precompute.mjs --run [--limit N]
//                                                      真调用（key 从环境变量 LLM_API_KEY 读；DeepSeek 也认 DEEPSEEK_API_KEY）
//   node apps/api/tools/precompute.mjs --check         只校验 demo.json（键对不对、读数合不合法、有没有像 key 的串）
// 其他参数：--no-engine 只用演示文案；--force 同版本的也重问；--out <路径> 写到别处；--concurrency N 同时问几条（默认 4）
// 地址和模型：环境变量 LLM_BASE_URL / LLM_MODEL > apps/api/wrangler.jsonc 的 vars > DeepSeek 默认
// 🔒 不打印、不写入 key；报错只有短码
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRequest, canonical, sha256Hex, sanitizeReading, SignError } from "../public/js/signs.js";
import { ruleReading } from "../public/js/rules.js";
import { PROMPT } from "../src/prompt.js";
import { llmConfig, llmReading, buildMessages, SAMPLES } from "../src/llm.js";
import { parseJsonc } from "./jsonc.mjs";

const API = new URL("..", import.meta.url);
const APPS = new URL("../..", import.meta.url);
export const ANSWERS = fileURLToPath(new URL("public/answers/demo.json", API));
const FIXTURES = new URL("fixtures/demo-signs.json", API);

// DeepSeek deepseek-flash 价目（每百万 token，人民币；docs/llm-apis/jinmingq-deepseek.md §1，09-29 实测卡）。空闲时段半价
const PRICE = { deepseek: { in: 2, out: 8, offpeak: 0.5, src: "docs/llm-apis/jinmingq-deepseek.md" } };
const OUT_TOKENS = 120; // 每次调用的输出 token 估计（prompts.md「花费估算」）

// ---------------------------------------------------------------- 收集请求

// /<模块>/public/<路径> → apps/<模块>/public/<路径>：让 backend.js 在 node 里读到路网、车流、参数
const fileFetch = async (u) => {
  const m = String(u).match(/^\/([a-z0-9_-]+)\/public\/([A-Za-z0-9_./-]+)$/);
  if (!m || m[2].includes("..")) return { ok: false, status: 404, json: async () => null };
  const p = new URL(`${m[1]}/public/${m[2]}`, APPS);
  if (!existsSync(p)) return { ok: false, status: 404, json: async () => null };
  const text = readFileSync(p, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
};

async function engineRequests() {
  const B = await import(new URL("engine/public/js/backend.js", APPS).href);
  const { checkSigns } = await import(new URL("public/js/check.js", API).href);
  const out = [];
  let from = "";
  const capture = async (req) => {
    out.push({ from, req });
    return ruleReading(req); // 只是为了让引擎跑完；不调大模型
  };
  const be = await B.connect({ fetch: fileFetch, readSigns: capture, checkSigns });
  for (const name of B.DEMO_NAMES) {
    from = `engine:${name}:run`;
    await be.run(be.demo(name));
    from = `engine:${name}:compare`;
    await be.compare(be.demo(name, { frames: [["ROADWORK", "AHEAD"]] }), be.demo(name));
    from = `engine:${name}:advise`;
    await be.advise(be.demo(name));
  }
  return out;
}

function fixtureRequests() {
  const fx = JSON.parse(readFileSync(FIXTURES, "utf8"));
  return fx.messages.flatMap((m) => fx.personas.map((persona) => ({ from: `fixture:${m.id}`, req: { persona, kmh: fx.kmh, signs: m.signs, roads: fx.roads } })));
}

// → [{ from, req（规范化后）, key }]，按规范串去重
export async function collectRequests({ engine = true, log = console.log } = {}) {
  const raw = fixtureRequests();
  if (engine) {
    try {
      raw.push(...(await engineRequests()));
    } catch (e) {
      log(`⚠️ 引擎演示方案的请求没收集到（只用演示文案）：${e?.message || e}`);
    }
  }
  const seen = new Map();
  for (const { from, req } of raw) {
    let n;
    try {
      n = normalizeRequest(req);
    } catch (e) {
      if (e instanceof SignError) {
        log(`⚠️ 跳过不合规范的请求（${from}）：${e.code}`);
        continue;
      }
      throw e;
    }
    const c = canonical(n);
    if (!seen.has(c)) seen.set(c, { from, req: n, key: await sha256Hex(c) });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- 配置

function workerVars() {
  try {
    return parseJsonc(readFileSync(new URL("wrangler.jsonc", API), "utf8")).vars || {};
  } catch {
    return {};
  }
}

// 预计算用的 env：强制 MOCK=0（这个工具本身就是 --run 才调用）；超时放宽到 20 秒（离线跑，不赶）
function llmEnv(env) {
  const vars = workerVars();
  const base = env.LLM_BASE_URL || vars.LLM_BASE_URL;
  const model = env.LLM_MODEL || vars.LLM_MODEL;
  const probe = llmConfig({ MOCK: "0", LLM_API_KEY: "x", LLM_BASE_URL: base, LLM_MODEL: model });
  const key = env.LLM_API_KEY || (probe.provider === "deepseek" ? env.DEEPSEEK_API_KEY : "") || "";
  return { MOCK: "0", LLM_API_KEY: key, LLM_BASE_URL: base, LLM_MODEL: model, LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS || "20000" };
}

function loadAnswers(path) {
  if (!existsSync(path)) return { note: "", prompt_v: PROMPT.v, answers: {} };
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data || typeof data !== "object" || !data.answers || typeof data.answers !== "object") throw new Error(`${path} 不是 { answers: {…} } 的格式`);
  return data;
}

const fresh = (entry, cfg) => entry?.reading?.prompt_v === PROMPT.v && entry?.reading?.model === cfg.model;

// ---------------------------------------------------------------- 三种模式

function dryRun(items, todo, cfg, log) {
  const inChars = todo.reduce((s, it) => s + [0, 1, 2].reduce((t, i) => t + buildMessages(it.req, i).reduce((u, m) => u + m.content.length, 0), 0), 0);
  const calls = todo.length * SAMPLES;
  const inTok = Math.ceil(inChars / 4);
  const outTok = calls * OUT_TOKENS;
  log(`要问 ${todo.length} 条（共 ${items.length} 条，${items.length - todo.length} 条文件里已有同版本的）→ 调用 ${todo.length} × ${SAMPLES} = ${calls} 次`);
  log(`token 估算：输入约 ${inTok.toLocaleString("en")}（按字符数 ÷ 4）· 输出约 ${outTok.toLocaleString("en")}（每次 ${OUT_TOKENS}）`);
  const p = PRICE[cfg.provider];
  if (p) {
    const peak = (inTok * p.in + outTok * p.out) / 1e6;
    log(`花费估算（${cfg.model} 价目，出处 ${p.src}）：高峰约 ¥${peak.toFixed(2)}，空闲时段约 ¥${(peak * p.offpeak).toFixed(2)}`);
  } else {
    log(`花费：按 ${cfg.model} 的价格表用上面的 token 数算（这里只有 DeepSeek 的价目）`);
  }
  log("这是 dry-run，没有调用、没花钱。真调用前先在群里报上面的次数和花费（D-09），然后：");
  log("  node --env-file=apps/api/.dev.vars apps/api/tools/precompute.mjs --run --limit 2   # 先问 2 条试水");
  log("  node --env-file=apps/api/.dev.vars apps/api/tools/precompute.mjs --run            # 再全量");
  return 0;
}

async function run(items, todo, cfg, env, path, data, { fetch, log, concurrency, now }) {
  if (!env.LLM_API_KEY) {
    log("❌ 没有 LLM_API_KEY（环境变量）。用 node --env-file=apps/api/.dev.vars … 或先 export；key 只放本机，不进仓库");
    return 1;
  }
  let ok = 0;
  let failed = 0;
  const save = () => {
    data.prompt_v = PROMPT.v;
    data.model = cfg.model;
    data.generated = now();
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  };
  for (let i = 0; i < todo.length; i += concurrency) {
    const chunk = todo.slice(i, i + concurrency);
    const outs = await Promise.all(chunk.map((it) => llmReading(it.req, env, { fetch })));
    chunk.forEach((it, j) => {
      const o = outs[j];
      if (o.reading) {
        data.answers[it.key] = { req: it.req, reading: o.reading, from: it.from };
        ok++;
      } else {
        failed++;
        log(`  ✗ ${it.from} · ${it.req.persona}：${o.valid}/${o.calls} 次有效（${[...new Set(o.errors)].join(", ")}）`);
      }
    });
    save(); // 每批都落盘：中途被打断，花过的钱不白花
    log(`  … ${Math.min(i + concurrency, todo.length)}/${todo.length}`);
  }
  log(`${failed ? "⚠️" : "✅"} 写好 ${ok} 条，失败 ${failed} 条 → ${path}（失败的演示时走 /api/read 或规则）`);
  log(`   调用约 ${todo.length * SAMPLES} 次：花了钱记进 docs/3-tasks.md 的额度台账（D-09）；再跑 --check 校验`);
  return failed ? 1 : 0;
}

// 键对不对、读数合不合法、有没有像 key 的串
export async function check(path, { log = console.log, env = {} } = {}) {
  let text;
  let data;
  try {
    text = readFileSync(path, "utf8");
    data = JSON.parse(text);
  } catch (e) {
    log(`❌ 读不了 ${path}：${e?.message || e}`);
    return 1;
  }
  const bad = [];
  if (!data || typeof data.answers !== "object" || !data.answers || Array.isArray(data.answers)) bad.push("顶层要有 answers 对象");
  const entries = Object.entries(data?.answers || {});
  let stale = 0;
  for (const [k, e] of entries) {
    let n;
    try {
      n = normalizeRequest(e?.req);
    } catch (err) {
      bad.push(`${k.slice(0, 12)}…：req 不合规范（${err?.code || err}）`);
      continue;
    }
    if ((await sha256Hex(canonical(n))) !== k) bad.push(`${k.slice(0, 12)}…：键和 req 对不上（answerKey 变了？）`);
    if (!sanitizeReading(e?.reading, n, "file")) bad.push(`${k.slice(0, 12)}…：读数过不了 sanitizeReading`);
    if (e?.reading?.prompt_v !== PROMPT.v) stale++;
  }
  if (/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}/.test(text)) bad.push("文件里有像 key 的串");
  const key = env.LLM_API_KEY || env.DEEPSEEK_API_KEY;
  if (key && text.includes(key)) bad.push("文件里有 key 的值");
  for (const b of bad) log(`  ✗ ${b}`);
  if (stale) log(`⚠️ ${stale} 条是旧版提示词（不是 ${PROMPT.v}）问的：还能用，想更新就 --run --force`);
  log(`${bad.length ? "❌" : "✅"} ${path}：${entries.length} 条读数，${bad.length} 个问题`);
  return bad.length ? 1 : 0;
}

function args(argv) {
  const o = { run: argv.includes("--run"), check: argv.includes("--check"), engine: !argv.includes("--no-engine"), force: argv.includes("--force") };
  const val = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  o.limit = Number(val("--limit")) || Infinity;
  o.concurrency = Math.max(1, Math.min(8, Number(val("--concurrency")) || 4));
  o.out = val("--out");
  return o;
}

// deps：{ fetch, env, log, now }（测试注入假 fetch 和假 env）
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || console.log;
  const penv = deps.env || process.env;
  const o = args(argv);
  const path = o.out ? resolve(o.out) : ANSWERS;
  if (o.check) return check(path, { log, env: penv });

  const env = llmEnv(penv);
  const cfg = llmConfig(env);
  if (!cfg.baseOk) {
    log("❌ LLM_BASE_URL 不合法：要 https://…，不能带账号密码、查询串（原值不打印，免得里面夹着 key）");
    return 1;
  }
  const items = await collectRequests({ engine: o.engine, log });
  const data = loadAnswers(path);
  const todo = items.filter((it) => o.force || !fresh(data.answers[it.key], cfg)).slice(0, o.limit);
  log(`预计算演示读数 · prompt_v ${PROMPT.v} · ${cfg.model} @ ${new URL(cfg.baseUrl).host} · key ${env.LLM_API_KEY ? "有" : "没有"}`);
  const n = (p) => items.filter((it) => it.from.startsWith(p)).length;
  log(`请求 ${items.length} 条（去重后；演示文案 ${n("fixture:")} · 引擎演示方案 ${n("engine:")}）`);
  if (!o.run) return dryRun(items, todo, cfg, log);
  return run(items, todo, cfg, env, path, data, {
    fetch: deps.fetch || globalThis.fetch,
    log,
    concurrency: o.concurrency,
    now: deps.now || (() => new Date().toISOString()),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.log(`❌ ${e?.message || e}`);
      process.exit(1);
    },
  );
}
