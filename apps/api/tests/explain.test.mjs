// AI 解读（public/js/explain.js + POST /api/explain）：规范化、规则版、数字追溯、外来解读的清洗、真引擎结果
// 反向断言：解读里的每个数字都能追溯到引擎给的数；编出来的数整句丢掉；外来解读删不掉规则版的风险；响应里没有「替人选定」的字段
// 用法：node tests/explain.test.mjs；不需要 npm i
import { existsSync, readFileSync } from "node:fs";
import { ok, eq, sec, done } from "./mini.mjs";
import worker from "../src/worker.js";
import {
  normalizeExplainRequest, ruleExplain, sanitizeExplain, allowedNumbers, numbersIn, totalOf, optionFromRun, explainOptions, ExplainError,
} from "../public/js/explain.js";
import { readSigns } from "../public/js/reader.js";

const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ExplainError ? e.code : `not ExplainError: ${e?.message}`;
  }
};

const A = {
  id: "o1", label: "Warning only",
  metrics: { delay_veh_min: 10493, queue_m: 918, mean_delay_s: 509, detour_share: 0.14, transit_pax_min: 18693, hire_aud: 900, days: 5 },
  per_capita_min: { commuter: 3.9, local: 4.4, tourist: 5.1, delivery: 3.0, transit: 2.2 },
  flags: { params_assumed: true, reading_rules: true },
};
const B = {
  id: "o2", label: "Add USE RUSSELL ST",
  metrics: { delay_veh_min: 5746, queue_m: 548, mean_delay_s: 244, detour_share: 0.35, transit_pax_min: 11206, hire_aud: 900, days: 5 },
  per_capita_min: { commuter: 1.9, local: 2.4, tourist: 3.1, delivery: 1.5, transit: 1.3 },
  flags: { params_assumed: true, reading_rules: true },
};
const C = {
  id: "o3", label: "Full closure at night",
  metrics: { delay_veh_min: 2100, queue_m: 0, mean_delay_s: 90, detour_share: 1, transit_pax_min: 0, transit_blocked_pax_h: 640, blocked_vph: 35, hire_aud: 1500, days: 3 },
  per_capita_min: { commuter: 1.2, pedestrian: 0.4 },
};
const REQ = { lang: "en", options: [A, B, C] };

// 一份解读里所有给人看的字
const texts = (x) => [
  ...x.options.flatMap((o) => [o.summary, ...o.pros, ...o.cons, ...o.risks, o.hardest_hit?.text || ""]),
  x.lean?.why || "",
];
const untraceable = (x, req) => {
  const allowed = allowedNumbers(normalizeExplainRequest(req));
  return texts(x).flatMap((t) => numbersIn(t).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n)))).map((n) => `${n} ← ${t}`));
};

await sec("请求规范化", () => {
  const n = normalizeExplainRequest({ options: [{ ...A, metrics: { ...A.metrics, secret: 1 }, per_capita_min: { ...A.per_capita_min, ceo: 9 }, flags: { params_assumed: "yes" }, extra: "x" }] });
  eq(n.lang, "en", "默认英文");
  ok(!("secret" in n.options[0].metrics) && !("ceo" in n.options[0].per_capita_min) && !("extra" in n.options[0]), "不认识的指标、人群、字段丢掉");
  eq(n.options[0].flags, { params_assumed: false, reading_rules: false }, "flags 只认 true");
  eq(codeOf(() => normalizeExplainRequest({ lang: "fr", options: [A] })), "bad_lang", "lang 不认识");
  eq(codeOf(() => normalizeExplainRequest({ options: [] })), "bad_options", "0 套方案");
  eq(codeOf(() => normalizeExplainRequest({ options: [A, B, C, { ...A, id: "o4" }, { ...A, id: "o5" }, { ...A, id: "o6" }] })), "bad_options", "超过 5 套");
  eq(codeOf(() => normalizeExplainRequest({ options: [A, { ...B, id: "o1" }] })), "bad_options", "id 重复");
  eq(codeOf(() => normalizeExplainRequest({ options: [{ ...A, label: "<b>x</b>" }] })), "bad_text", "反向：label 有 < >");
  eq(codeOf(() => normalizeExplainRequest({ options: [{ ...A, metrics: { queue_m: -3 } }] })), "bad_number", "负数");
  eq(codeOf(() => normalizeExplainRequest({ options: [{ ...A, metrics: { detour_share: 1.4 } }] })), "bad_number", "绕行比例超过 1");
  eq(codeOf(() => normalizeExplainRequest({ options: [{ ...A, metrics: { queue_m: "918" } }] })), "bad_number", "数字写成字符串");
});

await sec("规则版：优缺点、谁最吃亏、风险、倾向", () => {
  const x = ruleExplain(REQ);
  eq(x.src, "rule", "src rule");
  const [a, b, c] = x.options;
  ok(a.cons.some((t) => /Highest network delay \(10,493/.test(t)) && a.cons.some((t) => /Highest queue/.test(t)), "Warning only：全网延误、排队最多");
  ok(c.pros.some((t) => /Lowest network delay \(2,100/.test(t)) && c.cons.some((t) => /Highest equipment hire/.test(t)), "夜间全封：延误最少，但租金最高");
  ok(a.pros.some((t) => /Lowest equipment hire \(900/.test(t)) && b.pros.some((t) => /Lowest equipment hire \(900/.test(t)), "并列最少的都算（两套都是 900，比第三套便宜）");
  eq(a.hardest_hit.group, "tourist", "Warning only 最吃亏的是游客（每人 5.1 分钟）");
  eq(c.hardest_hit.group, "commuter", "只给了通勤和行人时按给的算");
  ok(c.risks.some((t) => /Trams or buses stop running: about 640/.test(t)) && c.risks.some((t) => /no detour: about 35/.test(t)), "停运、无路可绕进风险");
  ok(c.risks.some((t) => /100% of drivers detour/.test(t)), "绕行超过一半进风险");
  ok(a.risks.some((t) => /assumptions/.test(t)) && a.risks.some((t) => /keyword-rule/.test(t)), "假设值、规则读屏进风险");
  eq(totalOf(normalizeExplainRequest(REQ).options[2]), 2100, "合计 = 车·分钟 + 乘客·分钟 + 行人·分钟");
  eq(x.lean.option, "o3", "倾向合计最少的那套");
  ok(/not weighted by occupancy/.test(x.lean.why) && /not the cheapest/.test(x.lean.why) && /Check its risks/.test(x.lean.why), "倾向的理由写明加法口径、租金、风险");
  ok(/chooses the plan/.test(x.decide), "固定写明由人决定");
  const keys = JSON.stringify(Object.keys(x)) + JSON.stringify(Object.keys(x.lean));
  ok(!/final|chosen|selected|decision|approved/i.test(keys), `反向：响应里没有「替人选定」的字段：${keys}`);
  eq(untraceable(x, REQ), [], "反向：英文解读里每个数字都能追溯到请求里的数");
  const z = ruleExplain({ ...REQ, lang: "zh" });
  ok(z.options[0].cons.some((t) => t.startsWith("全网延误最多（10,493 车·分钟）")) && /由负责人决定/.test(z.decide), "中文版");
  eq(untraceable(z, { ...REQ, lang: "zh" }), [], "反向：中文解读里每个数字都能追溯");
});

await sec("只有一套、或缺数：不硬比", () => {
  const one = ruleExplain({ options: [A] });
  eq([one.options[0].pros, one.options[0].cons, one.lean], [[], [], null], "一套方案：没有优缺点、没有倾向");
  const tie = ruleExplain({ options: [A, { ...A, id: "o2", label: "Same" }] });
  eq([tie.options[0].pros.length, tie.lean], [0, null], "两套一样：不硬分高下");
  const gap = ruleExplain({ options: [A, { ...B, metrics: { queue_m: 548 } }] });
  eq(gap.lean, null, "有一套没有全网延误：不算合计、不给倾向");
});

await sec("外来解读（以后的大模型）当不可信数据", () => {
  const raw = {
    options: [
      { id: "o1", summary: "Warning only keeps 918 m of queue.", pros: ["Cheap to set up"], cons: ["Queue grows to 1,200 m at 8:30", "Visitors lose 5.1 min each"], risks: [] },
      { id: "o2", summary: "Saves 12 minutes for everyone", pros: ["<script>alert(1)</script>", "Queue drops to 548 m"], cons: [], risks: ["Detour via Russell St may clog"] },
      { id: "o3", summary: "Night closure", pros: [], cons: [], risks: [] },
    ],
    lean: { option: "o2", why: "Queue drops from 918 m to 548 m." },
    final: "o2",
  };
  const s = sanitizeExplain(raw, REQ, "llm");
  eq(s.options[0].cons, ["Visitors lose 5.1 min each"], "反向：编出来的数（1,200 m、8:30）整句丢掉，有出处的留下");
  eq(s.options[1].summary, ruleExplain(REQ).options[1].summary, "summary 里的数编的 → 换回规则版的 summary");
  eq(s.options[1].pros, ["Queue drops to 548 m"], "反向：带 < > 的句子丢掉");
  ok(s.options[2].risks.some((t) => /Trams or buses stop running/.test(t)), "反向：外来解读删不掉规则版的停运风险");
  eq(s.options[0].hardest_hit.group, "tourist", "谁最吃亏按引擎的数算，不信外来的");
  eq(s.lean, { option: "o2", why: "Queue drops from 918 m to 548 m." }, "倾向和理由有出处就保留");
  ok(!("final" in s), "反向：外来的 final 字段丢掉");
  eq(sanitizeExplain({ ...raw, lean: { option: "o9", why: "x" } }, REQ, "llm").lean, null, "倾向指向不存在的方案 → 不要");
  eq(sanitizeExplain({ options: raw.options.slice(0, 2) }, REQ, "llm"), null, "少一套方案 → 整份作废（调用方用规则版）");
  eq(sanitizeExplain("nope", REQ, "llm"), null, "不是对象 → 作废");
});

await sec("POST /api/explain", async () => {
  const post = (body, raw) => worker.fetch(new Request("https://site.test/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }), {});
  const r = await post(REQ);
  const b = await r.json();
  eq([r.status, b.ok, b.explain.src, b.explain.lean.option], [200, true, "rule", "o3"], "200 · 规则版");
  eq((await worker.fetch(new Request("https://site.test/api/explain"), {})).status, 405, "GET → 405");
  const bj = await post(null, "{");
  eq([bj.status, (await bj.json()).error], [400, "bad_json"], "坏 JSON → 400");
  const bo = await post({ options: [] });
  eq([bo.status, (await bo.json()).error], [400, "bad_options"], "没有方案 → 400 短码");
  eq((await post(null, JSON.stringify({ options: [{ ...A, label: "x".repeat(9000) }] }))).status, 413, "> 8KB → 413");
});

await sec("浏览器端 explainOptions（假 fetch）", async () => {
  const reply = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  const fromApi = await explainOptions(REQ, { fetch: reply({ ok: true, explain: ruleExplain(REQ) }) });
  eq([fromApi.src, fromApi.lean.option], ["rule", "o3"], "接口通 → 用接口的");
  const off = await explainOptions(REQ, { fetch: async () => { throw new Error("offline"); } });
  eq([off.src, off.lean.option], ["rule", "o3"], "断网 → 浏览器里跑规则版");
  const liar = ruleExplain(REQ);
  liar.options[0].pros = ["Cuts delay by 99%"];
  const cleaned = await explainOptions(REQ, { fetch: reply({ ok: true, explain: { ...liar, src: "llm" } }) });
  eq([cleaned.src, cleaned.options[0].pros], ["api", []], "反向：接口回来的字也过清洗，编的数丢掉");
  let code = null;
  try {
    await explainOptions({ options: [] }, { fetch: reply({}) });
  } catch (e) {
    code = e.code;
  }
  eq(code, "bad_options", "请求不合规范直接抛（调用方的 bug），不拿规则掩盖");
});

const engineUrl = new URL("../../engine/public/js/index.js", import.meta.url);
const backendUrl = new URL("../../engine/public/js/backend.js", import.meta.url);
const roadsDir = new URL("../../roads/public/cbd/", import.meta.url);
if (!existsSync(engineUrl) || !existsSync(backendUrl) || !existsSync(new URL("network.json", roadsDir))) {
  console.log("⏭ 跳过真引擎一节：没有 apps/engine 或 apps/roads");
} else {
  await sec("真引擎：Lonsdale 只写 ROADWORK AHEAD vs 加上 USE RUSSELL ST（引擎 → optionFromRun → 规则解读）", async () => {
    const { createEngine } = await import(engineUrl.href);
    const { summarize, demoPlan } = await import(backendUrl.href);
    const network = JSON.parse(readFileSync(new URL("network.json", roadsDir), "utf8"));
    const flows = JSON.parse(readFileSync(new URL("flows.json", roadsDir), "utf8"));
    const eng = createEngine({ network, flows, readSigns: (r) => readSigns(r, { fetch: null }) });
    const run = async (plan) => {
      const prep = await eng.prepare(plan);
      return summarize(eng.evaluate(plan), { failed: prep.failed, params: eng.params });
    };
    const warn = await run(demoPlan("lonsdale", { frames: [["ROADWORK", "AHEAD"]] }));
    const use = await run(demoPlan("lonsdale"));
    const req = { lang: "zh", options: [optionFromRun("warn", "只写前方施工", warn), optionFromRun("use", "加一帧 USE RUSSELL ST", use)] };
    const n = normalizeExplainRequest(req);
    ok(n.options.every((o) => o.metrics.delay_veh_min > 0 && o.metrics.queue_m >= 0), "optionFromRun 取到全网延误和排队");
    eq(Object.keys(n.options[0].per_capita_min).sort(), ["commuter", "delivery", "local", "tourist"], "四类司机每人多几分钟都在");
    const x = ruleExplain(req);
    ok(use.delay_min < warn.delay_min, `引擎：加一帧后全网延误变少（${warn.delay_min} → ${use.delay_min}）`);
    eq(x.lean?.option, "use", "倾向加一帧的那套");
    eq(untraceable(x, req), [], "反向：真引擎数字写出来的解读，每个数都能追溯");
    console.log(`    ${x.options[0].summary}\n    ${x.options[1].summary}\n    倾向：${x.lean?.why}`);
  });
}

done();
