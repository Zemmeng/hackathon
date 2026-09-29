# roads —— CBD 真实路网和真实车流，整理成路网引擎能直接读的 JSON
Owner: @louisxie316-dotcom

任务 T3。**先读 `PRD.md`**：要交什么、文件格式、数据从哪来、验收标准、时间盒都在里面。

## 怎么跑

第一次：`python3 -m venv apps/roads/.venv && apps/roads/.venv/bin/pip install -r apps/roads/requirements.txt`（`.venv/` 已 gitignore）

```bash
python3 apps/roads/tools/fetch_scats.py --sites                  # 站点表 → raw/
apps/roads/.venv/bin/python apps/roads/tools/fetch_osm.py        # OSM 路网 + 电车轨道 → raw/（约 30 秒）
apps/roads/.venv/bin/python apps/roads/tools/build_network.py    # → public/cbd/network.json、signals.json（约 2 秒）
python3 apps/roads/tools/fetch_scats.py --range 2026-08-01..2026-09-27   # SCATS 8 周 → raw/（约 270 MB、30 分钟，抽过的天跳过）
python3 apps/roads/tools/build_flows.py                          # → public/cbd/flows.json
```

`flows.json` 里每条路段的 `method`：

| method | 怎么算 | 准不准 |
|---|---|---|
| `detector_map` | 站点在 `build_flows.py` 的 `DETECTOR_MAP` 里、进口朝向对得上：直接用那几个检测器之和 | 最准；目前只有 2921 |
| `site_split` | 终点是有 SCATS 数据的路口：车道数 × 该路口「车道检测器」的平均每小时流量（信号灯检测器基本一车道一个；车道检测器 = 日流量 ≥ 路口最大检测器的 50%） | 量级对；比实测车道偏低约 1/3 |
| `street_interp` | 同名街道上下游相邻路段的每车道流量平均 × 本段车道数，沿街传 | 中 |
| `class_default` | 同道路等级已测路段每车道流量的中位数 × 车道数 | 最粗；多是没信号灯的小街和没名字的转弯匝道 |

核对（09-29，8 月 1 日–9 月 27 日，工作日 38 天、周末 18 天）：
- 2921 东行进口（`detector_map`，7 号检测器）工作日 16–18 点 400–453 辆 / 小时，sim 实测约 450
- 工作日 17 点每车道流量中位数：`detector_map` 431、`site_split` 277、`street_interp` 296、`class_default` 282
- 工作日高峰 v/c 中位数 0.25、95 分位 0.57；超过通行能力的路段 5 条
- 测试守住的：`site_split` 和 `detector_map` 每车道中位数相差不超过 2 倍；超过通行能力 1.2 倍的路段 ≤ 5%

换街区：三条都加同一个 `--bbox 南,西,北,东`，`build_network.py` 再加 `--area <名>`。

- 先看数据长什么样：`python3 apps/roads/tools/fetch_scats.py --day 2026-09-22`（远程只抽一天 CBD 的 SCATS 数据，约 4.6 MB，存到 `apps/roads/raw/`）
- 站点表：`python3 apps/roads/tools/fetch_scats.py --sites`
- 某个路口的检测器配置表：`python3 apps/roads/tools/fetch_scats.py --sheet 2921`

## 怎么测

`bash apps/roads/test.sh`。`public/cbd/` 下的文件还没生成时只做骨架检查；文件一出现，PRD 第 7 节的校验自动生效。

## 临街建筑 buildings.json（T11，需求见 issue #21）

```bash
B=https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets
curl -sS -G "$B/2018-building-footprints/exports/geojson" --data-urlencode "where=in_bbox(geo_point_2d, -37.8235, 144.9480, -37.8060, 144.9760)" -o apps/roads/raw/com_footprints_2018.geojson
apps/roads/.venv/bin/python -u apps/roads/tools/fetch_buildings.py   # 第一次拉 OSM（逐行打印在试哪台服务器），之后只用 raw/ 重算；--refresh 重新拉
```

结果（09-29）：2508 栋，910 KB；用途 other 1898、office 167、residential 147、retail 114、education 66、public 56、hotel 38、parking 22；2065 栋有 30 m 内的临街路段（每栋最多记 4 条）。

- 来源：OSM `building=*`（轮廓、名字、用途，ODbL）+ City of Melbourne「2018 Building Footprints」（高度，CC BY，5923 块）
- **高度优先级和 issue #21 写的不同：市政实测 → OSM `height` → OSM 楼层 × 3.2 → 默认 12 m。** 原因：CBD 高楼在 OSM 里外轮廓的 `height` 常只是裙楼、塔楼另画成 `building:part`——Eureka Tower OSM 20 m、市政 298 m（实际约 297 m）；Rialto Towers OSM 20 m、市政 249 m（实际约 251 m）。297 栋两边都有高度的楼，相对差中位数 14%，差 2.5 倍以上的 24 栋基本都是这种裙楼 / 塔楼情况
- 市政高度 = 代表点落在这栋 OSM 楼里的各部分 `footprint_max_elevation` 最大值 − `structure_min_elevation`（楼顶海拔 − 地面海拔）；市政数据是 2018 年的，之后新建的楼走 OSM 或默认值
- 高度来源：市政 2108、OSM height 30、OSM 楼层 32、默认 338（非默认 87%）
- 跨 bbox 边界的楼不要（验收要求所有点在 bbox 内）；只取外轮廓，天井不要；轮廓抽稀约 0.5 m
- 测试单独放 `tests/test_buildings.py`（不并进 `test_roads.py`，免得和 T7 的 PR #14 冲突）

## 对外接口

静态文件，格式见 `docs/contract.md`「路网数据文件」一节（和 `PRD.md` 第 5 节一致）。线上和本地都从 `/roads/public/cbd/<文件>` 读。`buildings.json` 格式是 issue #21 第 5 节的草案 v1，契约那一行由 lead 加。

## 外部 API

不调接口，全是提前下载的公开数据，来源和坑见 `PRD.md` 第 6 节。不需要任何 key。

## 结构

| 文件 | 一句话 |
|---|---|
| `PRD.md` | T3 的需求说明 |
| `public/cbd/` | 生成的 `network.json`、`flows.json`、`signals.json` |
| `tools/fetch_scats.py` | 远程抽 SCATS 一天 / 站点表 / 单个路口配置表 |
| `tools/fetch_osm.py` | 拉 OSM 机动车路网（不简化）和电车轨道到 `raw/` |
| `tools/build_network.py` | 生成 `network.json` + `signals.json` |
| `tools/build_flows.py` | 生成 `flows.json`（只用标准库） |
| `requirements.txt` | 只有 osmnx（带 networkx、geopandas、shapely） |
| `tests/test_roads.py` | 三个文件的校验 |
| `raw/` | 原始数据（已 gitignore，不提交） |

## 本模块固定模式

- 区域用 `--bbox` 参数传，不写死
- 路段 id 从 OSM id 派生，重跑时保持稳定
- 目录别叫 `data/`（仓库 `.gitignore` 忽略所有 `data/`）

- OSMnx 2.x 的 bbox 是 `(西, 南, 东, 北)`，本仓库 `--bbox` 是 `南,西,北,东`，脚本里转换
- OSMnx 默认把 Overpass 缓存写到**当前目录**的 `cache/`，在仓库根跑会越界（`check [3]` ❌）→ `fetch_osm.py` 已固定到 `raw/osm_cache/`
- 车道、自行车道在**不简化**的图上逐段算好再简化（简化后标签会混成列表）；澳洲靠左，双向路正向看 `cycleway:left`、反向看 `cycleway:right`

## 已知问题

- 只保留最大强连通块：CBD 默认 bbox 简化后 904 个节点，裁掉 99 个 bbox 边上开不出去的（09-29 13:50）
- `speed_kmh` 是路段内多个限速按时间加权的等效速度（`len_m / t0_s`），不一定是整数
- 路段车道数取沿途最小值（瓶颈）；约 190 条路段没有街名（多是转弯匝道）
- 151 个信号灯站点里 27 个在 30 米内没有节点（17 个行人灯 POS、5 个闪黄灯、5 个路口 INT），`node` 为 `null`
- SCATS 检测器不能按流量大小区分车 / 自行车 / 电车：2921 的 1 号是 Swanston 自行车检测器，一天 5500 次，和车道一样多 → `site_split` 用「车道检测器平均 × 车道数」，不用「路口总量按车道分摊」（后者会把自行车、电车全算成车，高估 2–3 倍）；也不能把所有检测器一起平均（电车、行人按钮流量小，会把每车道流量拉低到实测的 40%）
- `fetch_scats.py` 远程读 zip 时缓冲要大（4 MB）：每次读都是一次 HTTPS Range 请求，64 KB 时一天要 2 分钟，4 MB 时几秒
- 双向有中央隔离带的路（如 La Trobe，电车在中间）在 OSM 里是两条单行道，一个路口由 2–4 个节点组成；这些节点都标同一个站点号，节点之间的连接段不算进口，走插值
- 2921 的 3 号检测器（Swanston 南行左转）挂不上：OSM 机动车路网里没有 Swanston 从北往南进这个路口的路段
