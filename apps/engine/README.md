# engine —— 施工影响引擎：读数 + 每类人参数 → 各条路走多少人、哪里堵、堵多久、多个施工叠加的冲突成本
Owner: @Zemmeng（lead 暂管；T4 认领后改成认领人）

按 `docs/arch/4-ai-flow.md` 和 D-0929-1435：大模型（T5 的 `readSigns()`）只「读懂」屏上的字，比例、分钟数、排队全由这里算。
纯 JS，不碰 DOM，浏览器和 node 都能直接 import；同样输入同样结果，真路网上单次 `evaluate` 约 7 毫秒。

## 怎么跑

- 演示三幕：`node apps/engine/tools/demo.mjs`（方格路网）；加 `--real` 另在 T3 真路网上跑第一幕（Bourke Street 东行）
- 浏览器里（要经 http 打开，ES module 不能 file://；网页、引擎、路网数据要同源）：

```js
import { createEngine, mockReadSigns, loadParams } from '/engine/public/js/index.js';
const [network, flows] = await Promise.all(['network', 'flows'].map(f => fetch(`/roads/public/cbd/${f}.json`).then(r => r.json())));
const params = await loadParams();                         // T12 的 /params/public/params.json；读不到就用假设值，不抛错
const engine = createEngine({ network, flows, readSigns: mockReadSigns, params }); // T5 的 readSigns 到了换掉
const plan = { when: { date: '2026-10-06', hour: 17 }, worksites: [施工方案] };
await engine.prepare(plan);
const result = engine.evaluate(plan);
```

## 怎么测

`bash apps/engine/test.sh`（2026-09-29 17:50 实跑：177 passed, 0 failed）。

| 文件 | 测什么 |
|---|---|
| `tests/engine.test.mjs` | 路网、最短路、BPR、施工时段、绕行路线、读数请求、选择模型、两点校准（正好 3% / 20%）、evaluate（确定性、缺读数、全封卡住、同路段两施工不重复算、readSigns 全挂不崩）、冲突成本、顾问 |
| `tests/params.test.mjs` | 参数入口：合格的数照用、缺的逐项回退、不合格整组回退并报错、`sign_trust` 换算、读不到不抛错、校准目标跟着变；反向断言：塞不进第 5 类人、`__proto__` 不污染、默认值不被改 |
| `tests/backend.test.mjs` | 接线层：兜底（T5、参数加载不上照样出数；路网取不到要抛）、用仓库里 T5 真的读屏和规范检查、summary 口径（每车延误只算受影响的车）、屏上文字不合规范报错；审查确认的 7 条（全封时封闭路段上的车全部改道、多个施工时 why 和排队取同一段、前后对比按同一段路、不施工时段标出来、没日期的施工顾问按一小时比、顾问报读数失败、没有 crypto.subtle 时退回规则）；反向断言：读屏抛错、全封无路可绕都必须在 `flags` 里报出来 |
| `tests/e2e.test.mjs` | MOCK 读数跑演示三幕（8 点、17 点）、屏的位置（摆在拐口之后不算）、顾问改法重算；T3 真路网：加载、单次 < 100 毫秒、第一幕方向成立 |
| `tests/transit.test.mjs` | 电车公交（T16，真 transit.json）：Lonsdale 8 点 15 条公交跟着堵、每趟多的秒数 ≈ 留在 Lonsdale 的车（差 ≤ 25%）、车次 / 人数 / 乘客·分钟口径；La Trobe 全封 30 路电车停；Lonsdale 全封公交就近绕（只走主干道）；路口短路段补缺口；周末 / 平峰；前后对比 delta；transit.json 拿不到、这一块算挂了都照样出数。反向断言：不施工时段全是 0、比的是「没施工」不是自由流（本来就堵的路段不算）、封部分车道不列电车 |

## 对外接口（→ docs/contract.md §施工方案、§evaluate、§路人读数）

| 导出 | 用法 |
|---|---|
| `createEngine({ network, flows, readSigns, params? })` | → `{ prepare(方案), evaluate(方案, { seed }), window(worksites, whens), conflict(a, b, opts), calib, params }`；`engine.params` 报每项参数用的是 params.json 还是假设值 |
| `backend.js` 的 `connect()`（**网页只用这个**，D-0929-1540） | 一次装好路网 + 车流 + 公交电车 + 参数 + T5 读屏 + 引擎 → `{ run(方案), compare(前, 后), advise(方案), check(方案), demo(名), status() }`；`run` 回能直接显示的 summary（`queue_m mean_delay_s routes by_type hot flags transit` …，原始结果在 `.raw`）。T5、参数、transit.json 加载不上有兜底，`status()` / `flags` 里报。用法和字段见 `docs/arch/T13-web-wiring-PRD.md`，`summary.transit` 见 `docs/contract.md` §evaluate |
| `transitImpact(net, flows, transit, 方案, 结果)` | 电车公交受影响多少（T16）→ `summary.transit`：每条受影响线路的车次、每趟多几秒、乘客·分钟、绕行 / 停运；`PAX_PER_TRIP` 每趟人数（假设值）；`routePaths(net, transit)` 每条线路补过缺口的路段序列（测试核对绕行全程用） |
| `loadParams({ url?, fetch? })` / `applyParams(json)` | 读 T12 的 `params.json` → `{ mix, personas, anchors, used }`；读不到、不合格逐项回退到假设值，不抛错 |
| `advise(engine, 方案, { askAdvisor })` | 第 ⑦ 步：拿 ≤ 3 个改法（改字 · 挪设备 · 错开），每个都重算、标 `better` |
| `mockReadSigns` / `mockAdvise` | 关键词规则版读数器 / 顾问，T5 和大模型顾问到之前演示、测试用 |
| `makeGrid()` | 测试用的 5 × 9 方格路网（Hoddle Grid 街名、假设车流） |
| `PERSONAS` `MIX` `chooseShares` `calibrate` … | 选择模型和校准的零件（见 `index.js`） |

## 参数（T12 @Unzzip 的 `apps/params/public/params.json`）

格式照 `docs/arch/T12-params-PRD.md` 第 4 节：每个数写成 `{ value, range, source, confidence }`（直接写数也认），`value: null` = 没找到 → 用假设值、不算错。**引擎认的字段以这张表为准**：

| 字段 | 引擎怎么用 | 不合格时 |
|---|---|---|
| `mix.commuter / local / tourist / delivery` | 4 类人占车流的比例，加起来 1 ± 0.02（会归一） | 整组用假设值 50 / 25 / 10 / 15 |
| `anchors.generic_warning_divert` | 两点校准低点：只写 ROADWORK / AHEAD 时全体车辆的绕行比例 | 两个都要合格（0–1、低 < 高），否则都用 3% / 20% |
| `anchors.named_route_divert` | 两点校准高点：写 USE / RUSSELL ST 时的绕行比例 | 同上 |
| `persona.<类型>.hurry` | 赶不赶时间，乘在每分钟的效用上（平均 ≈ 1，0.05–5） | 这一项用假设值 |
| `persona.<类型>.familiar`（或 `route_familiarity`，T12 #31 的叫法） | 熟不熟路：知道 / 会自己想到这条绕行的比例（0.01–1，进 `ln()`）；两个都给用 `familiar` | 同上 |
| `persona.<类型>.trust` | 信不信屏：乘在读数的 `trust` 上的**相对倍数**（平均的人 = 1，0–3） | 同上 |
| `persona.<类型>.sign_trust` | 照屏上说的走的比例（0–1）。没给 `trust` 的类型用它换算：`sign_trust ÷ 给了数的几类人按占比加权的平均`；至少 2 类有数才换算，超过 3 截到 3 | 只有 1 类有数：报一条错，trust 用假设值 |
| `persona.<类型>.queue_averse` | 怕不怕堵：乘在「看到的排队」上（0–5） | 这一项用假设值 |
| `persona.<类型>.truck_only` | 只能走货车路（布尔） | 这一项用假设值 |

- 值写成字符串、布尔（`"0.05"`、`"3%"`）→ 报「不是数」并用假设值；`value: null` = 没找到，不报错
- **收下但还没用**（列在 `engine.params.ignored`，带完整路径，嵌套的也列，如 `anchors.stated_to_actual`、`persona.commuter.xxx`）：`anchors.stated_to_actual`（D-0929-1435 后大模型不回比例，用不上问卷→实际的换算）、`value_of_time`、`vms`。要让它们进模型，先在这里加一行再改代码
- 绝对的「信不信」由两点校准的推荐力度 B 吸收，所以 `trust` / `sign_trust` 只有**各类人之间的相对高低**会改结果

## 外部 API

不联网、不要 key。读数从注入的 `readSigns`（T5）拿；路网、车流、公交电车是 T3 的 `/roads/public/cbd/network.json`、`flows.json`、`transit.json`（PTV GTFS，CC BY 4.0）。

## 电车公交（T16，`public/js/transit.js`）

`backend.js` 的 `run()` 算完车以后调 `transitImpact()`，结果在 `summary.transit`（字段见 `docs/contract.md` §evaluate）。模型和假设：

| 什么 | 怎么算 | 出处 |
|---|---|---|
| 列哪些线路 | 这个方向经过的路段被全封，或整趟比没施工时慢 > 0.1 秒（别的路段车少了反而快，加起来不慢的不列）；这个小时有车次 | 引擎 |
| 车次 | `trips[wd/we][小时]`，工作日 / 周末用引擎的 `dayType` | GTFS（T3） |
| 公交每趟多几秒 | 线路上每个路段（方案下的 `linkTime` − 同一小时没施工的 `linkTime`）之和；不能直接加 `links[].delay_s`（那是比自由流多的） | 引擎 |
| 公交遇到全封 | 封闭段前后 400 米内就近绕（最短路，按方案下的通行时间；先只走 trunk / primary / secondary / tertiary，绕不过去再放开到小街，小巷始终不走）；从哪拐出、在哪回来按「走到拐出点 + 绕行 + 回来后的线路」全程挑最快的；多的秒数 = 绕完全程 − 平时全程，最少记 0（跳过线路上的一圈不算变快，按时刻表跑早到要等）；绕不过去 = `blocked` | 工程假设 |
| 公交全封在路网边上 | transit.json 的线路只截到 CBD 路网里：全封离线路进 / 出路网 < 400 米、路网里绕不过去 → 公交在路网外就换路了，`edge: true`、分钟数 `null`，不算停运（另计 `edge_routes`）。8 点把公交用到的 233 个路段逐一全封，原来判「停运」的 56 次全是这种 | 工程假设 |
| 电车 | CBD 电车走自己的车道：封部分车道不耽误（不列）；全封 = `blocked`，只报停掉的车次和乘客，分钟数 `null` | 工程假设 |
| 每趟载客人数 | 工作日 7–9、16–18 点：电车 60、公交 25；其余：电车 30、公交 12（区间见 `PAX_RANGE`） | **假设值**，没有 PTV 分线路载客数据［待核］ |
| 线路路段缺口 | transit.json 按 10 米采样匹配，路口里很短的路段常缺：相邻两段接不上时 60 米内的最短路补上（电车只走有轨道的路段） | 工程假设 |

2026-09-29 17:50 实测（`tests/transit.test.mjs`，T12 参数 + 规则读屏）：Lonsdale 演示 8 点封 1 条道，15 条公交每趟多约 356 秒（留在 Lonsdale 的车多约 360 秒），77 趟 / 1925 人每小时，约 1.1 万乘客·分钟；同一段全封，公交从 Exhibition St 拐出、经 Victoria St → Elizabeth St 绕回，每趟多约 76 秒（2026-09-29 修正：原来绕行算法把跳过的那段线路又算了一遍、还偏向晚拐，报约 91 秒）；La Trobe 演示全封，30 路电车每小时停 6 趟 / 360 人。单次 < 10 毫秒。

## 结构

| 文件 | 一句话 |
|---|---|
| `public/js/index.js` | 引擎核心的全部导出 |
| `public/js/backend.js` | 后端接线层：给网页的一站式入口（按 URL 动态加载 T5 的 reader.js / check.js，其余从 index.js 来） |
| `public/js/pipeline.js` | `createEngine`：prepare / evaluate / window / conflict，排队反馈的逐次平均 |
| `public/js/choice.js` | 第 ④ 步选择模型：每类人参数（赶时间 · 熟路 · 信屏 · 怕堵 · 只能走货车路）+ 被说动的比例 → 各路线比例 |
| `public/js/calibrate.js` | 两点校准：在参考场景上解出绕行惯性 A、推荐力度 B |
| `public/js/params.js` | 读 T12 的 `params.json`，逐项校验、回退，报每项用的是哪个 |
| `public/js/reading.js` | 第 ② 步读数请求（全部标志 + 每条绕行拐口前的标志）、MOCK 读数器 |
| `public/js/routes.js` | 第 ① 步：受影响的车、原路、最多 3 条绕行（上游约 400 米、下游约 300 米） |
| `public/js/assign.js` | 第 ⑤ 步：分流，BPR + D/D/1 排队，全网总行程时间 |
| `public/js/net.js` · `worksite.js` · `cards.js` · `canon.js` | 路网索引和最短路 · 施工时段和通行能力 · 读屏秒数和路名清洗 · 稳定 JSON |
| `public/js/advisor.js` | 第 ⑦ 步的引擎这一半 + MOCK 顾问 |
| `public/js/transit.js` | 电车公交（T16）：线路 → 路段序列（补缺口）、公交延误和绕行、电车停运、乘客·分钟 |
| `public/js/grid.js` | 方格路网 |
| `tools/demo.mjs` · `tests/` · `test.sh` | 演示 · 测试 |

## 本模块固定模式

- 🔒 引擎核心不 import api 模块：`readSigns` / `askAdvisor` 由调用方注入；只有接线层 `backend.js` 按 URL 动态加载 T5 的文件
- 🔒 大模型只给读数和改法，所有数字引擎算；排队变长引擎自己重算，不再问大模型
- `evaluate` 同步、确定：要的读数先 `prepare`；缺的按「没人被说动」算并报 `missing`
- 读数请求只含「字 + 人」（不含位置、耗时、排队），同一句话每类人只问一次；屏的位置由引擎用 `turn_m` 判断
- 改了选择模型参数就重跑 `node tools/demo.mjs` 看三幕方向还对不对

## 已知问题

- 每类人参数、占比 `MIX`、两点校准的 3% / 20% 在 T12 的 `params.json` 到之前是假设值［待核］；`BETA`、「看到排队 1 公里 ≈ 多堵 4 分钟」是工程假设，不在 params.json 里
- T3 的车流有些路段本身就超过通行能力（如 Flinders Street 2526 / 1800）：引擎只算比没施工多出来的，但绝对数会偏大
- 绕行路线不走 CBD 小巷（OSM `living_street` / `service` 等，见 `routes.js` 的 `NO_DETOUR`）：T3 给 Heffernan Lane 这类小巷的通行能力是 1620 veh/h，比主路单车道还高，不排除的话屏上会点名一条巷子
- BPR + 确定性排队，没有排队回溢到上游路口；路线按自由流定，不随拥堵重新找路；只改道施工第一段上的车
- 引擎核心只模拟开车的人（每车 1 人）；电车公交乘客在接线层另算（`summary.transit`，每趟人数是假设值，公交不会因为排队而改道、电车只看全封）；行人、骑车、轮椅还没做
- 顾问（`advise`）、冲突成本（`conflict`）还只比车的延误，不含电车公交
- 冲突 / 顾问的时间窗最多 31 天、每天只采样 1–2 个小时
- T3 路网没有 `truck` 字段，禁货车限制现在不生效
