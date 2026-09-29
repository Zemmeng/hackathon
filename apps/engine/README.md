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

`bash apps/engine/test.sh`（2026-09-29 T16 电车公交 + T17 行人合并后实跑，数字见集成 PR）。

| 文件 | 测什么 |
|---|---|
| `tests/engine.test.mjs` | 路网、最短路、BPR、施工时段、绕行路线、读数请求、选择模型、两点校准（正好 3% / 20%）、evaluate（确定性、缺读数、全封卡住、同路段两施工不重复算、readSigns 全挂不崩）、冲突成本、顾问 |
| `tests/params.test.mjs` | 参数入口：合格的数照用、缺的逐项回退、不合格整组回退并报错、`sign_trust` 换算、读不到不抛错、校准目标跟着变；反向断言：塞不进第 5 类人、`__proto__` 不污染、默认值不被改 |
| `tests/backend.test.mjs` | 接线层：兜底（T5、参数加载不上照样出数；路网取不到要抛）、用仓库里 T5 真的读屏和规范检查、summary 口径（每车延误只算受影响的车）、屏上文字不合规范报错；审查确认的 7 条（全封时封闭路段上的车全部改道、多个施工时 why 和排队取同一段、前后对比按同一段路、不施工时段标出来、没日期的施工顾问按一小时比、顾问报读数失败、没有 crypto.subtle 时退回规则）；反向断言：读屏抛错、全封无路可绕都必须在 `flags` 里报出来 |
| `tests/peds.test.mjs` | T17 封人行道：主演示 Lonsdale 西行 8 点封左侧 → 人/小时、每人多走几米、多花几人·分钟、过几次马路；左 / 右（双幅路找对面那幅，按并排长度选）/ 两侧；校验 `closes.footpath`（`bad_plan`）；没路可绕记 `blocked`、死胡同 / 小孤岛记 `dead_end`（小图）；过马路按过几条街数（La Trobe = 4）；计数器要在同一侧；直街不拆段；反向断言：没封 / 不在时段全 0、绕行不经过也不贴着封闭段走、walk / peds 拿不到或还没到时 `src = null` 而不是假装 0、找不到人行道报 `unmatched`、connect 不等行人数据、封人行道不改车的数字 |
| `tests/e2e.test.mjs` | MOCK 读数跑演示三幕（8 点、17 点）、屏的位置（摆在拐口之后不算）、顾问改法重算；T3 真路网：加载、单次 < 100 毫秒、第一幕方向成立 |
| `tests/transit.test.mjs` | 电车公交（T16，真 transit.json）：Lonsdale 8 点 15 条公交跟着堵、每趟多的秒数 ≈ 留在 Lonsdale 的车（差 ≤ 25%）、车次 / 人数 / 乘客·分钟口径；La Trobe 全封 30 路电车停；Lonsdale 全封公交就近绕（只走主干道）；路口短路段补缺口；周末 / 平峰；前后对比 delta；transit.json 拿不到、这一块算挂了都照样出数。反向断言：不施工时段全是 0、比的是「没施工」不是自由流（本来就堵的路段不算）、封部分车道不列电车 |
| `tests/ailog.test.mjs` | AI 调用日志（假读屏：file / llm / kv / 普通错 → 规则兜底）：条数 = 调用次数、字段齐、src 照实记、同一方案再跑不多记；`readingsOf` 主路段、屏按经过顺序、why 和 summary 同一句、返回拷贝；环形上限、订阅 / 退订、回调抛错不影响读数；反向断言：不多发请求、规则兜底不冒充大模型、`SignError` 记 `error` |
| `tests/options.test.mjs` | T22 按库存出 3 套方案（真路网 + 真 equipment.json）：三档形状、护栏件数 = ⌈封闭长度 ÷ 每节长⌉、租金 = 件数 × 日租 × 天数、报价行和方案设备对得上、单条施工 / when / n / worksite、全封、两侧人行道；反向断言：每种设备不超库存（库存很少时照样不超、缺口进 `stock.short`）、租金必须标 `assumed`、引导档 VMS 文字合规范（含 T5 checkSigns）、同样输入逐字同样输出、不改输入、库存取不到抛 `no_inventory`。哪套更少堵只记录，不断言 |

## 对外接口（→ docs/contract.md §施工方案、§evaluate、§路人读数）

| 导出 | 用法 |
|---|---|
| `createEngine({ network, flows, readSigns, params? })` | → `{ prepare(方案), evaluate(方案, { seed }), window(worksites, whens), conflict(a, b, opts), calib, params }`；`engine.params` 报每项参数用的是 params.json 还是假设值 |
| `backend.js` 的 `connect()`（**网页只用这个**，D-0929-1540） | 一次装好路网 + 车流 + 公交电车 + 参数 + T5 读屏 + 引擎 → `{ run(方案), compare(前, 后), advise(方案), check(方案), validate(方案), demo(名), status(), pedsReady() }`（行人数据后台取，`pedsReady()` 等它取完）；`run` 回能直接显示的 summary（`queue_m mean_delay_s routes by_type hot flags` …，原始结果在 `.raw`）。T5、参数加载不上有兜底，`status()` / `flags` 里报。用法和字段见 `docs/arch/T13-web-wiring-PRD.md` |
| `be.aiLog()` · `be.onAiLog(fn)` · `be.readingsOf(summary)` · `be.lastReadings()` | AI 调用日志：每次读屏调用一条 `{ seq, t, persona, signs, roads, kmh, read_s, src, model, ms, reading, fallback?, error? }`（`src` 照实记 `file / kv / llm / rule`，规则兜底带 `fallback`，`SignError` 记 `error`），内存里环形 200 条（`AI_LOG_MAX`，`connect({ aiLogMax })` 可改）；`readingsOf(s)` = 那次 `run()` 主路段每类人读到的屏（按经过顺序）和读数；不多发请求。见 contract §evaluate v3.10；网页 `apps/web/src/js/9-ai.js` |
| `transitImpact(net, flows, transit, 方案, 结果)` | 电车公交受影响多少（T16）→ `summary.transit`：每条受影响线路的车次、每趟多几秒、乘客·分钟、绕行 / 停运；`PAX_PER_TRIP` 每趟人数（假设值）；`routePaths(net, transit)` 每条线路补过缺口的路段序列（测试核对绕行全程用） |
| `pedImpact(walk, peds, 方案, { net? })`（T17） | 封人行道（`closes.footpath` ∈ `left / right / both`）→ `{ src, footpath, active, day, hour, closed, closed_m, ped_h, detour_m, extra_min, crossings, blocked, blocked_ped_h, dead_end, unmatched, unmatched_sides, note, note_zh, step_free: null, measured, method, sensor, detour, stretches, assumed }`（`footpathActive(方案)` = 这个小时有没有在封人行道）；`backend.run` 把它放在 `summary.peds`，字段表见 `docs/contract.md` §evaluate「行人」。`validatePlan(方案)` / `validateWorksite(施工)` → 错误列表 |
| `loadParams({ url?, fetch? })` / `applyParams(json)` | 读 T12 的 `params.json` → `{ mix, personas, anchors, used }`；读不到、不合格逐项回退到假设值，不抛错 |
| `advise(engine, 方案, { askAdvisor })` | 第 ⑦ 步：拿 ≤ 3 个改法（改字 · 挪设备 · 错开），每个都重算、标 `better` |
| `be.clash(a, b, { hours?, when? })` · `be.stagger(a, b, { maxDays = 7, back? })`（T21） | 叠加冲突：两处施工重叠的那几天 × 早晚高峰，`engine.conflict()` 算 D(A)、D(B)、D(A+B)、冲突成本（车·分钟）；显示字段永远 ≥ 0：D 有负的（Flinders St 基线超通行能力）→ `flags.negative_delay`、`reliable = false`；只有冲突成本 < 0（同一走廊互相替代）→ `flags.substitutes`、显示 0、仍可信；读屏失败 → `reliable = false`。`stagger` 把 b 逐天往后挪到冲突成本 0 为止（`best` 先取可信的尝试），带挪前 / 挪后同一段时间的全网总延误。见 contract §evaluate v3.8；测试 `tests/clash.test.mjs` |
| `be.options(施工 \| 方案, { n = 3, when?, worksite? })`（T22） | 按 RPM Hire 库存出 最省 / 标准 / 引导 3 套交通管理方案，每套用引擎跑同一个小时，带租金（假设值）和库存检查 → `{ worksite, when, days, site, inventory, options: [{ id, label, plan, hire, stock, result, flags, vs, guide? }] }`；见下面「按库存出方案」和 contract §施工方案 v3.7 |
| `options.js` 的 `tierNeeds` `resolveNeeds` `hireOf` `stockOf` `vmsTextOk` `daysOf` | 上面那个的纯函数零件：摆什么、对库存（不超）、算租金、查 VMS 文字 |
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

不联网、不要 key。读数从注入的 `readSigns`（T5）拿；路网、车流、公交电车是 T3 的 `/roads/public/cbd/network.json`、`flows.json`、`transit.json`（PTV GTFS，CC BY 4.0）；行人（T17）是 T3 的 `walk.json`、`peds.json`（1.7 MB + 1.8 MB，`connect()` 在后台取、**不等**它们，`run()` 只在这个小时封了人行道时才等，最多 8 秒；取不到不抛）。

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

## 行人模型（T17，`public/js/peds.js`）

| 步 | 怎么算 | 假设 |
|---|---|---|
| 封哪几段 | `walk.json` 里 `road_link` = 施工路段、`side` 对得上、`kind` 是 `sidewalk / other / path` 的人行道；右侧还要找对面那幅路（同名、方向相反、≤ 40 米）挂着的 `left`，只取和施工路段并排（夹角 < 45°、横向 ≤ 65 米）走了 ≥ min(5 米, 自身长度一半) 的 | 过街（`crossing`）和步行街（`mall`）不封；5 米［假设值］ |
| 分段 | 施工 × 哪一侧 × 一串首尾相接、方向差 < 60° 的施工路段（直街跨 45° 方位不会被拆成两段、人数不会算两遍） | — |
| 起点、终点 | 这一段封掉的人行道里离得最远、避开封闭段还能走到 ≥ min(60, 节点数一半) 个节点的两个节点；这样的节点不到 2 个 = 死胡同（`dead_end`，不算绕行，不算 `blocked`） | 60 个节点［假设值：CBD 一个街区四周约 20–40 个］ |
| 多走几米 | 人行道路网（不分方向）上避开所有封闭段的最短路 − 平时最短路 | 走最短路 |
| 多少人 | 这一段封掉的人行道里这个小时人最多的那条（`peds.json`），两侧都封加起来 | 数到的人都走完整段（上限） |
| 多花几分钟 | `ped_h × detour_m ÷ (1.3 m/s × 60)` | 步速 1.3 m/s［假设值］；等红灯没算 |
| 没路可绕 | `blocked = true`，人数进 `blocked_ped_h`，不算进 `extra_min`（全网扫一遍只有 St Kilda Rd 桥两侧都封这 3 处） | — |
| 过几次马路 | 绕行路线上连着的过街段算一次（安全岛切开的），不同名字的街分开算 | — |
| 最近的计数器 | 先认装在封掉的人行道上的；否则 ≤ 40 米、而且在施工路段中心线同一侧 | 马路对面的计数器数的是另一拨人 |
| 找不到人行道 | `unmatched = true` + `note`（全网单侧封约 1/3 的路段会这样：`walk.json` 没画那一侧） | 不等于「人行道照常通行」 |
| 无障碍 | `step_free` 一律 `null` | `walk.json` 没有台阶 / 坡道数据 |

实测（2026-09-29 复审修完，真数据）：Lonsdale 西行 8 点封左侧 47 米 → 185 人/小时、每人多走 176 米、过 2 次马路、417 人·分钟；封右侧（对面那幅路的北侧人行道 102 米）→ 185 人/小时、多走 67 米、158 人·分钟；两侧都封 → 370 人/小时、1125 人·分钟。La Trobe 西行 17 点封左 / 右 → 818 人/小时、过 4 次马路、约 1020 / 1070 人·分钟。

## 按库存出方案（T22，`public/js/options.js` + `be.options()`）

D-0929-2011 ③。给一处施工配 3 套方案，**数字全由引擎算**（每套都 `run()` 同一个小时）。`options()` 本身不调大模型；每套的读数走 `run()` 同一条读屏链（T5 答案文件 → `/api/read` → 规则），读数一样时逐字同样输出。演示前要把它生成的屏上文字预算进 T5 答案文件（下面的实测是规则读数）。

| 档 | 摆什么 | 为什么这么分 |
|---|---|---|
| `o1` Minimum | 护栏（水马 `barrier_water`，件数 = ⌈封闭长度 ÷ 2 米⌉）+ ROADWORK AHEAD + LEFT/RIGHT LANE CLOSED（全封换 DETOUR AHEAD）+ END ROADWORK（摆在施工段末端，`at_m` 为负；`signsOn()` 只收 `at_m ≥ 0` 的牌，它不进读数请求、不占 T5 最多 6 块的名额） | 合规最低配 |
| `o2` Standard | o1 + 箭头板 + 一块 VMS 写 ROADWORK / AHEAD | 常见做法 |
| `o3` Guided | o2，同一块 VMS 加一帧点名最快绕行（`mockAdvise` 的写法，如 USE / RUSSELL / SAVE 9 MIN） | 引擎里只有「点名绕行」会让人改道 |

- VMS 位置：先跑 o1，按规则顾问找最快绕行，摆在它拐口上游 +100 米（取整 50）；o2、o3 同位置，两者只差屏上的字。没有更快的绕行 → o3 字同 o2、`flags.no_faster_detour`
- 封人行道（`closes.footpath`）：每侧一排能封人行道的护栏 + 一块 FOOTPATH CLOSED
- 库存：按优先顺序挑剩余库存够的条目（水马 → 塑料隔板 → 钢护栏；VMS A 类 → C 类）；都不够就只摆剩下的件数、缺口进 `stock.short`，**方案里每种设备件数永远 ≤ 库存**。整份方案里时间重叠的其他施工带的设备（`equipment[].item / qty`）先从库存里扣（`stock.shared_with`）。先配可选条目少的（人行道只能用水马），车道护栏再挑剩下的，免得误报缺货
- 输入挡板（都抛 `bad_plan`）：有路段不在路网、`time` 日期不存在或 `from` 晚于 `to`、`hours` 不是 `[开始, 结束)`、`when` 不合格。施工在 `when` 那个小时不施工 → `flags.inactive`、`flags.ok = false`；VMS 没进读数请求 → `flags.vms_read = false`
- 租金 = 件数 × `day_rate_aud` × 天数（`time.from`–`time.to` 日历天数含两头）。**库存件数和日租价都是假设值**（equipment.json 官网没价），`hire.assumed = true`、`flags.assumed`，界面标「假设值」（D-0929-1536）
- 设备条目都带 `item`（equipment.json 的 id）和 `qty`，和 contract `equipment[].item / qty` 同口径，pack.js 能按同一份方案报价
- 2026-09-29 实测 Lonsdale 西行 8 点（引擎规则读数）：o1 排队 918 米 / 全网 10493 车·分 / A$515；o2 一样 918 / 10493 / A$1765（箭头板和「前方施工」在引擎里不改路线选择）；o3 276 / 2800 / A$1765。La Trobe 17 点三套都几乎不堵，o3 没有更快的绕行

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
| `public/js/peds.js` | T17 封人行道 → 行人绕行（人行道路网最短路、每小时人数、过几次马路） |
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
- 引擎核心只模拟开车的人（每车 1 人）；电车公交乘客在接线层另算（`summary.transit`，每趟人数是假设值，公交不会因为排队而改道、电车只看全封）；骑车还没做
- 行人只算「封人行道 → 绕行」（T17，`summary.peds`），不算人流和车流互相影响、不判断轮椅能不能走；`walk` 当只读数据用（索引按对象缓存，改了要给新对象）；peds.json 大多是估算（6802 条里 67 条实测），`measured` / `sensor` 报出来
- 顾问（`advise`）、冲突成本（`conflict`）还只比车的延误，不含电车公交和行人
- 冲突 / 顾问的时间窗最多 31 天、每天只采样 1–2 个小时
- T3 路网没有 `truck` 字段，禁货车限制现在不生效
