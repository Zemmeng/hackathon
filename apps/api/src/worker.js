// Worker 薄路由：入口校验 + 分发；读屏规则在 public/js/rules.js（浏览器和这里共用）
// GET /api/health 自检 · POST /api/read 读懂屏上的字 · 其余交给静态资源 public/
// 大模型还没定（D-0929-1435）：现在不管 MOCK 是什么都用规则回答；定了以后在 read() 里接 KV 缓存和大模型
import { normalizeRequest, SignError } from "../public/js/signs.js";
import { ruleReading } from "../public/js/rules.js";

// 部署时可用 --var VERSION:$(git rev-parse --short HEAD) 覆盖
const VERSION = "0.1.0";
const MAX_BODY = 8 * 1024; // 合法请求最多几百字节，8KB 足够

// 只有明确写 MOCK=0 才算关掉 MOCK：变量没配时默认不花钱
export const isMock = (env) => env?.MOCK !== "0";

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return json({ ok: true, v: env.VERSION || VERSION, mock: isMock(env) });
    }

    if (path === "/api/read") {
      if (request.method !== "POST") return fail(405, "method", "只接受 POST");
      const text = await request.text();
      if (text.length > MAX_BODY) return fail(413, "too_large", `请求体超过 ${MAX_BODY} 字节`);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return fail(400, "bad_json", "请求体不是合法 JSON");
      }
      let req;
      try {
        req = normalizeRequest(body);
      } catch (e) {
        if (e instanceof SignError) return fail(400, e.code, e.message);
        throw e;
      }
      return json({ ok: true, reading: await read(req, env) });
    }

    // 未知 /api/* 明确回 404 JSON：不交给 ASSETS，免得前端把一页 HTML 当成接口响应
    if (path.startsWith("/api/")) return fail(404, "not_found", "没有这个接口");

    return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, "not_found", "没有静态资源");
  },
};

// req 已规范化。以后的顺序：KV → 大模型（问 3 次取平均和区间）→ 任何一步失败回规则
export async function read(req, env) {
  void env;
  return ruleReading(req);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    // 读数只取决于请求体，但 POST 本来就不缓存；health 要看到当前版本
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// docs/contract.md §错误格式
const fail = (status, error, msg) => json({ ok: false, error, msg }, status);
