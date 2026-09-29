// 预计算工具 tools/precompute.mjs：默认 dry-run 不花钱；--run 用假 fetch 写文件；--check 校验；写出的文件 readSigns() 真能用
// 用法：node tests/precompute.test.mjs（不联网：fetch 全是假的）
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, eq, sec, done } from "./mini.mjs";
import { main, check, collectRequests, ANSWERS } from "../tools/precompute.mjs";
import { readSigns, resetReader, answerKey } from "../public/js/reader.js";
import { PROMPT } from "../src/prompt.js";

const FAKE = ["fake", "k3y", "for", "tests", "7f3a9c"].join("-");
const dir = mkdtempSync(join(tmpdir(), "precompute-"));
const out = join(dir, "demo.json");

const answer = { notice: 0.8, understand: 0.9, advice: { "Russell Street": "use" }, saving_min: 4, delay_min: null, trust: 0.7, why: "Use Russell" };
function fakeLLM() {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) };
  };
  f.calls = calls;
  return f;
}
const logger = () => {
  const lines = [];
  const log = (s) => lines.push(String(s));
  log.text = () => lines.join("\n");
  return log;
};

try {
  await sec("反向（计费）：默认 dry-run —— 只报次数和花费，fetch 0 次", async () => {
    const f = fakeLLM();
    const log = logger();
    const code = await main(["--no-engine", "--out", out], { fetch: f, env: { LLM_API_KEY: FAKE }, log });
    eq([code, f.calls.length], [0, 0], "退出码 0，fetch 0 次");
    ok(/要问 32 条.*调用 32 × 3 = 96 次/.test(log.text()), "报了条数和调用次数（8 句 × 4 类人 × 3 次）");
    ok(/高峰约 ¥\d+\.\d\d/.test(log.text()), "按 DeepSeek 价目报了花费");
    ok(!log.text().includes(FAKE), "反向：输出里没有 key");
  });

  await sec("--run 没有 key：拒绝，不调用", async () => {
    const f = fakeLLM();
    const log = logger();
    eq(await main(["--run", "--no-engine", "--out", out], { fetch: f, env: {}, log }), 1, "退出码 1");
    eq(f.calls.length, 0, "fetch 0 次");
  });

  await sec("--run（假 fetch）：问 3 次合成，写进文件，键 = answerKey", async () => {
    const f = fakeLLM();
    const log = logger();
    const code = await main(["--run", "--no-engine", "--limit", "2", "--out", out], { fetch: f, env: { LLM_API_KEY: FAKE }, log, now: () => "2026-09-29T00:00:00Z" });
    eq([code, f.calls.length], [0, 6], "2 条 × 3 次 = 6 次调用");
    ok(f.calls.every((c) => c.body.thinking?.type === "disabled"), "走的是和 Worker 同一个调用层（DeepSeek 带 thinking disabled）");
    const data = JSON.parse(readFileSync(out, "utf8"));
    const entries = Object.entries(data.answers);
    eq([entries.length, data.prompt_v, data.model], [2, PROMPT.v, "deepseek-flash"], "写了 2 条，带 prompt_v 和模型");
    for (const [k, e] of entries) {
      eq(k, await answerKey(e.req), `键 = answerKey(req)（${e.from}）`);
      eq([e.reading.src, e.reading.range?.notice], ["llm", [0.8, 0.8]], "读数来自大模型，带 range");
    }
    const all = readFileSync(out, "utf8") + log.text();
    ok(!all.includes(FAKE), "反向：文件和输出里都没有 key");
    const again = logger();
    await main(["--no-engine", "--out", out], { fetch: f, env: {}, log: again });
    ok(/要问 30 条/.test(again.text()), "已问过的同版本读数不重问（dry-run 剩 30 条）");
  });

  await sec("写出的文件浏览器 readSigns() 真能用（src file，不再调接口）", async () => {
    const data = JSON.parse(readFileSync(out, "utf8"));
    const [e] = Object.values(data.answers);
    resetReader();
    const hits = [];
    const f = async (url) => {
      hits.push(url);
      return url === "https://t/answers.json" ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 500, json: async () => ({}) };
    };
    const r = await readSigns(e.req, { fetch: f, answersUrl: "https://t/answers.json", apiBase: "https://t" });
    eq([r.src, r.advice, hits], ["file", { "Russell Street": "use" }, ["https://t/answers.json"]], "命中文件，没调 /api/read");
  });

  await sec("--check：好文件过，坏文件拒", async () => {
    const quiet = logger();
    eq(await check(out, { log: quiet }), 0, "刚写的文件过");
    eq(await check(ANSWERS, { log: quiet }), 0, "仓库里的 public/answers/demo.json 过");
    const data = JSON.parse(readFileSync(out, "utf8"));
    const [k, e] = Object.entries(data.answers)[0];
    const bad = join(dir, "bad.json");
    const put = (d) => writeFileSync(bad, JSON.stringify(d));
    put({ ...data, answers: { ["0".repeat(64)]: e } });
    eq(await check(bad, { log: quiet }), 1, "键和 req 对不上 → 拒");
    put({ ...data, answers: { [k]: { ...e, reading: { ...e.reading, notice: 3 } } } });
    eq(await check(bad, { log: quiet }), 1, "读数不合法 → 拒");
    put({ ...data, leak: ["sk", "abcdefghijklmnopqrstuvwx"].join("-") });
    eq(await check(bad, { log: quiet }), 1, "有像 key 的串 → 拒");
    put({ ...data, leak: FAKE });
    eq(await check(bad, { log: quiet, env: { LLM_API_KEY: FAKE } }), 1, "有 key 的值 → 拒");
  });

  await sec("引擎演示方案的请求也收集（lonsdale / latrobe 的 run、前后对比、规划顾问）", async () => {
    const log = logger();
    const items = await collectRequests({ engine: true, log });
    const eng = items.filter((i) => i.from.startsWith("engine:"));
    ok(eng.length > 0, `收集到 ${eng.length} 条引擎请求（共 ${items.length} 条）${log.text() ? "；" + log.text() : ""}`);
    ok(eng.some((i) => i.from.startsWith("engine:lonsdale:")) && eng.some((i) => i.from.startsWith("engine:latrobe:")), "两个演示方案都有");
    eq(new Set(items.map((i) => i.key)).size, items.length, "按规范串去重");
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

done();
