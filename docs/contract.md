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
  "model": "deepseek-flash",
  "prompt_v": "r2"
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
| `src` | `file`（随网页发布的 `demo.json`）/ `kv`（Worker 的缓存：内存、KV 或 Cache API）/ `llm`（刚问的大模型）/ `rule`（关键词规则） |
| `model` | 大模型名（= Worker 变量 `LLM_MODEL`，例 `deepseek-flash`）；规则读数是 `"rules"` |
| `prompt_v` | 提示词版本（`apps/api/prompts.md`，例 `r2`）；规则读数是规则版本（例 `k1`） |
| `note` | 可选，只在 `POST /api/read` 的规则兜底时出现：为什么没用大模型的短码（例 `llm_fallback: 1/3 valid (timeout)`、`llm_rate_limited`）。`readSigns()` 会丢掉它，引擎看不到 |

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

**结果**（数字全由引擎算；单位：`*_min` = 这一小时比「没有施工」多出来的车·分钟；每车按 1 人算，公交电车乘客还没建模）：

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
| `GET /api/health` | — | `{ "ok": true, "v": "<版本>", "mock": bool, "llm": { "mode": "rules"\|"llm", "model", "key": bool, "cache": "kv"\|"cache-api"\|"none", "prompt_v", "provider" } }`；`key` 只说有没有，**永远不给值**；api 没绑上时 site 自己回 `{ ok, v, mock: true, api: false }` | api |
| `POST /api/read` | 同 §路人读数 的请求 | `{ "ok": true, "reading": <读数> }`（`src` 是 `llm / kv / rule`）；不合规范 400 `{ "ok": false, "error", "msg" }`；> 8KB 413 | api |

- `llm.mode` 是 `llm` 只在 Worker 变量 `MOCK` 为 `"0"` **且**有 secret `LLM_API_KEY`；否则 `/api/read` 只用关键词规则、不发任何外部请求（`apps/api/tests/llm.test.mjs` 反向断言）
- `/api/*` 由 site 用服务绑定 `API` 转给 api Worker（`hackathon-api`）；`/api/public/*` 是 `apps/api/public/` 的静态文件，不转发
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
| v3.2 | 2026-09-29 | T19 大模型接口留好（向后兼容，只加字段）：`/api/health` 加 `llm`；读数说明 `src` / `model` / `prompt_v`，加可选 `note`；site 服务绑定 `API` → `hackathon-api` | lead |
| v3.1 | 2026-09-29 | §路人读数：`kind` 加 `arrow`、`read_s` 上限 120、路名字符、`SignError` 和 `failed` / `missing`（T5 #29 对齐引擎）；HTTP API 加 `POST /api/read`；§evaluate：网页只接 `backend.js`（D-0929-1540） | lead |
| v3 | 2026-09-29 | 加「施工方案」；「evaluate」定稿（createEngine / prepare / evaluate / conflict / advise 和结果字段，T9 骨架）；参数入口 `loadParams()` 读 T12 的 `params.json`，`calib.target` | lead |
| v2 | 2026-09-29 | 加「路人读数」（api → engine，D-0929-1435）和「evaluate」草案（engine → web） | lead |
| v1 | 2026-09-29 | 加「路网数据文件」一节（roads → engine、web）；HTTP / WS 节还是模板预置，T5 定了再改 | lead |
| v0 | 2026-09-26 | 模板预置：health / create / ws 骨架 | lead |
