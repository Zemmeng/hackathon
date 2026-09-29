// 施工登记表的服务端：worker.js 的 /api/worksites* + Durable Object WorksiteRegister（假 storage，在 node 里直接跑）
// 反向断言：edit_token 只在登记那一次返回，任何 GET 都拿不到 token 和它的哈希；预置施工改不了；库满、每日写入上限封顶
// 用法：node tests/register.test.mjs；不需要 npm i
import { ok, eq, sec, done } from "./mini.mjs";
import worker from "../src/worker.js";
import { WorksiteRegister } from "../src/register.js";
import { sha256Hex } from "../public/js/signs.js";
import { WS_LIMITS } from "../public/js/worksites.js";

// 假的 DO 命名空间：一份内存 storage（get / put / list 和 workerd 的形状一样，存取都深拷贝）
function fakeRegister(clock = () => Date.parse("2026-09-30T00:00:00Z")) {
  const store = new Map();
  const storage = {
    async get(k) {
      return structuredClone(store.get(k));
    },
    async put(k, v) {
      store.set(k, structuredClone(v));
    },
    async list({ prefix }) {
      return new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]));
    },
  };
  const obj = new WorksiteRegister({ storage }, {}, clock);
  const ns = { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
  return { store, ns };
}

const WS = {
  title: "Collins St water main",
  kind: "utility",
  links: ["l595594354_9756035316"],
  closes: { lanes: 1, footpath: "left" },
  time: { from: "2026-10-12", to: "2026-10-14", hours: [9, 15] },
  equipment: [{ id: "VMS-1", type: "vms", at_m: 200, frames: [["USE", "RUSSELL ST"]] }],
};

const call = (env, path, { method = "GET", body, token, raw } = {}) => {
  const headers = {};
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-edit-token"] = token;
  return worker.fetch(new Request(`https://site.test${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env);
};
const j = async (r) => ({ status: r.status, b: await r.json() });

await sec("没绑 REGISTER：只读的预置施工，页面照样能演", async () => {
  const env = {};
  const h = await j(await call(env, "/api/health"));
  eq(h.b.register, false, "/api/health 报 register:false");
  const l = await j(await call(env, "/api/worksites"));
  eq([l.status, l.b.register, l.b.n, l.b.worksites.map((w) => w.id)], [200, "seed", 3, ["W-LATROBE", "W-LONSDALE", "W-LTLBOURKE"]], "GET 回 3 条预置（按开工日期、id 排）");
  const p = await j(await call(env, "/api/worksites", { method: "POST", body: WS }));
  eq([p.status, p.b.error], [503, "no_register"], "POST → 503 no_register");
  const one = await j(await call(env, "/api/worksites/W-LONSDALE"));
  eq([one.status, one.b.worksite.seed], [200, true], "GET 预置的一条");
});

await sec("登记 → 查 → 改（带 token）", async () => {
  let now = Date.parse("2026-09-30T01:00:00Z");
  const { store, ns } = fakeRegister(() => now);
  const env = { REGISTER: ns };
  eq((await j(await call(env, "/api/health"))).b.register, true, "/api/health 报 register:true");

  const c = await j(await call(env, "/api/worksites", { method: "POST", body: { ...WS, email: "someone@example.com", id: "W-LONSDALE", seed: true } }));
  eq(c.status, 201, "POST → 201");
  const { worksite: w, edit_token: token } = c.b;
  ok(/^W-[2-9A-HJ-NP-Z]{6}$/.test(w.id), `服务端发 id（客户端给的 W-LONSDALE 不算）：${w.id}`);
  ok(/^[0-9a-f]{32}$/.test(token), "edit_token 是 32 位十六进制");
  eq([w.seed, w.created, w.updated, w.status], [false, "2026-09-30T01:00:00.000Z", "2026-09-30T01:00:00.000Z", "draft"], "seed:false · 服务端时间");
  ok(!("email" in w), "反向：邮箱没存也没回");

  const rec = store.get(`ws:${w.id}`);
  eq(rec.th, await sha256Hex(token), "库里存的是 token 的 SHA-256");
  ok(!JSON.stringify(rec).includes(token), "反向：库里没有 token 原文");

  const l = await call(env, "/api/worksites");
  const lt = await l.text();
  const lb = JSON.parse(lt);
  eq([lb.register, lb.n], ["do", 4], "列表 = 3 条预置 + 1 条新登记");
  const one = await call(env, `/api/worksites/${w.id}`);
  const ot = await one.text();
  for (const [name, t] of [["列表", lt], ["单条", ot]]) {
    ok(!t.includes(token) && !t.includes(rec.th) && !/"th"/.test(t), `反向：${name}里没有 token、没有哈希、没有 th 字段`);
  }

  const noTok = await j(await call(env, `/api/worksites/${w.id}`, { method: "PATCH", body: { status: "assessed" } }));
  eq([noTok.status, noTok.b.error], [403, "bad_token"], "不带 token → 403");
  const wrong = await j(await call(env, `/api/worksites/${w.id}`, { method: "PATCH", body: { status: "assessed" }, token: "0".repeat(32) }));
  eq([wrong.status, wrong.b.error], [403, "bad_token"], "token 不对 → 403");
  eq(store.get(`ws:${w.id}`).ws.status, "draft", "反向：被拒的改动没落库");

  now = Date.parse("2026-09-30T02:00:00Z");
  const good = await j(await call(env, `/api/worksites/${w.id}`, {
    method: "PATCH", token,
    body: { status: "decided", decision: { option: "o2", by: "council", reason: "least tram delay", at: "1999-01-01T00:00:00Z" } },
  }));
  eq([good.status, good.b.worksite.status, good.b.worksite.decision.option], [200, "decided", "o2"], "带对 token → 200，写上决定");
  ok(good.b.worksite.decision.at !== "1999-01-01T00:00:00Z" && /^\d{4}-\d{2}-\d{2}T/.test(good.b.worksite.decision.at), "decision.at 由服务端盖，不信客户端给的");
  eq([good.b.worksite.created, good.b.worksite.updated], ["2026-09-30T01:00:00.000Z", "2026-09-30T02:00:00.000Z"], "created 不变 · updated 更新");
  const keepAt = good.b.worksite.decision.at;
  const again = await j(await call(env, `/api/worksites/${w.id}`, { method: "PATCH", token, body: { title: "Collins St water main (stage 1)" } }));
  eq([again.b.worksite.title, again.b.worksite.decision.at], ["Collins St water main (stage 1)", keepAt], "没改决定时保留原来的决定时间");
  ok(!JSON.stringify(again.b).includes(token), "反向：PATCH 的响应里也没有 token");

  const bad = await j(await call(env, `/api/worksites/${w.id}`, { method: "PATCH", token, body: { links: [] } }));
  eq([bad.status, bad.b.error], [400, "bad_links"], "改成不合规范 → 400 短码");
  const empty = await j(await call(env, `/api/worksites/${w.id}`, { method: "PATCH", token, body: {} }));
  eq([empty.status, empty.b.error], [400, "bad_patch"], "空 PATCH → 400 bad_patch");

  const c2 = await j(await call(env, "/api/worksites", { method: "POST", body: WS }));
  ok(c2.b.worksite.id !== w.id && c2.b.edit_token !== token, "再登记一条：id 和 token 都不一样");
  const cross = await j(await call(env, `/api/worksites/${w.id}`, { method: "PATCH", token: c2.b.edit_token, body: { status: "withdrawn" } }));
  eq([cross.status, cross.b.error], [403, "bad_token"], "反向：拿别人那条的 token 改不了我的");
});

await sec("预置施工改不了", async () => {
  const { ns } = fakeRegister();
  const env = { REGISTER: ns };
  const r = await j(await call(env, "/api/worksites/W-LONSDALE", { method: "PATCH", token: "a".repeat(32), body: { status: "withdrawn" } }));
  eq([r.status, r.b.error], [403, "locked"], "PATCH 预置 → 403 locked");
  const l = await j(await call(env, "/api/worksites"));
  eq(l.b.worksites.find((w) => w.id === "W-LONSDALE").status, "draft", "还是原样");
});

await sec("查询、错误和方法", async () => {
  const { ns } = fakeRegister();
  const env = { REGISTER: ns };
  await call(env, "/api/worksites", { method: "POST", body: WS });
  eq((await j(await call(env, "/api/worksites?from=2026-10-10"))).b.worksites.map((w) => w.title), ["Little Bourke St closure on the Russell St detour", "Collins St water main"], "from 过滤：10-10 以后还在施工的");
  eq((await j(await call(env, "/api/worksites?status=decided"))).b.n, 0, "status 过滤");
  const q = await j(await call(env, "/api/worksites?from=tomorrow"));
  eq([q.status, q.b.error], [400, "bad_query"], "查询参数不对 → 400");
  const nf = await j(await call(env, "/api/worksites/W-NOPE12"));
  eq([nf.status, nf.b.error], [404, "not_found"], "没有这条 → 404");
  eq((await call(env, "/api/worksites/..%2F..%2Fhealth")).status, 404, "id 有怪字符 → 404");
  eq((await call(env, "/api/worksites/a/b")).status, 404, "多一层路径 → 404");
  eq((await j(await call(env, "/api/worksites", { method: "DELETE" }))).status, 405, "DELETE 列表 → 405");
  eq((await j(await call(env, "/api/worksites/W-LONSDALE", { method: "DELETE" }))).status, 405, "DELETE 单条 → 405（没有删除，只能改成 withdrawn）");
  const bj = await j(await call(env, "/api/worksites", { method: "POST", raw: "{nope" }));
  eq([bj.status, bj.b.error], [400, "bad_json"], "坏 JSON → 400");
  const big = await j(await call(env, "/api/worksites", { method: "POST", raw: JSON.stringify({ ...WS, title: "x".repeat(20000) }) }));
  eq([big.status, big.b.error], [413, "too_large"], "请求体超过 16KB → 413");
  const inv = await j(await call(env, "/api/worksites", { method: "POST", body: { ...WS, title: "<b>hi</b>" } }));
  eq([inv.status, inv.b.error], [400, "bad_text"], "反向：标题带 < > → 400");
});

await sec("封顶：库满 409 · 每天写入上限 429 · 过了 UTC 0 点重新计", async () => {
  const { store, ns } = fakeRegister(() => Date.parse("2026-09-30T05:00:00Z"));
  const env = { REGISTER: ns };
  for (let i = 0; i < WS_LIMITS.entries; i++) store.set(`ws:W-FILL${String(i).padStart(3, "0")}`, { ws: { id: `W-FILL${i}` }, th: "x" });
  const full = await j(await call(env, "/api/worksites", { method: "POST", body: WS }));
  eq([full.status, full.b.error], [409, "full"], `满 ${WS_LIMITS.entries} 条 → 409 full`);

  const b = fakeRegister(() => Date.parse("2026-09-30T05:00:00Z"));
  b.store.set("writes", { day: "2026-09-30", n: WS_LIMITS.writesPerDay });
  const cap = await j(await call({ REGISTER: b.ns }, "/api/worksites", { method: "POST", body: WS }));
  eq([cap.status, cap.b.error], [429, "daily_cap"], `今天已写 ${WS_LIMITS.writesPerDay} 次 → 429`);
  b.store.set("writes", { day: "2026-09-29", n: WS_LIMITS.writesPerDay });
  eq((await call({ REGISTER: b.ns }, "/api/worksites", { method: "POST", body: WS })).status, 201, "昨天的计数不算");
  eq(b.store.get("writes"), { day: "2026-09-30", n: 1 }, "计数只存一条");
});

await sec("DO 出错：GET 退回预置，写入回 503", async () => {
  const env = { REGISTER: { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error("boom"); } }) } };
  const l = await j(await call(env, "/api/worksites"));
  eq([l.status, l.b.register, l.b.n], [200, "seed", 3], "GET 照样回预置");
  const p = await j(await call(env, "/api/worksites", { method: "POST", body: WS }));
  eq([p.status, p.b.error], [503, "register_error"], "POST → 503，不透传报错内容");
  ok(!JSON.stringify(p.b).includes("boom"), "反向：内部报错文字不出去");
});

done();
