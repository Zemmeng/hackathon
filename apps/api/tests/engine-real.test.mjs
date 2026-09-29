// 联调：main 上真的引擎（apps/engine，#20）+ T3 真路网 + T5 的 readSigns()（规则，不碰网络）
// 引擎把 readSigns() 抛错静默当成「没人被说动」，所以这里数 readSigns 抛了几次错：必须是 0，prepare 的 failed 也必须是 0
// 只读别的模块，不改。引擎改了导出或请求形状，这里会红：那就是接口对不上了，先对齐再合
// 用法：node tests/engine-real.test.mjs
import { existsSync, readFileSync } from "node:fs";
import { ok, eq, sec, done } from "./mini.mjs";
import { readSigns, resetReader } from "../public/js/reader.js";

const engineUrl = new URL("../../engine/public/js/index.js", import.meta.url);
const roadsDir = new URL("../../roads/public/cbd/", import.meta.url);

if (!existsSync(engineUrl) || !existsSync(new URL("network.json", roadsDir))) {
  console.log("⏭ 跳过：没有 apps/engine 或 apps/roads 的真路网");
} else {
  const { createEngine, affected, capFactors } = await import(engineUrl.href);
  const network = JSON.parse(readFileSync(new URL("network.json", roadsDir), "utf8"));
  const flows = JSON.parse(readFileSync(new URL("flows.json", roadsDir), "utf8"));

  let calls = 0;
  const errors = [];
  const t5 = async (req) => {
    calls++;
    try {
      return await readSigns(req, { fetch: null }); // 不碰网络：答案文件和 /api/read 都跳过，直接规则
    } catch (e) {
      errors.push(`${e.code}: ${e.message}`);
      throw e;
    }
  };

  const WHEN = { date: "2026-10-06", hour: 17 };
  const LINK = "l2177124610_2190478926"; // Bourke Street 东行，两车道（引擎 e2e 测试用的同一段）
  const eng = createEngine({ network, flows, readSigns: t5 });
  const [ap] = affected(eng.net, flows, { id: "R", links: [LINK], closes: { lanes: 1 } }, WHEN, capFactors(eng.net, [{ links: [LINK], closes: { lanes: 1 } }]));
  const best = ap.alts[0];
  const stem = best.name.split(" ")[0].toUpperCase().slice(0, 10);
  const plan = (equipment) => ({
    when: WHEN,
    worksites: [{ id: "R", links: [LINK], closes: { lanes: 1 }, time: { from: "2026-10-05", to: "2026-10-09", hours: [7, 19] }, equipment }],
  });

  await sec("真引擎 prepare：VMS + 静态牌 + 两块箭头板（一块没有字），readSigns 一次都不抛", async () => {
    resetReader();
    const p = plan([
      { id: "vms1", type: "vms", at_m: Math.round(best.diverge_m) + 100, frames: [["USE", stem, "SAVE 3 MIN"]] },
      { id: "s1", type: "sign", at_m: 80, text: "RIGHT LANE CLOSED" },
      { id: "a1", type: "arrow", at_m: 60 },
      { id: "a2", type: "arrow", at_m: 40, text: "MERGE LEFT" },
      { id: "b1", type: "barrier", at_m: 0 },
    ]);
    const out = await eng.prepare(p);
    eq(errors, [], "readSigns 抛错 0 次");
    eq(out.failed, 0, `prepare：问了 ${out.asked} 条，failed = 0`);
    ok(calls > 0, `readSigns 真被调了（${calls} 次）`);
    const r = eng.evaluate(p);
    eq(r.missing ?? 0, 0, "evaluate：没有缺读数");
    const byType = r.approaches[0].by_type;
    ok(Object.values(byType).every((b) => b.reading && b.reading.src === "rule"), "每类人的 reading 都是 T5 给的（src: rule）");
    const told = byType.commuter.reading.advice[best.name];
    eq(told, "use", `屏上 USE ${stem} → 引擎拿到 advice「${best.name}: use」`);
  });

  await sec("对照：屏上字超规范（11 个字符）时，引擎那段会缺读数 —— T2 要用 checkSigns() 先挡住", async () => {
    resetReader();
    errors.length = 0;
    const p = plan([{ id: "vms1", type: "vms", at_m: Math.round(best.diverge_m) + 100, frames: [["ROADWORKS AH"]] }]);
    const out = await eng.prepare(p);
    ok(errors.length > 0 && errors.every((e) => e.startsWith("line_too_long")), `readSigns 拒了 ${errors.length} 次（line_too_long）`);
    ok(out.failed > 0, `prepare 的 failed = ${out.failed}：引擎把它当缺读数，不会崩`);
  });
}

done();
