# engine —— 施工影响引擎：读数 + 每类人参数 → 各条路走多少人、哪里堵、堵多久、多个施工叠加的冲突成本
Owner: @Zemmeng（lead 暂管；T4 认领后改成认领人）

按 `docs/arch/4-ai-flow.md` 和 D-0929-1435：大模型（T5 的 `readSigns()`）只「读懂」屏上的字，比例、分钟数、排队全由这里算。
纯 JS，不碰 DOM，浏览器和 node 都能直接 import；同样输入同样结果，真路网上单次 `evaluate` 约 7 毫秒。

## 怎么跑

- 演示三幕：`node apps/engine/tools/demo.mjs`（方格路网）；加 `--real` 另在 T3 真路网上跑第一幕（Bourke Street 东行）
- 浏览器里（要经 http 打开，ES module 不能 file://；网页、引擎、路网数据要同源）：

```js
import { createEngine, mockReadSigns } from '/engine/public/js/index.js';
const [network, flows] = await Promise.all(['network', 'flows'].map(f => fetch(`/roads/public/cbd/${f}.json`).then(r => r.json())));
const engine = createEngine({ network, flows, readSigns: mockReadSigns }); // T5 的 readSigns 到了换掉
const plan = { when: { date: '2026-10-06', hour: 17 }, worksites: [施工方案] };
await engine.prepare(plan);
const result = engine.evaluate(plan);
```

## 怎么测

`bash apps/engine/test.sh`（2026-09-29 实跑：67 passed, 0 failed）。

| 文件 | 测什么 |
|---|---|
| `tests/engine.test.mjs` | 路网、最短路、BPR、施工时段、绕行路线、读数请求、选择模型、两点校准（正好 3% / 20%）、evaluate（确定性、缺读数、全封卡住、同路段两施工不重复算、readSigns 全挂不崩）、冲突成本、顾问 |
| `tests/e2e.test.mjs` | MOCK 读数跑演示三幕（8 点、17 点）、屏的位置（摆在拐口之后不算）、顾问改法重算；T3 真路网：加载、单次 < 100 毫秒、第一幕方向成立 |

## 对外接口（→ docs/contract.md §施工方案、§evaluate、§路人读数）

| 导出 | 用法 |
|---|---|
| `createEngine({ network, flows, readSigns })` | → `{ prepare(方案), evaluate(方案, { seed }), window(worksites, whens), conflict(a, b, opts), calib }` |
| `advise(engine, 方案, { askAdvisor })` | 第 ⑦ 步：拿 ≤ 3 个改法（改字 · 挪设备 · 错开），每个都重算、标 `better` |
| `mockReadSigns` / `mockAdvise` | 关键词规则版读数器 / 顾问，T5 和大模型顾问到之前演示、测试用 |
| `makeGrid()` | 测试用的 5 × 9 方格路网（Hoddle Grid 街名、假设车流） |
| `PERSONAS` `MIX` `chooseShares` `calibrate` … | 选择模型和校准的零件（见 `index.js`） |

## 外部 API

不联网、不要 key。读数从注入的 `readSigns`（T5）拿；路网和车流是 T3 的 `/roads/public/cbd/network.json`、`flows.json`。

## 结构

| 文件 | 一句话 |
|---|---|
| `public/js/index.js` | 对外的全部导出 |
| `public/js/pipeline.js` | `createEngine`：prepare / evaluate / window / conflict，排队反馈的逐次平均 |
| `public/js/choice.js` | 第 ④ 步选择模型：每类人参数（赶时间 · 熟路 · 信屏 · 怕堵 · 只能走货车路）+ 被说动的比例 → 各路线比例 |
| `public/js/calibrate.js` | 两点校准：在参考场景上解出绕行惯性 A、推荐力度 B |
| `public/js/reading.js` | 第 ② 步读数请求（全部标志 + 每条绕行拐口前的标志）、MOCK 读数器 |
| `public/js/routes.js` | 第 ① 步：受影响的车、原路、最多 3 条绕行（上游约 400 米、下游约 300 米） |
| `public/js/assign.js` | 第 ⑤ 步：分流，BPR + D/D/1 排队，全网总行程时间 |
| `public/js/net.js` · `worksite.js` · `cards.js` · `canon.js` | 路网索引和最短路 · 施工时段和通行能力 · 读屏秒数和路名清洗 · 稳定 JSON |
| `public/js/advisor.js` | 第 ⑦ 步的引擎这一半 + MOCK 顾问 |
| `public/js/grid.js` | 方格路网 |
| `tools/demo.mjs` · `tests/` · `test.sh` | 演示 · 测试 |

## 本模块固定模式

- 🔒 引擎不 import api 模块：`readSigns` / `askAdvisor` 由调用方注入
- 🔒 大模型只给读数和改法，所有数字引擎算；排队变长引擎自己重算，不再问大模型
- `evaluate` 同步、确定：要的读数先 `prepare`；缺的按「没人被说动」算并报 `missing`
- 读数请求只含「字 + 人」（不含位置、耗时、排队），同一句话每类人只问一次；屏的位置由引擎用 `turn_m` 判断
- 改了选择模型参数就重跑 `node tools/demo.mjs` 看三幕方向还对不对

## 已知问题

- 每类人参数、占比 `MIX`、`BETA`、「看到排队 1 公里 ≈ 多堵 4 分钟」都是工程假设；两点校准的 3% / 20% ［待核］
- T3 的车流有些路段本身就超过通行能力（如 Flinders Street 2526 / 1800）：引擎只算比没施工多出来的，但绝对数会偏大
- BPR + 确定性排队，没有排队回溢到上游路口；路线按自由流定，不随拥堵重新找路；只改道施工第一段上的车
- 只模拟开车的人（每车 1 人）：电车公交乘客、行人、骑车、轮椅还没做
- 冲突 / 顾问的时间窗最多 31 天、每天只采样 1–2 个小时
- T3 路网没有 `truck` 字段，禁货车限制现在不生效
