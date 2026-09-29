// 屏上文字的规范 + 请求规范化 + 读数校验 + 缓存键。浏览器（reader.js）和 Worker（src/worker.js）共用同一份
// 规范出处：RPM VMS 产品页（每帧 4 行 × 10 字符）、WA VMS 指南 §1.4、§7.4 —— 见 docs/arch/T5-PRD.md
// 接口：docs/contract.md §路人读数

export const PERSONAS = ["commuter", "local", "tourist", "delivery"];

export const LIMITS = {
  frames: 2, // VMS 最多 2 帧
  lines: 4, // 每帧最多 4 行
  chars: 10, // 每行最多 10 个字符
  words: 8, // 一块屏所有帧合计最多 8 个词；静态标志牌同样按 8 个词算
  signChars: 40, // 静态标志牌一整句最多 40 个字符（例 RIGHT LANE CLOSED 是 17 个）
  signs: 8, // 一次请求最多 8 块标志
  roads: 8, // 当前路 + 候选绕行路最多 8 条
  roadChars: 40,
  readS: 120, // 能读的秒数上限
  kmh: 130,
};

// 屏上只允许大写字母、数字、空格和常见标点；不许 < > 这类字符，免得有人在屏上拼出提示词里的标签
const SIGN_CHARS = /^[A-Z0-9 .,'&:!?()+/-]*$/;
const ROAD_CHARS = /^[A-Za-z0-9 .'&-]+$/;

export class SignError extends Error {
  constructor(code, msg) {
    super(msg);
    this.name = "SignError";
    this.code = code; // 机器可读短码，Worker 原样放进 { ok:false, error } 里
  }
}

const bad = (code, msg) => new SignError(code, msg);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const squash = (s) => s.replace(/\s+/g, " ").trim();

// 屏上一行 / 一句：转大写、合并空格，再查字符集
function signText(x, where) {
  if (typeof x !== "string") throw bad("bad_sign", `${where} 要是字符串`);
  const t = squash(x.toUpperCase());
  if (!SIGN_CHARS.test(t)) throw bad("bad_chars", `${where} 只能用大写字母、数字、空格和 . , ' & : ! ? ( ) + / -`);
  return t;
}

export const countWords = (text) => (text ? text.split(" ").length : 0);

function normSign(s, i) {
  const at = `signs[${i}]`;
  if (!isObj(s)) throw bad("bad_sign", `${at} 要是对象`);
  const readS = s.read_s;
  if (typeof readS !== "number" || !Number.isFinite(readS) || readS < 0 || readS > LIMITS.readS) {
    throw bad("bad_read_s", `${at}.read_s 要是 0–${LIMITS.readS} 的秒数`);
  }
  const read_s = Math.round(readS);

  if (s.kind === "vms") {
    const fr = s.frames;
    if (!Array.isArray(fr) || fr.length < 1 || fr.length > LIMITS.frames) {
      throw bad("too_many_frames", `${at} 的 VMS 要有 1–${LIMITS.frames} 帧`);
    }
    let words = 0;
    const frames = fr.map((f, j) => {
      if (!Array.isArray(f)) throw bad("bad_sign", `${at}.frames[${j}] 要是一组行`);
      if (f.length > LIMITS.lines) throw bad("too_many_lines", `${at}.frames[${j}] 超过 ${LIMITS.lines} 行`);
      const lines = f.map((l, k) => signText(l, `${at}.frames[${j}][${k}]`)).filter(Boolean);
      for (const l of lines) {
        if (l.length > LIMITS.chars) throw bad("line_too_long", `「${l}」超过每行 ${LIMITS.chars} 个字符`);
        words += countWords(l);
      }
      if (!lines.length) throw bad("empty_frame", `${at}.frames[${j}] 没有字`);
      return lines;
    });
    if (words > LIMITS.words) throw bad("too_many_words", `${at} 合计 ${words} 个词，超过 ${LIMITS.words} 个`);
    return { kind: "vms", frames, read_s };
  }

  if (s.kind === "sign") {
    const text = signText(s.text, `${at}.text`);
    if (!text) throw bad("empty_sign", `${at}.text 没有字`);
    if (text.length > LIMITS.signChars) throw bad("line_too_long", `${at}.text 超过 ${LIMITS.signChars} 个字符`);
    if (countWords(text) > LIMITS.words) throw bad("too_many_words", `${at}.text 超过 ${LIMITS.words} 个词`);
    return { kind: "sign", text, read_s };
  }

  throw bad("bad_kind", `${at}.kind 只能是 vms 或 sign`);
}

function normRoad(r, i) {
  if (typeof r !== "string") throw bad("bad_road", `roads[${i}] 要是字符串`);
  const t = squash(r);
  if (!t || t.length > LIMITS.roadChars || !ROAD_CHARS.test(t)) {
    throw bad("bad_road", `roads[${i}] 要是 1–${LIMITS.roadChars} 个字符的路名（字母、数字、空格、. ' & -）`);
  }
  return t;
}

// 请求 → 规范化后的请求；不合规范抛 SignError（Worker 回 400，浏览器端直接抛给调用方）
// 规范化：大写、合并空格、去空行、read_s 取整、路名去重；多余字段丢掉
export function normalizeRequest(req) {
  if (!isObj(req)) throw bad("bad_request", "请求要是一个对象");
  if (!PERSONAS.includes(req.persona)) throw bad("bad_persona", `persona 只能是 ${PERSONAS.join(" / ")}`);
  const kmh = req.kmh;
  if (typeof kmh !== "number" || !Number.isFinite(kmh) || kmh < 0 || kmh > LIMITS.kmh) {
    throw bad("bad_kmh", `kmh 要是 0–${LIMITS.kmh} 的数`);
  }
  if (!Array.isArray(req.signs) || req.signs.length > LIMITS.signs) {
    throw bad("too_many_signs", `signs 要是数组，最多 ${LIMITS.signs} 块`);
  }
  if (!Array.isArray(req.roads) || req.roads.length > LIMITS.roads) {
    throw bad("bad_road", `roads 要是数组，最多 ${LIMITS.roads} 条`);
  }
  return {
    persona: req.persona,
    kmh: Math.round(kmh),
    signs: req.signs.map(normSign),
    roads: [...new Set(req.roads.map(normRoad))],
  };
}

// 一块标志的全部文字（帧和行用空格接起来，按阅读顺序）
export const signMessage = (s) => (s.kind === "vms" ? s.frames.flat().join(" ") : s.text);

// 缓存用的规范串：只含「字 + 人 + 候选路」。按 T5-PRD，kmh 不进键（read_s 已经含了车速）；路名排序后顺序无关
export function canonical(req) {
  return JSON.stringify({ p: req.persona, s: req.signs, r: [...req.roads].sort() });
}

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- 读数校验
// 文件、KV、大模型回来的东西都当不可信数据：字段不对就返回 null（调用方改用规则），不硬凑

const MAX_MIN = 240;
const WHY_MAX = 160;
const SRCS = ["file", "kv", "llm", "rule"];

const unit = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null);
const r2 = (x) => Math.round(x * 100) / 100;

function minutes(x) {
  if (x === null || x === undefined) return null;
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_MIN ? Math.round(x) : undefined;
}

function pair(x) {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const [a, b] = x.map(unit);
  return a !== null && b !== null && a <= b ? [r2(a), r2(b)] : null;
}

export function cleanWhy(x) {
  if (typeof x !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return squash(x.replace(/[\u0000-\u001f\u007f]/g, " ")).slice(0, WHY_MAX);
}

// raw：任意来源的读数；req：规范化后的请求；src：这份读数实际从哪来
export function sanitizeReading(raw, req, src) {
  if (!isObj(raw) || !SRCS.includes(src)) return null;
  const notice = unit(raw.notice);
  const understand = unit(raw.understand);
  const trust = unit(raw.trust);
  const saving = minutes(raw.saving_min);
  const delay = minutes(raw.delay_min);
  if (notice === null || understand === null || trust === null || saving === undefined || delay === undefined) return null;

  // advice 只认请求里给过的路名（大小写不敏感，输出用请求里的写法），只认 use / avoid
  const advice = {};
  if (raw.advice !== undefined && !isObj(raw.advice)) return null;
  const byUpper = new Map(req.roads.map((r) => [r.toUpperCase(), r]));
  for (const [k, v] of Object.entries(raw.advice || {})) {
    const road = typeof k === "string" ? byUpper.get(squash(k).toUpperCase()) : undefined;
    if (road && (v === "use" || v === "avoid") && advice[road] !== "avoid") advice[road] = v;
  }

  const out = {
    persona: req.persona,
    notice: r2(notice),
    understand: r2(understand),
    advice,
    saving_min: saving,
    delay_min: delay,
    trust: r2(trust),
    why: cleanWhy(raw.why),
  };
  if (isObj(raw.range)) {
    const range = {};
    for (const k of ["notice", "understand", "trust"]) {
      const p = pair(raw.range[k]);
      if (p) range[k] = p;
    }
    if (Object.keys(range).length) out.range = range;
  }
  out.src = src;
  if (typeof raw.model === "string") out.model = raw.model.slice(0, 80);
  if (typeof raw.prompt_v === "string") out.prompt_v = raw.prompt_v.slice(0, 20);
  return out;
}
