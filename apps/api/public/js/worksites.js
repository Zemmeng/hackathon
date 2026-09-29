// 施工登记表（T5 · 提案 #48 第 ⑤ 步）：「施工」对象的规范化、时间重叠、浏览器端客户端。浏览器和 Worker（src/register.js）共用
// 「施工」= docs/contract.md §施工方案（links / closes / time / equipment）+ 登记表字段（title / kind / status / decision）
//   服务端再加 id / seed / created / updated。引擎要的格式用 toEngineWorksite() 转
// 🔒 只收白名单字段：别的字段（邮箱、名字……）一律丢掉，不存、不回
// 🔒 title / reason 不许有 < > 和控制字符：网页用 innerHTML 拼模板，挡在入口
import { normSign, SignError } from "./signs.js";
import { SEED_WORKSITES } from "./worksites-seed.js";

export const WS_LIMITS = {
  title: 80,
  reason: 280,
  links: 20,
  equipment: 30,
  lanes: 8,
  atM: 2000, // 设备离施工起点最多多少米（和引擎顾问的 at_m 上限一样）
  spanDays: 366,
  entries: 200, // 登记表最多存几条（不含预置的演示施工）
  writesPerDay: 500, // 全局每天最多写几次（UTC 0 点清零）：公开接口，防有人刷满 Durable Object
};
export const KINDS = ["road", "utility", "building", "event", "other"];
export const STATUSES = ["draft", "assessed", "decided", "exported", "withdrawn"];
export const ROLES = ["contractor", "council"];
export const EQUIP_TYPES = ["vms", "sign", "arrow", "barrier"];
export const FOOTPATH_SIDES = ["left", "right", "both"];
export const PATCH_KEYS = ["title", "kind", "status", "links", "closes", "time", "equipment", "decision"];

export class WorksiteError extends Error {
  constructor(code, msg) {
    super(msg);
    this.name = "WorksiteError";
    this.code = code; // 机器可读短码，Worker 原样放进 { ok:false, error } 里
  }
}

const bad = (code, msg) => new WorksiteError(code, msg);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const LINK_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DIR_RE = /^[NSEW]{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// 一段给人看的字：合并空白；空了按 required 报错；不许 < > 和控制字符
function text(x, max, code, where, required = true) {
  if (x === undefined || x === null || x === "") {
    if (required) throw bad(code, `${where} 不能为空`);
    return "";
  }
  if (typeof x !== "string") throw bad(code, `${where} 要是字符串`);
  const t = x.replace(/\s+/g, " ").trim();
  if (!t && required) throw bad(code, `${where} 不能为空`);
  if (t.length > max) throw bad(code, `${where} 最多 ${max} 个字符`);
  if (/[<>\u0000-\u001f\u007f]/.test(t)) throw bad("bad_text", `${where} 不能有 < > 或控制字符`);
  return t;
}

function oneOf(x, list, code, where) {
  if (!list.includes(x)) throw bad(code, `${where} 只能是 ${list.join(" / ")}`);
  return x;
}

export function isDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const dayNum = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;

function normLinks(x) {
  if (!Array.isArray(x) || x.length < 1 || x.length > WS_LIMITS.links) {
    throw bad("bad_links", `links 要是 1–${WS_LIMITS.links} 个路段 id 的数组（network.json 的 id，按行车方向）`);
  }
  for (const id of x) if (typeof id !== "string" || !LINK_RE.test(id)) throw bad("bad_links", `路段 id 只能是 1–64 个字母、数字、_ -`);
  return [...new Set(x)];
}

// closes.lanes = 封几条车道（≥ 车道数 = 全封，引擎按路段车道数算）；footpath 不写 / null / "none" = 人行道不封
function normCloses(c) {
  if (!isObj(c)) throw bad("bad_closes", "closes 要是 { lanes, footpath? } 对象");
  const { lanes } = c;
  if (!Number.isInteger(lanes) || lanes < 0 || lanes > WS_LIMITS.lanes) throw bad("bad_closes", `closes.lanes 要是 0–${WS_LIMITS.lanes} 的整数`);
  const f = c.footpath;
  const footpath = f === undefined || f === null || f === "none" ? null : oneOf(f, FOOTPATH_SIDES, "bad_closes", "closes.footpath");
  if (lanes === 0 && !footpath) throw bad("bad_closes", "既不封车道也不封人行道：没有要登记的施工");
  return { lanes, footpath };
}

// time.hours = 每天 [开始, 结束)，和引擎同一口径；跨午夜的夜间施工要拆成两条
function normTime(t) {
  if (!isObj(t)) throw bad("bad_time", "time 要是 { from, to, hours } 对象");
  if (!isDate(t.from) || !isDate(t.to)) throw bad("bad_time", "time.from / time.to 要是 YYYY-MM-DD 日期");
  if (t.from > t.to) throw bad("bad_time", "time.from 不能晚于 time.to");
  if (dayNum(t.to) - dayNum(t.from) + 1 > WS_LIMITS.spanDays) throw bad("bad_time", `工期最长 ${WS_LIMITS.spanDays} 天`);
  const h = t.hours === undefined || t.hours === null ? [0, 24] : t.hours;
  if (!Array.isArray(h) || h.length !== 2 || !h.every(Number.isInteger) || h[0] < 0 || h[1] > 24 || h[0] >= h[1]) {
    throw bad("bad_time", "time.hours 要是 [开始, 结束) 两个整点，0 ≤ 开始 < 结束 ≤ 24");
  }
  return { from: t.from, to: t.to, hours: [h[0], h[1]] };
}

// 屏上文字沿用 signs.js 的规范（2 帧 × 4 行 × 10 字符、8 个词、只许大写和常见标点）
function signOf(s, at) {
  try {
    return normSign({ ...s, read_s: 0 }, 0);
  } catch (e) {
    if (e instanceof SignError) throw bad(e.code, e.message.replace(/^signs\[0\]/, at));
    throw e;
  }
}

function normEquipment(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > WS_LIMITS.equipment) throw bad("bad_equipment", `equipment 要是数组，最多 ${WS_LIMITS.equipment} 件`);
  const ids = new Set();
  return list.map((e, i) => {
    const at = `equipment[${i}]`;
    if (!isObj(e)) throw bad("bad_equipment", `${at} 要是对象`);
    if (typeof e.id !== "string" || !ID_RE.test(e.id)) throw bad("bad_equipment", `${at}.id 要是 1–32 个字母、数字、_ -`);
    if (ids.has(e.id)) throw bad("bad_equipment", `${at}.id「${e.id}」重复了`);
    ids.add(e.id);
    oneOf(e.type, EQUIP_TYPES, "bad_equipment", `${at}.type`);
    if (typeof e.at_m !== "number" || !Number.isFinite(e.at_m) || e.at_m < 0 || e.at_m > WS_LIMITS.atM) {
      throw bad("bad_equipment", `${at}.at_m 要是 0–${WS_LIMITS.atM} 米（在施工起点上游多远）`);
    }
    const out = { id: e.id, type: e.type, at_m: Math.round(e.at_m) };
    if (e.type === "vms") out.frames = signOf({ kind: "vms", frames: e.frames }, at).frames;
    if (e.type === "sign" || e.type === "arrow") {
      const s = signOf({ kind: e.type, text: e.text }, at);
      if (s.text) out.text = s.text;
    }
    if (e.dir !== undefined && e.dir !== null) {
      if (typeof e.dir !== "string" || !DIR_RE.test(e.dir)) throw bad("bad_equipment", `${at}.dir 只能是 N / S / E / W（或两个字母，如 NW）`);
      out.dir = e.dir;
    }
    if (e.char_mm !== undefined && e.char_mm !== null) {
      if (!Number.isInteger(e.char_mm) || e.char_mm < 100 || e.char_mm > 600) throw bad("bad_equipment", `${at}.char_mm 要是 100–600 的整数（毫米）`);
      out.char_mm = e.char_mm;
    }
    return out;
  });
}

// 人来决定（提案第 ⑦ 步）：选了哪套方案、谁、为什么。at 由服务端写，客户端给的只在格式对时保留
function normDecision(d) {
  if (d === undefined || d === null) return null;
  if (!isObj(d)) throw bad("bad_decision", "decision 要是 { option, by, reason? } 对象");
  if (typeof d.option !== "string" || !ID_RE.test(d.option)) throw bad("bad_decision", "decision.option 要是方案 id（1–32 个字母、数字、_ -）");
  return {
    option: d.option,
    by: oneOf(d.by, ROLES, "bad_decision", "decision.by"),
    reason: text(d.reason, WS_LIMITS.reason, "bad_decision", "decision.reason", false),
    at: typeof d.at === "string" && ISO_RE.test(d.at) ? d.at : null,
  };
}

// 输入 → 规范化后的「施工」（不含 id / seed / created / updated）；不合规范抛 WorksiteError；多余字段丢掉
export function normalizeWorksite(x) {
  if (!isObj(x)) throw bad("bad_worksite", "施工要是一个对象");
  const ws = {
    title: text(x.title, WS_LIMITS.title, "bad_title", "title"),
    kind: x.kind === undefined || x.kind === null ? "other" : oneOf(x.kind, KINDS, "bad_kind", "kind"),
    status: x.status === undefined || x.status === null ? "draft" : oneOf(x.status, STATUSES, "bad_status", "status"),
    links: normLinks(x.links),
    closes: normCloses(x.closes),
    time: normTime(x.time),
    equipment: normEquipment(x.equipment),
    decision: normDecision(x.decision),
  };
  if ((ws.status === "decided" || ws.status === "exported") && !ws.decision) {
    throw bad("bad_status", "status 是 decided / exported 时要有 decision（选了哪套、谁选的）");
  }
  return ws;
}

// PATCH：只认 PATCH_KEYS 里的字段，合并后整份重新校验
export function applyPatch(cur, patch) {
  if (!isObj(patch)) throw bad("bad_worksite", "PATCH 请求体要是对象");
  const keys = Object.keys(patch).filter((k) => PATCH_KEYS.includes(k));
  if (!keys.length) throw bad("bad_patch", `没有能改的字段（只能改 ${PATCH_KEYS.join(" / ")}）`);
  const merged = { ...cur };
  for (const k of keys) merged[k] = patch[k];
  return normalizeWorksite(merged);
}

// 预置的演示施工，规范化一遍（有错模块加载就抛，测试会红）
export const SEEDS = SEED_WORKSITES.map((s) => ({ id: s.id, ...normalizeWorksite(s), seed: true, created: null, updated: null }));
export const isSeedId = (id) => SEEDS.some((s) => s.id === id);

// 工期和日期窗口 [from, to]（含两头）有没有交集；只看日期，不看每天几点
export function inWindow(ws, from, to) {
  return (!from || ws.time.to >= from) && (!to || ws.time.from <= to);
}

// 两处施工会不会同时进行：日期有交集且每天的时段有交集（和引擎 worksite.js 的 overlaps() 同一口径）
export function timeOverlap(a, b) {
  const [a0, a1] = a.time.hours || [0, 24];
  const [b0, b1] = b.time.hours || [0, 24];
  return a.time.from <= b.time.to && b.time.from <= a.time.to && a0 < b1 && b0 < a1;
}

// 登记表里和 ws 时间上重叠的其他施工（撤回的不算）→ 网页拿去逐对调引擎 conflict(a, b) 算冲突成本
export function overlapping(ws, list) {
  return list.filter((o) => o.id !== ws.id && o.status !== "withdrawn" && timeOverlap(ws, o));
}

// 查询参数 → { from, to, status }；不合规范抛 bad_query
export function parseQuery(q = {}) {
  const get = (k) => (typeof q.get === "function" ? q.get(k) : q[k]) || null;
  const out = { from: get("from"), to: get("to"), status: get("status") };
  for (const k of ["from", "to"]) if (out[k] && !isDate(out[k])) throw bad("bad_query", `${k} 要是 YYYY-MM-DD 日期`);
  if (out.from && out.to && out.from > out.to) throw bad("bad_query", "from 不能晚于 to");
  if (out.status && !STATUSES.includes(out.status)) throw bad("bad_query", `status 只能是 ${STATUSES.join(" / ")}`);
  return out;
}

// 按查询过滤，按开工日期、id 排序
export function selectWorksites(list, q = {}) {
  return list
    .filter((ws) => inWindow(ws, q.from, q.to) && (!q.status || ws.status === q.status))
    .sort((a, b) => (a.time.from === b.time.from ? (a.id < b.id ? -1 : 1) : a.time.from < b.time.from ? -1 : 1));
}

// 登记表的「施工」→ 引擎认的 §施工方案 对象（引擎不认 title / status 这些，转一下更干净）
export function toEngineWorksite(ws) {
  return {
    id: ws.id,
    name: ws.title,
    links: [...ws.links],
    closes: { lanes: ws.closes.lanes, ...(ws.closes.footpath ? { footpath: ws.closes.footpath } : {}) },
    time: { from: ws.time.from, to: ws.time.to, hours: [...ws.time.hours] },
    equipment: structuredClone(ws.equipment),
  };
}

// ---- 浏览器端客户端：同源部署时 apiBase 留空；opts: { fetch, apiBase, timeoutMs }，测试里注入 fetch ----

async function call(path, { method = "GET", body, token, fetch, apiBase = "", timeoutMs = 8000 } = {}) {
  const f = fetch || globalThis.fetch;
  if (typeof f !== "function") throw bad("no_fetch", "没有 fetch");
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["x-edit-token"] = token;
    const r = await f(`${apiBase}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl?.signal });
    const b = await r.json().catch(() => null);
    if (!r.ok || !b || b.ok !== true) throw bad(b?.error || `http_${r.status}`, b?.msg || `登记表接口回 ${r.status}`);
    return b;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 列出登记表（默认全部）→ { src: "api" | "seed", worksites }。接口不通就退回预置的演示施工（只读），页面照样能演
export async function listWorksites(query = {}, opts = {}) {
  const q = parseQuery(query);
  try {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
    const b = await call(`/api/worksites${qs ? `?${qs}` : ""}`, opts);
    return { src: b.register === "do" ? "api" : "seed", worksites: b.worksites };
  } catch {
    return { src: "seed", worksites: selectWorksites(structuredClone(SEEDS), q) };
  }
}

export async function getWorksite(id, opts = {}) {
  return (await call(`/api/worksites/${encodeURIComponent(id)}`, opts)).worksite;
}

// 登记 → { worksite, edit_token }。edit_token 只在这一次返回：页面自己存好（localStorage），改的时候要带
export async function createWorksite(ws, opts = {}) {
  const b = await call("/api/worksites", { ...opts, method: "POST", body: normalizeWorksite(ws) });
  return { worksite: b.worksite, edit_token: b.edit_token };
}

// 改状态 / 写决定 / 换设备 → 新的 worksite
export async function updateWorksite(id, patch, token, opts = {}) {
  return (await call(`/api/worksites/${encodeURIComponent(id)}`, { ...opts, method: "PATCH", body: patch, token })).worksite;
}
