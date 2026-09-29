# T3 路网数据 PRD

> 负责人：@louisxie316-dotcom · 模块：`apps/roads/` · 分支：`louisxie316-dotcom/roads/T3-network`
> 写于 2026-09-29 13:10（lead）。有不清楚的先问 lead，别猜；改了本文件就在末尾「变更记录」加一行。

## 1. 一句话

把墨尔本 CBD 的**真实路网**和**真实车流**整理成三个 JSON 文件，让路网引擎（T4）直接读进来，算「封掉一段路以后，车往哪里绕、堵多久」；网页面板（T2）也用同一份路网在地图上画路段。

## 2. 在整个系统里的位置

整体流程见 `docs/2-plan.md`，图见 `docs/arch/`（先看「系统流程」那一页）。T3 是**第 4 步「算出影响」的输入**：

```
T3 roads（本任务）──静态 JSON──▶ T4 engine（算绕路和延误，在浏览器里跑）
                    └──────────▶ T2 web（地图上画路段、让用户选施工路段）
```

T3 的产物是**提前做好、随网页一起发布的静态文件**，线上不调用任何接口，也不需要任何 key。

## 3. 交付物

| 文件 | 内容 | 谁用 |
|---|---|---|
| `public/cbd/network.json` | 路网：路口（节点）和路段（有方向），每段的长度、车道、限速、通行能力 | T4、T2 |
| `public/cbd/flows.json` | 每条路段每小时的基础车流（工作日 / 周末各 24 个数） | T4 |
| `public/cbd/signals.json` | 区域内的 SCATS 信号灯路口，以及匹配到的节点 | T2（地图标注）、核对来源 |
| `tools/*.py` | 从原始数据生成上面三个文件的脚本，一条命令能重跑 | 以后换街区 / 更新数据 |
| `tests/test_roads.py` | 校验三个文件（已经按第 7 节写好，文件一出现就会自动校验） | `test.sh`、CI |
| `README.md` | 怎么重跑、数据来源、字段说明、坑 | 所有人 |

线上和本地的访问路径都是 `/roads/public/cbd/<文件>`（lead 的部署把每个模块的 `public/` 原样挂到 `/<模块>/public/`）。

## 4. 范围

**区域**：CBD 棋盘路网。默认范围（南, 西, 北, 东）= `-37.8235, 144.9480, -37.8060, 144.9760`，写成脚本参数 `--bbox`，**不要写死**：演示街区还没最终定，换街区只该是重跑一遍。

**做**：
- 机动车能走的路网（OSM `network_type="drive"`），每个方向一条路段
- 每条路段的车道数、限速、通行能力、自由流时间；有电车轨道、有自行车道的打标记
- 真实车流：DataVic SCATS 信号灯数据，2026-08-01 至 09-27，按工作日 / 周末分小时平均
- 信号灯路口和路网节点的对应

**不做**（别的任务或以后再说）：
- 路径规划、车流分配、延误计算（T4）
- 行人路网、公交线路（后面单独开任务）
- 界面（T2）

## 5. 文件格式（契约 v1，已写进 `docs/contract.md`「路网数据文件」一节）

加字段可以随时加；**改名、删字段、改单位要先找 lead**，并把 `version` 加 1。

### 5.1 `network.json`

```json
{
  "version": 1,
  "area": "cbd",
  "bbox": [-37.8235, 144.9480, -37.8060, 144.9760],
  "generated": "2026-09-29T16:30:00+10:00",
  "sources": ["© OpenStreetMap contributors (ODbL)"],
  "assumptions": { "sat_flow_vph_per_lane": 1800, "green_ratio_signal": 0.5, "default_speed_kmh": 40 },
  "nodes": [
    { "id": "n1", "lat": -37.8096, "lon": 144.9638, "osm": 12345678, "signal": "2921" }
  ],
  "links": [
    {
      "id": "l1", "from": "n1", "to": "n2",
      "name": "La Trobe Street", "highway": "primary",
      "len_m": 118.4, "lanes": 2, "speed_kmh": 40,
      "cap_vph": 1800, "t0_s": 10.7,
      "tram": true, "bike_lane": true,
      "osm_way": 987654,
      "geometry": [[-37.8096, 144.9638], [-37.8099, 144.9651]]
    }
  ]
}
```

| 字段 | 规则 |
|---|---|
| `nodes[].id` / `links[].id` | 字符串，唯一，**重跑时尽量稳定**（用 OSM id 派生，别用行号），T2 会拿它存用户选的施工路段 |
| `nodes[].signal` | 匹配到的 SCATS 站点号（字符串）；没有就 `null` |
| `links[]` | **有方向**：双向路拆成两条，`from → to` 就是车流方向 |
| `lanes` | 这个方向的车道数，≥ 1。OSM 双向路的 `lanes` 是总数：有 `lanes:forward` / `lanes:backward` 就用；没有就总数除以 2 向上取整；都没有按道路等级默认（primary / secondary 2，其余 1） |
| `speed_kmh` | OSM `maxspeed`；没有按 40（CBD 常见限速），写进 `assumptions` |
| `cap_vph` | 这个方向每小时最多通过多少辆车 = `lanes × 1800 ×`（终点是信号灯路口 ? 0.5 : 0.9）；两个系数写进 `assumptions` |
| `t0_s` | 自由流时间 = `len_m / (speed_kmh / 3.6)` |
| `tram` / `bike_lane` | 布尔。自行车道看 OSM `cycleway*` 标签；电车看同一条街上有没有 `railway=tram`（P1，做不完先全填 `false` 并在 README 里写明） |
| `geometry` | 从 `from` 到 `to` 的折线，`[纬度, 经度]`，保留 5 位小数就够 |

### 5.2 `flows.json`

```json
{
  "version": 1,
  "unit": "veh/h",
  "period": "2026-08-01..2026-09-27（去掉 08-31 缺数和 09-25 公众假期）",
  "days": {
    "wd": { "l1": [120, 80, "…共 24 个"] },
    "we": { "l1": [150, 110, "…共 24 个"] }
  },
  "method": { "l1": "site_split" },
  "coverage": { "links": 820, "measured": 310, "estimated": 510 }
}
```

- 每条 `network.json` 里的路段都要有 `wd`、`we` 两组，各 24 个非负数（下标 = 小时，0 = 00:00–01:00）
- `method` 标每条路段的数是怎么来的：`detector_map`（按配置表对到车道，最准）/ `site_split`（按路口总量分摊）/ `street_interp`（同一条街上下游插值）/ `class_default`（按道路等级的默认值，最不准）

### 5.3 `signals.json`

```json
{ "version": 1, "sites": [ { "site": "2921", "name": "SWANSTON/LATROBE", "type": "INT", "lat": -37.8096, "lon": 144.9638, "node": "n1", "dist_m": 6.2 } ] }
```

`node` 是匹配到的最近路网节点（30 米内），匹配不到填 `null`。

## 6. 数据来源和怎么拿

| 数据 | 入口 | 许可证 | 怎么拿 |
|---|---|---|---|
| 路网 | OpenStreetMap，用 Python 包 OSMnx | ODbL，页面要写「© OpenStreetMap contributors」 | `uv pip install osmnx` 或 `pip install osmnx` |
| 信号灯车流 | https://discover.data.vic.gov.au/dataset/traffic-signal-volume-data | CC BY 4.0 | 每月一个全州 zip（约 120–135 MB），8 月和 9 月两个；下到 `apps/roads/raw/`（已 gitignore） |
| 信号灯站点表 | https://discover.data.vic.gov.au/dataset/victorian-traffic-signals | CC BY 4.0 | 一个 CSV（约 300 KB），列 `SITE_NO, SITE_NAME, TYPE, MUNICIPALITY, LATITUDE, LONGITUDE` |
| 检测器配置表 | https://discover.data.vic.gov.au/dataset/traffic-signal-configuration-data-sheets | CC BY 4.0 | 按站点号段打包，一个包约 2 GB；**只按需抽单个路口**，用 `tools/fetch_scats.py --sheet <站点号>` |

**已经踩过的坑**（`apps/sim/README.md`「外部 API」一节有全文）：
- SCATS CSV：一行 = 一个站点的一个检测器一天；`V00`–`V95` 是 96 个 15 分钟时段；**负数 = 故障或缺失，当空值**；每个站点最多 24 个检测器
- 检测器号不带方向和车道，要对照配置表第 2 页的平面图；有的检测器是自行车、电车、行人按钮（Swanston/La Trobe 2921 的对应关系已经在 `apps/sim/tools/build_demand.py` 的 `DET` 里）
- 8 月的包缺 08-31；09-25 是公众假期；City of Melbourne 的站点 `MUNICIPALITY = MBN`
- 服务器支持 HTTP Range：`tools/fetch_scats.py --day 2026-09-22` 能远程只抽一天（约 4.6 MB），先用它看格式，再决定要不要下全量
- lead 本机已经有 8–9 月 CBD 131 个站点的抽取结果（40 MB CSV），需要可以找 lead 用网盘拿，省掉下载
- **别把目录叫 `data/`**：仓库 `.gitignore` 忽略所有 `data/`
- OSMnx 2.x 的 `graph_from_bbox` 参数顺序和 1.x 不一样：先打一条最小请求确认，别照网上旧例子猜

## 7. 验收标准（`tests/test_roads.py` 已经写好，文件出现就自动校验）

跑 `bash apps/roads/test.sh`，最后一行 `N passed, 0 failed` 才算过：

1. `network.json`：`version` 是整数；节点 id、路段 id 各自唯一；每条路段的 `from` / `to` 都是存在的节点
2. 每条路段 `len_m > 0`、`lanes ≥ 1`、`5 ≤ speed_kmh ≤ 110`、`cap_vph > 0`、`t0_s` 和 `len_m / 速度` 相差不超过 5%
3. 所有节点都在 `bbox` 内（允许外扩 300 米，边界路段会伸出去一点）
4. 路网连通：最大的「互相能开到」的节点群（强连通分量）至少占全部节点的 90%，否则 T4 绕路会找不到路
5. `flows.json`：每条路段都有 `wd`、`we` 各 24 个非负数；`coverage` 三个数对得上
6. 常识检查：名字含 La Trobe 的路段里，至少有一条工作日 17 点的车流在 100–2000 辆 / 小时之间（sim 里 Swanston 路口东行实测约 450）
7. `signals.json`：站点号唯一；`node` 要么是 `null`，要么是存在的节点
8. 三个文件各自小于 2 MB（网页要在手机上加载）

## 8. 步骤和时间盒

| 时间 | 做什么 | 交出什么 |
|---|---|---|
| 13:30–14:15 | 装 OSMnx，拉 CBD 路网，存 `raw/` | 能在 Python 里画出路网 |
| 14:15–15:30 | 写 `tools/build_network.py`：车道、限速、通行能力、自由流时间 → `network.json` | 测试 1–4 通过 |
| **17:00 集成点** | **先开 draft PR 交最小版 `network.json`**（没有车流也行），T4 马上能换成真路网 | draft PR |
| 17:00–19:00 | `tools/build_flows.py`：SCATS 站点匹配节点 → `signals.json`；按路口总量分摊到进口路段（`site_split`）→ `flows.json` | 测试 5–7 通过 |
| 19:00–20:30 | 没有检测器的路段：同一条街插值，还没有就按道路等级默认；README 写清每种方法 | `coverage` 数字 |
| **21:00 集成点** | PR 转正式，`check.sh --quick` 全绿，找 lead 合 | 合进 main |
| 加分（有时间再做） | 几个关键路口按配置表对到车道（`detector_map`）；电车轨道标记 | `method` 里 `detector_map` 的数量 |

## 9. 规矩提醒

- 只改 `apps/roads/`，外加 `docs/3-tasks.md` 自己那节；要改别处写进交接单第 2 节
- 原始数据放 `apps/roads/raw/`（已 gitignore），**不提交大文件**；`public/cbd/` 里只放生成的三个 JSON
- 每做完一步跑 `bash scripts/check.sh --quick`；开 PR 前贴汇总行
- 这个任务不需要任何 key，也不花钱
- 睡前或换人前写交接单（`handoff/README.md`）

## 10. 待定

- 演示街区可能从 CBD 改成别处：`--bbox` 参数化就够，不用现在考虑
- 行人路网、公交电车线路：后面单独开任务
- 通行能力的两个系数（1800、0.5）是常用经验值，T4 跑出来明显不对再一起调

## 变更记录

| 时间 | 谁 | 改了什么 |
|---|---|---|
| 09-29 13:10 | lead | 初版 |
