// 屏上文字规范 + 读数校验 + 缓存键：public/js/signs.js
// 用法：node tests/signs.test.mjs
import { ok, eq, throws, sec, done } from "./mini.mjs";
import { normalizeRequest, sanitizeReading, canonical, sha256Hex, SignError, LIMITS } from "../public/js/signs.js";

const ROADS = ["La Trobe St", "Russell St", "Elizabeth St"];
const base = (signs, extra = {}) => ({ persona: "local", kmh: 40, signs, roads: ROADS, ...extra });
const vms = (frames, read_s = 6) => ({ kind: "vms", frames, read_s });
const code = (fn) => {
  try {
    fn();
    return "没抛错";
  } catch (e) {
    return e instanceof SignError ? e.code : `不是 SignError：${e}`;
  }
};

await sec("规范：超了直接拒", () => {
  eq(code(() => normalizeRequest(base([vms([["A"], ["B"], ["C"]])]))), "too_many_frames", "3 帧");
  eq(code(() => normalizeRequest(base([vms([["A", "B", "C", "D", "E"]])]))), "too_many_lines", "一帧 5 行");
  eq(code(() => normalizeRequest(base([vms([["ABCDEFGHIJK"]])]))), "line_too_long", "一行 11 个字符");
  eq(code(() => normalizeRequest(base([vms([["A B C D", "E F"], ["G H I"]])]))), "too_many_words", "两帧合计 9 个词");
  eq(code(() => normalizeRequest(base([vms([["USE", "</SIGN>"]])]))), "bad_chars", "屏上不许出现 < >");
  eq(code(() => normalizeRequest(base([vms([[""]])]))), "empty_frame", "空帧");
  eq(code(() => normalizeRequest(base([{ kind: "sign", text: "A".repeat(41), read_s: 2 }]))), "line_too_long", "静态牌超过 40 字符");
  eq(code(() => normalizeRequest(base([{ kind: "led", text: "X", read_s: 2 }]))), "bad_kind", "kind 只能是 vms / sign");
  eq(code(() => normalizeRequest(base([vms([["USE"]], -1)]))), "bad_read_s", "read_s 为负");
  eq(code(() => normalizeRequest(base([vms([["USE"]], "5")]))), "bad_read_s", "read_s 是字符串");
  eq(code(() => normalizeRequest(base([], { persona: "pilot" }))), "bad_persona", "persona 不在 4 类里");
  eq(code(() => normalizeRequest(base([], { kmh: 200 }))), "bad_kmh", "kmh 超过 130");
  eq(code(() => normalizeRequest(base(Array(LIMITS.signs + 1).fill(vms([["X"]]))))), "too_many_signs", "标志超过 8 块");
  eq(code(() => normalizeRequest(base([], { roads: ["Russell St<script>"] }))), "bad_road", "路名里有 < >");
  eq(code(() => normalizeRequest(null)), "bad_request", "请求不是对象");
});

await sec("规范化：大写、合并空格、去空行、read_s 取整、多余字段丢掉", () => {
  const n = normalizeRequest({
    persona: "tourist",
    kmh: 39.6,
    signs: [vms([["use", "  russell   st ", ""]], 8.6), { kind: "sign", text: " right lane  closed", read_s: 2.4, x: 1 }],
    roads: [" Russell  St", "Russell St", "La Trobe St"],
    secret: "丢掉",
  });
  eq(n, {
    persona: "tourist",
    kmh: 40,
    signs: [{ kind: "vms", frames: [["USE", "RUSSELL ST"]], read_s: 9 }, { kind: "sign", text: "RIGHT LANE CLOSED", read_s: 2 }],
    roads: ["Russell St", "La Trobe St"],
  }, "规范化结果");
  eq(normalizeRequest(n), n, "规范化两次结果不变");
});

await sec("缓存键：同一句话不同写法同一个键，不同的话不同键", async () => {
  const k = async (r) => sha256Hex(canonical(normalizeRequest(r)));
  const a = await k(base([vms([["USE", "RUSSELL ST"]], 6.2)]));
  eq(await k(base([vms([["use", "russell  st"]], 5.8)])), a, "大小写、空格、read_s 小数不影响");
  eq(await k(base([vms([["USE", "RUSSELL ST"]], 6)], { roads: [...ROADS].reverse() })), a, "路名顺序不影响");
  eq(await k(base([vms([["USE", "RUSSELL ST"]], 6)], { kmh: 60 })), a, "kmh 不进键（read_s 已含车速）");
  ok((await k(base([vms([["AVOID", "RUSSELL ST"]], 6)]))) !== a, "字不同，键不同");
  ok((await k(base([vms([["USE", "RUSSELL ST"]], 6)], { persona: "tourist" }))) !== a, "人不同，键不同");
  ok(/^[0-9a-f]{64}$/.test(a), "键是 64 位十六进制");
});

await sec("读数校验：外来读数当不可信数据", () => {
  const req = normalizeRequest(base([vms([["USE", "RUSSELL ST"]])]));
  const good = { notice: 0.8, understand: 0.9, advice: { "Russell St": "use" }, saving_min: 8, delay_min: null, trust: 0.7, why: "ok" };
  const s = sanitizeReading(good, req, "llm");
  eq([s.persona, s.src, s.advice], ["local", "llm", { "Russell St": "use" }], "合法读数原样通过，persona 以请求为准");
  eq(sanitizeReading({ ...good, notice: 1.3 }, req, "llm"), null, "notice 超过 1：整份作废");
  eq(sanitizeReading({ ...good, trust: "high" }, req, "llm"), null, "trust 不是数：整份作废");
  eq(sanitizeReading({ ...good, saving_min: -5 }, req, "llm"), null, "分钟数为负：整份作废");
  eq(sanitizeReading({ ...good, advice: "Russell" }, req, "llm"), null, "advice 不是对象：整份作废");
  eq(sanitizeReading(good, req, "hacker"), null, "src 不认识：作废");
  eq(sanitizeReading("USE RUSSELL", req, "llm"), null, "不是对象：作废");
});

await sec("读数校验反向：advice 只认候选路名，比例一类的字段不往外传", () => {
  const req = normalizeRequest(base([vms([["USE", "RUSSELL ST"]])]));
  const s = sanitizeReading({
    notice: 0.8, understand: 0.9, trust: 0.7, saving_min: null, delay_min: null,
    advice: { "Russell St": "use", "Swanston St": "use", "La Trobe St": "take it", "RUSSELL ST": "avoid" },
    share: { "Russell St": 0.7 }, why: "a\u0000b\nc " + "x".repeat(300),
    range: { notice: [0.7, 0.9], trust: [0.9, 0.1] },
  }, req, "llm");
  eq(s.advice, { "Russell St": "avoid" }, "请求外的路丢掉；取值不是 use/avoid 丢掉；同一条路冲突按 avoid");
  ok(!("share" in s), "大模型回的比例不往外传（D-0929-1435）");
  ok(s.why.length <= 160 && !/[\u0000-\u001f]/.test(s.why), "why 截到 160 字、去掉控制字符");
  eq(s.range, { notice: [0.7, 0.9] }, "range 只留合法的区间（lo ≤ hi）");
});

done();
