# T10 底图数据 PRD：给 T2 网页的真实街景

> 负责人：@louisxie316-dotcom · 模块：`apps/roads/` · 分支：`louisxie316-dotcom/roads/T10-basemap` · 写于 2026-09-29 15:05（lead）
> 用的人：T2 @unicornnnnnny（`apps/web`）。决定依据：D-0929-1445（T2 主路径接回真路网）、D-0929-1505（本任务）。

## 1. 为什么

T2 页面（`apps/web/src/js/1-world.js`）的底图现在是合成的：
- 8 条街是手写的，宽度、人行道、电车和自行车道都是估的
- 楼的位置和高度用随机数生成（`buildWorld()` 里 `rng(20260929)`）
- 树、公园、广场也是随机的；只有州立图书馆、Melbourne Central 是手摆的

评审一眼就能看出街景是假的。这一单把这些换成真数据，T2 拿到文件就能替换 `STREETS` 和 `buildWorld()` 的输出。

## 2. 总规矩（和 `PRD.md` §9 一样，另加两条）

- 只改 `apps/roads/`；脚本放 `tools/*.py`，一条命令能重跑，范围用 `--bbox`，不写死；原始数据放 `raw/`（已 gitignore）
- 产物 `apps/roads/public/cbd/basemap.json`，**< 2 MB**（D-0929-1430）；不要 key，不花钱
- 🆕 **坐标用 T2 的局部米坐标**：原点 `lat -37.8098, lon 144.9652`，x 向东、y 向北，单位米，保留 1 位小数；文件头写 `origin`，方便核对。换算和 T2 的 `toLL()` 互逆：`x = (lon − 144.9652) × 111320 × cos(−37.8098°)`，`y = (lat + 37.8098) × 111320`
- 🆕 **能挂上路网的都挂**：街道段带 `network.json` 的 `link` id，人行道带 `walk.json` 的 id，电车站带 `transit.json` 的站点 id
- 估出来的数标 `method`，假设写进 `assumptions`，README 写清楚；数据源和许可写进 README「外部数据」节

## 3. P0：必须做（17:00 集成点交最小版，21:00 交全）

范围：先做 T2 页面的视窗（原点周围 x ±380 m、y ±360 m，比页面的 ±320 × ±300 m 多出 60 m 边），P1 再扩到整个 CBD bbox。

| 字段 | 内容 | 来源建议 |
|---|---|---|
| `streets[]` | 每条路段：`link`、`name`、中心线折线 `xy`、车行道宽 `carriage_m`、左右人行道宽 `foot_m`、`lanes`、`tram`、`bike` | `network.json` + `walk.json`；宽度优先用 OSM `width`，没有就按车道数 × 3.3 m 估并标 `method` |
| `buildings[]` | 轮廓多边形 `xy`、高度 `h_m`、`name`（有就填） | City of Melbourne 开放数据的建筑轮廓（有高度字段就用）；没有就用 OSM `building:levels × 3.2 m`，都没有按街区中位数估并标 `method` |

验收：
- T2 的 8 条街（La Trobe、Lonsdale、Little Lonsdale、Little La Trobe、A'Beckett、Swanston、Russell、Elizabeth）都在 `streets` 里，名字能对上
- State Library Victoria 和 Melbourne Central 在 `buildings` 里有名字、有高度
- `tests/test_roads.py` 加测试：文件 < 2 MB；每个 `streets[].link` 都在 `network.json` 里；坐标都在范围内；`h_m` > 0

## 4. P1：有时间再做

- `trees[]`：点位 `xy` + 冠幅 `canopy_m`（City of Melbourne 城市树木开放数据）
- `parks[]` / `plazas[]`：多边形（OSM `leisure=park`、`place=square`、`area:highway=pedestrian`）
- `stops[]`：电车站台多边形或点，带 `transit.json` 的站点 id
- 范围扩到整个 CBD bbox（和 `network.json` 一样），体积超了就分成 `basemap-core.json`（页面视窗）和 `basemap-cbd.json`

## 5. P2：给天气加分层（D-0929-1445 的第二层）

- 内涝：官方洪水 / 积水覆盖区多边形（City of Melbourne 或 Melbourne Water 的开放数据），带来源
- 找不到开放数据就跳过，别编

## 6. 交接

- 格式定稿后，lead 写进 `docs/contract.md`（roads → web）
- 交付时在 PR 里 @unicornnnnnny，写清楚 T2 替换 `STREETS` 和 `buildWorld()` 要读哪几个字段
