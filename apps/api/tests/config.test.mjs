// 部署配置：wrangler.jsonc / package.json / 锁文件 / .dev.vars.example 的关键项（T19：api Worker 要能被 deploy.sh 部署、被 site 绑定）
// 用法：node tests/config.test.mjs；不需要 npm i
import { readFileSync } from "node:fs";
import { ok, eq, sec, done } from "./mini.mjs";
import { parseJsonc } from "../tools/jsonc.mjs";
import * as entry from "../src/worker.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

await sec("wrangler.jsonc", () => {
  const w = parseJsonc(read("wrangler.jsonc"));
  eq([w.name, w.main], ["hackathon-api", "src/worker.js"], "Worker 名 hackathon-api（site 的服务绑定认这个名字）");
  eq([w.assets?.directory, w.assets?.binding], ["public", "ASSETS"], "静态资源 public/，绑定 ASSETS");
  ok(["0", "1"].includes(w.vars?.MOCK), `vars.MOCK 是字符串 "0" 或 "1"（现在 ${JSON.stringify(w.vars?.MOCK)}；worker 只认 "0" 为关）`);
  ok(/^https:\/\//.test(w.vars?.LLM_BASE_URL || ""), `LLM_BASE_URL 是 https：${w.vars?.LLM_BASE_URL}`);
  ok(typeof w.vars?.LLM_MODEL === "string" && w.vars.LLM_MODEL.length > 0, `LLM_MODEL = ${w.vars?.LLM_MODEL}`);
  const secretish = Object.keys(w.vars || {}).filter((k) => /KEY|SECRET|TOKEN|PASSWORD/i.test(k));
  eq(secretish, [], "反向：vars 里没有 key / secret / token（key 只用 wrangler secret put）");
  ok(!("services" in w), "api 自己不绑别的 Worker（只有 site 绑它）");
  eq(w.workers_dev, false, "不开 hackathon-api.*.workers.dev：公开入口只有 site（服务绑定不需要它）");
  for (const k of ["LLM_MAX_CALLS_PER_MIN", "LLM_MAX_CALLS_PER_DAY"]) {
    ok(/^[0-9]+$/.test(w.vars?.[k] ?? ""), `vars.${k} 是整数字符串（现在 ${JSON.stringify(w.vars?.[k])}）`);
  }
});

await sec("Durable Object BUDGET：大模型每日上限的全局计数", () => {
  const w = parseJsonc(read("wrangler.jsonc"));
  const b = (w.durable_objects?.bindings || []).find((x) => x.name === "BUDGET");
  eq(b?.class_name, "LlmBudget", "绑定 BUDGET → 类 LlmBudget（src/llm.js 认 env.BUDGET）");
  const sqlite = (w.migrations || []).flatMap((m) => m.new_sqlite_classes || []);
  ok(sqlite.includes("LlmBudget"), "migrations 用 new_sqlite_classes（免费版只能用 SQLite 后端的 DO）");
  ok(!(w.migrations || []).some((m) => (m.new_classes || []).includes("LlmBudget")), "反向：不是 new_classes（KV 后端免费版部署不上）");
  eq(typeof entry.LlmBudget, "function", "入口 src/worker.js 导出了 LlmBudget（workerd 按名字找类）");
});

await sec("tests/workerd.test.mjs 自给自足：不吃 wrangler.jsonc 的 MOCK、不吃本机 .dev.vars 的 key", () => {
  const t = read("tests/workerd.test.mjs");
  ok(/const OFF = \{ MOCK: "1", LLM_API_KEY: "" \}/.test(t), "默认那个 Worker 用 vars 强制 MOCK=1、key 为空（lead 改 MOCK=0 后门禁照样绿，也不会花钱）");
  ok(/\bvars,\s*\n\s*persist: false/.test(t), "unstable_dev 带 vars 覆盖、persist:false（DO 计数不落盘）");
  ok(/LLM_BASE_URL: `http:\/\/127\.0\.0\.1:/.test(t), "打开大模型的那个 Worker 只连本进程的假服务商");
});

await sec("package.json + 锁文件：deploy.sh 能部署", () => {
  const pkg = JSON.parse(read("package.json"));
  eq(pkg.scripts?.deploy, "wrangler deploy", "有 deploy 脚本（deploy.sh 跑 npm run deploy）");
  const lock = JSON.parse(read("package-lock.json"));
  ok(/^4\./.test(lock.packages?.["node_modules/wrangler"]?.version || ""), `锁文件里有 wrangler 4.x（deploy.sh 用 npm ci 按锁装）：${lock.packages?.["node_modules/wrangler"]?.version}`);
  eq(lock.packages?.[""]?.devDependencies, pkg.devDependencies, "锁文件和 package.json 的依赖一致（不然 npm ci 直接失败）");
});

await sec(".dev.vars.example：只有变量名和假值", () => {
  const ex = read(".dev.vars.example");
  for (const k of ["MOCK", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) ok(new RegExp(`^${k}=`, "m").test(ex), `列了 ${k}`);
  eq(ex.match(/^LLM_API_KEY=(.*)$/m)?.[1], "", "反向：LLM_API_KEY 的值是空的");
  eq(ex.match(/^MOCK=(.*)$/m)?.[1], "1", "示例默认 MOCK=1（复制过去不花钱）");
});

done();
