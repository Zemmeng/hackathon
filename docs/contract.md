# 模块之间的接口契约

> 并行开发唯一需要协调的东西。改它 = 改所有调用方：PR 标题以 `contract:` 开头，lead 合并，合并后通知依赖方。优先向后兼容（加字段不删字段）。
> 版本号：**v3**（每改一次加 1，写进「变更记录」）。

## 谁调谁

| 调用方 | 被调方 | 接口 | 见节 |
|---|---|---|---|
| web | api | HTTP + WebSocket | §HTTP、§WS |
| engine、web | roads | 静态 JSON 文件（随网页一起发布，线上不调接口） | §路网数据文件 |
| engine | api | 浏览器里的 `readSigns()`（背后是 `POST /api/read`） | §路人读数 |
| web | engine | 浏览器里的 `createEngine(...).evaluate(方案)`（T9 骨架） | §施工方案、§evaluate |

## 路网数据文件（roads → engine、web）

T3 产出，放在 `apps/roads/public/cbd/`，本地和线上都从 `/roads/public/cbd/<文件>` 读（lead 部署时把每个模块的 `public/` 原样挂到 `/<模块>/public/`）。字段细则和生成方法见 `apps/roads/PRD.md` 第 5 节，校验见 `apps/roads/tests/test_roads.py`。

| 文件 | 顶层字段 | 要点 |
|---|---|---|
| `network.json` | `version, area, bbox[南,西,北,东], generated, sources, assumptions, nodes[], links[]` | 路段有方向；`links[]`：`id, from, to, name, highway, len_m, lanes, speed_kmh, cap_vph, t0_s, tram, bike_lane, osm_way, geometry[[lat,lon]]`；`nodes[]`：`id, lat, lon, osm, signal` |
| `flows.json` | `version, unit="veh/h", period, days{wd,we}{路段 id: 24 个数}, method{路段 id}, coverage{links, measured, estimated}` | 下标 = 小时；`method` ∈ `detector_map / site_split / street_interp / class_default` |
| `signals.json` | `version, sites[{site, name, type, lat, lon, node, dist_m}]` | `node` 是 30 米内最近的节点，没有就 `null` |
| `transit.json` | `version, sources, service_dates{wd,we}, assumptions, routes[], stops[], coverage` | PTV GTFS 电车 / 公交。`routes[]`：`id, mode (tram / bus), short, dirs[{dir, headsign, links[], stops[], trips{wd,we}[24], offnet_m, geometry}]`，`links` 是匹配到的路段 id（按 10 米采样，路口里的短路段可能缺）；`stops[]`：`id, name, lat, lon, mode, road_link, routes[]`。引擎的 `transit.js` 读它（T16） |

- 加字段随时可以；改名、删字段、改单位要开 `contract:` PR，并把文件里的 `version` 加 1
- 路段 id 从 OSM id 派生，重跑时保持稳定（T2 会用它存用户选的施工路段）

## 路人读数（api → engine）

D-0929-1435：大模型只「读懂」屏上的字，比例由引擎算。T5 在 `apps/api/public/js/reader.js` 导出 `readSigns(请求) → Promise<读数>`，引擎只调这一个函数。背后按顺序：随网页发布的答案文件 → `POST /api/read`（Cloudflare Worker，先查 KV）→ 大模型 → 任何一步失败都用关键词规则（`src: "rule"`）。

**请求**（一类人 × 一串标志）：

```json
{
  "persona": "commuter",
  "kmh": 40,
  "signs": [
    { "kind": "vms",  "frames": [["USE", "RUSSELL ST", "SAVE 8 MIN"]], "read_s": 9 },
    { "kind": "sign", "text": "RIGHT LANE CLOSED", "read_s": 3 }
  ],
  "roads": ["La Trobe St", "Russell St", "Elizabeth St"]
}
```

- `persona` ∈ `commuter / local / tourist / delivery`；`signs` 按经过的先后顺序；`read_s` 是引擎按「可读距离 ÷ 车速」算好的秒数，超过 120 按 120 算（排队时车速 5 km/h 会算出约 137 秒）
- `signs[].kind` ∈ `vms / sign / arrow`；`arrow`（箭头板）的 `text` 可以省；护栏 `barrier` 不进请求。路名字符和引擎的 `cleanName()` 一致（字母、数字、空格和 `. , ' & / ( ) -`）
- 请求不合规范时 `readSigns()` 抛 `SignError`（`.code` 是短码）。引擎把抛错记成 `prepare()` 的 `failed` 和 `evaluate` 结果的 `missing`（那一类人按「没人被说动」算），界面要显示出来；T2 在用户输入屏上文字时先用 `apps/api/public/js/check.js` 的 `checkSigns()` 挡住（不抛错，回 `{ ok, error?, warnings[] }`）
- `roads` = 当前路 + 候选绕行路的名字，只用来把「叫你走哪条」对到路名
- 请求里**没有**各条路的耗时和排队：读数只取决于「字 + 人」，所以同一句话每类人只问一次，缓存一直有效

**读数**：

```json
{
  "persona": "commuter",
  "notice": 0.85,
  "understand": 0.9,
  "advice": { "Russell St": "use", "La Trobe St": "avoid" },
  "saving_min": 8,
  "delay_min": null,
  "trust": 0.7,
  "why": "Sign says Russell saves 8 min and I'm late",
  "range": { "notice": [0.8, 0.9], "understand": [0.85, 0.95], "trust": [0.6, 0.75] },
  "src": "file",
  "model": "…",
  "prompt_v": "r1"
}
```

| 字段 | 含义 |
|---|---|
| `notice` | 这类人里注意到标志的比例，0–1 |
| `understand` | 注意到的人里看懂的比例，0–1 |
| `advice` | 标志叫你走（`use`）或别走（`avoid`）的路；没提到的路不出现 |
| `saving_min` / `delay_min` | 标志上说走推荐路能省几分钟 / 原路要多堵几分钟；没写就 `null` |
| `trust` | 看懂的人里相信这句话的程度，0–1 |
| `why` | 一句理由（英文，界面显示用 `textContent`） |
| `range` | 问 3 次的最小到最大；规则兜底时没有这个字段 |
| `src` | `file / kv / llm / rule` |

- 引擎拿读数 + 每类人的参数算各条路的比例（选择模型和两点校准归 T4）；**大模型不回比例**
- 加字段随时可以；改名、删字段、改取值范围要开 `contract:` PR

## 施工方案（web → engine）

一条施工 = 一个对象，web 画出来交给引擎（以后存 `/api/worksites` 也用这个格式）。引擎侧见 `apps/engine/public/js/worksite.js` 开头。

```json
{
  "id": "A",
  "links": ["<network.json 的路段 id，按行车方向>"],
  "closes": { "lanes": 1 },
  "time": { "from": "2026-10-05", "to": "2026-10-09", "hours": [7, 19] },
  "equipment": [
    { "id": "vms1", "type": "vms", "at_m": 300, "frames": [["USE", "RUSSELL ST", "SAVE 4 MIN"]], "char_mm": 320 },
    { "id": "s1", "type": "sign", "at_m": 100, "text": "RIGHT LANE CLOSED", "dir": "W" }
  ]
}
```

- `links` 同方向连着的算一段；双向施工两个方向都列。`closes.lanes` ≥ 车道数 = 全封；没全封时剩下车道的通行能力再 × 0.9
- `time.hours` = 每天 `[开始, 结束)`；`equipment[].at_m` = 在施工起点上游多少米；`type` ∈ `vms / sign / arrow / barrier`（`barrier` 不进读数请求）；`dir` 可选，只给这个方向的车看
- 屏上文字（`frames`）：≤ 2 帧 × ≤ 4 行 × ≤ 10 字符、合计 ≤ 8 个词、大写（校验归 T5 / T2）
- 「什么时候」= `when: { date: "YYYY-MM-DD", hour: 0–23, day?: "wd" | "we" }`；`hour` 是 `flows.json` 的下标

## evaluate（engine → web）

D-0929-1435 定稿（T9 骨架）。**网页只 import 接线层 `/engine/public/js/backend.js`**（D-0929-1540，lead 接好了路网 + 车流 + 参数 + T5 读屏）：

```js
const be = await (await import('/engine/public/js/backend.js')).connect();
const s = await be.run(方案);          // 能直接显示的数字：queue_m mean_delay_s routes by_type hot flags …；引擎原始结果（下表）在 s.raw
const c = await be.compare(前, 后);     // 前后对比，c.delta 负数 = 变好；be.advise(方案) 顾问改法；be.check(方案) 屏上文字规范
```

**电车公交 `s.transit`**（T16，`apps/engine/public/js/transit.js`；`connect()` 同时读 `/roads/public/cbd/transit.json`，读不到不抛：`status().transit = "none"`、`status().errors` 记一条、`s.transit = { src: null }`；这一块算的时候抛错 → `{ src: null, error }`，车的数字照出；`opts.transit` 可以直接给）：

```js
s.transit = {
  src: 'gtfs' | null, day: 'wd' | 'we', hour,
  routes: [{ id, short, mode: 'tram' | 'bus', dir, headsign,
             trips_h, pax_per_trip, pax_h,          // 这个小时的车次（GTFS）、每趟人数（假设值）、乘客/小时
             delay_s, pax_min,                      // 每趟多的秒数（≥ 0）、乘客·分钟；停掉的（blocked）和路网外换路的（edge）都是 null
             diverted, blocked, edge,               // 公交全封要绕 / 电车全封停（公交在路网里绕不过去也算 blocked）/
                                                    // edge：全封在线路进出路网 400 米内、路网里绕不过去 → 在路网外换路，分钟数算不出，不算停运
             stops_closed: [{ id, name }],          // 在全封路段上的站
             links: [路段 id],                      // 这条线路变慢了或全封的路段
             detour_links: [路段 id], stops_skipped: [{ id, name }] }],  // 公交绕的路、绕开的站（没绕 = []）
  trips_h, pax_h, pax_min, blocked_routes, blocked_pax_h,   // 合计；pax_min 不含停掉的和 edge 的（≥ 0）
  edge_routes,                                              // edge 的线路数（不算进 blocked_routes / blocked_pax_h）
  assumed: { pax_per_trip: { tram, bus }, period: 'peak' | 'offpeak', range: { tram: [低, 高], bus: [低, 高] }, note },
}
c.delta.transit_pax_min   // 后 − 前（负数 = 变好）；任何一边没有公交数据 = null
```

- 只列「这个方向经过的路段被全封」或「整趟比没施工时慢 > 0.1 秒」、这个小时有车次的线路（有的路段因为车流绕走反而变快，整趟加起来不慢的不列）；排序：停掉的在前（按 `pax_h`），其余按 `pax_min` 从大到小，`edge` 的放最后（按 `pax_h`）
- 公交：跟车流走固定线路，每趟多的秒数 = 线路上每个路段（这个方案的通行时间 − 同一小时没施工时的通行时间）之和，都用引擎的 `linkTime`（不是 `links[].delay_s`，那是比自由流多的）。有路段全封 → 在封闭段前后 400 米内就近绕（最短路，先只走主干道，不走小巷；从哪拐出去、在哪回来按全程时间挑最快的），多的秒数 = 绕完的全程 − 平时全程，**最少记 0**（绕行跳过了线路上本来绕的一圈也不算「变快」：按时刻表跑，早到要等；跳过的站在 `stops_skipped`）
- 公交 `edge`：`transit.json` 的线路只截到 CBD 路网里；全封离线路进 / 出路网不到 400 米、路网里又绕不过去 → 公交在路网外就换路了：`diverted: true, edge: true`，`delay_s` / `pax_min` 为 `null`，不算停运。界面别显示成「+0 秒」，写「在地图外绕行」
- 电车：假设 CBD 电车走自己的车道，封部分车道不耽误电车（不列）；全封电车经过的路段 → `blocked`，只报停掉的车次和乘客，不编分钟数
- 每趟载客人数是**假设值**（D-0929-1536：界面标「假设值」+ 区间）：工作日 7–9、16–18 点高峰电车 60 / 公交 25，其余电车 30 / 公交 12；`assumed` 里给当时用的数和区间

字段表见 `docs/arch/T13-web-wiring-PRD.md` 第 5 节。下面是引擎核心的用法（接线层内部就是这么调的）：

```js
import { createEngine } from '/engine/public/js/index.js';
import { readSigns } from '/api/public/js/reader.js';        // T5 的；没好之前用 index.js 导出的 mockReadSigns
const engine = createEngine({ network, flows, readSigns, params });  // network / flows = /roads/public/cbd/ 的两个 JSON；params = await loadParams()（可省）
await engine.prepare(方案);                                   // 先把要的读数问好（异步，同一句话每类人只问一次，一直缓存）
const 结果 = engine.evaluate(方案, { seed });                 // 同步、纯计算，同样输入同样结果；真路网上约 7 毫秒
```

- `方案 = { when, worksites: [施工方案] }`；只有在 `when` 生效的施工才算
- 引擎向 `readSigns` 要的请求见 §路人读数：每段路每类人一份「全部标志」，另外每条绕行路线一份「拐口之前看得到的标志」（屏摆在拐口之后不算点名那条路）
- 还没问到的读数按「没人被说动」算，`结果.missing` 报缺几条；`prepare` 之后应为 0
- 比例由引擎的选择模型算：每类人参数（赶时间 · 熟路 · 信屏 · 怕堵 · 只能走货车路）在 `choice.js`；两个全局参数（绕行惯性 A、推荐力度 B）由两点校准定（ROADWORK / AHEAD → 3%，USE / RUSSELL ST → 20%，都［待核］），见 `结果.calib`
- 排队变长 → 引擎按「看得到的排队」自己重算选择（逐次平均 6 轮），不再问大模型
- 参数：`loadParams()` 读同源的 `/params/public/params.json`（T12），读不到、不合格逐项回退到假设值、不抛错；引擎认哪些字段见 `apps/engine/README.md`「参数」一节；`engine.params` = `{ src: params | default, version, mix, personas, anchors, used: { mix, anchors, persona.<类型>.<项> } 每项来源, ignored, errors, override }`，界面可以标「参数有出处 / 假设值」

**结果**（数字全由引擎算；单位：`*_min` = 这一小时比「没有施工」多出来的车·分钟；每车按 1 人算；公交电车乘客在接线层的 `s.transit`，见上）：

| 字段 | 含义 |
|---|---|
| `delay_min` | 全网总延误（veh·min） |
| `by_type[类型]` | `{ delay_min, vehicles, per_capita_min }`：每类人（commuter / local / tourist / delivery）的总延误和人均延误 |
| `others_min` | 没受影响、但被绕行车流拖慢的背景车流的延误 |
| `approaches[]` | 每段受影响的方向：`street dir to volume queue_m delay_min share routes[] by_type signs` |
| `approaches[].routes[]` | `{ id, name, usual_min, now_min, share, flow, truck, turn_m, extra_min }`；`id: "stay"` 是原路，`turn_m` = 在施工起点上游多少米拐出去 |
| `approaches[].by_type[类型]` | `{ share, detour, extra_min, informed, told[], reading }`：`informed` = 被标志说动的比例，`reading` = T5 给的读数（界面显示 `why`，用 `textContent`） |
| `links[]` | 每个路段 `{ id, v, cap, delay_s, queue_m }`（流量 veh/h、比平时多的秒数、一小时末排队米数） |
| `hot[]` | 多出时间最多的 ≤ 5 个路段 |
| `blocked_vph` | 全封又无路可绕、卡住的车流（不算进 `delay_min`，界面单独标） |
| `calib` | `{ A, B, method: two_point | default, ok, target: { lo, hi }, lo_detour, hi_detour, src, model }`；`ok = false` = 两个目标至少有一个够不着 |
| `missing` | 还没问到的读数条数 |

其他：`engine.window(worksites, whens)` 一段时间的总延误；`engine.conflict(a, b, { whens?, hours? })` → `{ a, b, ab, cost, overlap, whens, truncated }`，`cost = D(A+B) − D(A) − D(B)`（时段不重叠时正好是 0；默认采样每个施工时段里的 8 点、17 点，没有就取时段中间那个小时，最多 31 天）；`advise(engine, 方案, { askAdvisor })` 第 ⑦ 步，每个改法都重算、标 `better`（MOCK 顾问 `mockAdvise`）。

- 🔒 只支持同源：网页、`/engine/public/`、`/roads/public/`、`/api/*` 挂在同一个域名下
- 路段可选字段 `truck: false` = 禁货车（T3 现在没有这个字段，没有时禁货车不生效）

## HTTP API

| 方法 + 路径 | 请求 | 响应 | 负责模块 |
|---|---|---|---|
| `GET /api/health` | — | `{ "ok": true, "v": "<版本>", "mock": bool }` | api |
| `POST /api/read` | 同 §路人读数 的请求 | `{ "ok": true, "reading": <读数> }`；不合规范 400 `{ "ok": false, "error", "msg" }` | api |
| `POST /api/create` | `{}` | `{ "code": "ABCDE" }` | api |

## WebSocket 消息（`/ws?room=<CODE>`）

| type | 方向 | 字段 |
|---|---|---|
| `join` | 客户端 → 服务端 | `token`, `nick` |
| `act` | 客户端 → 服务端 | `kind`, `payload` |
| `state` | 服务端 → 客户端 | `v`, `view`（按本人裁剪后的状态） |
| `err` | 服务端 → 客户端 | `msg` |

## 共享状态形状

```json
{
  "v": 12,
  "code": "ABCDE",
  "phase": "lobby",
  "members": [{ "id": "m1", "nick": "甲", "secret": "🔒只给本人" }],
  "log": []
}
```

- `v` 单调递增，客户端用它判断广播新旧
- 标 🔒 的字段必须按用户裁剪后再下发（`viewFor()`）

## 错误格式

`{ "ok": false, "error": "<机器可读短码>", "msg": "<给人看的中文>" }`，HTTP 状态码照 REST 常规。

## Mock

`MOCK=1` 时：`/api/health` 的 `mock` 为 true；前端 `/api/*` 不通时在本地用 `logic.js` 的 `reduce()` 跑同一套逻辑。fixtures 放各模块 `fixtures/`。

## 变更流程

开 `contract:` PR → lead 批准 → 群里通知依赖方 → 依赖方各自适配。**字段路径以实测为准**，别照文档猜。

## 变更记录（最新在上）

| 版本 | 时间 | 改了什么 | 谁 |
|---|---|---|---|
| v3.2 | 2026-09-29 | §路网数据文件加 `transit.json`；§evaluate：接线层 `run()` 加 `summary.transit`（电车公交受影响的线路、乘客·分钟，T16），`compare()` 加 `delta.transit_pax_min`；只加字段 | lead |
| v3.1 | 2026-09-29 | §路人读数：`kind` 加 `arrow`、`read_s` 上限 120、路名字符、`SignError` 和 `failed` / `missing`（T5 #29 对齐引擎）；HTTP API 加 `POST /api/read`；§evaluate：网页只接 `backend.js`（D-0929-1540） | lead |
| v3 | 2026-09-29 | 加「施工方案」；「evaluate」定稿（createEngine / prepare / evaluate / conflict / advise 和结果字段，T9 骨架）；参数入口 `loadParams()` 读 T12 的 `params.json`，`calib.target` | lead |
| v2 | 2026-09-29 | 加「路人读数」（api → engine，D-0929-1435）和「evaluate」草案（engine → web） | lead |
| v1 | 2026-09-29 | 加「路网数据文件」一节（roads → engine、web）；HTTP / WS 节还是模板预置，T5 定了再改 | lead |
| v0 | 2026-09-26 | 模板预置：health / create / ws 骨架 | lead |
