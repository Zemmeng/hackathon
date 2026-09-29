// 登记表里预置的演示施工（只读：PATCH 回 403 locked）。格式 = worksites.js 的「施工」对象
// 前两条和引擎演示方案一样（apps/engine/public/js/backend.js 的 DEMOS.lonsdale / latrobe），只是 id 改成唯一的
// 第三条封在 Lonsdale 演示的绕行路线上（Russell St → Little Bourke St），和第一条有 3 天重叠：演示「多处施工互相影响」
// 09-29 本地用 main 上的引擎 conflict() 试过：10-07、10-08 早 8 点两个时刻，冲突成本约 1 万车·分钟（数以引擎现场算的为准）
const WEEK = { from: "2026-10-05", to: "2026-10-09", hours: [7, 19] };

export const SEED_WORKSITES = [
  {
    id: "W-LONSDALE",
    title: "Lonsdale St westbound lane closure",
    kind: "road",
    status: "draft",
    links: ["l595594354_9756035316"],
    closes: { lanes: 1, footpath: null },
    time: WEEK,
    equipment: [
      { id: "VMS-1", type: "vms", at_m: 300, frames: [["ROADWORK", "AHEAD"], ["USE", "RUSSELL ST"]] },
      { id: "S-1", type: "sign", at_m: 100, text: "RIGHT LANE CLOSED" },
      { id: "A-1", type: "arrow", at_m: 60 },
      { id: "B-1", type: "barrier", at_m: 0 },
    ],
  },
  {
    id: "W-LATROBE",
    title: "La Trobe St westbound lane closure at Swanston St",
    kind: "road",
    status: "draft",
    links: ["l2187770692_2190483583"],
    closes: { lanes: 1, footpath: null },
    time: WEEK,
    equipment: [
      { id: "VMS-1", type: "vms", at_m: 260, frames: [["ROADWORK", "AHEAD"], ["USE", "RUSSELL ST"]] },
      { id: "S-1", type: "sign", at_m: 100, text: "RIGHT LANE CLOSED" },
      { id: "A-1", type: "arrow", at_m: 60 },
      { id: "B-1", type: "barrier", at_m: 0 },
    ],
  },
  {
    id: "W-LTLBOURKE",
    title: "Little Bourke St closure on the Russell St detour",
    kind: "utility",
    status: "draft",
    links: ["l26034673_245532558"],
    closes: { lanes: 1, footpath: null },
    time: { from: "2026-10-07", to: "2026-10-12", hours: [7, 19] },
    equipment: [
      { id: "S-1", type: "sign", at_m: 50, text: "ROAD CLOSED" },
      { id: "B-1", type: "barrier", at_m: 0 },
    ],
  },
];
