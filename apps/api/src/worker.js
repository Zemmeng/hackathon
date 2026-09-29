// Worker 薄路由：入口校验 + 分发；读屏规则在 public/js/rules.js（浏览器和这里共用），大模型在 src/llm.js
// GET /api/health 自检 · POST /api/read 读懂屏上的字 · /api/worksites 施工登记表（src/register.js）· 其余交给静态资源 public/
// 默认（MOCK 不是 "0" 或没有 LLM_API_KEY）只用规则、不花钱；打开大模型见 README「怎么接大模型」（T19）
import { normalizeRequest, SignError } from "../public/js/signs.js";
import { ruleReading } from "../public/js/rules.js";
import { llmConfig, llmStatus, serverReading } from "./llm.js";
import { handleWorksites } from "./register.js";
import { readLimited, json, fail } from "./http.js";

// Durable Object 类必须从入口模块导出（wrangler.jsonc 的 durable_objects / migrations 认这个名字）
export { LlmBudget } from "./budget.js";
export { WorksiteRegister } from "./register.js";
export { readLimited };

// 部署时可用 --var VERSION:$(git rev-parse --short HEAD) 覆盖
const VERSION = "0.3.0";
const MAX_BODY = 8 * 1024; // 合法请求最多几百字节，8KB 足够

// 只有明确写 MOCK=0 才算关掉 MOCK：变量没配时默认不花钱
export const isMock = (env) => env?.MOCK !== "0";

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      // llm：{ mode, model, key: 有没有（不给值）, cache: kv / cache-api / memory（按主机名）, prompt_v, provider, budget, per_day, per_min }
      // register：施工登记表的 Durable Object 绑上没有（没绑 = 只有预置的演示施工，只读）
      return json({ ok: true, v: env.VERSION || VERSION, mock: isMock(env), llm: llmStatus(env, url.hostname), register: hasRegister(env) });
    }

    if (path === "/api/read") {
      if (request.method !== "POST") return fail(405, "method", "只接受 POST");
      const text = await readLimited(request, MAX_BODY);
      if (text === null) return fail(413, "too_large", `请求体超过 ${MAX_BODY} 字节`);
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
      return json({ ok: true, reading: await read(req, env, url.origin) });
    }

    if (path === "/api/worksites" || path.startsWith("/api/worksites/")) {
      const r = await handleWorksites(request, env, url);
      if (r) return r;
    }

    // 未知 /api/* 明确回 404 JSON：不交给 ASSETS，免得前端把一页 HTML 当成接口响应
    if (path.startsWith("/api/")) return fail(404, "not_found", "没有这个接口");

    return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, "not_found", "没有静态资源");
  },
};

const hasRegister = (env) => Boolean(env?.REGISTER && typeof env.REGISTER.idFromName === "function");

// req 已规范化。MOCK 或没 key → 规则（和 T19 以前一模一样）；
// 否则 内存 → KV / Cache API → 大模型（问 3 次合成）→ 任何一步失败回规则。origin：Cache API 的键用同源的假网址
export async function read(req, env = {}, origin) {
  if (llmConfig(env).mode !== "llm") return ruleReading(req);
  try {
    return await serverReading(req, env, { origin });
  } catch {
    return { ...ruleReading(req), note: "llm_error" }; // 不透传报错内容
  }
}
