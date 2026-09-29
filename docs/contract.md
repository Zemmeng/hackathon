# 模块之间的接口契约

> 并行开发唯一需要协调的东西。改它 = 改所有调用方：PR 标题以 `contract:` 开头，lead 合并，合并后通知依赖方。优先向后兼容（加字段不删字段）。
> 版本号：**v2**（每改一次加 1，写进「变更记录」）。

## 谁调谁

| 调用方 | 被调方 | 接口 | 见节 |
|---|---|---|---|
| web | api | HTTP + WebSocket | §HTTP、§WS |
| engine、web | roads | 静态 JSON 文件（随网页一起发布，线上不调接口） | §路网数据文件 |
| engine | api | 浏览器里的 `readSigns()`（背后是 `POST /api/read`） | §路人读数 |
| web | engine | 浏览器里的 `evaluate(方案)`（草案，T4 定稿） | §evaluate |

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

D-0929-1430：大模型只「读懂」屏上的字，比例由引擎算。T5 在 `apps/api/public/js/reader.js` 导出 `readSigns(请求) → Promise<读数>`，引擎只调这一个函数。背后按顺序：随网页发布的答案文件 → `POST /api/read`（Cloudflare Worker，先查 KV）→ 大模型 → 任何一步失败都用关键词规则（`src: "rule"`）。

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

- `persona` ∈ `commuter / local / tourist / delivery`；`signs` 按经过的先后顺序；`read_s` 是引擎按「可读距离 ÷ 车速」算好的秒数
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

## evaluate（engine → web，草案）

T4 在 `apps/engine/public/js/` 导出 `evaluate(方案, { seed }) → 结果`：纯函数，同样输入同样结果，目标单次 100 毫秒以内（设备边际价值、时间窗这类功能要反复调它）。结果至少有每类人的总延误（人·分钟）和人均延误、各路段的流量 / 延误 / 排队。字段 T4 开工后定稿写进这里。

## HTTP API

| 方法 + 路径 | 请求 | 响应 | 负责模块 |
|---|---|---|---|
| `GET /api/health` | — | `{ "ok": true, "v": "<版本>", "mock": bool }` | api |
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
| v2 | 2026-09-29 | 加「路人读数」（api → engine，D-0929-1430）和「evaluate」草案（engine → web） | lead |
| v1 | 2026-09-29 | 加「路网数据文件」一节（roads → engine、web）；HTTP / WS 节还是模板预置，T5 定了再改 | lead |
| v0 | 2026-09-26 | 模板预置：health / create / ws 骨架 | lead |
