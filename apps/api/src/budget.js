// 大模型每日调用上限（T19 修）：全局一个 Durable Object 计数，跨所有 Worker 实例、所有入口网址都算一本账
// 为什么：/api/read 是公开的，MOCK=0 以后谁都能 POST；每实例每分钟的限流挡不住多实例 / 换着花样绕缓存，这里是真正的封顶
// 🔒 拿不到额度（没绑 BUDGET、DO 出错、超了）一律不调用，回规则 —— 宁可少用大模型，不能多花钱
// 免费版只能用 SQLite 后端的 DO（wrangler.jsonc 的 migrations 用 new_sqlite_classes）；每天 UTC 0 点清零（墨尔本上午 10 / 11 点）
// ⚠️ 不 import "cloudflare:workers"：worker.js 要在 node 里直接跑测试，老式「有 fetch() 的类」在 workerd 里同样能当 DO

const DAY_KEY = "calls"; // 只存一条 { day, n }，不会越存越多

const int = (x) => {
  const n = Number(x);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

export class LlmBudget {
  // clock 只给测试注入；workerd 只传 (ctx, env)
  constructor(ctx, env, clock = Date.now) {
    this.ctx = ctx;
    this.clock = clock;
  }

  // POST /take?n=3&max=600 → { ok, used, max, day }。get → put 之间没有别的 I/O，DO 的 input gate 保证不会被别的请求插进来
  async fetch(request) {
    const u = new URL(request.url);
    const n = int(u.searchParams.get("n"));
    const max = int(u.searchParams.get("max"));
    if (u.pathname !== "/take" || !(n > 0) || Number.isNaN(max)) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
    const day = new Date(this.clock()).toISOString().slice(0, 10);
    const cur = await this.ctx.storage.get(DAY_KEY);
    const used = cur && cur.day === day && Number.isInteger(cur.n) ? cur.n : 0;
    if (used + n > max) return Response.json({ ok: false, used, max, day });
    await this.ctx.storage.put(DAY_KEY, { day, n: used + n });
    return Response.json({ ok: true, used: used + n, max, day });
  }
}

// Worker 这边：预留 n 次调用。返回 "ok" | "over" | "no_budget" | "error"（不抛）
export async function takeBudget(env, n, max) {
  const ns = env?.BUDGET;
  if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") return "no_budget";
  try {
    const stub = ns.get(ns.idFromName("global"));
    const r = await stub.fetch(`https://budget.internal/take?n=${n}&max=${max}`, { method: "POST" });
    const b = await r.json();
    return b && b.ok === true ? "ok" : r.ok ? "over" : "error";
  } catch {
    return "error";
  }
}
