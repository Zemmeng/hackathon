// 施工登记表的纯函数 + 浏览器端客户端（public/js/worksites.js）：规范化、白名单、时间重叠、预置施工、引擎格式
// 用法：node tests/worksites.test.mjs；不需要 npm i
import { existsSync, readFileSync } from "node:fs";
import { ok, eq, sec, done } from "./mini.mjs";
import {
  normalizeWorksite, applyPatch, timeOverlap, overlapping, inWindow, parseQuery, selectWorksites, toEngineWorksite,
  listWorksites, createWorksite, updateWorksite, SEEDS, WorksiteError, WS_LIMITS,
} from "../public/js/worksites.js";

const BASE = {
  title: "Test closure",
  links: ["l595594354_9756035316"],
  closes: { lanes: 1 },
  time: { from: "2026-10-05", to: "2026-10-09", hours: [7, 19] },
};
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof WorksiteError ? e.code : `not WorksiteError: ${e?.message}`;
  }
};
const rejects = (patch, code, msg) => eq(codeOf(() => normalizeWorksite({ ...BASE, ...patch })), code, msg);

await sec("预置的演示施工", async () => {
  eq(SEEDS.map((s) => s.id), ["W-LONSDALE", "W-LATROBE", "W-LTLBOURKE"], "3 条，id 唯一");
  ok(SEEDS.every((s) => s.seed === true && s.created === null), "都标 seed: true");
  const roads = new URL("../../roads/public/cbd/network.json", import.meta.url);
  if (existsSync(roads)) {
    const ids = new Set(JSON.parse(readFileSync(roads, "utf8")).links.map((l) => l.id));
    ok(SEEDS.every((s) => s.links.every((id) => ids.has(id))), "路段 id 都在 T3 的 network.json 里");
  }
  const eng = new URL("../../engine/public/js/worksite.js", import.meta.url);
  if (existsSync(eng)) {
    const { validateWorksite, overlaps } = await import(eng.href);
    eq(SEEDS.flatMap((s) => validateWorksite(toEngineWorksite(s))), [], "转成引擎格式后，引擎的 validateWorksite() 没有意见");
    const pairs = SEEDS.flatMap((a) => SEEDS.map((b) => [a, b]));
    ok(pairs.every(([a, b]) => timeOverlap(a, b) === overlaps(toEngineWorksite(a), toEngineWorksite(b))), "timeOverlap() 和引擎 overlaps() 结论一致");
  }
  const lon = SEEDS[0];
  eq(overlapping(lon, SEEDS).map((s) => s.id), ["W-LATROBE", "W-LTLBOURKE"], "Lonsdale 和另外两条时间上重叠（不含自己）");
  eq(overlapping(lon, SEEDS.map((s) => (s.id === "W-LTLBOURKE" ? { ...s, status: "withdrawn" } : s))).map((s) => s.id), ["W-LATROBE"], "撤回的不算");
});

await sec("规范化：默认值和整理", () => {
  const w = normalizeWorksite(BASE);
  eq([w.kind, w.status, w.time.hours, w.equipment, w.decision, w.closes.footpath], ["other", "draft", [7, 19], [], null, null], "默认 other · draft · 设备空 · 没决定 · 人行道不封");
  eq(normalizeWorksite({ ...BASE, time: { from: "2026-10-05", to: "2026-10-05" } }).time.hours, [0, 24], "不给 hours = 全天");
  eq(normalizeWorksite({ ...BASE, title: "  Lonsdale \n  St   works " }).title, "Lonsdale St works", "标题合并空白");
  eq(normalizeWorksite({ ...BASE, links: ["a", "b", "a"] }).links, ["a", "b"], "路段去重");
  eq(normalizeWorksite({ ...BASE, closes: { lanes: 1, footpath: "none" } }).closes.footpath, null, "footpath none → null");
  const eqp = normalizeWorksite({ ...BASE, equipment: [{ id: "V", type: "vms", at_m: 299.6, frames: [["use", "russell  st"]] }, { id: "A", type: "arrow", at_m: 60 }, { id: "B", type: "barrier", at_m: 0, text: "IGNORED" }] }).equipment;
  eq(eqp, [{ id: "V", type: "vms", at_m: 300, frames: [["USE", "RUSSELL ST"]] }, { id: "A", type: "arrow", at_m: 60 }, { id: "B", type: "barrier", at_m: 0 }], "VMS 转大写 · at_m 取整 · 箭头板可以没字 · 护栏不带字");
});

await sec("反向：白名单以外的字段一律丢掉（不存个人信息，也不让客户端自己定 id / seed）", () => {
  const w = normalizeWorksite({ ...BASE, id: "W-LONSDALE", seed: true, email: "someone@example.com", owner: "Alice", created: "2020-01-01T00:00:00Z", th: "x" });
  eq(Object.keys(w).sort(), ["closes", "decision", "equipment", "kind", "links", "status", "time", "title"], "只剩白名单字段");
  ok(!JSON.stringify(w).includes("example.com") && !JSON.stringify(w).includes("Alice"), "邮箱、名字不在结果里");
  const e = normalizeWorksite({ ...BASE, equipment: [{ id: "S", type: "sign", at_m: 1, text: "ROAD CLOSED", secret: "x", url: "http://evil" }] }).equipment[0];
  eq(Object.keys(e).sort(), ["at_m", "id", "text", "type"], "设备也只留认识的字段");
});

await sec("不合规范 → WorksiteError 短码", () => {
  rejects({ title: "" }, "bad_title", "标题空");
  rejects({ title: "x".repeat(WS_LIMITS.title + 1) }, "bad_title", "标题太长");
  rejects({ title: "<img src=x onerror=alert(1)>" }, "bad_text", "反向：标题有 < > 被拒（网页用 innerHTML 拼模板）");
  rejects({ title: "a\u0007b" }, "bad_text", "控制字符被拒");
  rejects({ kind: "party" }, "bad_kind", "kind 不认识");
  rejects({ status: "approved" }, "bad_status", "status 不认识");
  rejects({ status: "decided" }, "bad_status", "decided 没有 decision");
  rejects({ links: [] }, "bad_links", "没有路段");
  rejects({ links: ["a b"] }, "bad_links", "路段 id 有空格");
  rejects({ links: Array.from({ length: WS_LIMITS.links + 1 }, (_, i) => `l${i}`) }, "bad_links", "路段太多");
  rejects({ closes: null }, "bad_closes", "没有 closes");
  rejects({ closes: { lanes: 9 } }, "bad_closes", "封 9 条车道");
  rejects({ closes: { lanes: 1.5 } }, "bad_closes", "车道数不是整数");
  rejects({ closes: { lanes: 0 } }, "bad_closes", "什么都不封");
  rejects({ closes: { lanes: 1, footpath: "north" } }, "bad_closes", "footpath 写方位");
  rejects({ time: { from: "2026-10-09", to: "2026-10-05" } }, "bad_time", "开始晚于结束");
  rejects({ time: { from: "2026-02-30", to: "2026-03-01" } }, "bad_time", "2 月 30 日");
  rejects({ time: { from: "2026-01-01", to: "2027-06-01" } }, "bad_time", "工期超过一年");
  rejects({ time: { from: "2026-10-05", to: "2026-10-09", hours: [19, 7] } }, "bad_time", "跨午夜的时段（要拆两条）");
  rejects({ time: { from: "2026-10-05", to: "2026-10-09", hours: [7.5, 19] } }, "bad_time", "时段不是整点");
  rejects({ equipment: [{ id: "A", type: "sign", at_m: 1, text: "X" }, { id: "A", type: "sign", at_m: 2, text: "Y" }] }, "bad_equipment", "设备 id 重复");
  rejects({ equipment: [{ id: "C", type: "cone", at_m: 1 }] }, "bad_equipment", "设备类型不认识");
  rejects({ equipment: [{ id: "C", type: "barrier", at_m: 5000 }] }, "bad_equipment", "at_m 太远");
  rejects({ equipment: [{ id: "V", type: "vms", at_m: 1, frames: [["A", "B", "C", "D", "E"]] }] }, "too_many_lines", "VMS 5 行（沿用 signs.js 的短码）");
  rejects({ equipment: [{ id: "V", type: "vms", at_m: 1, frames: [["ROADWORKSAHEAD"]] }] }, "line_too_long", "VMS 一行超 10 字符");
  rejects({ equipment: [{ id: "V", type: "vms", at_m: 1, frames: [["<B>"]] }] }, "bad_chars", "反向：屏上有 < >");
  rejects({ equipment: [{ id: "S", type: "sign", at_m: 1, text: "" }] }, "empty_sign", "标志牌没字");
  rejects({ equipment: [{ id: "S", type: "sign", at_m: 1, text: "X", dir: "north" }] }, "bad_equipment", "dir 写单词");
  rejects({ decision: { option: "o1", by: "admin" } }, "bad_decision", "决定人只能是 contractor / council");
  rejects({ decision: { option: "o1", by: "council", reason: "see <script>" } }, "bad_text", "反向：理由里有 < >");
  eq(codeOf(() => normalizeWorksite([BASE])), "bad_worksite", "不是对象");
});

await sec("PATCH 合并", () => {
  const cur = { id: "W-X", ...normalizeWorksite(BASE), seed: false };
  const d = applyPatch(cur, { status: "decided", decision: { option: "o2", by: "council", reason: "cheapest" } });
  eq([d.status, d.decision.option, d.decision.by, d.decision.at], ["decided", "o2", "council", null], "写决定（at 由服务端盖）");
  eq(codeOf(() => applyPatch(cur, {})), "bad_patch", "空 PATCH");
  eq(codeOf(() => applyPatch(cur, { id: "W-LONSDALE", seed: true })), "bad_patch", "反向：只改 id / seed 不算能改的字段");
  eq(applyPatch(cur, { title: "New", id: "W-HACK" }).title, "New", "混着不认识的字段也只改认识的");
  eq(codeOf(() => applyPatch(cur, { links: [] })), "bad_links", "合并后整份重新校验");
});

await sec("查询和排序", () => {
  eq(parseQuery(new URLSearchParams("from=2026-10-10")).from, "2026-10-10", "URLSearchParams 也认");
  eq(codeOf(() => parseQuery({ from: "10/10/2026" })), "bad_query", "日期格式不对");
  eq(codeOf(() => parseQuery({ from: "2026-10-10", to: "2026-10-01" })), "bad_query", "from 晚于 to");
  eq(codeOf(() => parseQuery({ status: "x" })), "bad_query", "status 不认识");
  eq(selectWorksites(SEEDS, { from: "2026-10-10" }).map((s) => s.id), ["W-LTLBOURKE"], "10-10 以后还在施工的只有 Little Bourke");
  eq(selectWorksites(SEEDS, { to: "2026-10-06" }).map((s) => s.id), ["W-LATROBE", "W-LONSDALE"], "10-06 以前开工的两条，同一天开工按 id 排");
  ok(inWindow(SEEDS[0], "2026-10-09", "2026-10-09") && !inWindow(SEEDS[0], "2026-10-10", null), "窗口含两头");
});

await sec("toEngineWorksite：引擎的 §施工方案 格式", () => {
  const e = toEngineWorksite(SEEDS[0]);
  eq(Object.keys(e), ["id", "name", "links", "closes", "time", "equipment"], "只有引擎认的字段");
  eq(e.closes, { lanes: 1 }, "人行道不封时不带 footpath");
  eq(toEngineWorksite({ ...SEEDS[0], closes: { lanes: 1, footpath: "left" } }).closes, { lanes: 1, footpath: "left" }, "封人行道时带上");
  e.equipment[0].at_m = 1;
  eq(SEEDS[0].equipment[0].at_m, 300, "反向：改转出来的对象不会改到预置施工");
});

await sec("浏览器端客户端（假 fetch）", async () => {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const f = (answer) => async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  const l1 = await listWorksites({ from: "2026-10-01" }, { fetch: f(() => reply(200, { ok: true, register: "do", worksites: [SEEDS[0]] })) });
  eq([l1.src, l1.worksites.length, calls.at(-1).url], ["api", 1, "/api/worksites?from=2026-10-01"], "接口通 → src api，查询带上");
  const l2 = await listWorksites({}, { fetch: async () => { throw new Error("offline"); } });
  eq([l2.src, l2.worksites.length], ["seed", 3], "断网 → 退回预置的 3 条，页面照样能演");
  const l3 = await listWorksites({}, { fetch: f(() => reply(503, { ok: false, error: "api_not_deployed" })) });
  eq(l3.src, "seed", "site 没绑 api（503）→ 预置");

  const c = await createWorksite({ ...BASE, email: "x@y.z" }, { fetch: f(() => reply(201, { ok: true, worksite: { id: "W-AAAAAA" }, edit_token: "t".repeat(32) })) });
  const sent = JSON.parse(calls.at(-1).init.body);
  eq([calls.at(-1).init.method, calls.at(-1).init.headers["content-type"], c.edit_token.length], ["POST", "application/json", 32], "POST JSON，拿回 edit_token");
  ok(!("email" in sent), "反向：客户端先规范化，不认识的字段根本不发出去");

  await updateWorksite("W-AAAAAA", { status: "assessed" }, "a".repeat(32), { fetch: f(() => reply(200, { ok: true, worksite: { id: "W-AAAAAA" } })) });
  eq([calls.at(-1).init.method, calls.at(-1).url, calls.at(-1).init.headers["x-edit-token"]], ["PATCH", "/api/worksites/W-AAAAAA", "a".repeat(32)], "PATCH 带 x-edit-token");

  let code = null;
  try {
    await updateWorksite("W-LONSDALE", { status: "assessed" }, "a".repeat(32), { fetch: f(() => reply(403, { ok: false, error: "locked", msg: "…" })) });
  } catch (e) {
    code = e.code;
  }
  eq(code, "locked", "接口的错误短码原样抛给页面");
  let local = null;
  try {
    await createWorksite({ ...BASE, title: "" }, { fetch: f(() => reply(201, {})) });
  } catch (e) {
    local = e.code;
  }
  eq([local, calls.at(-1).init.method], ["bad_title", "PATCH"], "不合规范在浏览器里就拒，不发请求");
});

done();
