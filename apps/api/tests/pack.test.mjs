// 执行包 + 设备租金（public/js/pack.js）：设备对应库存、报价、超库存、多处施工共用库存、配置检查、要通知谁、文字版
// 反向断言：报价和文字版一律写明「假设值」；对不上库存的设备不瞎配；通知对象只写角色；文字版里没有 token
// 用法：node tests/pack.test.mjs；不需要 npm i（没有 apps/roads 的库存 / 路网就跳过真数据那几节）
import { existsSync, readFileSync } from "node:fs";
import { ok, eq, sec, done, throws } from "./mini.mjs";
import { itemFor, quote, stockCheck, buildPack, packText, packDoc, linkInfoFrom, daysOf, loadInventory } from "../public/js/pack.js";
import { SEEDS, normalizeWorksite, WorksiteError } from "../public/js/worksites.js";

const roads = new URL("../../roads/public/cbd/", import.meta.url);
const have = existsSync(new URL("equipment.json", roads)) && existsSync(new URL("network.json", roads));

await sec("设备 → 库存条目", () => {
  eq(itemFor({ type: "vms" }), { item: "vms_a", how: "type" }, "VMS 默认 A 级");
  eq(itemFor({ type: "arrow" }).item, "arrow_board", "箭头板");
  eq(itemFor({ type: "barrier" }).item, "barrier_water", "护栏默认注水护栏（对行人和骑车人更友好）");
  eq(itemFor({ type: "sign", text: "RIGHT LANE CLOSED" }).item, "sign_lane_closed_right", "按牌上的字");
  eq(itemFor({ type: "sign", text: "ROADWORK AHEAD" }).item, "sign_roadwork_ahead", "ROADWORK AHEAD");
  eq(itemFor({ type: "sign", text: "END ROADWORK" }).item, "sign_end_roadwork", "END ROADWORK 不会被当成 ROADWORK AHEAD");
  eq(itemFor({ type: "sign", text: "DETOUR LEFT" }).item, "sign_detour_left", "DETOUR LEFT");
  eq(itemFor({ type: "sign", text: "FOOTPATH CLOSED USE OTHER SIDE" }).item, "sign_footpath_closed", "人行道封闭");
  eq(itemFor({ type: "sign", text: "ROAD CLOSED" }), { item: null, how: "none" }, "反向：库存里没有的牌不瞎配");
  eq(itemFor({ type: "vms", item: "vms_c" }), { item: "vms_c", how: "given" }, "写了 item 就用写的");
});

await sec("登记表的施工可以带 item / qty", () => {
  const base = { title: "x", links: ["a"], closes: { lanes: 1 }, time: { from: "2026-10-01", to: "2026-10-02" } };
  const w = normalizeWorksite({ ...base, equipment: [{ id: "V", type: "vms", at_m: 100, frames: [["USE", "RUSSELL ST"]], item: "vms_c", qty: 2 }] });
  eq([w.equipment[0].item, w.equipment[0].qty], ["vms_c", 2], "item / qty 留下");
  const code = (e) => {
    try {
      normalizeWorksite({ ...base, equipment: [e] });
    } catch (x) {
      return x instanceof WorksiteError ? x.code : "?";
    }
    return null;
  };
  eq(code({ id: "V", type: "barrier", at_m: 0, item: "Barrier Water" }), "bad_equipment", "item 格式不对");
  eq(code({ id: "V", type: "barrier", at_m: 0, qty: 0 }), "bad_equipment", "qty 0");
  eq(daysOf({ from: "2026-10-05", to: "2026-10-09" }), 5, "工期按日历天，含两头");
  throws(() => buildPack(SEEDS[0], {}), /inventory/, "没传库存直接报错");
});

if (!have) {
  console.log("⏭ 跳过真数据几节：没有 apps/roads 的 equipment.json / network.json");
} else {
  const inventory = JSON.parse(readFileSync(new URL("equipment.json", roads), "utf8"));
  const network = JSON.parse(readFileSync(new URL("network.json", roads), "utf8"));
  const links = linkInfoFrom(network);
  const [LON, , LTL] = SEEDS;
  const rate = (id) => inventory.items.find((i) => i.id === id).day_rate_aud;
  const stock = (id) => inventory.items.find((i) => i.id === id).qty;

  await sec("报价：Lonsdale（真库存 + 真路段长度）", () => {
    const q = quote(LON, inventory, { links });
    const len = links.get(LON.links[0]).len_m;
    const barriers = Math.ceil(len / 2);
    eq([q.days, q.length_m], [5, len], `5 天 · 封闭段 ${len} 米`);
    const row = (id) => q.lines.find((l) => l.item === id);
    eq(row("barrier_water").qty, barriers, `注水护栏每节 2 米 → ${barriers} 节`);
    eq([row("vms_a").qty, row("arrow_board").qty, row("sign_lane_closed_right").qty], [1, 1, 1], "VMS、箭头板、右侧车道封闭牌各 1");
    const expect = 5 * (rate("vms_a") + rate("arrow_board") + rate("sign_lane_closed_right") + barriers * rate("barrier_water"));
    eq(q.total_aud, expect, `合计 = 件数 × 日租价 × 天数：A$${expect}`);
    eq([q.unmatched, q.over_stock, q.assumed], [[], [], true], "都对上了、没超库存、标明是假设值");
  });

  await sec("报价：写了 item / qty、超库存、对不上、长度不知道", () => {
    const ws = { ...LON, equipment: [{ id: "V", type: "vms", at_m: 300, frames: [["A"]], item: "vms_c", qty: 2 }, { id: "B", type: "barrier", at_m: 0, item: "barrier_steel", qty: stock("barrier_steel") + 10 }, { id: "X", type: "barrier", at_m: 0, item: "crane_99" }] };
    const q = quote(ws, inventory, { links });
    eq(q.lines.find((l) => l.item === "vms_c").cost_aud, 2 * rate("vms_c") * 5, "vms_c × 2 按 C 级日租价");
    eq(q.over_stock, [{ item: "barrier_steel", need: stock("barrier_steel") + 10, stock: stock("barrier_steel") }], "钢护栏超库存");
    eq(q.unmatched.map((u) => u.item), ["crane_99"], "库存里没有的 item → 对不上，不算钱");
    const blind = quote(LON, inventory);
    eq([blind.length_m, blind.total_aud, blind.lines.find((l) => l.item === "barrier_water").unknown], [null, null, true], "不给路段长度：护栏节数算不出、合计为 null");
    eq(blind.partial_total_aud, 5 * (rate("vms_a") + rate("arrow_board") + rate("sign_lane_closed_right")), "只给「至少多少」");
    eq(blind.notes, [{ code: "length_unknown", equipment: "B-1" }], "标 length_unknown");
  });

  await sec("多处施工共用库存", () => {
    const vms2 = (id, from, to) => ({ ...LON, id, time: { from, to, hours: [7, 19] }, equipment: [{ id: "V1", type: "vms", at_m: 300, frames: [["A"]], qty: 2 }] });
    const three = [vms2("W-1", "2026-10-05", "2026-10-09"), vms2("W-2", "2026-10-07", "2026-10-12"), vms2("W-3", "2026-10-08", "2026-10-08")];
    const r = stockCheck(three, inventory, { links });
    eq(r, [{ item: "vms_a", date: "2026-10-08", need: 6, stock: stock("vms_a"), worksites: ["W-1", "W-2", "W-3"] }], "10-08 三处同时要 6 块 A 级 VMS，库存 4 → 报缺得最多的那天");
    eq(stockCheck(three.slice(0, 2), inventory, { links }), [], "两处各 2 块 = 4，刚好够");
    eq(stockCheck([...three.slice(0, 2), { ...three[2], status: "withdrawn" }], inventory, { links }), [], "撤回的不占库存");
    eq(stockCheck(SEEDS, inventory, { links }), [], "3 条演示施工一起用，库存够");
  });

  await sec("执行包：Little Bourke（全封、牌子对不上）", () => {
    const impacts = { transit_pax_min: 120, blocked_vph: 35, peds_extra_min: 0 };
    const p = buildPack({ ...LTL, decision: { option: "o2", by: "council", reason: "shortest works", at: "2026-09-30T02:00:00.000Z" } }, { inventory, links, impacts, now: "2026-09-30T03:00:00.000Z" });
    eq([p.id, p.where.streets, p.when.days], ["W-LTLBOURKE", ["Little Bourke Street"], 6], "地点、6 天");
    const codes = p.checks.map((c) => c.code);
    ok(codes.includes("full_no_detour_info") && codes.includes("unmatched") && codes.includes("no_end_sign"), `全封没有绕行信息、ROAD CLOSED 对不上、没有施工结束牌：${codes}`);
    eq(p.notify.map((n) => n.who), ["council", "frontage", "transit", "emergency"], "通知：市政、沿街、公交（有乘客延误）、应急（全封）");
    const zh = packText(p, "zh");
    const en = packText(p, "en");
    console.log(zh.split("\n").map((l) => `    ${l}`).join("\n"));
    ok(/假设值，以 RPM Hire 正式报价为准/.test(zh) && /assumptions; RPM Hire's formal quote applies/.test(en), "反向：文字版一律写明日租价是假设值");
    ok(/不是实测/.test(zh) && /not field measurements/.test(en), "写明数字来自仿真");
    ok(/选 o2（市政，2026-09-30）：shortest works/.test(zh), "决定写进去");
    ok(/ROAD CLOSED/.test(zh) && /没算进报价/.test(zh), "对不上的牌子明说没算钱");
    ok(!/Yarra|PTV|Metro Trains|000|@|https?:/.test(zh + en), "反向：通知只写角色，不写机构、电话、网址");
  });

  await sec("执行包：Lonsdale 文字版 + 人行道", () => {
    const withFoot = { ...LON, closes: { lanes: 1, footpath: "left" } };
    const p = buildPack(withFoot, { inventory, links, now: "2026-09-30T03:00:00.000Z" });
    ok(p.checks.some((c) => c.code === "no_footpath_sign"), "封了人行道但没牌 → 检查提示");
    ok(p.notify.some((n) => n.who === "pedestrians"), "封人行道 → 通知行人和无障碍出行者");
    const fixed = buildPack({ ...withFoot, equipment: [...withFoot.equipment, { id: "S-9", type: "sign", at_m: 20, text: "FOOTPATH CLOSED" }] }, { inventory, links });
    ok(!fixed.checks.some((c) => c.code === "no_footpath_sign"), "摆了人行道封闭牌 → 不再提示");
    const en = packText(buildPack(LON, { inventory, links }), "en");
    ok(/Frame 1: ROADWORK \/ AHEAD/.test(en) && /Frame 2: USE \/ RUSSELL ST/.test(en), "VMS 排程列出每一屏");
    ok(/Total: A\$[\d,]+ \(assumed rates\)/.test(en), "合计标 assumed rates");
    ok(!/edit_token|[0-9a-f]{32}/.test(en), "反向：文字版里没有 token 一类的东西");
  });

  await sec("packDoc：按区块给网页排版（措辞和 packText 同一张表）", () => {
    const p = buildPack({ ...LON, status: "decided", decision: { option: "C", by: "council", reason: "less delay", at: "2026-09-30T02:00:00.000Z" } }, { inventory, links, now: "2026-09-30T03:00:00.000Z" });
    const zh = packDoc(p, "zh"), en = packDoc(p, "en");
    eq([zh.lang, en.lang, packDoc(p, "fr").lang], ["zh", "en", "en"], "只认 zh / en，别的按英文");
    eq([zh.title, zh.status.key, zh.status.text, en.status.text], ["Lonsdale St westbound lane closure", "decided", "已选定", "decided"], "标题、状态");
    eq([zh.decision, zh.reason], ["选 C（市政，2026-09-30）", "less delay"], "决定一行不带理由，理由单独给（网页用引用样式）");
    ok(/假设值，以 RPM Hire 正式报价为准/.test(zh.quote.note) && /assumptions; RPM Hire's formal quote applies/.test(en.quote.note), "反向：报价区块一律带假设值说明");
    eq(zh.quote.total_aud, p.quote.total_aud, "合计给数字，和 quote() 一样");
    eq(zh.quote.lines.map((l) => l.qty), p.quote.lines.map((l) => l.qty), "件数给数字");
    eq(zh.vms[0].frames.map((f) => f.label), ["第 1 屏", "第 2 屏"], "VMS 按屏分好");
    eq(en.vms[0].frames[1].lines, ["USE", "RUSSELL ST"], "每屏的行原样给");
    eq(zh.labels.cols, { item: "设备", qty: "数量", rate: "日租价", days: "天数", cost: "金额" }, "表头已翻译");
    ok(zh.checks.includes("没有「施工结束」牌") && zh.notify[0].who === "市政交通管理", "检查和通知用 packText 同一套措辞");
    const over = packDoc(buildPack({ ...LON, equipment: [{ id: "B", type: "barrier", at_m: 0, item: "barrier_steel", qty: stock("barrier_steel") + 1 }] }, { inventory, links }), "zh");
    ok(/超库存（库存 \d+）/.test(over.quote.lines[0].over || ""), "超库存的行带提示");
  });

  await sec("浏览器端 loadInventory（假 fetch）", async () => {
    const inv = await loadInventory({ fetch: async (u) => ({ ok: u === "/roads/public/cbd/equipment.json", status: 200, json: async () => inventory }) });
    eq(inv.items.length, inventory.items.length, "同源路径取库存");
    let err = null;
    try {
      await loadInventory({ fetch: async () => ({ ok: false, status: 404 }) });
    } catch (e) {
      err = e.message;
    }
    ok(/404/.test(err || ""), "取不到就抛（页面决定怎么提示）");
  });
}

done();
