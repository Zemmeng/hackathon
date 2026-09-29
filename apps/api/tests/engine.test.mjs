// 反向：#20 引擎（apps/engine/public/js/reading.js）发来的请求都要被接住，不许抛 SignError
// 引擎把 readSigns 抛错当成「没人被说动」静默吞掉，所以这里被拒 = 结果悄悄算错。请求形状照 #20 在 09-29 15:20 的代码抄
// 用法：node tests/engine.test.mjs
import { ok, eq, sec, done } from "./mini.mjs";
import { readSigns, resetReader } from "../public/js/reader.js";

// 照 #20 cards.js：可读距离 ÷ 车速（车速最低按 5 km/h 算），四舍五入到秒
const legibleM = (charMm) => charMm * 0.6; // 只为造出一串真实量级的秒数；具体系数以引擎为准
const readSeconds = (kmh, charMm = 320) => Math.round(legibleM(charMm) / (Math.max(5, kmh) / 3.6));
// 照 #20 cards.js 的 cleanName
const cleanName = (s) => String(s ?? "").replace(/[^A-Za-z0-9 .,'&/()-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Unnamed road";

// 照 #20 reading.js：signsOn() 把 vms / sign / arrow 按位置排好，最多 6 块，m 在 request() 里去掉
function engineRequest(persona, kmh, equipment, street, alts) {
  const signs = equipment
    .filter((e) => e.type === "vms" || e.type === "sign" || e.type === "arrow")
    .map((e) => ({ kind: e.type, ...(e.type === "vms" ? { frames: e.frames } : { text: e.text }), read_s: readSeconds(kmh, e.type === "vms" ? e.char_mm : 200) }))
    .slice(-6);
  return { persona, kmh, signs, roads: [street, ...alts].map(cleanName) };
}

const EQUIP = [
  { type: "barrier" },
  { type: "arrow" }, // 只有箭头，没有字
  { type: "arrow", text: "MERGE RIGHT" },
  { type: "sign", text: "RIGHT LANE CLOSED" },
  { type: "vms", frames: [["LA TROBE", "CLOSED"], ["USE", "RUSSELL ST"]], char_mm: 320 },
  { type: "vms", frames: [["ROADWORK", "AHEAD"]] },
];
const noFetch = { fetch: null }; // 只测规范和规则，不碰网络

await sec("各种车速 × 4 类人：引擎的请求全部接住", async () => {
  let n = 0;
  for (const kmh of [0, 5, 10, 40, 60]) {
    for (const persona of ["commuter", "local", "tourist", "delivery"]) {
      const req = engineRequest(persona, kmh, EQUIP, "La Trobe Street", ["Russell Street", "A'Beckett Street", "Unnamed (service) road?"]);
      resetReader();
      try {
        const r = await readSigns(req, noFetch);
        ok(r.src === "rule" && r.notice >= 0 && r.notice <= 1, `${kmh} km/h × ${persona}：合法读数`);
        n++;
      } catch (e) {
        ok(false, `${kmh} km/h × ${persona} 被拒：${e.code} ${e.message}`);
      }
    }
  }
  eq(n, 20, "20 个请求都有读数");
  ok(readSeconds(5) > 120, `前提：5 km/h 时引擎算出的秒数（${readSeconds(5)}）确实超过 120`);
});

await sec("引擎的校准锚点（#20 calibrate.js）", async () => {
  for (const frames of [[["ROADWORK", "AHEAD"]], [["USE", "RUSSELL ST"]]]) {
    const r = await readSigns({
      persona: "local", kmh: 40,
      signs: [{ kind: "vms", frames, read_s: 9 }, { kind: "sign", text: "RIGHT LANE CLOSED", read_s: 9 }],
      roads: ["La Trobe Street", "Russell Street", "Elizabeth Street"],
    }, noFetch);
    ok(r.src === "rule", `${frames.flat().join(" / ")}：接住`);
  }
});

await sec("箭头板读起来：注意得到，但不给路名建议", async () => {
  resetReader();
  const r = await readSigns({ persona: "tourist", kmh: 40, signs: [{ kind: "arrow", read_s: 4 }], roads: ["La Trobe Street", "Russell Street"] }, noFetch);
  ok(r.notice > 0, "notice > 0");
  eq(r.advice, {}, "advice 为空");
});

done();
