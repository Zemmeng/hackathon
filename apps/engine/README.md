# engine —— 施工影响引擎：找受影响的车、写场景卡、校准、分流算延误、算叠加冲突、重算顾问的改法
Owner: @Zemmeng（lead 暂管；T4 认领后改成认领人）

负责 `docs/arch/4-ai-flow.md` 里引擎的那几步：① 找受影响的车和能绕的路 → ② 写场景卡 → （③ 问路人，api 模块）→ ④ 两点校准 → ⑤ 分流、算排队和延误 → ⑥ 叠加冲突成本 → ⑦ 顾问改法逐个重算。原则「大模型出主意，引擎算数字」。纯 JS，不联网、不花钱、不碰 DOM，浏览器和 node 都能直接 import。

## 怎么跑

- 看演示三幕：`node apps/engine/tools/demo.mjs` —— 在方格路网上用 api 的关键词规则跑，打印 ① 改一句屏上的字排队变短 ② 两个施工叠加有冲突成本 ③ 错开日期冲突成本归零，最后是规则版顾问的改法和引擎重算的前后对比
- `node apps/engine/tools/demo.mjs --cards <文件>` 另把用到的场景卡写成 JSON，给 api 的 `tools/prewarm.mjs` 预热用
- 浏览器里（要经 http 打开，ES module 不能 file://；网页和 `/api/*` 同源，见契约「谁调谁」）：

```js
import { makeGrid, runScenario } from '/engine/public/js/index.js';
import { askPersonas } from '/api/public/js/persona.js';
const { network, flows } = makeGrid();
const r = await runScenario({ network, flows, when: { date: '2026-10-06', hour: 17 }, worksites: [ws], ask: askPersonas });
```

## 怎么测

`bash apps/engine/test.sh` —— node 跑，最后一行 `N passed, M failed`（2026-09-29 实跑：84 passed, 0 failed）。

| 文件 | 测什么 |
|---|---|
| `tests/engine.test.mjs` | 路网、最短路、BPR、第 ①②④⑤⑥ 步各自算得对；路人选择用**假的 ask**，不依赖 api |
| `tests/e2e.test.mjs` | 接上 api 的 `askPersonas` / `askAdvisor`（`force: 'rule'`）跑全流程，断言演示三幕；数字来自方格 + 规则，只断言方向和关系，不断言具体值 |

## 对外接口（→ docs/contract.md「引擎结果」「规划顾问」「施工方案」「路人 agent」）

前端只 import `public/js/index.js`：

| 导出 | 用法 |
|---|---|
| `makeGrid()` | → `{ network, flows }`，格式照契约「路网数据文件」 |
| `runScenario({ network, flows, when, worksites, ask, maxRounds? })` | 一个时刻的完整结果：`delay_min`（全网多出的 veh·min）、`blocked_vph`、`approaches[]`（每段受影响的方向：排队、各路线分流和用时、每类人比例和理由、`calib`）、`hot[]`（最堵的 ≤ 5 段）、`rounds` |
| `conflictCost({ network, flows, a, b, ask, whens?, hours? })` | 第 ⑥ 步：`{ a, b, ab, cost, overlap, whens, truncated }`，`cost = D(A+B) − D(A) − D(B)` |
| `windowDelay({ … whens })` | 一串时刻的总延误 `{ delay_min, per }` |
| `advise({ network, flows, when, worksites, ask, askAdvisor, … })` | 第 ⑦ 步：拿顾问 ≤ 3 个改法，每个都用引擎重算，给前后对比；每个改法带 `better`（`delta_min < 0`），结果带 `truncated` |
| `calibrate` `makeAnchors` `anchorsFor` `anchorCard` `REF_CARD` `ANCHORS` | 第 ④ 步 |
| `buildCard` `readSeconds` · `approaches` `affected` · `evaluate` | 第 ② 步 · 第 ① 步 · 第 ⑤ 步单独用 |
| `isActive` `overlaps` `capFactors` `shiftWorksite` `windowWhens` `dayType` | 施工方案的时间和通行能力 |
| `loadNetwork` `shortestPath` `linkTime` `bearing` · `MAX_ROUNDS` | 路网工具 · 最多问几轮（2） |

- `when = { date: 'YYYY-MM-DD', hour: 0–23, day?: 'wd'|'we' }`；施工方案格式见 `worksite.js` 开头注释和契约「施工方案」
- 注入的 `ask(card, opts?)` 要和 api 的 `askPersonas` 一样：回 `{ src, by_type, raw, mix, model, prompt_v }`（**校准前**），还要认 `opts.force === 'rule'`（锚点跟着回答的来源走）。`ask` 抛错或回的不合格（缺哪类人、比例对不上卡上的路线）→ 这段改问 `ask(card, { force: 'rule' })`，不让整个结果崩
- 第 ② 步场景卡：绕行路线带 `turn_m`（= 这条路的 `diverge_m` 取整，施工起点上游多少米拐出去），api 的规则据此判断标志是不是摆在拐口之前
- 第 ④ 步 `calibrate(ans, anchors, card)` → `{ method: two_point|ratio|forced, share, by_type, raw_detour, detour, anchors }`：
  - `two_point`：全体（按 `mix` 加权）绕行比例按两个锚点连直线换算 —— ROADWORK / AHEAD → 3%、USE / RUSSELL ST → 20%（都 **［待核］**），全体封顶 35%；各类人按表态高低等比例缩放，某类超过 100% 的部分按比例分给其他还没到 100% 的类（全体仍 = 换算值）
  - `ratio`：回答的 `model` 和锚点对不上（含 `model: "mixed"`），或两块标准屏的表态差 < 0.02 → 表态 × 1/5
  - `forced`：全封（没有 `stay` 路线），不校准
  - 所有绕行都禁货车时，送货那类留在原路（这一类 detour = 0）
  - 锚点按「ask 函数 × 来源」缓存；不是纯大模型来源（有一类退回规则、两块屏来源不一）或 `model` 和回答对不上的锚点用完就丢、下次重问；锚点问不到 → 用规则锚点
- 第 ⑤ 步 `evaluate()`：路段用时 = BPR + 确定性排队（D/D/1）。流量 v 超过通行能力 c 时每辆车平均多等 (v − c)·T / (2c) 秒（T = 3600，含一小时末还没放完的车的清空时间）；排队长度 = (v − c)·T / 3600 辆 × 7 米 ÷ 这条路**原本**的车道数（排队排在上游整条路上）
  - 每段挪走的车 F = min(这段的车流, 原路各路段上现在还剩的流量)：同一条街上两个施工，第二个只分第一个没分走的车，不重复算；`approaches[].volume` 就是这个 F
  - 没有绕行路线（全封又无路可绕）时一辆都不挪，卡住的车报进 `blocked_vph`，不算进 `delay_min`
- 回头再算：第 1 轮算完，把「司机看到的排队」（一小时末排队的一半，100 米一档）写进场景卡的 `queue_m` 再问，最多 2 轮；最终分流 = 各轮平均（MSA）；`calib` 的 `raw_detour` / `detour` 也是各轮平均，每轮明细在 `calib.per_round[]`（`{ queue_m, raw_detour, detour, src }`）
- 时间窗 `windowWhens(worksites, hours?)`：从最早开工到最晚完工的每一天 × 采样小时。没传 `hours` 时每个施工取落在自己时段里的早晚高峰 8 点、17 点，一个都不在时段里就取时段中间那个小时。最多 31 天（`MAX_DAYS`），更长的只算前 31 天，结果带 `truncated`
- `advise()` 改前、改后用同一段时间窗比：默认覆盖改前和所有改后方案（错开日期挪出去的那几天也算进来，不然好处会被高估）；变差的改法照样列出，`better: false`
- `windowDelay` `conflictCost` `advise` 内部用 `memoAsk()`（`pipeline.js`）把 `ask` 包一层：同一次计算里一模一样的卡（连同 opts）只问一次，失败的不缓存

## 外部 API

没有。不联网、不要 key；路人选择通过注入的 `ask` 拿。T3 的真路网（`/roads/public/cbd/network.json`、`flows.json`，格式见契约「路网数据文件」）到了直接替换 `makeGrid()` 的输出，引擎代码不用改。

## 结构

| 文件 | 一句话 |
|---|---|
| `public/js/index.js` | 对外的全部导出 |
| `public/js/grid.js` | 方格路网：Hoddle Grid 真街名，200 米一格，车流和配时是假设 |
| `public/js/net.js` | 路网索引、最短路、路段用时（BPR + D/D/1 确定性排队） |
| `public/js/worksite.js` | 施工方案：何时生效、降多少通行能力、挪日期、时间窗采样（`sampleHours` `windowWhens` `MAX_DAYS`） |
| `public/js/routes.js` | 第 ①：受影响的车、原路和最多 3 条绕行路线（带 `diverge_m`） |
| `public/js/cards.js` | 第 ②：场景卡（标志顺序、屏上原文、能读几秒、路线平时用时和拐口距离 `turn_m`、前面排多长） |
| `public/js/calibrate.js` | 第 ④：两点校准、锚点缓存 |
| `public/js/assign.js` | 第 ⑤：按比例分流，算每段用时、排队和全网总行程时间 |
| `public/js/pipeline.js` | 串起 ①–⑥，回头再算，冲突成本，`memoAsk` |
| `public/js/advisor.js` | 第 ⑦ 的引擎这一半：结果摘要、套用改法、重算 |
| `public/js/canon.js` | 键排好序的 JSON，做 `memoAsk` 的缓存键（和 api `cardkey.js` 同一写法，引擎不 import api） |
| `tests/engine.test.mjs` · `tests/e2e.test.mjs` · `tests/_t.mjs` | 见「怎么测」；`_t.mjs` 是断言小工具和演示用的施工 A / B |
| `tools/demo.mjs` | 终端里打印演示三幕和顾问对比；`--cards` 导出场景卡 |
| `test.sh` | 跑全部测试，最后一行 `N passed, M failed` |

## 本模块固定模式

- 🔒 引擎代码不 import api 模块：`ask` / `askAdvisor` 由调用方注入（浏览器传 api 的 `askPersonas` / `askAdvisor`，测试传假的或 `force: 'rule'`）。只有 `tests/e2e.test.mjs` 和 `tools/demo.mjs` 为了端到端才 import api
- 🔒 大模型只给比例和改法，所有数字（分钟、排队、延误、冲突成本）引擎算；顾问的每个改法都回第 ⑤ 步重算
- 纯函数、确定性：同样输入同样输出，不碰 DOM，`test.sh` 用 node 跑
- 校准在全体比例上做，各类人等比例缩放（分别换算的话低的那类会被截到 0，锚点就对不准）；锚点必须和回答同一个 `model`；锚点按「ask 函数 × 来源」只问一次，失败不缓存
- 回头再算取各轮平均（MSA）：第 1 轮的排队是「没人因为排队改道」时的排队，直接用第 2 轮会矫枉过正、来回摆
- 场景卡的 `queue_m` 按 100 米一档，和 api 的 `cardKey` 一致，同一场景能命中缓存；参考场景 `REF_CARD` 和 api `tools/demo-cards.mjs` 的是同一张，锚点的缓存键才对得上
- 货车不上 `truck: false` 的路（校准分配时再排除一次）
- 比较两个方案（冲突、顾问改前改后）一律用同一段时间窗，不各算各的

## 已知问题

- 方格路网和车流都是假设：200 米一格、没按真实的约 20° 旋转、晚高峰车流和 24 小时比例、周末 × 0.7、每个路口平均等灯 20 秒；等 T3 真数据
- BPR（α 0.15、β 4）+ D/D/1 确定性排队，没有排队回溢到上游路口（spillback）：排得再长也不堵住上一个路口
- 路线按自由流用时定，不随拥堵重新找路
- 受影响的车 = 施工第一段路段上的车流；从施工段中间路口拐进来的车不改道
- 只模拟开车的人：坐电车、步行、骑车、坐轮椅的还没建模
- 同一条街上相邻的两段部分封闭仍当成两组司机：各写一张卡、各问一次、各自校准（第二段只分第一段没分走的车，数量不重复，但司机的反应没有合起来看）
- 时间窗最多 31 天（`MAX_DAYS`），更长的施工只算开头一个月（`truncated: true`）；每天只采样 1–2 个小时（高峰或时段中间），不是全天
- 所有绕行都禁货车时送货那类留在原路，这一份不补给别的类：全体绕行比例会比两点换算出来的略低
- 工程假设参数：施工区旁车道通行能力 × 0.9、绕行比原路慢 3 倍以上不算、上下游各看 2 段路（约 400 米）
- 两点校准的锚点 3% / 20% **［待核］**
- 禁货车靠路段的可选字段 `truck: false`（契约 v2「路网数据文件」）：T3 的真路网没有这个字段时，送货司机的禁货车限制不生效
- 一个施工最多 10 件设备，场景卡只放离施工最近的 6 块标志（api 的上限）
