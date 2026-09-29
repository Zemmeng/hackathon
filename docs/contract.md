# 模块之间的接口契约

> 并行开发唯一需要协调的东西。改它 = 改所有调用方：PR 标题以 `contract:` 开头，lead 合并，合并后通知依赖方。优先向后兼容（加字段不删字段）。
> 版本号：**v2**（每改一次加 1，写进「变更记录」）。

## 谁调谁

| 调用方 | 被调方 | 接口 | 见节 |
|---|---|---|---|
| web | api | HTTP + WebSocket（WebSocket 模板预置，本项目不用） | §HTTP、§WS |
| engine、web | roads | 静态 JSON 文件（随网页一起发布，线上不调接口） | §路网数据文件 |
| web | engine | JS import `/engine/public/js/index.js`（ES module，在打开网页的浏览器里算） | §施工方案、§引擎结果、§规划顾问 |
| engine | api | 注入函数 `askPersonas` / `askAdvisor`（来自 `/api/public/js/persona.js`，在浏览器里跑）；引擎不 import api | §路人 agent、§规划顾问 |
| persona.js | api Worker | 先读答案文件，没命中再 `POST /api/persona`、`POST /api/advisor` | §路人 agent、§HTTP |
| web | api | `GET/POST/DELETE /api/worksites`（施工清单；引擎只吃对象，不联网） | §施工方案、§HTTP |

浏览器里这样接（web 负责注入，引擎和 api 互不 import）：

```js
import { runScenario, advise } from '/engine/public/js/index.js';
import { askPersonas, askAdvisor } from '/api/public/js/persona.js';
const res = await runScenario({ network, flows, when, worksites, ask: askPersonas });
const adv = await advise({ network, flows, when, worksites, ask: askPersonas, askAdvisor });
```

- 注入的 `ask(card, opts?)` 必须认第二个参数：引擎问校准锚点时会传 `{ force: 'rule' }`（§路人 agent 第 ④ 步）
- 🔒 只支持同源：网页、`/engine/public/`、`/api/public/`、`/api/*` 挂在同一个域名下（本地开发也一样）。Worker 故意不开 CORS：`/api/worksites` 没有鉴权、`/api/persona` 会用掉当天的真调用额度，开了等于任何网站都能改清单、烧额度
- node 测试 / 工具脚本不联网：`ask: (c, o) => askPersonas(c, { ...o, force: 'rule' })`，或传假函数
- `index.js` 的其他导出：`isActive overlaps shiftWorksite windowWhens dayType`（施工时间）· `buildCard readSeconds`（场景卡）· `calibrate makeAnchors anchorsFor anchorCard REF_CARD ANCHORS`（校准）· `windowDelay conflictCost`（叠加）· `advisorSummary applySuggestion`（顾问）· `loadNetwork makeGrid evaluate`（`makeGrid` = 测试和演示用的玩具路网）

## 路网数据文件（roads → engine、web）

T3 产出，放在 `apps/roads/public/cbd/`，本地和线上都从 `/roads/public/cbd/<文件>` 读（lead 部署时把每个模块的 `public/` 原样挂到 `/<模块>/public/`）。字段细则和生成方法见 `apps/roads/PRD.md` 第 5 节，校验见 `apps/roads/tests/test_roads.py`。

| 文件 | 顶层字段 | 要点 |
|---|---|---|
| `network.json` | `version, area, bbox[南,西,北,东], generated, sources, assumptions, nodes[], links[]` | 路段有方向；`links[]`：`id, from, to, name, highway, len_m, lanes, speed_kmh, cap_vph, t0_s, tram, bike_lane, osm_way, geometry[[lat,lon]]`，可选 `truck`（`false` = 禁货车，不写 = 允许；引擎靠它不让送货车绕进禁货车的路，没有这个字段时禁货车不生效）；`nodes[]`：`id, lat, lon, osm, signal` |
| `flows.json` | `version, unit="veh/h", period, days{wd,we}{路段 id: 24 个数}, method{路段 id}, coverage{links, measured, estimated}` | 下标 = 小时；`method` ∈ `detector_map / site_split / street_interp / class_default` |
| `signals.json` | `version, sites[{site, name, type, lat, lon, node, dist_m}]` | `node` 是 30 米内最近的节点，没有就 `null` |

- 加字段随时可以；改名、删字段、改单位要开 `contract:` PR，并把文件里的 `version` 加 1
- 路段 id 从 OSM id 派生，重跑时保持稳定（T2 会用它存用户选的施工路段）

## 施工方案（web ↔ engine ↔ api）

一条施工 = 一个对象：web 画出来、存进 `/api/worksites`、原样交给引擎。引擎侧见 `apps/engine/public/js/worksite.js` 开头；服务端校验是 `apps/api/src/app.js` 的 `validateWorksite()`，不合规 → 400 `bad_worksite` + `issues`；合规的只存下表里的字段（`pickWorksite()`），别的字段丢掉。

```json
{
  "id": "ws-latrobe-w",
  "name": "La Trobe St lane closure",
  "links": ["<network.json 的路段 id>", "<下一个路段 id>"],
  "closes": { "lanes": 1 },
  "time": { "from": "2026-10-05", "to": "2026-10-09", "hours": [7, 19] },
  "equipment": [
    { "id": "vms1", "type": "vms", "at_m": 400, "frames": [["USE", "RUSSELL ST"]], "char_mm": 320 },
    { "id": "s1", "type": "sign", "at_m": 150, "text": "RIGHT LANE CLOSED", "dir": "W" }
  ]
}
```

| 字段 | 规则 | 说明 |
|---|---|---|
| `id` | `[A-Za-z0-9_-]{1,40}` | 清单里唯一；POST 同一个 id = 覆盖 |
| `name` | 可选，1–40 个 `A-Za-z0-9 .,'&/()-`，首尾不能有空白、不能有连续空白 | 不能有中文（会进提示词） |
| `links` | 1–20 个路段 id | 按行车方向；同方向连着的算一段 approach，双向施工两个方向都列 |
| `closes.lanes` | 整数 0–8 | 每个路段封几条；≥ 车道数 = 全封；没全封时剩下车道的通行能力再 × 0.9（`WZ_FRICTION`）；两条施工压同一路段时相加 |
| `time.from` / `time.to` | `YYYY-MM-DD`，to ≥ from | 两端都算 |
| `time.hours` | `[开始, 结束)`，0–24 的整数 | 每天这几个小时生效；api 要求必填（引擎缺省按全天） |
| `equipment[]` | 最多 10 件 | `barrier` 只画不进场景卡 |
| `.id` | 同 `id` 规则 | 顾问建议靠它指哪件设备 |
| `.type` | `vms` / `sign` / `arrow` / `barrier` | |
| `.at_m` | 0–3000 | 在施工起点上游多少米 |
| `.dir` | 可选，`N/S/E/W` | 只给这个方向的车看；不给 = 所有方向 |
| `.frames` | `vms` 必填：≤ 2 帧 × ≤ 4 行 × ≤ 10 字符，合计 ≤ 8 词，字符只许 `A-Z0-9 .,'&/:+-` | `apps/api/public/js/vms.js` 的 `checkVms()`；超 3 行、超 8 字符只给警告。T2 输入框直接用它提示 |
| `.text` | `sign` / `arrow` 必填：≤ 40 字符，字符同上 | `checkSignText()` |
| `.char_mm` | 可选，字高毫米，默认 320 | 决定能读几秒：≥ 320 → 200 米看得清，≥ 200 → 100 米，更小 → 60 米 |

「什么时候」统一用 `when`：

```json
{ "date": "2026-10-06", "hour": 8, "day": "wd" }
```

- `hour` 0–23 = `flows.json` 的下标；`day` 可选（`wd` / `we`），不给按 `date` 算周几（不管公共假期）
- 生效 = `from ≤ date ≤ to` 且 `hours[0] ≤ hour < hours[1]`（`isActive()`）；两条施工重叠 = 日期和小时段都有交集（`overlaps()`）

## 路人 agent：场景卡与回答（engine ↔ api）

第 ② 步引擎给每段 approach 写一张场景卡（`apps/engine/public/js/cards.js` 的 `buildCard()`），第 ③ 步交给 `askPersonas(card)` 问 4 类人。卡上只放司机在路上看得到的东西。

```json
{
  "trip": { "on": "La Trobe St", "dir": "W", "to": "Spencer St", "kmh": 40 },
  "signs": [
    { "m": 400, "kind": "vms", "read_s": 18, "frames": [["ROADWORK", "AHEAD"]] },
    { "m": 150, "kind": "sign", "text": "RIGHT LANE CLOSED" }
  ],
  "routes": [
    { "id": "stay", "name": "La Trobe St", "usual_min": 6 },
    { "id": "r1", "name": "Russell St", "usual_min": 8, "turn_m": 350 },
    { "id": "r2", "name": "Elizabeth St", "usual_min": 9, "turn_m": 150, "truck": false }
  ],
  "queue_m": 0
}
```

| 字段 | 规则（`apps/api/src/app.js` 的 `validateCard()`，不合规 → 400 `bad_card` + `issues`） | 说明 |
|---|---|---|
| `trip.on` / `trip.to` | 1–40 个 `A-Za-z0-9 .,'&/()-`，首尾不能有空白、不能有连续空白（`isName()`） | 所在街、要去的路口；引擎用 `cleanName()` 清洗 |
| `trip.dir` / `trip.kmh` | `N/S/E/W` / 5–110 | 行车方向、路段限速 |
| `signs[]` | ≤ 6 块，从远到近 | 施工设备里本方向的 vms / sign / arrow |
| `.m` / `.kind` | 0–3000 / `vms` `sign` `arrow` | vms 带 `frames` + `read_s`，另两种带 `text`（规则同 §施工方案） |
| `.read_s` | 0–120 | 能读几秒 = 看得清的距离 ÷ 车速 |
| `routes[]` | 1–6 条，至少 1 条不是 `stay` | `stay` = 原路；全封时没有 `stay` |
| `.id` / `.name` | `stay` 或 `r1`–`r9` / 路名同上；都不重复 | 绕行路线按拐进去的那条街起名 |
| `.usual_min` | 0–180 | 平时走完要几分钟（一位小数） |
| `.truck` | 可选，只会写 `false` | 禁货车；`delivery` 永远分不到 |
| `.turn_m` | 可选，0–3000，只有绕行路线写（`stay` 写了也算错，issue 码 `bad_turn_m`） | 在施工起点上游多少米拐出去（引擎取 `diverge_m` 取整）；提示词写成「turn off about N m before the works」。标志要在拐口之前（`sign.m ≥ turn_m`）才算点名了这条路：摆在拐口之后，司机看到时已经拐不过去（`rules.js` 的 `namedRoute()`） |
| `queue_m` | 0–10000，100 米一档 | 司机看到前面排多长；第 1 轮是 0 |

**一类人的回答**（`POST /api/persona` 的 `answer`、答案文件里的每一类）：

```json
{ "share": { "stay": 0.62, "r1": 0.26, "r2": 0.12 }, "lo": 0.31, "hi": 0.45, "notice": 0.85, "understand": 0.9, "why": "Sign names Russell St.", "n": 3 }
```

- `share`：每条路线 0–1，合计 1 ± 0.02（`rules.js` 的 `validTypeAnswer()`），是**校准前**的表态
- `lo` / `hi`：几次回答里绕行比例（1 − stay；没有 stay 就是 1）的最小 / 最大；`n` = 有效回答次数（大模型 2–3，规则 1，规则版 lo = hi）
- `notice` / `understand`：注意到 / 看懂的概率 0–1；`why`：一句英文，≤ 200 字符

**`askPersonas(card)` 的回答**（`apps/api/public/js/persona.js` 的 `combine()`）：

```json
{
  "src": "rule",
  "by_type": {
    "commuter": { "share": {}, "lo": 0.31, "hi": 0.31, "notice": 0.85, "understand": 0.9, "why": "…", "n": 1,
                  "src": "rule", "model": "rule-v1", "prompt_v": "-", "fallback": "mock" },
    "local": {}, "tourist": {}, "delivery": {}
  },
  "raw": { "stay": 0.71, "r1": 0.2, "r2": 0.09 },
  "mix": { "commuter": 0.5, "local": 0.25, "tourist": 0.1, "delivery": 0.15 },
  "model": "rule-v1",
  "prompt_v": "-"
}
```

- `by_type`：4 类人各自的回答 + 来源；`raw`：按 `mix`（车流占比，工程假设）加权的全体比例，同样**校准前**
- 顶层 `src` = 4 类里最「估算」的那个（`rule` < `llm` < `kv` < `file`）：只要有一类是 `rule`，界面就标「估算」
- 顶层 `model` / `prompt_v`：答案文件的，或第一个非规则那类的；全是规则时 `rule-v1` / `-`；有的类是规则、有的不是 → `model: "mixed"`（锚点对不上，引擎的校准退回 `ratio`）
- 送货那类不管从哪来（答案文件、Worker）都再过一遍 `truckSafe()`：`truck: false` 的绕行清零、按比例补回

| `src` | 从哪来 | 花钱 |
|---|---|---|
| `file` | 随网页发布的答案文件命中（4 类都有且合法才算） | 0 |
| `kv` | Worker 的 KV 缓存命中 | 0 |
| `llm` | Worker 刚问了大模型（每类 3 次，每次打乱路线顺序） | 每类 3 次调用 |
| `rule` | 关键词规则 `rules.js` 的 `ruleAnswer()`，同一张卡永远同一个答案 | 0 |

查找顺序：答案文件 → 每类人一个 `POST /api/persona`（4 个并行）→ 哪一类失败就只有那一类用规则。

- 答案文件 5 秒拉不到就当没有；只缓存「拿到了」和「确定没有（404）」，网络错误、超时、5xx 下次调用再试；没有 `crypto.subtle`（非 https 的局域网地址）算不了键，跳过答案文件
- 每个 Worker 请求浏览器等 25 秒（Worker 等大模型 20 秒，多留 5 秒，免得 Worker 已经付钱问到的答案在浏览器这边丢掉）

`fallback` 只在 `src: "rule"` 时出现：

| 在哪兜底 | 短码 |
|---|---|
| Worker | `mock` `no_provider` `no_db`（没绑 D1）`cap` `fuse_error`（D1 计数出错）`timeout`（单次调用 20 秒）`llm_failed`（有效回答不到 2 次）`llm_error` `unknown_provider`；顾问多一个 `llm_empty`（大模型的建议全被滤掉）。条件见 §Mock |
| 浏览器 persona.js | `network` `http_<状态码>` `bad_json`（回的不是 JSON）`bad_response` `timeout`（每个请求 25 秒，超时中止请求）`no_fetch`（没有 fetch 或传了 `fetch: null`）；`askAdvisor` 用同一套 |

**答案文件** `apps/api/public/answers/answers.json`（线上 `/api/public/answers/answers.json`，persona.js 按自己的地址找）：

```json
{
  "version": 1,
  "prompt_v": "p1",
  "model": "",
  "generated": null,
  "note": "…",
  "entries": {
    "<cardKey(场景卡, prompt_v)>": { "by_type": { "commuter": {}, "local": {}, "tourist": {}, "delivery": {} } }
  }
}
```

- 键 = `cardKey(card, prompt_v)`（`apps/api/public/js/cardkey.js`）= SHA-256（`prompt_v|` + 规范化后的卡），64 位十六进制。规范化：文字大写、分钟取整、`m` 和 `turn_m` 50 米一档、`queue_m` 100 米一档、`kmh` 5 km/h 一档、路线按 id 排、标志从远到近 —— 写法不同的同一张卡也能命中
- 只由 `apps/api/tools/prewarm.mjs --run` 写，只写大模型的回答，**从不写规则答案**；预热用的卡来自 `node apps/engine/tools/demo.mjs --cards <文件>`
- `apps/api/prompts.md` 的 `prompt_v` 一改：Worker KV 的旧键自动作废；答案文件不会自动作废（它按文件自己的 `prompt_v` 查），必须重跑 `prewarm.mjs --run`，`prewarm.mjs --check` 和 `tests/behavior.test.mjs` 发现两边 `prompt_v` 不一致会报错。Worker KV 另用自己的键：路人 `p:` + `cardKey(card, "prompt_v|模型|类型")`，顾问 `a:` + SHA-256（`prompt_v|模型|` + 键排好序的摘要 JSON）

### 第 ④ 步：两点校准（在引擎里）

> 和 `docs/arch/5-llm-api-detail.pdf` 第 3 页的草稿不同：草稿里 `askPersonas` 直接回校准后的 `share`；现在 api 只回校准前的 `by_type` / `raw` / `mix`，校准由引擎的 `calibrate()`（`apps/engine/public/js/calibrate.js`）做，和 `docs/arch/4-ai-flow.md` 表里「第 ④ 步 = 引擎」一致。**界面显示的比例一律用 §引擎结果里的 `share`，不用 `raw`。**

- 锚点：参考卡 `REF_CARD`（La Trobe St 西行，40 km/h）换两块标准屏，用同一个 `ask` 问：`ROADWORK / AHEAD` → 全体 3%，`USE / RUSSELL ST` → 20%（两个都［待核］）。每个 `ask` 函数、每种来源只问一次；规则回答配规则锚点（`ask(card, { force: 'rule' })`）。锚点卡的屏按 200 mm 字高固定 `read_s: 9`（和 `5-llm-api-detail.pdf` 第 3 页的例子、api `tools/demo-cards.mjs` 一致），不随引擎的读屏公式变，否则预热的锚点答案对不上
- 换算：全体表态绕行 X = Σ mix × (1 − stay)，按两点连成的直线换成 D，截到 0–35%；各类人按表态的相对高低等比例缩放，某类超过 100% 的部分按比例分给其他还没到 100% 的类（全体仍 = D）；绕行那部分按回答自己的比例分给各条绕行路线（货车不上 `truck: false`；所有绕行都禁货车时送货那类留在原路，这一份不补给别的类）
- 锚点缓存按「ask 函数 × 来源」；不是纯大模型来源（有一类退回了规则、两块屏来源不一）或 `model` 和回答对不上的锚点用完就丢、下次重问；锚点问不到 → 用规则锚点
- `method`：`two_point` 正常；`ratio` = 回答和锚点不是同一个模型（含 `model: "mixed"`），或两块标准屏的表态差不到 0.02 → X × 1/5（同样截到 35%）；`forced` = 全封没有 `stay`，全部绕行、不校准
- `calibrate(ans, anchors, card)` 回 `{ method, share, by_type{类型: { share, detour, raw_detour }}, raw_detour, detour, anchors }`

## 引擎结果（engine → web）

`runScenario({ network, flows, when, worksites, ask, maxRounds = 2 })`：`network` / `flows` 是 roads 的两个 JSON（或 `loadNetwork()` 过的），`worksites` 里只有在 `when` 生效的才算。单位：`delay_min` = 这一小时里比「没有施工」多出来的**车·分钟**（veh·min）；`queue_m` = 这一小时**末尾**的排队米数（排队车数 × 7 米 ÷ 这条路原本的车道数：排队排在上游整条路上，不按施工段剩下的车道算）；`volume` / `flow` = veh/h。路段用时 = BPR + 确定性排队（D/D/1）：流量 v 超过通行能力 c 时每辆车平均多等 (v − c)·T / (2c) 秒，T = 3600，含一小时末还没放完的车的清空时间。

```json
{
  "when": { "date": "2026-10-06", "hour": 8 },
  "delay_min": 1450,
  "tt_base_min": 38210.5,
  "blocked_vph": 0,
  "approaches": [{
    "worksite": "ws-latrobe-w", "entry": "<路段 id>", "street": "La Trobe St", "dir": "W", "to": "Spencer St",
    "volume": 820, "blocked": false, "queue_m": 640, "delay_min": 910,
    "share": { "stay": 0.83, "r1": 0.12, "r2": 0.05 },
    "routes": [{ "id": "r1", "name": "Russell St", "usual_min": 8, "now_min": 9.4, "share": 0.12, "flow": 98,
                 "truck": true, "diverge_m": 380, "extra_min": 3.1 }],
    "by_type": { "commuter": { "share": {}, "detour": 0.21, "extra_min": 2.4, "notice": 0.85, "understand": 0.9,
                               "why": "…", "lo": 0.31, "hi": 0.45, "src": "rule" } },
    "card": {},
    "src": "rule", "model": "rule-v1",
    "calib": { "method": "two_point", "raw_detour": 0.41, "detour": 0.17,
               "per_round": [{ "queue_m": 0, "raw_detour": 0.43, "detour": 0.18, "src": "rule" },
                             { "queue_m": 300, "raw_detour": 0.39, "detour": 0.16, "src": "rule" }] },
    "rounds": 2
  }],
  "hot": [{ "id": "<路段 id>", "name": "La Trobe St", "from": "<节点>", "to": "<节点>", "extra_min": 520, "v": 1310, "cap": 900, "queue_m": 640 }],
  "rounds": 2,
  "active": ["ws-latrobe-w"]
}
```

| 字段 | 含义 |
|---|---|
| `delay_min` | 全网总延误（veh·min）= 全网总行程时间 − 没施工时的，取整 |
| `tt_base_min` | 没施工时全网总行程时间（veh·min） |
| `blocked_vph` | 全封又没路可绕、卡住的车流（veh/h）：这些车一辆都不挪，留在原路，**不算进** `delay_min`，界面单独标 |
| `approaches[].volume` | 这段实际分流的车（veh/h）= min(这段的车流, 原路各路段上现在还剩的流量)：同一条街上前一个施工已经分走的不重复算 |
| `approaches[].delay_min` | 这段受影响的车多花的时间（veh·min）= volume × Σ 各路线 share × extra_min |
| `approaches[].share` | 校准后、各轮平均的分流；没有绕行路线 → `{ "stay": 1 }` |
| `routes[].now_min` / `extra_min` | 现在走完几分钟 / 每辆车比「没施工时的原路」多几分钟 |
| `routes[].diverge_m` | 在施工起点上游多少米拐出去；`stay` 是 `null` |
| `by_type[类型]` | `share` `detour` 校准后（各轮平均）；`extra_min` 该类每辆车平均多几分钟；`notice` `understand` `why` `lo` `hi` `src` 是最后一轮的表态（校准前） |
| `card` `src` `model` | 最后一轮的场景卡、回答来源、模型 |
| `calib` | `raw_detour` / `detour` 是各轮平均（和 `share` 一致），`method` 是最后一轮的；`per_round[]` 每轮一条 `{ queue_m, raw_detour, detour, src }`。没问过（没有绕行路线）时 `by_type` 是 `{}`，`card` `src` `model` `calib` 都是 `null` |
| `hot[]` | 多出时间最多的 ≤ 5 个路段（`extra_min` 单位 veh·min，> 0.5 才列） |
| `rounds` | 问了几轮（≤ 2） |

- 没有生效的施工时直接回 `{ when, delay_min: 0, tt_base_min, approaches: [], hot: [], rounds: 0, active: [] }`（没有 `blocked_vph`）
- 回头再算（⑤ → ③）：第 2 轮把 `queue_m` = 一小时末排队的一半（100 米一档）写进场景卡再问，档位没变就停，最多 2 轮；分流取各轮平均（MSA），不直接用第 2 轮，免得矫枉过正、来回摆
- `ask` 抛错或回的不合格（缺哪类人、比例对不上卡上的路线）→ 这段改问 `ask(card, { force: 'rule' })`，不让整个结果崩；`src` 如实标 `rule`
- 数字全是引擎算的，大模型只给比例

| 函数 | 回什么 |
|---|---|
| `windowDelay({ network, flows, worksites, whens, ask })` | `{ delay_min, per: [{ when, delay_min }] }`：一串时刻的总延误（veh·min） |
| `conflictCost({ network, flows, a, b, ask, whens?, hours? })` | `{ a, b, ab, cost, overlap, whens, truncated }`：只有 A / 只有 B / 两个都在时的总延误；`cost` = ab − a − b（第 ⑥ 步冲突成本，正 = 叠加更糟）；`overlap` 时间有没有交集；`whens` = 算了几个时刻；`truncated` = 时间窗超过 31 天被截了 |
| `advise({ network, flows, when, worksites, ask, askAdvisor, whens?, hours })` | 见 §规划顾问 |

- 默认 `whens`（`windowWhens()`）= 从最早开工到最晚完工的每一天 × 采样小时。采样小时：传了 `hours` 就用它；没传就每个施工取落在自己 `time.hours` 里的早晚高峰 8 点、17 点，一个都不在时段里就取时段中间那个小时。最多 31 天（`MAX_DAYS`），更长的只算前 31 天，结果带 `truncated: true`；时间不重叠时冲突成本正好是 0
- `windowDelay` `conflictCost` `advise` 内部把 `ask` 包一层 `memoAsk()`：同一次计算里一模一样的卡（连同 opts）只问一次，失败的不缓存

## 规划顾问（engine ↔ api，第 ⑦ 步）

引擎把结果摘要交给 `askAdvisor(summary)`，拿回 ≤ 3 条改法，每条都回到第 ⑤ 步用引擎重算。大模型出主意，引擎算数字。

摘要（`apps/engine/public/js/advisor.js` 的 `advisorSummary(result, worksites, conflicts)`）：

```json
{
  "when": { "date": "2026-10-06", "hour": 8 },
  "worksites": [{ "id": "ws-latrobe-w", "name": "…", "links": [], "closes": { "lanes": 1 }, "time": {}, "equipment": [] }],
  "approaches": [{ "worksite": "ws-latrobe-w", "street": "La Trobe St", "dir": "W", "queue_m": 640, "delay_min": 910,
    "routes": [{ "id": "r1", "name": "Russell St", "usual_min": 8, "now_min": 9.4, "share": 0.12, "truck": true, "diverge_m": 380 }] }],
  "conflicts": [{ "a": "ws-latrobe-w", "b": "ws-swanston-n", "cost_min": 120 }]
}
```

- `conflicts` 只列时间有重叠的两两组合，`cost_min` = `conflictCost().cost`（用改前的时间窗算）
- Worker 查摘要外形（`validateSummary()`）：是对象；`worksites` `approaches` `conflicts` 有的话是数组；施工 `id` 合 `[A-Za-z0-9_-]{1,40}`，`time.from` / `to` 有的话是 `YYYY-MM-DD`，`equipment` / `routes` 有的话是数组。不合 → 400 `bad_summary`

建议（`apps/api/public/js/rules.js` 的 `checkSuggestion()` 校验，Worker 和浏览器都会丢掉不合规的）：

| `kind` | 字段 | 规则 | 引擎怎么改（`applySuggestion()`） |
|---|---|---|---|
| `text` | `worksite, equipment, frames, at_m?, why` | `frames` 过 `checkVms`；`equipment` 是屏的 id 或 `null` | 改那块屏的字；`null` = 新加一块 id `vms-new` 的屏，放在 `at_m`（不给就 300 米） |
| `move` | `worksite, equipment, at_m, why` | `at_m` 0–2000 | 把那件设备挪到 `at_m` |
| `shift` | `worksite, days, why` | 整数，≠ 0，绝对值 ≤ 60 | 整段 `time.from` / `to` 平移 `days` 天 |

- 通用：`worksite` 和 `equipment`（`text` 的 `null` 除外）合 `[A-Za-z0-9_-]{1,40}`；`why` 一句英文（Worker 清洗到 ≤ 200 字符）。Worker 还丢掉 `worksite` 不在 `summary.worksites` 里的（大模型、KV 缓存、规则版都过这一道）；浏览器只过 `checkSuggestion()`，对不上的由 `advise()` 标 `skipped`
- 规则版（`adviseRule()`）只在最快的绕行现在比原路至少快 1 分钟时才建议改屏上的字（全封没有原路时照样建议），一样快取拐口最近的那条
- `askAdvisor(summary)` 回 `{ src: "llm" | "kv" | "rule", suggestions: [≤3], fallback? }`；`fallback` 是浏览器这边兜底的原因，或 Worker 回的原因（原样透传）；规则版的建议也过 `checkSuggestion()`

`advise()` 的回答：

```json
{
  "src": "rule",
  "summary": {},
  "whens": 10,
  "truncated": false,
  "before": { "delay_min": 15200, "result": {} },
  "options": [
    { "suggestion": {}, "worksites": [], "delay_min": 12900, "delta_min": -2300, "better": true, "result": {} },
    { "suggestion": {}, "skipped": "no_such_worksite_or_equipment" }
  ]
}
```

- `before.delay_min` / `options[].delay_min` = 整段 `whens` 的总延误（veh·min）；`delta_min` = 改后 − 改前，负数 = 变好；`better` = `delta_min < 0`（变差的改法照样列出，界面标「不建议」）
- 改前、改后用同一段时间窗：默认覆盖改前和所有改后方案（错开日期挪出去的那几天也算进来，不然好处会被高估）；`whens` = 时刻数，`truncated` 同 `conflictCost`；`askAdvisor` 回了 `fallback` 时顶层也带
- `before.result` / `options[].result` = 改前 / 改后在 `when` 那一小时的 `runScenario` 结果，给前后对比；`options[].worksites` = 改后的施工清单

## HTTP API

| 方法 + 路径 | 请求 | 响应 | 负责模块 |
|---|---|---|---|
| `GET /api/health` | — | `{ "ok": true, "v": "<版本>", "mock": bool, "llm": "<模型名>" \| null, "prompt_v": "p1" }`（v2 加 `llm` `prompt_v`；`llm` 为 null = 还没接大模型） | api |
| `POST /api/create` | `{}` | `{ "code": "ABCDE" }` | api（模板预置，本项目不用，没实现） |
| `POST /api/persona` | `{ "type": "commuter" \| "local" \| "tourist" \| "delivery", "card": 场景卡 }` | `{ ok, src: "kv" \| "llm" \| "rule", type, answer: 一类人的回答, model, prompt_v, fallback? }`；规则时 `model: "rule-v1"`、`prompt_v: "-"` | api |
| `POST /api/advisor` | `{ "summary": 结果摘要 }` | `{ ok, src: "llm" \| "kv" \| "rule", suggestions: [≤3], model?, fallback? }`；`model` 只在 llm / kv 时有 | api |
| `GET /api/worksites` | — | `{ ok, worksites: [施工方案…], persist }` | api |
| `POST /api/worksites` | `{ "worksite": 施工方案 }` | `{ ok, worksite, persist }`；同 id 覆盖；只存认识的字段（`pickWorksite()`，多余的丢掉、屏上文字规范化），回的 `worksite` 就是存下的那份 | api |
| `DELETE /api/worksites?id=<id>` | — | `{ ok, id, persist }`；id 不存在也回 ok | api |

| 状态 | `error` | 什么时候 |
|---|---|---|
| 400 | `bad_json` | 请求体不是 JSON |
| 400 | `bad_type` `bad_card` `bad_summary` `bad_worksite` `bad_id` | 校验不过；`bad_card` `bad_worksite` 多带 `issues: [{ code, msg }]` |
| 404 | `not_found` | 没有这个接口 |
| 405 | `method_not_allowed` | 方法不对，带 `Allow` 头 |
| 409 | `too_many` | 施工清单已满 200 条（覆盖已有 id 不算；D1 上用一条带条件的语句判断，并发 POST 也不会超） |
| 413 | `too_large` | 请求体 > 8 KB |
| 500 | `internal` | 其他异常；不回显异常原文 |

- `/api/persona` `/api/advisor` 兜底时也回 200 + `src: "rule"` + `fallback`，不是报错；前端按 `src` 标「估算」即可
- `persist`：true = 存在 D1（绑定 `DB`，表 `worksites`，见 `apps/api/schema.sql`，按 id 排序）；false = 没绑 D1，存在 Worker 实例内存里，重启就丢
- `/api/worksites` 没有鉴权（GET / POST / DELETE 都是）：不开 CORS 只挡住别的网站的网页，用 curl 谁都能改
- 同一个 Worker 也发静态文件：`/api/public/*` → api 模块的 `public/`（`persona.js` `rules.js` `vms.js` `cardkey.js`、答案文件）

## WebSocket 消息（`/ws?room=<CODE>`）

> 模板预置，本项目不用。

| type | 方向 | 字段 |
|---|---|---|
| `join` | 客户端 → 服务端 | `token`, `nick` |
| `act` | 客户端 → 服务端 | `kind`, `payload` |
| `state` | 服务端 → 客户端 | `v`, `view`（按本人裁剪后的状态） |
| `err` | 服务端 → 客户端 | `msg` |

## 共享状态形状

> 模板预置，本项目不用。

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

- 校验类 400 多带 `issues: [{ code, msg }]`（`code` 是 ASCII 短码，`msg` 中文），界面可以逐条提示

## Mock

`MOCK=1` 时：`/api/health` 的 `mock` 为 true；前端 `/api/*` 不通时在本地用 `logic.js` 的 `reduce()` 跑同一套逻辑。fixtures 放各模块 `fixtures/`。（后半句模板预置，本项目不用，见下）

v2 起 `MOCK` 是 api Worker 的变量（`apps/api/wrangler.jsonc` 默认 `"1"`），只有等于 `"0"` 才可能真调大模型：

- `MOCK` 不是 `"0"` → `/api/persona` `/api/advisor` 一律回规则估算，`fallback: "mock"`（persona 例外：绑了 KV 且配了模型时，KV 里已有的答案照样回 `src: "kv"`；advisor 在 MOCK 下不查 KV）
- `MOCK=0` 还要同时满足，缺一个就回规则并带对应短码：`LLM_PROVIDER` 和 `LLM_MODEL` 都设了（否则 `no_provider`）· 绑了 D1 `DB`（否则 `no_db`：没有原子的当天计数就不花钱）· 当天（UTC）真调用数加上这次不超过 `LLM_DAILY_CAP`（默认 300；`"0"` = 一次都不调；填的不是非负整数按 300；persona 每次记 3、advisor 记 1；超了 `cap`）
- 当天计数在 D1 的 `quota(day, n)` 表（`apps/api/schema.sql`），`app.js` 的 `reserve()` 用一条原子语句加：`INSERT … ON CONFLICT(day) DO UPDATE SET n = n + excluded.n WHERE n + excluded.n <= 上限 RETURNING n`，没回行 = 超限，并发也不会超；D1 出错一律当超限 → `fuse_error`（不调、回规则）。先占额度再调，调用失败占掉的不退
- KV `PERSONA_KV` 只做问答缓存，可选：不绑照样能真调，只是每次都问（键见 §路人 agent 答案文件那段）；KV 是最终一致的，刚写进去的答案别处可能 60 秒后才读得到
- 现状：用哪家大模型未定（D-0929-1333），`apps/api/src/llm.js` 只会抛 `no_provider`，线上线下全部是规则估算
- 浏览器 / node 不联网：`askPersonas(card, { force: 'rule' })`、`askAdvisor(summary, { force: 'rule' })` 纯本地；`{ fetch: null }` 也走规则，但带 `fallback: "no_fetch"`

## 变更流程

开 `contract:` PR → lead 批准 → 群里通知依赖方 → 依赖方各自适配。**字段路径以实测为准**，别照文档猜。

## 变更记录（最新在上）

| 版本 | 时间 | 改了什么 | 谁 |
|---|---|---|---|
| v2 | 2026-09-29 | 加「施工方案」「路人 agent」「引擎结果」「规划顾问」四节，HTTP 加 persona / advisor / worksites，health 加 `llm` `prompt_v`；第 ④ 步校准放在引擎（和 5-llm-api-detail.pdf 草稿不同）；create / WS / 共享状态标为模板预置不用；含对抗审查后的修正：场景卡路线加可选 `turn_m`，花钱保险丝从 KV 改成 D1 `quota` 表原子计数（去掉 `no_kv`，加 `no_db` `fuse_error`），advisor 加 KV 缓存和摘要校验 | lead |
| v1 | 2026-09-29 | 加「路网数据文件」一节（roads → engine、web）；HTTP / WS 节还是模板预置，T5 定了再改 | lead |
| v0 | 2026-09-26 | 模板预置：health / create / ws 骨架 | lead |
