// readSigns() 的取数顺序：答案文件 → /api/read → 规则。fetch 全部注入，不碰网络
// 用法：node tests/reader.test.mjs
import { ok, eq, sec, done } from "./mini.mjs";
import { readSigns, resetReader, answerKey, SignError } from "../public/js/reader.js";
import { ruleReading } from "../public/js/rules.js";

const REQ = {
  persona: "commuter",
  kmh: 40,
  signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST", "SAVE 8 MIN"]], read_s: 9 }],
  roads: ["La Trobe St", "Russell St", "Elizabeth St"],
};
const LLM = {
  notice: 0.85, understand: 0.9, advice: { "Russell St": "use", "La Trobe St": "avoid" }, saving_min: 8, delay_min: null,
  trust: 0.7, why: "Sign says Russell saves 8 min", range: { notice: [0.8, 0.9] }, model: "m", prompt_v: "r1",
};
const OPTS = { answersUrl: "https://t/answers.json", apiBase: "https://t", timeoutMs: 200 };

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// 假 fetch：按 URL 分派，记下每次调用
function fakeFetch({ answers = {}, api }) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(url);
    if (url === OPTS.answersUrl) return res(200, { answers });
    if (url === `${OPTS.apiBase}/api/read`) return api(JSON.parse(init.body), init);
    return res(404, {});
  };
  f.calls = calls;
  return f;
}

await sec("答案文件里有：直接用，不调接口", async () => {
  resetReader();
  const key = await answerKey(REQ);
  const f = fakeFetch({ answers: { [key]: { reading: LLM } }, api: () => res(200, { ok: true, reading: { ...LLM, src: "llm" } }) });
  const r = await readSigns(REQ, { ...OPTS, fetch: f });
  eq(r.src, "file", "src 是 file");
  eq(r.advice, LLM.advice, "读数来自文件");
  ok(!f.calls.includes(`${OPTS.apiBase}/api/read`), "没调 /api/read");
});

await sec("文件里没有：调 /api/read，src 以接口为准", async () => {
  resetReader();
  let sent = null;
  const f = fakeFetch({ api: (body) => ((sent = body), res(200, { ok: true, reading: { ...LLM, src: "kv" } })) });
  const r = await readSigns(REQ, { ...OPTS, fetch: f });
  eq(r.src, "kv", "src 是 kv");
  eq(r.range, { notice: [0.8, 0.9] }, "range 带回来");
  eq(sent.signs[0].frames, [["USE", "RUSSELL ST", "SAVE 8 MIN"]], "发给接口的是规范化后的请求");
});

await sec("接口挂了 / 超时 / 回的东西不合法：都用规则", async () => {
  const cases = [
    ["500", () => res(500, { ok: false })],
    ["网络错", () => { throw new Error("offline"); }],
    ["超时", (_b, init) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("abort"))))],
    ["notice 超范围", () => res(200, { ok: true, reading: { ...LLM, notice: 7, src: "llm" } })],
    ["src 乱写", () => res(200, { ok: true, reading: { ...LLM, src: "file" } })],
    ["不是 JSON 对象", () => res(200, "USE RUSSELL")],
  ];
  const rule = ruleReading(REQ);
  for (const [name, api] of cases) {
    resetReader();
    const r = await readSigns(REQ, { ...OPTS, fetch: fakeFetch({ api }) });
    eq(r, rule, `${name} → 规则读数`);
  }
});

await sec("没有 fetch 的环境（node 默认读不了相对路径）：直接规则", async () => {
  resetReader();
  const r = await readSigns(REQ, { fetch: null });
  eq(r.src, "rule", "src 是 rule");
});

await sec("同一句话同一类人：一个会话只取一次；拿到的是副本", async () => {
  resetReader();
  const f = fakeFetch({ api: () => res(200, { ok: true, reading: { ...LLM, src: "llm" } }) });
  const a = await readSigns(REQ, { ...OPTS, fetch: f });
  a.advice["Russell St"] = "avoid"; // 改返回值不能污染缓存
  const b = await readSigns({ ...REQ, kmh: 60, signs: [{ ...REQ.signs[0], read_s: 9.2 }] }, { ...OPTS, fetch: f });
  eq(f.calls.filter((u) => u.endsWith("/api/read")).length, 1, "/api/read 只调了 1 次");
  eq(b.advice["Russell St"], "use", "第二次拿到的没被第一次的改动污染");
});

await sec("请求不合规范：抛 SignError，不拿规则掩盖", async () => {
  resetReader();
  let err = null;
  try {
    await readSigns({ ...REQ, signs: [{ kind: "vms", frames: [["ABCDEFGHIJK"]], read_s: 3 }] }, { ...OPTS, fetch: fakeFetch({ api: () => res(500) }) });
  } catch (e) {
    err = e;
  }
  ok(err instanceof SignError && err.code === "line_too_long", "抛 SignError(line_too_long)");
});

done();
