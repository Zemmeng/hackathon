// 引擎只调这一个函数：readSigns(请求) → Promise<读数>（docs/contract.md §路人读数）
// 按顺序：随网页发布的答案文件 → POST /api/read（Worker 先查 KV 再问大模型）→ 都不行用关键词规则（src: "rule"）
// 请求不合规范直接抛 SignError：那是调用方的 bug，不拿规则掩盖
import { normalizeRequest, canonical, sha256Hex, sanitizeReading } from "./signs.js";
import { ruleReading } from "./rules.js";

export { SignError } from "./signs.js";

const DEFAULTS = {
  answersUrl: new URL("../answers/demo.json", import.meta.url).href,
  apiBase: "", // 同源部署时留空；本地单独起 Worker 时传 http://localhost:<端口>
  timeoutMs: 8000,
};

const memo = new Map(); // 请求规范串的哈希 → Promise<读数>：同一句话同一类人一个会话只取一次
const answerFiles = new Map(); // answersUrl → Promise<{ [key]: { reading } }>

// 测试或界面上的「重新读取」用
export function resetReader() {
  memo.clear();
  answerFiles.clear();
}

// 答案文件的键：规范串（persona + 规范化 signs + 排序后的 roads）的 SHA-256
export const answerKey = (req) => sha256Hex(canonical(normalizeRequest(req)));

// opts: { fetch, apiBase, answersUrl, timeoutMs }，测试里注入 fetch
export async function readSigns(request, opts = {}) {
  const req = normalizeRequest(request);
  const o = { ...DEFAULTS, ...opts };
  const key = await sha256Hex(canonical(req));
  if (!memo.has(key)) memo.set(key, resolve(req, key, o));
  return structuredClone(await memo.get(key));
}

async function resolve(req, key, o) {
  const f = o.fetch || globalThis.fetch;
  if (typeof f === "function") {
    const fromFile = await fileReading(req, key, o, f);
    if (fromFile) return fromFile;
    const fromApi = await apiReading(req, o, f);
    if (fromApi) return fromApi;
  }
  return ruleReading(req);
}

async function fileReading(req, key, o, f) {
  try {
    if (!answerFiles.has(o.answersUrl)) answerFiles.set(o.answersUrl, loadAnswers(o.answersUrl, f));
    const answers = await answerFiles.get(o.answersUrl);
    const entry = answers[key];
    return entry ? sanitizeReading(entry.reading, req, "file") : null;
  } catch {
    return null;
  }
}

async function loadAnswers(url, f) {
  try {
    const res = await f(url);
    if (!res.ok) return {};
    const body = await res.json();
    return body && typeof body.answers === "object" && body.answers ? body.answers : {};
  } catch {
    return {};
  }
}

async function apiReading(req, o, f) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), o.timeoutMs) : null;
  try {
    const res = await f(`${o.apiBase}/api/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal: ctl?.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const r = body?.reading;
    const src = ["kv", "llm", "rule"].includes(r?.src) ? r.src : null;
    return src ? sanitizeReading(r, req, src) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
