// 冒烟：用 wrangler 的 unstable_dev 在真的 Workers 运行时（workerd）里起 Worker，按 wrangler.jsonc 的配置跑
// 查 /api/health、/api/read、400、静态资源（reader.js、answers/demo.json）、Durable Object 每日计数。node 直接调 fetch() 测不到的：配置、绑定、打包
// 用法：cd apps/api && npm i 后 node tests/workerd.test.mjs；没装 wrangler 就跳过（CI 和没 npm i 的队友不受影响）
// 🔒 自给自足（hermetic）：变量全用 vars 显式覆盖，不管 wrangler.jsonc 的 MOCK 是 0 还是 1、本机 .dev.vars 里放没放真 key，
//    结果都一样，也绝不会连到真的服务商（第二个 Worker 的大模型地址是本进程里的假服务器）。config.test.mjs 查这几项没被删
import { createServer } from "node:http";
import { ok, eq, sec, done } from "./mini.mjs";

const here = new URL("..", import.meta.url).pathname;
let unstable_dev;
try {
  ({ unstable_dev } = await import("wrangler"));
} catch {
  console.log("⏭ 跳过：没装 wrangler（cd apps/api && npm i 以后再跑）");
}

// vars 覆盖 wrangler.jsonc 和 .dev.vars（实测）；persist:false = DO 计数只在内存，每次从 0 开始
const OFF = { MOCK: "1", LLM_API_KEY: "" };
const start = (vars) =>
  unstable_dev("src/worker.js", {
    config: "wrangler.jsonc",
    ip: "127.0.0.1",
    logLevel: "error",
    vars,
    persist: false,
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
  });

const REQ = {
  persona: "commuter",
  kmh: 40,
  signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST", "SAVE 8 MIN"]], read_s: 9 }],
  roads: ["La Trobe St", "Russell St", "Elizabeth St"],
};
const postTo = (worker, body) =>
  worker.fetch("/api/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

if (unstable_dev) {
  process.chdir(here);
  const worker = await start(OFF);
  const post = (body) => postTo(worker, body);
  try {
    await sec("GET /api/health（测试强制 MOCK=1、没 key：不看 wrangler.jsonc / .dev.vars 写的什么）", async () => {
      const r = await worker.fetch("/api/health");
      const b = await r.json();
      eq([r.status, b.ok, b.mock], [200, true, true], "200 · ok · mock");
      eq([b.llm?.mode, b.llm?.key], ["rules", false], "反向：本机 .dev.vars 就算放了 key，这里也是 key:false、mode rules（不会花钱）");
      eq(b.llm?.budget, true, "wrangler.jsonc 的 BUDGET（Durable Object）绑上了");
    });

    await sec("POST /api/read", async () => {
      const r = await post(REQ);
      const b = await r.json();
      eq([r.status, b.ok, b.reading.src], [200, true, "rule"], "200 · 规则读数");
      eq([b.reading.advice, b.reading.saving_min], [{ "Russell St": "use" }, 8], "advice · saving_min");
      const bad = await post({ ...REQ, signs: [{ kind: "vms", frames: [["A", "B", "C", "D", "E"]], read_s: 6 }] });
      eq([bad.status, (await bad.json()).error], [400, "too_many_lines"], "5 行 → 400");
      const nope = await worker.fetch("/api/nope");
      eq([nope.status, (await nope.json()).error], [404, "not_found"], "未知接口 → 404 JSON");
      const big = await worker.fetch("/api/read", { method: "POST", body: "x".repeat(9000) });
      eq(big.status, 413, "> 8KB → 413");
    });

    await sec("静态资源：浏览器能拿到 reader.js 和答案文件", async () => {
      const js = await worker.fetch("/js/reader.js");
      ok(js.status === 200 && /javascript/.test(js.headers.get("content-type") || ""), "reader.js 200 且是 JS");
      ok((await js.text()).includes("export async function readSigns"), "reader.js 内容对");
      const ans = await worker.fetch("/answers/demo.json");
      eq([ans.status, typeof (await ans.json()).answers], [200, "object"], "answers/demo.json 200");
    });

    await sec("施工登记表：workerd 里真的 Durable Object（persist:false，不落盘）", async () => {
      const h = await (await worker.fetch("/api/health")).json();
      eq(h.register, true, "wrangler.jsonc 的 REGISTER 绑上了");
      const ws = {
        title: "workerd smoke",
        links: ["l595594354_9756035316"],
        closes: { lanes: 1 },
        time: { from: "2026-10-12", to: "2026-10-13", hours: [9, 15] },
      };
      const c = await worker.fetch("/api/worksites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ws) });
      const cb = await c.json();
      eq([c.status, cb.worksite?.seed], [201, false], "POST → 201");
      const lt = await (await worker.fetch("/api/worksites")).text();
      const lb = JSON.parse(lt);
      eq([lb.register, lb.n], ["do", 4], "列表 = 3 条预置 + 1 条新登记");
      ok(!lt.includes(cb.edit_token), "反向：列表里没有 edit_token");
      const patch = (token) =>
        worker.fetch(`/api/worksites/${cb.worksite.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-edit-token": token }, body: JSON.stringify({ status: "assessed" }) });
      eq((await patch("0".repeat(32))).status, 403, "token 不对 → 403");
      const p = await patch(cb.edit_token);
      eq([p.status, (await p.json()).worksite?.status], [200, "assessed"], "带对 token → 200");
      const js = await worker.fetch("/js/worksites.js");
      ok(js.status === 200 && (await js.text()).includes("export async function listWorksites"), "浏览器端 worksites.js 能拿到");
    });

    await sec("AI 解读 POST /api/explain（规则版）", async () => {
      const opt = (id, label, delay) => ({ id, label, metrics: { delay_veh_min: delay, queue_m: delay / 10 } });
      const r = await worker.fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: "zh", options: [opt("a", "只写前方施工", 10000), opt("b", "加一帧 USE RUSSELL ST", 5000)] }) });
      const b = await r.json();
      eq([r.status, b.explain?.src, b.explain?.lean?.option], [200, "rule", "b"], "200 · 规则版 · 倾向延误少的那套");
      const js = await worker.fetch("/js/explain.js");
      ok(js.status === 200 && (await js.text()).includes("export async function explainOptions"), "浏览器端 explain.js 能拿到");
    });
  } finally {
    await worker.stop();
  }

  // 第二个 Worker：打开大模型，但地址指向本进程里的假服务器（假 key），每天只许 3 次 → 看 Durable Object 在 workerd 里真的封顶
  const FAKE = ["fake", "workerd", "key", "91c2"].join("-");
  const hits = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
      const content = JSON.stringify({ notice: 0.8, understand: 0.9, advice: { "Russell St": "use" }, saving_min: 8, delay_min: null, trust: 0.7, why: "fake upstream" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const llm = await start({
    MOCK: "0",
    LLM_API_KEY: FAKE,
    LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    LLM_MODEL: "deepseek-flash",
    LLM_MAX_CALLS_PER_DAY: "3",
    LLM_MAX_CALLS_PER_MIN: "60",
  });
  try {
    await sec("workerd 里的 Durable Object 每日封顶（假服务商，一次真调用都没有）", async () => {
      const h = await (await llm.fetch("/api/health")).text();
      const hb = JSON.parse(h);
      eq([hb.llm.mode, hb.llm.key, hb.llm.budget, hb.llm.per_day], ["llm", true, true, 3], "health：llm · key true · budget true · 每天 3 次");
      ok(!h.includes(FAKE), "反向：health 里没有 key 的值");
      const a = await (await postTo(llm, REQ)).text();
      const b = await (await postTo(llm, REQ)).text();
      const other = { ...REQ, signs: [{ kind: "vms", frames: [["AVOID", "RUSSELL ST"]], read_s: 9 }] };
      const c = await (await postTo(llm, other)).text();
      const [ra, rb, rc] = [a, b, c].map((t) => JSON.parse(t).reading);
      eq([ra.src, rb.src, rc.src, rc.note], ["llm", "kv", "rule", "llm_daily_cap"], "第 1 份问大模型 · 同一句走缓存 · 新的一句超了上限回规则");
      eq(hits.length, 3, "假服务商只收到 3 次调用");
      ok(hits.every((x) => x.url === "/chat/completions" && x.auth === `Bearer ${FAKE}`), "POST /chat/completions，带 Bearer");
      eq(hits[0].body.thinking, { type: "disabled" }, "deepseek-* 带 thinking disabled");
      ok(![a, b, c].some((t) => t.includes(FAKE)), "反向：读数响应里没有 key 的值");
    });
  } finally {
    await llm.stop();
    server.close();
  }
}

done();
