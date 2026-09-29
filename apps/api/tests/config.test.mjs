// 部署配置：wrangler.jsonc / package.json / 锁文件 / .dev.vars.example 的关键项（T19：api Worker 要能被 deploy.sh 部署、被 site 绑定）
// 用法：node tests/config.test.mjs；不需要 npm i
import { readFileSync } from "node:fs";
import { ok, eq, sec, done } from "./mini.mjs";
import { parseJsonc } from "../tools/jsonc.mjs";

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
