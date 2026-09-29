// 施工登记表的服务端（T5 · 提案 #48 第 ⑤ 步）：Durable Object WorksiteRegister 存「施工」，worker.js 把 /api/worksites* 交给 handleWorksites()
// 为什么用 DO：多处施工要互相影响，大家得看同一份；一个全局实例 = 一本账，写入不会交错（和 budget.js 同一套做法）
// 🔒 公开接口、没有登录：谁都能登记；改只能凭登记时拿到的 edit_token（只回这一次，库里只存它的 SHA-256）；任何 GET 都不带 token 和哈希
// 🔒 预置的演示施工（public/js/worksites-seed.js）不进库、改不了（403 locked）；库满 409；全局每天写入上限 429
// ⚠️ 不 import "cloudflare:workers"：worker.js 要在 node 里直接跑测试，老式「有 fetch() 的类」在 workerd 里同样能当 DO
import { normalizeWorksite, applyPatch, parseQuery, selectWorksites, isSeedId, SEEDS, WS_LIMITS, ID_RE, WorksiteError } from "../public/js/worksites.js";
import { sha256Hex } from "../public/js/signs.js";
import { readLimited, json, fail } from "./http.js";

const MAX_BODY = 16 * 1024; // 30 件设备都写满字也就几 KB
const TOKEN_RE = /^[0-9a-f]{32}$/;
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉 0 O 1 I，念给别人听不会错

const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return `W-${[...b].map((x) => ID_ALPHABET[x % 32]).join("")}`;
};
const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");

export class WorksiteRegister {
  // clock 只给测试注入；workerd 只传 (ctx, env)
  constructor(ctx, env, clock = Date.now) {
    this.ctx = ctx;
    this.clock = clock;
  }

  // 内部接口（只有 Worker 调）：GET /list · GET /get?id= · POST /create { ws, th } · POST /update { id, ws, th }
  // 每条存成 "ws:<id>" → { ws, th }；th = edit_token 的 SHA-256，只在这里比对，不出 DO
  async fetch(request) {
    const u = new URL(request.url);
    const s = this.ctx.storage;
    const now = new Date(this.clock()).toISOString();

    if (request.method === "GET" && u.pathname === "/list") {
      const m = await s.list({ prefix: "ws:" });
      return Response.json({ ok: true, worksites: [...m.values()].map((r) => r.ws) });
    }
    if (request.method === "GET" && u.pathname === "/get") {
      const r = await s.get(`ws:${u.searchParams.get("id")}`);
      return r ? Response.json({ ok: true, worksite: r.ws }) : Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (request.method !== "POST") return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
    const b = await request.json();

    if (u.pathname === "/create") {
      if (!(await this.takeWrite(now))) return Response.json({ ok: false, error: "daily_cap" }, { status: 429 });
      const n = (await s.list({ prefix: "ws:" })).size;
      if (n >= WS_LIMITS.entries) return Response.json({ ok: false, error: "full" }, { status: 409 });
      let id = null;
      for (let i = 0; i < 8 && !id; i++) {
        const c = newId();
        if (!isSeedId(c) && !(await s.get(`ws:${c}`))) id = c;
      }
      if (!id) return Response.json({ ok: false, error: "id_exhausted" }, { status: 500 });
      const ws = { id, ...b.ws, seed: false, created: now, updated: now };
      await s.put(`ws:${id}`, { ws, th: b.th });
      return Response.json({ ok: true, worksite: ws }, { status: 201 });
    }

    if (u.pathname === "/update") {
      const r = await s.get(`ws:${b.id}`);
      if (!r) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      if (typeof b.th !== "string" || r.th !== b.th) return Response.json({ ok: false, error: "bad_token" }, { status: 403 });
      if (!(await this.takeWrite(now))) return Response.json({ ok: false, error: "daily_cap" }, { status: 429 });
      const ws = { id: b.id, ...b.ws, seed: false, created: r.ws.created, updated: now };
      await s.put(`ws:${b.id}`, { ws, th: r.th });
      return Response.json({ ok: true, worksite: ws });
    }

    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  // 全局每天写入计数（UTC）：只存一条 { day, n }
  async takeWrite(now) {
    const day = now.slice(0, 10);
    const cur = await this.ctx.storage.get("writes");
    const n = cur && cur.day === day && Number.isInteger(cur.n) ? cur.n : 0;
    if (n >= WS_LIMITS.writesPerDay) return false;
    await this.ctx.storage.put("writes", { day, n: n + 1 });
    return true;
  }
}

const stubOf = (env) => {
  const ns = env?.REGISTER;
  if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") return null;
  return ns.get(ns.idFromName("global"));
};

// DO 内部调用 → { status, b }；DO 出错回 { status: 503 }
async function doCall(stub, path, body) {
  try {
    const init = body === undefined ? { method: "GET" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const r = await stub.fetch(`https://register.internal${path}`, init);
    return { status: r.status, b: await r.json() };
  } catch {
    return { status: 503, b: null };
  }
}

// DO 回的错误短码 → 对外的 msg
const DO_MSG = {
  not_found: "没有这条施工",
  bad_token: "edit_token 不对：只有登记时拿到 token 的人能改",
  daily_cap: `登记表今天的写入次数到上限了（每天 ${WS_LIMITS.writesPerDay} 次，UTC 0 点清零）`,
  full: `登记表满了（最多 ${WS_LIMITS.entries} 条）`,
};
const fromDo = ({ status, b }) =>
  b ? fail(status, b.error || "register_error", DO_MSG[b.error] || "登记表出错") : fail(503, "register_error", "登记表暂时不可用");

async function readJson(request) {
  const text = await readLimited(request, MAX_BODY);
  if (text === null) return { err: fail(413, "too_large", `请求体超过 ${MAX_BODY} 字节`) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { err: fail(400, "bad_json", "请求体不是合法 JSON") };
  }
}

const badInput = (e) => {
  if (e instanceof WorksiteError) return fail(400, e.code, e.message);
  throw e;
};

// /api/worksites 和 /api/worksites/<id>；不是这两种路径回 null（worker.js 接着回 404）
export async function handleWorksites(request, env, url) {
  const path = url.pathname;
  const stub = stubOf(env);

  if (path === "/api/worksites") {
    if (request.method === "GET") {
      let q;
      try {
        q = parseQuery(url.searchParams);
      } catch (e) {
        return badInput(e);
      }
      // 没绑 DO 或 DO 出错：照样回预置的演示施工，页面能演；register 告诉页面现在是哪种
      let stored = [];
      let register = "seed";
      if (stub) {
        const r = await doCall(stub, "/list");
        if (r.status === 200 && r.b?.ok) {
          stored = r.b.worksites;
          register = "do";
        }
      }
      const worksites = selectWorksites([...SEEDS, ...stored], q);
      return json({ ok: true, register, n: worksites.length, worksites });
    }
    if (request.method === "POST") {
      if (!stub) return fail(503, "no_register", "登记表还没部署（api Worker 没绑 REGISTER）：现在只有预置的演示施工");
      const { body, err } = await readJson(request);
      if (err) return err;
      let ws;
      try {
        ws = normalizeWorksite(body);
      } catch (e) {
        return badInput(e);
      }
      if (ws.decision) ws.decision.at = new Date().toISOString();
      const token = newToken();
      const r = await doCall(stub, "/create", { ws, th: await sha256Hex(token) });
      if (r.status !== 201) return fromDo(r);
      return json({ ok: true, worksite: r.b.worksite, edit_token: token }, 201);
    }
    return fail(405, "method", "只接受 GET / POST");
  }

  const m = path.match(/^\/api\/worksites\/([^/]+)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!ID_RE.test(id)) return fail(404, "not_found", "没有这条施工");
  const seed = SEEDS.find((s) => s.id === id);

  if (request.method === "GET") {
    if (seed) return json({ ok: true, worksite: seed });
    if (!stub) return fail(404, "not_found", "没有这条施工");
    const r = await doCall(stub, `/get?id=${encodeURIComponent(id)}`);
    return r.status === 200 && r.b?.ok ? json({ ok: true, worksite: r.b.worksite }) : fromDo(r);
  }

  if (request.method === "PATCH") {
    if (seed) return fail(403, "locked", "预置的演示施工不能改：登记一条新的再改");
    if (!stub) return fail(503, "no_register", "登记表还没部署（api Worker 没绑 REGISTER）");
    const token = request.headers.get("x-edit-token") || "";
    if (!TOKEN_RE.test(token)) return fail(403, "bad_token", "要带请求头 x-edit-token（登记时拿到的 32 位 token）");
    const { body, err } = await readJson(request);
    if (err) return err;
    const cur = await doCall(stub, `/get?id=${encodeURIComponent(id)}`);
    if (cur.status !== 200 || !cur.b?.ok) return fromDo(cur);
    let ws;
    try {
      ws = applyPatch(cur.b.worksite, body);
    } catch (e) {
      return badInput(e);
    }
    // 决定是这次写的就盖上服务端时间；没改决定就保留原来的时间
    if (ws.decision && body && Object.prototype.hasOwnProperty.call(body, "decision")) ws.decision.at = new Date().toISOString();
    const r = await doCall(stub, "/update", { id, ws, th: await sha256Hex(token) });
    return r.status === 200 && r.b?.ok ? json({ ok: true, worksite: r.b.worksite }) : fromDo(r);
  }

  return fail(405, "method", "只接受 GET / PATCH");
}
