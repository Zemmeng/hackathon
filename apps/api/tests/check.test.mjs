// 文案输入框的软警告 checkSigns()（public/js/check.js）+ 演示文案清单（fixtures/demo-signs.json）+ 真路网路名
// 用法：node tests/check.test.mjs
import { readFileSync } from "node:fs";
import { ok, eq, sec, done } from "./mini.mjs";
import { checkSigns } from "../public/js/check.js";
import { ruleReading } from "../public/js/rules.js";

const ROADS = ["La Trobe Street", "Russell Street", "Lonsdale Street", "Little Lonsdale Street", "A'Beckett Street"];
const req = (signs) => ({ persona: "tourist", kmh: 40, signs, roads: ROADS });
const vms = (frames, read_s = 9) => ({ kind: "vms", frames, read_s });
const codes = (r) => r.warnings.map((w) => w.code);

await sec("超规范：ok=false + 短码，不抛错", () => {
  const r = checkSigns(req([vms([["ABCDEFGHIJK"]])]));
  eq([r.ok, r.error.code, r.warnings], [false, "line_too_long", []], "11 个字符");
  eq(checkSigns(null).error.code, "bad_request", "请求不是对象也不抛");
});

await sec("软警告：没超规范但不好读", () => {
  eq(codes(checkSigns(req([vms([["USE", "RUSSELL ST"]])]))), [], "好读的：没有警告");
  eq(codes(checkSigns(req([vms([["ROADWORKS", "AHEAD"]])]))), ["long_line"], "9 个字符的行（不是路名）");
  eq(codes(checkSigns(req([vms([["USE", "A'BECKETT"]])]))), [], "整行是路名，9 个字符也不提醒");
  eq(codes(checkSigns(req([vms([["A", "B", "C", "D"]])]))), ["many_lines"], "4 行");
  eq(codes(checkSigns(req([vms([["LA TROBE", "CLOSED"], ["USE", "RUSSELL ST"]], 3)]))), ["frames_too_fast", "short_read"], "两帧只能读 3 秒");
  eq(codes(checkSigns(req([vms([["LA TROBE", "CLOSED"], ["USE", "RUSSELL ST"]], 4)]))), ["short_read"], "两帧 4 秒：轮得完一遍，但 5 个词读不完");
  eq(codes(checkSigns(req([vms([["RD WKS", "AHD"]])]))), ["odd_abbrev"], "非标准缩写");
  eq(codes(checkSigns(req([vms([["RD WKS AHD"]])]))), ["long_line", "odd_abbrev"], "10 个字符的缩写行：两条都提醒");
  const w = checkSigns(req([vms([["USE"]]), vms([["RD WKS", "AHD"]])])).warnings;
  eq(w.map((x) => x.sign), [1], "警告标了是第几块标志");
  ok(w.every((x) => typeof x.msg === "string" && x.msg.length > 0), "每条都有给人看的 msg");
});

await sec("真路网的路名写法（network.json 用全称）", () => {
  const adv = (lines) => ruleReading(req([vms([lines])])).advice;
  eq(adv(["USE", "RUSSELL ST"]), { "Russell Street": "use" }, "ST 对上 Street");
  eq(adv(["USE", "A'BECKETT"]), { "A'Beckett Street": "use" }, "带撇号");
  eq(adv(["USE LITTLE", "LONSDALE"]), { "Little Lonsdale Street": "use" }, "Little Lonsdale 优先于 Lonsdale");
  eq(adv(["USE", "LONSDALE"]), { "Lonsdale Street": "use" }, "只写 LONSDALE 是 Lonsdale Street");
});

await sec("演示文案清单：每句都合规范，规则读数说得通", () => {
  const demo = JSON.parse(readFileSync(new URL("../fixtures/demo-signs.json", import.meta.url), "utf8"));
  ok(demo.messages.length >= 6, "至少 6 句");
  eq(new Set(demo.messages.map((m) => m.id)).size, demo.messages.length, "id 不重复");
  const roads = JSON.parse(readFileSync(new URL("../../roads/public/cbd/network.json", import.meta.url), "utf8"));
  const names = new Set(roads.links.map((l) => l.name));
  for (const r of demo.roads) ok(names.has(r), `路名 ${r} 在 network.json 里`);
  for (const m of demo.messages) {
    for (const persona of demo.personas) {
      const r = checkSigns({ persona, kmh: demo.kmh, signs: m.signs, roads: demo.roads });
      ok(r.ok, `${m.id} × ${persona} 合规范${r.ok ? "" : `：${r.error.msg}`}`);
    }
  }
  const byId = Object.fromEntries(demo.messages.map((m) => [m.id, ruleReading({ persona: "local", kmh: demo.kmh, signs: m.signs, roads: demo.roads })]));
  eq(byId.plain.advice, {}, "plain：没有建议");
  eq(byId["use-russell"].advice, { "Russell Street": "use" }, "use-russell");
  eq(byId["closed-use"].advice, { "Russell Street": "use", "La Trobe Street": "avoid" }, "closed-use");
  eq(byId["delay-only"].delay_min, 15, "delay-only：15 分钟");
});

done();
