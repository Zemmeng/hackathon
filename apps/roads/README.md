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

第二期（需求 `PRD-2.md`，@jinmingq 写，在他的分支 `jinmingq/roads/T3-phase2-prd`）：

```bash
python3 apps/roads/tools/build_equipment.py                      # → public/cbd/equipment.json（清单写在脚本里）
python3 apps/roads/tools/fetch_gtfs.py                           # GTFS 电车 3/、市区巴士 4/ → raw/gtfs/（约 105 MB，一两分钟）
apps/roads/.venv/bin/python apps/roads/tools/build_transit.py    # → public/cbd/transit.json（约 20 秒）
```

`transit.json`（服务日 工作日 2026-09-29、周六 10-03）：电车 22 条、巴士 25 条，站点 182 个；走向对上机动车路网的长度 90.6%。核对（09-29）：
- 电车线路用到的 285 条路段里 98% 在 `network.json` 标了 `tram`（顺带验证第一期的电车标记）
- 96 路有 1.3–1.6 km 对不上机动车路网，正是 Bourke St Mall 只走电车的段（`offnet_m`）
- La Trobe St 上挂着 30、35、86 路；19 路工作日高峰每小时 13 班、96 路 10 班
- 12 个站点 30 米内没有机动车路段（`road_link: null`），多在电车专用段上

```bash
apps/roads/.venv/bin/python apps/roads/tools/fetch_osm.py --walk # OSM 行人路网 → raw/（主站拒连就加 --overpass <镜像>）
B=https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets
curl -sS -G "$B/pedestrian-counting-system-monthly-counts-per-hour/exports/csv" --data-urlencode "where=sensing_date>=date'2026-08-01' and sensing_date<=date'2026-09-27'" -o apps/roads/raw/peds.csv
curl -sS "$B/pedestrian-counting-system-sensor-locations/exports/csv" -o apps/roads/raw/ped_sensors.csv
apps/roads/.venv/bin/python apps/roads/tools/build_walk.py       # → public/cbd/walk.json、peds.json（约 5 秒）
```

`walk.json` 用 OSM（09-29 查：CBD 人行道 77 km 是单独画的 `footway=sidewalk`，只挂在道路 `sidewalk=*` 标签上的只有 3 km，所以不用 City of Melbourne 的 Pedestrian Network）。节点 5198、路段 6802（人行道 1948、人行横道 988、小路 1808、沿车行道 1844、步行街 214）。人行道 92% 挂上了车行道，其中 82% 在那个方向的左边。

`peds.json`：bbox 内 71 个传感器（70 个挂上人行道），2026-08-01..09-27，工作日 39 天、周末 18 天。核对：Swanston St `Swa148_T` 工作日 17 点平均 1938 人（PRD-2 参考 09-27 周六 17 点 1626）；最忙的是 Collins St `Col620_T` 17 点 3299 人。

| method | 怎么算 | 条数 |
|---|---|---|
| `sensor` | 传感器挂的那条人行道，8 周分小时平均 | 67 |
| `street_interp` | 同名街道 800 m 内最近的传感器 | 1825 |
| `class_default` | 所挨车行道等级的传感器中位数；不挨车行道的小路取全部传感器 25 分位 | 4910 |

`equipment.json`：16 种设备（护栏 3、静态标志 9、VMS 2、箭头板 1、行人临时信号灯 1）。规格抄自 RPM Hire 官网产品页（每项 `url`，2026-09-29 查）；**`qty`、`day_rate_aud` 全是假设**（官网没有公开价格），列在每项的 `assumed` 里。标志编号只填查实的 T1-1、T2-16，其余 `null`。RPM 官网没有静态标志牌的产品页。

VMS 每行 **10** 个字符（`chars_per_line`），和 T5 的 `readSigns()` / `/api/read` 一致（超了回 400）。RPM 官网同一页前后不一致：FAQ 写「12-13 characters per line up to 4 lines」，文案指南写「Up to 10 characters per line (including any spaces)」「Ideally, 3 lines of text and 8 characters per line」、每屏停 2 秒（闪烁 3 秒）——取 10，推荐值放在 `lines_recommended` / `chars_recommended` / `seconds_per_screen`。第一版误取了 FAQ 的 12，@jinmingq 在 #14 指出（09-29）。

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
curl -sS -G "$B/buildings-with-name-age-size-accessibility-and-bicycle-facilities/exports/csv" --data-urlencode "where=year(census_year)=2024 and latitude>=-37.8235 and latitude<=-37.8060 and longitude>=144.9480 and longitude<=144.9760" --data-urlencode "select=census_year,building_name,predominant_space_use,number_of_floors_above_ground,latitude,longitude" -o apps/roads/raw/com_buildings_clue.csv
apps/roads/.venv/bin/python -u apps/roads/tools/fetch_buildings.py   # 第一次拉 OSM（逐行打印在试哪台服务器），之后只用 raw/ 重算；--refresh 重新拉
```

结果（09-29）：2508 栋，910 KB；用途 office 395、residential 488、public 301、retail 200、education 98、hotel 90、parking 35、other 901（36%；只用 OSM 时 1898、76%）；用途来源 OSM 610、普查 997、没有 901；2065 栋有 30 m 内的临街路段（每栋最多记 4 条）。

- 来源：OSM `building=*`（轮廓、名字、用途，ODbL）+ City of Melbourne「2018 Building Footprints」（高度，CC BY，5923 块）+ City of Melbourne「Building information」CLUE 普查 2024 年（用途、地上层数，CC BY）
- 用途：OSM 标签能判断的优先（`amenity` / `shop` / 具体的 `building` 值）；OSM 只有 `building=yes` 这类判成 other 的，用代表点落在楼内的普查记录的 `predominant_space_use`（多条取最多的），按 `CLUE_USE` 关键词映射。`Student Accommodation` 归住宅、`Commercial Accommodation` 归酒店；空置、在建、仓储、设备间、批发、制造留在 other。OSM 没有楼层数的也用普查的 `number_of_floors_above_ground` 补
- **高度优先级和 issue #21 写的不同：市政实测 → OSM `height` → OSM 楼层 × 3.2 → 默认 12 m。** 原因：CBD 高楼在 OSM 里外轮廓的 `height` 常只是裙楼、塔楼另画成 `building:part`——Eureka Tower OSM 20 m、市政 298 m（实际约 297 m）；Rialto Towers OSM 20 m、市政 249 m（实际约 251 m）。297 栋两边都有高度的楼，相对差中位数 14%，差 2.5 倍以上的 24 栋基本都是这种裙楼 / 塔楼情况
- 市政高度 = 代表点落在这栋 OSM 楼里的各部分 `footprint_max_elevation` 最大值 − `structure_min_elevation`（楼顶海拔 − 地面海拔）；市政数据是 2018 年的，之后新建的楼走 OSM 或默认值
- 高度来源：市政 2108、OSM height 30、OSM 楼层 32、默认 338（非默认 87%）
- 跨 bbox 边界的楼不要（验收要求所有点在 bbox 内）；只取外轮廓，天井不要；轮廓抽稀约 0.5 m
- 测试单独放 `tests/test_buildings.py`（不并进 `test_roads.py`，免得和 T7 的 PR #14 冲突）

## 天气回测（T31，需求见 `docs/arch/T31-weather-backtest-PRD.md`）

```bash
python3 apps/roads/tools/fetch_weather.py       # Open-Meteo 逐小时天气 → public/cbd/weather_hourly.json（免费、不要 key；日期默认按 raw/ 里的交通数据定）
python3 apps/roads/tools/backtest_weather.py    # → public/cbd/weather_backtest.json（约 20 秒）
```

前置：SCATS 原始数据（`fetch_scats.py --range 2026-08-01..2026-09-27`）、行人计数 `raw/peds.csv`（见上面 T7 的 curl），以及 **BoM 逐日观测手动下载**到 `raw/`（`IDCJDW3033.202608.csv`、`IDCJDW3033.202609.csv`，浏览器打开 `https://www.bom.gov.au/climate/dwo/2026MM/text/IDCJDW3033.2026MM.csv`；BoM 不支持自动抓取，© Commonwealth of Australia，不提交）。

**结论**（2026-08-01..09-27，剔除 09-21..09-27 学校假期周；BoM 核过的湿小时 vs 同一星期几同一小时的晴天中位数）：
- 车：下雨（≥ 0.1 mm/h，13 天）白天车流 **0.997 [0.989, 1.005]**，≥ 1 mm/h（4 天）0.998——8 周里看不出变化；饱和进口高峰最大 15 分钟流量早高峰 0.979 [0.971, 0.986]（上限）
- 自行车（2921 的 4 个检测器）：0.924 [0.861, 0.986]；安慰剂平均 0.966，方法对自行车约偏低 3%，所以实际约 −5%
- 行人（5 个计数器）：0.875 [0.813, 0.933]；≥ 1 mm/h 时 0.681 [0.50, 0.91]；08-10 周一早高峰（BoM 24.4 mm）行人 0.44、自行车 0.78、车 1.00
- 页面 `WXP`：雷暴 `rate .9` 对车过强、对行人偏弱，一个共用的 `rate` 表达不了；`T 1.4`（通行能力 ×0.71）远强于实测（×0.98）；雾（仅模型）车流反而 +3%（雾多在无风晴冷的早上，不是因果）；内涝、高温、大风这 8 周没有样本

口径和坑：
- 数据：天气 Open-Meteo `ecmwf_ifs`（**Weather data by Open-Meteo.com**，CC BY 4.0）；核对 BoM 墨尔本 Olympic Park；车流 DataVic SCATS；行人 City of Melbourne
- Open-Meteo 格点在 CBD 西北约 3 km（-37.786, 144.940）；模型的雨点时间对不准：模型报雨但 BoM 那 24 h < 0.2 mm 的 33 小时算误报（例 08-19 早上），不当雨天用
- 时间对齐：交通第 h 小时对 Open-Meteo T = h+1（T 的降水是前一小时累计）；拿自行车雨天效应核对，T = h / h+1 / h+2 三种差别在区间内，核不出哪种更对
- 基线按**星期几**分：只分工作日 / 周末时安慰剂偏低 4–11%（全天晴的日子里周日多，周一比周二到周四低约 6%）；安慰剂用「留一天」基线，和真雨天对称
- 每天取基线加权中位数的 log 比，再对天平均；95% 区间按天重抽样 2,000 次；`n_days < 3` 不给数
- 没有速度、占有率数据：`WXP` 的 `v` `ped` `bike` `b` `wob`（速度 / 减速 / 摇摆）测不了；通行能力近似把「车少了」和「开慢了」混在一起，只当上限
- `car` 用全 CBD 540 个车道检测器（按流量启发式挑，没逐个核车道）；`car_2921` 用配置表核过的 3 个检测器，结论一致

## 对外接口

静态文件，格式见 `docs/contract.md`「路网数据文件」一节（和 `PRD.md` 第 5 节一致）。线上和本地都从 `/roads/public/cbd/<文件>` 读。`buildings.json` 格式是 issue #21 第 5 节的草案 v1，契约那一行由 lead 加。

## 外部 API

不调接口，全是提前下载的公开数据，来源和坑见 `PRD.md` 第 6 节。不需要任何 key。

⚠️ **许可**：`public/cbd/` 下的 `network.json`、`walk.json`、`buildings.json` 由 OpenStreetMap 衍生，按 **ODbL 1.0 share-alike** 分发，**不是 MIT**（署名「© OpenStreetMap contributors」）。要再分发这些文件，得连许可一起给。其余数据和代码的许可见 `docs/submission.md` 与根 `README.md`。

## 结构

| 文件 | 一句话 |
|---|---|
| `PRD.md` | T3 的需求说明 |
| `public/cbd/` | 生成的 `network.json`、`flows.json`、`signals.json` |
| `tools/fetch_scats.py` | 远程抽 SCATS 一天 / 站点表 / 单个路口配置表 |
| `tools/fetch_osm.py` | 拉 OSM 机动车路网（不简化）和电车轨道到 `raw/` |
| `tools/build_network.py` | 生成 `network.json` + `signals.json` |
| `tools/build_flows.py` | 生成 `flows.json`（只用标准库） |
| `tools/build_equipment.py` | 生成 `equipment.json`（设备清单和来源写在脚本里） |
| `tools/fetch_gtfs.py` | 从 GTFS 总包里只抽电车、市区巴士两个子包 |
| `tools/build_transit.py` | 生成 `transit.json`：线路走向对到有向路段、每小时班次、站点 |
| `tools/fetch_weather.py` | Open-Meteo 逐小时天气 → `weather_hourly.json`（只用标准库） |
| `tools/backtest_weather.py` | 天气回测 → `weather_backtest.json`（只用标准库） |
| `tests/test_weather.py` | 天气两个文件的校验和反向断言 |
| `tools/build_walk.py` | 生成 `walk.json` + `peds.json`：人行道挂车行道和左右、传感器挂人行道、插值 |
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
- GTFS 总包里的子包是压缩存放的，不能再往里 Range，只能整个子包下（电车 14 MB、巴士 87 MB）；子包编号 3 电车、4 市区巴士，按 `routes.txt` 的 `route_type` 核对过
- Overpass 主站偶尔拒连、镜像 180 秒读超时：`fetch_osm.py` 超时已放到 300 秒，可用 `--overpass` 换镜像（09-29 kumi 超时，主站重试成功）
- `walk.json`、`peds.json` 离 2 MB 上限不远（1.7 / 1.8 MB；`apps/<模块>/public/` 下的 .json 上限 2MB 见 D-0929-1430，其余文件仍 1MB）：已去掉室内通道、停车场过道、私家车道（约 700 条）；换更大的街区要先看体积，超了的备选是 peds 改成「曲线表 + 路段引用」（只有 77 种不同曲线）
- `fetch_scats.py` 远程读 zip 时缓冲要大（4 MB）：每次读都是一次 HTTPS Range 请求，64 KB 时一天要 2 分钟，4 MB 时几秒
- 双向有中央隔离带的路（如 La Trobe，电车在中间）在 OSM 里是两条单行道，一个路口由 2–4 个节点组成；这些节点都标同一个站点号，节点之间的连接段不算进口，走插值
- 2921 的 3 号检测器（Swanston 南行左转）挂不上：OSM 机动车路网里没有 Swanston 从北往南进这个路口的路段
