// AI 解读（T5 · 提案 #48 第 ⑥ 步）：读引擎给每套方案算出的数字，写优缺点、谁最吃亏、风险、倾向哪套和理由。浏览器和 Worker 共用
// 原则（D-0929-1310「大模型出主意，引擎算数字」）：解读里的每个数字都得来自引擎给的数（allowedNumbers），编出来的句子整句丢掉；
//   只说「倾向」，不替人拍板：选哪套由负责人决定（decide 那句固定写在响应里）
// 现在只有规则版（src: "rule"，确定、不花钱）；大模型版以后走同一个请求 / 响应格式，回来的字先过 sanitizeExplain()
// 🔒 label 不许有 < >（网页用 innerHTML 拼模板）；多余字段丢掉

export const EXPLAIN_LIMITS = { options: 5, label: 60, item: 200, items: 6, max: 1e8 };
export const GROUPS = ["commuter", "local", "tourist", "delivery", "transit", "pedestrian"];
export const LANGS = ["zh", "en"];

export class ExplainError extends Error {
  constructor(code, msg) {
    super(msg);
    this.name = "ExplainError";
    this.code = code;
  }
}
const bad = (code, msg) => new ExplainError(code, msg);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

// 越小越好的指标：拿来比优缺点、加总。detour_share 不在里面（绕得多不一定是坏事），只进风险
const METRICS = [
  { key: "delay_veh_min", name: { zh: "全网延误", en: "network delay" }, unit: { zh: "车·分钟", en: "vehicle-min" } },
  { key: "queue_m", name: { zh: "排队", en: "queue" }, unit: { zh: "米", en: "m" } },
  { key: "mean_delay_s", name: { zh: "每车多等", en: "extra wait per car" }, unit: { zh: "秒", en: "s" } },
  { key: "transit_pax_min", name: { zh: "电车公交乘客延误", en: "tram & bus passenger delay" }, unit: { zh: "人·分钟", en: "passenger-min" } },
  { key: "peds_extra_min", name: { zh: "行人多花的时间", en: "extra walking time" }, unit: { zh: "人·分钟", en: "person-min" } },
  { key: "hire_aud", name: { zh: "设备租金", en: "equipment hire" }, unit: { zh: "澳元", en: "AUD" } },
  { key: "days", name: { zh: "工期", en: "duration" }, unit: { zh: "天", en: "days" } },
];
const EXTRA = ["detour_share", "transit_blocked_pax_h", "peds_blocked_h", "blocked_vph"];
const METRIC_KEYS = [...METRICS.map((m) => m.key), ...EXTRA];
const GROUP_NAME = {
  zh: { commuter: "通勤司机", local: "本地司机", tourist: "游客", delivery: "送货司机", transit: "电车公交乘客", pedestrian: "行人" },
  en: { commuter: "commuters", local: "local drivers", tourist: "visitors", delivery: "delivery drivers", transit: "tram & bus passengers", pedestrian: "pedestrians" },
};

function num(x, where, max = EXPLAIN_LIMITS.max) {
  if (x === undefined || x === null) return null;
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > max) throw bad("bad_number", `${where} 要是 0–${max} 的数（没有就不写或写 null）`);
  return x;
}

function label(x, where) {
  if (typeof x !== "string") throw bad("bad_label", `${where} 要是字符串`);
  const t = x.replace(/\s+/g, " ").trim();
  if (!t || t.length > EXPLAIN_LIMITS.label) throw bad("bad_label", `${where} 要是 1–${EXPLAIN_LIMITS.label} 个字符`);
  if (/[<>\u0000-\u001f\u007f]/.test(t)) throw bad("bad_text", `${where} 不能有 < > 或控制字符`);
  return t;
}

// 请求 → 规范化后的请求；不合规范抛 ExplainError；多余字段丢掉
export function normalizeExplainRequest(req) {
  if (!isObj(req)) throw bad("bad_request", "请求要是一个对象");
  const lang = req.lang === undefined || req.lang === null ? "en" : req.lang;
  if (!LANGS.includes(lang)) throw bad("bad_lang", `lang 只能是 ${LANGS.join(" / ")}`);
  if (!Array.isArray(req.options) || req.options.length < 1 || req.options.length > EXPLAIN_LIMITS.options) {
    throw bad("bad_options", `options 要是 1–${EXPLAIN_LIMITS.options} 套方案`);
  }
  const ids = new Set();
  const options = req.options.map((o, i) => {
    const at = `options[${i}]`;
    if (!isObj(o)) throw bad("bad_options", `${at} 要是对象`);
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) throw bad("bad_options", `${at}.id 要是 1–32 个字母、数字、_ -`);
    if (ids.has(o.id)) throw bad("bad_options", `${at}.id「${o.id}」重复了`);
    ids.add(o.id);
    const m = isObj(o.metrics) ? o.metrics : {};
    const metrics = {};
    for (const k of METRIC_KEYS) {
      const v = num(m[k], `${at}.metrics.${k}`, k === "detour_share" ? 1 : EXPLAIN_LIMITS.max);
      if (v !== null) metrics[k] = v;
    }
    const pc = isObj(o.per_capita_min) ? o.per_capita_min : {};
    const per_capita_min = {};
    for (const g of GROUPS) {
      const v = num(pc[g], `${at}.per_capita_min.${g}`, 1e4);
      if (v !== null) per_capita_min[g] = v;
    }
    const f = isObj(o.flags) ? o.flags : {};
    return {
      id: o.id,
      label: label(o.label, `${at}.label`),
      metrics,
      per_capita_min,
      flags: { params_assumed: f.params_assumed === true, reading_rules: f.reading_rules === true },
    };
  });
  return { lang, options };
}

// ---- 数字：规则版只用请求里的数和各方案的合计；大模型回来的字也按这个查 ----

const commas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtInt = (n) => commas(String(Math.round(n)));
const fmt1 = (n) => String(Math.round(n * 10) / 10);
const fmtMetric = (k, v) => (k === "detour_share" ? `${Math.round(v * 100)}%` : k === "mean_delay_s" || k === "queue_m" || v >= 100 ? fmtInt(v) : fmt1(v));

// 合计 = 车·分钟 + 乘客·分钟 + 行人·分钟（直接相加，没按载客人数换算，why 里写明）；缺全网延误就不算
export function totalOf(o) {
  const m = o.metrics;
  if (m.delay_veh_min === undefined) return null;
  return m.delay_veh_min + (m.transit_pax_min || 0) + (m.peds_extra_min || 0);
}

// 解读里允许出现的数：请求里所有的数（含 label 里写的）和各方案合计，以及它们的取整、一位小数、百分数
export function allowedNumbers(req) {
  const out = new Set();
  const add = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    for (const x of [v, Math.round(v), Math.round(v * 10) / 10, Math.round(v * 100)]) out.add(String(x));
  };
  add(req.options.length);
  for (const o of req.options) {
    for (const v of Object.values(o.metrics)) add(v);
    for (const v of Object.values(o.per_capita_min)) add(v);
    add(totalOf(o));
    for (const t of o.label.match(/\d+(?:\.\d+)?/g) || []) out.add(t);
  }
  return out;
}

// 一段字里出现的数（去掉千分位逗号）
export const numbersIn = (text) => (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((t) => t.replace(/,/g, ""));
const traceable = (text, allowed) => numbersIn(text).every((n) => allowed.has(n) || allowed.has(String(Number(n))));

// ---- 规则版解读：确定、可追溯；src: "rule" ----

export function ruleExplain(input) {
  const req = normalizeExplainRequest(input);
  const L = req.lang;
  const zh = L === "zh";
  const g = GROUP_NAME[L];
  const many = req.options.length > 1;
  const show = (m, v) => `${m.name[L]} ${fmtMetric(m.key, v)} ${m.unit[L]}`;

  const range = {};
  for (const m of METRICS) {
    const vs = req.options.map((o) => o.metrics[m.key]).filter((v) => v !== undefined);
    if (vs.length === req.options.length && Math.max(...vs) > Math.min(...vs)) range[m.key] = [Math.min(...vs), Math.max(...vs)];
  }

  const options = req.options.map((o) => {
    const m = o.metrics;
    const parts = METRICS.filter((x) => ["delay_veh_min", "queue_m", "mean_delay_s", "transit_pax_min"].includes(x.key) && m[x.key] !== undefined).map((x) => show(x, m[x.key]));
    const summary = !parts.length ? o.label : zh ? `${o.label}：${parts.join("，")}。` : `${o.label}: ${parts.join(", ")}.`;
    const pros = [];
    const cons = [];
    if (many) {
      for (const x of METRICS) {
        const r = range[x.key];
        if (!r) continue;
        if (m[x.key] === r[0]) pros.push(zh ? `${x.name.zh}最少（${fmtMetric(x.key, m[x.key])} ${x.unit.zh}）` : `Lowest ${x.name.en} (${fmtMetric(x.key, m[x.key])} ${x.unit.en})`);
        if (m[x.key] === r[1]) cons.push(zh ? `${x.name.zh}最多（${fmtMetric(x.key, m[x.key])} ${x.unit.zh}）` : `Highest ${x.name.en} (${fmtMetric(x.key, m[x.key])} ${x.unit.en})`);
      }
    }
    const groups = Object.entries(o.per_capita_min).filter(([, v]) => v > 0);
    const worst = groups.length ? groups.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
    const hardest_hit = worst ? { group: worst[0], min: Math.round(worst[1] * 10) / 10, text: zh ? `${g[worst[0]]}每人多花 ${fmt1(worst[1])} 分钟，受影响最大` : `${cap(g[worst[0]])} lose the most: ${fmt1(worst[1])} min each` } : null;
    const risks = [];
    if (m.transit_blocked_pax_h > 0) risks.push(zh ? `有电车 / 公交停运，每小时约 ${fmtInt(m.transit_blocked_pax_h)} 名乘客受影响` : `Trams or buses stop running: about ${fmtInt(m.transit_blocked_pax_h)} passengers an hour affected`);
    if (m.peds_blocked_h > 0) risks.push(zh ? `有行人无路可绕，每小时约 ${fmtInt(m.peds_blocked_h)} 人` : `Some pedestrians have no way around: about ${fmtInt(m.peds_blocked_h)} an hour`);
    if (m.blocked_vph > 0) risks.push(zh ? `全封后有车无路可绕，每小时约 ${fmtInt(m.blocked_vph)} 辆` : `After full closure some traffic has no detour: about ${fmtInt(m.blocked_vph)} vehicles an hour`);
    if (m.detour_share > 0.5) risks.push(zh ? `${fmtMetric("detour_share", m.detour_share)} 的车要绕行，绕行路线本身可能也会堵` : `${fmtMetric("detour_share", m.detour_share)} of drivers detour, so the detour itself may clog`);
    if (o.flags.params_assumed) risks.push(zh ? "部分参数是假设值，数字看区间" : "Some inputs are assumptions; read the numbers as ranges");
    if (o.flags.reading_rules) risks.push(zh ? "路人怎么读屏是关键词规则估算的" : "How drivers read the signs is a keyword-rule estimate");
    return { id: o.id, summary, pros, cons, hardest_hit, risks };
  });

  let lean = null;
  const totals = req.options.map((o) => ({ o, t: totalOf(o) })).filter((x) => x.t !== null);
  if (many && totals.length === req.options.length) {
    const best = totals.reduce((a, b) => (b.t < a.t ? b : a));
    if (totals.some((x) => x.t > best.t)) {
      const risky = options.find((x) => x.id === best.o.id).risks.length > 0;
      const cheaper = range.hire_aud && best.o.metrics.hire_aud !== range.hire_aud[0];
      const why = zh
        ? `把车·分钟、乘客·分钟、行人·分钟直接相加（没按载客人数换算），「${best.o.label}」合计最少（${fmtInt(best.t)}）。${cheaper ? "但它的租金不是最低。" : ""}${risky ? "注意它的风险提示。" : ""}`
        : `Adding vehicle-, passenger- and pedestrian-minutes as they are (not weighted by occupancy), "${best.o.label}" has the lowest total (${fmtInt(best.t)}).${cheaper ? " It is not the cheapest to hire, though." : ""}${risky ? " Check its risks." : ""}`;
      lean = { option: best.o.id, why };
    }
  }

  return {
    src: "rule",
    lang: L,
    options,
    lean,
    decide: zh ? "AI 只给参考，不替人拍板：选哪套由负责人决定，并写下理由。" : "This is advice only. The person responsible chooses the plan and records why.",
  };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- 外来的解读（以后的大模型、缓存）当不可信数据：字段不对整份作废（回 null，调用方用规则版）；数字追溯不到的句子丢掉 ----

const cleanItem = (x, allowed) => {
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim().slice(0, EXPLAIN_LIMITS.item);
  if (!t || /[<>]/.test(t) || !traceable(t, allowed)) return null;
  return t;
};
const cleanList = (xs, allowed) => (Array.isArray(xs) ? xs.map((x) => cleanItem(x, allowed)).filter(Boolean).slice(0, EXPLAIN_LIMITS.items) : []);

export function sanitizeExplain(raw, input, src) {
  const req = normalizeExplainRequest(input);
  if (!isObj(raw) || !Array.isArray(raw.options)) return null;
  const allowed = allowedNumbers(req);
  const byId = new Map(raw.options.filter(isObj).map((o) => [o.id, o]));
  if (!req.options.every((o) => byId.has(o.id))) return null;
  const rule = ruleExplain(req);
  const options = req.options.map((o, i) => {
    const r = byId.get(o.id);
    return {
      id: o.id,
      summary: cleanItem(r.summary, allowed) || rule.options[i].summary,
      pros: cleanList(r.pros, allowed),
      cons: cleanList(r.cons, allowed),
      hardest_hit: rule.options[i].hardest_hit, // 谁最吃亏按引擎的数算，不信外来的
      risks: [...new Set([...rule.options[i].risks, ...cleanList(r.risks, allowed)])].slice(0, EXPLAIN_LIMITS.items),
    };
  });
  let lean = null;
  if (isObj(raw.lean) && req.options.some((o) => o.id === raw.lean.option)) {
    const why = cleanItem(raw.lean.why, allowed);
    if (why) lean = { option: raw.lean.option, why };
  }
  return { src, lang: req.lang, options, lean, decide: rule.decide };
}

// ---- 浏览器端：引擎结果 → 一套方案；POST /api/explain，接口不通就在浏览器里跑规则版 ----

// be.run() 的结果（apps/engine/public/js/backend.js 的 summarize()）→ 请求里的一套方案。extra：{ hire_aud, days }
export function optionFromRun(id, name, s, extra = {}) {
  const t = s?.transit?.src ? s.transit : null;
  const p = s?.peds?.src ? s.peds : null;
  const per = {};
  for (const k of ["commuter", "local", "tourist", "delivery"]) if (s?.by_type?.[k]) per[k] = s.by_type[k].per_capita_min;
  if (t && t.pax_h > 0 && t.pax_min !== null) per.transit = t.pax_min / t.pax_h;
  if (p && p.ped_h > 0) per.pedestrian = p.extra_min / p.ped_h;
  const metrics = {
    delay_veh_min: s?.delay_min,
    queue_m: s?.queue_m,
    mean_delay_s: s?.mean_delay_s,
    detour_share: s?.detour_share,
    transit_pax_min: t ? t.pax_min : undefined,
    transit_blocked_pax_h: t ? t.blocked_pax_h : undefined,
    peds_extra_min: p ? p.extra_min : undefined,
    peds_blocked_h: p ? p.blocked_ped_h : undefined,
    blocked_vph: s?.blocked_vph,
    hire_aud: extra.hire_aud,
    days: extra.days,
  };
  for (const k of Object.keys(metrics)) if (typeof metrics[k] !== "number" || !Number.isFinite(metrics[k]) || metrics[k] < 0) delete metrics[k];
  return {
    id,
    label: name,
    metrics,
    per_capita_min: per,
    flags: { params_assumed: s?.flags?.params !== "params", reading_rules: s?.flags?.reading_src === "rule" },
  };
}

// → 解读；opts: { fetch, apiBase, timeoutMs }。请求不合规范直接抛 ExplainError（调用方的 bug），接口不通就本地规则版（src: "rule"）
export async function explainOptions(input, opts = {}) {
  const req = normalizeExplainRequest(input);
  const f = opts.fetch || globalThis.fetch;
  if (typeof f === "function") {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? 8000) : null;
    try {
      const r = await f(`${opts.apiBase || ""}/api/explain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: ctl?.signal });
      const b = await r.json().catch(() => null);
      const clean = r.ok && b?.ok ? sanitizeExplain(b.explain, req, b.explain?.src === "rule" ? "rule" : "api") : null;
      if (clean) return clean;
    } catch {
      // 断网、超时、site 没绑 api：下面用规则版
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return ruleExplain(req);
}
