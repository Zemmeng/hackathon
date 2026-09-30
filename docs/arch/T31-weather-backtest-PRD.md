# T31：真实天气回测（PRD）

> 负责人：@louisxie316-dotcom（小谢）· 模块 `apps/roads` · 分支 `louisxie316-dotcom/roads/T31-weather-backtest`
> 写于 2026-09-30 10:03（lead）· 依据：lead 原话「给小谢在 github 发一个任务 就是让他去搞天气的数据……真实的天气数据回测一下试试看」
> 时间盒：**阶段 1 约 2h，09-30 16:00 前 PR 绿**；阶段 2 可选，20:00 前。功能冻结 10-01 06:00，页面要不要换成实测数，lead 看完你的结果再定
> 花费：0（Open-Meteo 免费、不要 key）

## 1. 为什么做

- 页面上的 6 种天气（晴 / 雷暴 / 内涝 / 浓雾 / 高温 / 大风）只在第 2 步路口微观仿真里起作用，倍数写死在 `apps/web/src/js/4-sim.js:14-20` 的 `WXP`，**都是编的**，所以页面标着「示意」（D-0929-2012）。引擎（`apps/engine`）完全不管天气
- 评委问「下雨会怎样」「这些数哪来的」时答不上。你手上已经有 2026-08-01..09-27 的 SCATS 和行人计数（T3、T7），配上同期的真实逐小时天气，就能回测：**墨尔本 CBD 真下雨的时候，车、自行车、行人实际少了多少，通行能力掉了多少**，再和 `WXP` 对一下

`WXP` 每个字段乘的是什么（lead 读过代码）：

| 字段 | 乘的是什么（`4-sim.js` 行） | 能不能用你的数据回测 |
|---|---|---|
| `rate` | 所有入口的到达率，**车 / 自行车 / 行人共用一个**（:98） | 能：SCATS 车流、2921 号 1 号检测器（Swanston 自行车）、行人计数 |
| `T` | 车的跟车时距（:137），决定通行能力 | 只能近似：饱和进口高峰 15 分钟最大车道流量，晴 vs 雨 |
| `v` `bike` `ped` | 车 / 自行车 / 行人的**速度**（:92 :126 :144） | 不能：SCATS 只有流量，没有速度、占有率、饱和度 |
| `b` `wob` | 减速度 / 自行车摇摆（:137 :101） | 不能 |

现在的值：雷暴 `rate .9`（全体 −10%）`T 1.4`；内涝 `rate .75`；雾 `rate .85` `T 1.7`；高温 `rate .8`；大风 `rate .85`。

## 2. 数据（lead 的 agent 09-30 09:55 实测过，照这个取）

### 2.1 天气：Open-Meteo 历史接口（免费、不要 key、CC BY 4.0）
```
https://archive-api.open-meteo.com/v1/archive?latitude=-37.8136&longitude=144.9631
  &start_date=2026-08-01&end_date=2026-09-27
  &hourly=precipitation,rain,temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code,visibility
  &timezone=Australia%2FMelbourne&models=ecmwf_ifs
```
- 返回 `hourly.time[]`（本地时间、不带时区，如 `2026-08-01T00:00`）和 `hourly.<变量>[]` 平行数组，缺值是 `null`。单位：mm、°C、km/h、能见度 m
- **一定要带 `models=ecmwf_ifs`**：默认模型的能见度全是 `null`；`era5` 晚 5 天、格点 0.25°
- 窗口里全是 UTC+10（夏令时 10-04 才开始）
- 降水在时间 T 的值是 T 之前那一小时的（Open-Meteo 文档说的，没独立验证），对到 SCATS 的小时时自己核一次
- 署名：`Weather data by Open-Meteo.com`（链接 https://open-meteo.com/）

### 2.2 核对：BoM 墨尔本（Olympic Park）逐日观测
- `https://www.bom.gov.au/climate/dwo/202608/text/IDCJDW3033.202608.csv`（还有 `202609`）
- **BoM 明说不支持自动抓取**：用浏览器手动下这几个 CSV，放 `apps/roads/raw/`（已 gitignore），**不要写进脚本、不要提交**（版权 © Commonwealth of Australia）
- latin-1 编码；日期不补零（`2026-08-1`）；`Rainfall (mm)` 是「前一天 9 点到当天 9 点」的 24 小时雨量

### 2.3 车流 / 自行车：SCATS 原始数据（不能用 `flows.json`）
- `flows.json` 只有工作日 / 周末 × 24 小时的平均，没有逐日数据，回测必须用原始数据：`python3 apps/roads/tools/fetch_scats.py --range 2026-08-01..2026-09-27`（你本机的 `raw/` 可能还在）
- 一行 = 一个路口的一个检测器的一天，`V00..V95` 是 96 个 15 分钟流量，负数是故障 → 那一小时丢掉（`build_flows.py` 就是这么做的）
- 建议的路口：2921 Swanston/La Trobe（1 号 = Swanston 自行车检测器，约 5,500 次 / 天；5、7 号是车道）、2903 Russell/Lonsdale、2902 Exhibition/Lonsdale、2935 Lonsdale 近 Swanston（路段行人灯，只有 2 个检测器，适合做通行能力近似）。除 2921 外，检测器对应哪条车道没核过，要说「Lonsdale 西行」先 `fetch_scats.py --sheet <站点>` 查
- 2921 在 09-28 的 07–10 点整段缺数

### 2.4 行人：City of Melbourne 逐小时计数
- 和 T7 同一个接口（`apps/roads/README.md` 里的 `pedestrian-counting-system-monthly-counts-per-hour`），数据滚动保留两年（2024-09-30 起）
- 演示附近的计数器：`Swa295_T`、`Lat224_T`、`Swa330_T`、`Lon364_T`、`Lon189_T`（这个窗口缺 86 小时）

## 3. 这个窗口能回测什么（先看清楚，别硬凑）

lead 的 agent 用上面的接口数过（`ecmwf_ifs`，2026-08-01..09-27）：

| 天气 | 小时数 | 能不能回测 |
|---|---|---|
| 有雨（≥ 0.1 mm/h） | 共 205 h；工作日高峰（07–10、16–19）29 h | 能，但效应小，要把所有白天小时放在一起算 |
| 中雨（≥ 1 mm/h） | 共 41 h；工作日高峰 6 h，只有 **08-10 周一早上**被 BoM 证实（24.4 mm）；**08-19 周三早上是模型误报**（BoM 0 mm） | 只能做个案 |
| 大雨（≥ 4 mm/h） | 2 h，都在半夜 | 不能 |
| 高温 ≥ 30 °C | 0 h（BoM 最高 28.5） | 这个窗口不能 |
| 大风（阵风 ≥ 60 km/h） | BoM 实测 0 天（最大 59）；模型说 5 天，不可信 | 这个窗口不能 |
| 雾（能见度 < 1 km） | 模型 32 h，如 08-17 周一 07–09 点 120–160 m；没有实测能见度可以核 | 只能个案，标「仅模型」 |

两个来源都认的工作日大雨天（≥ 5 mm）：**08-10 周一、08-25 周二**。

## 4. 做法

### 阶段 1（必做，约 2h）：8 周窗口，雨天 vs 晴天
1. `tools/fetch_weather.py`：拉 2.1 的逐小时天气 → `public/cbd/weather_hourly.json`（带 `source`、`licence`、`attribution` 字段；1,344 行，很小）
2. `tools/backtest_weather.py`：
   - **每小时分类**：`dry` = 本小时和前 2 小时都是 0 mm，且 BoM 当天雨量 < 1 mm；`wet` = ≥ 0.1 mm；`rain` = ≥ 1 mm；`fog` = 能见度 < 1000 m（标 `model_only`）。其余小时不进任何一类
   - **剔除的天**：09-25（公众假期，`build_flows.py` 的 `HOLIDAYS` 已有）、09-26（AFL 总决赛），维州学校假期查一下日期（大概 9 月下旬），剔除或单独算。剔除清单写进输出
   - **基线**：每个检测器（或计数器）× 工作日 / 周末 × 小时，只用 `dry` 小时取中位数
   - **效应**：`wet` / `rain` 小时的流量 ÷ 基线，按交通方式（车 / 自行车 / 行人）分开汇总（按基线流量加权的对数比均值），**95% 区间按「天」重抽样**（同一天的小时相关，不能按小时抽）
   - **通行能力近似**（对应 `T`）：选高峰时接近饱和的进口（例如晴天高峰 15 分钟流量前 10%），比较雨天和晴天高峰的最大 15 分钟车道流量。这个数把「车少了」和「开得慢了」混在一起，**只当上限**，写明
   - **个案**：08-10 周一 07–10 点、08-25 周二、08-17 周一的雾（仅模型），逐小时列车 / 自行车 / 行人相对基线的比，附 BoM 当天雨量
   - **安慰剂检验**：随机挑晴天当「假雨天」跑同一套算法，比值的区间应该包含 1.0。不包含说明方法有偏，先修方法
3. 输出 `public/cbd/weather_backtest.json`（键名 ASCII）：
```json
{
  "version": 1, "window": ["2026-08-01", "2026-09-27"],
  "sources": {"weather": "...Open-Meteo ecmwf_ifs...", "check": "BoM IDCJDW3033", "traffic": "DataVic SCATS", "peds": "City of Melbourne"},
  "excluded_days": [{"date": "2026-09-25", "why": "public holiday"}],
  "classes": {"dry": "...", "wet": "precip >= 0.1 mm/h", "rain": ">= 1 mm/h", "fog": "visibility < 1000 m (model only)"},
  "results": [{"cls": "wet", "mode": "car", "period": "day", "ratio": 0.98, "ci95": [0.95, 1.01], "n_days": 14, "n_hours": 120, "n_sensors": 9}],
  "capacity_proxy": [{"site": "2935", "period": "am", "ratio": null, "ci95": null, "n_days": 1, "note": "sample too small"}],
  "cases": [{"date": "2026-08-10", "hours": "07-10", "rain_mm_h": [2.1, 1.3, 1.2], "bom_daily_mm": 24.4, "car": 0.97, "bike": 0.7, "ped": 0.9}],
  "placebo": {"ratio": 1.0, "ci95": [0.98, 1.02], "n_days": 10},
  "wxp_compare": [{"wxp": "storm.rate", "current": 0.9, "measured": "car 0.98 [0.95, 1.01]; bike ...", "literature": "Melbourne car -1.35..-3.43% (Keay & Simmonds 2005)", "verdict": "too_strong"}]
}
```
   上面的数都是**格式示例，不是答案**。`n_days < 3` 的格子 `ratio` 和 `ci95` 写 `null`，`note` 写原因，**不许编数**。`verdict` 只能是 `ok` / `too_strong` / `too_weak` / `wrong_direction` / `untestable` / `no_sample`
4. `apps/roads/README.md` 加「天气回测」一节：怎么跑（两条命令）、数据来源和署名、**结论不超过 5 行**、局限（Open-Meteo 格点在 CBD 西北 3–4 km；模型的雨点时间对不准，要拿 BoM 核；没有速度数据）

### 阶段 2（可选，阶段 1 合了还有时间）：拉长窗口，补高温、大风、大雨
- SCATS 月包从 2025-01 到 2026-09 都有（`fetch_scats.py --range` 能直接用；2024 年及以前是年包套月包，脚本不支持，不用碰），行人数据从 2024-09-30 起
- 按天挑样本：BoM 最高温 ≥ 35 °C 的工作日、BoM 阵风 ≥ 60 km/h 的工作日、BoM 雨量 ≥ 10 mm 的工作日，每个配 2 个同星期几、前后 2 周内的晴天当对照。BoM 的月 CSV 手动下
- 先打一条 2025-01 的 Open-Meteo 请求，确认 `ecmwf_ifs` 能取那么早；跨夏令时切换日（2025-10-05、2026-04-05）检查 `CT_RECORDS`，确认 `V00` 是本地 0 点
- 结果并进同一个 `weather_backtest.json`（`window` 改成实际范围，`cls` 加 `heat` / `wind` / `heavy_rain`）

## 5. 拿来对照的文献（写进 `wxp_compare.literature`，数只写你算出来的）

| 对照 | 文献里的范围 | 出处 |
|---|---|---|
| 雨天车流量（墨尔本） | 湿天日交通量 −1.35%～−3.43% | Keay & Simmonds 2005, *Accident Analysis & Prevention* 37(1):109–124, doi:10.1016/j.aap.2004.07.005 |
| 雨天骑车人数（墨尔本） | 小雨 −8～−19%，大雨 −13～−25% | Phung & Rose 2007, ATRF |
| 雨天 / 大风骑车人数（墨尔本） | 小雨约 −13%，大雨约 −40%，强风约 −15～−20% | Ahmed, Rose & Jacob 2010, ATRF |
| 雨天信号灯路口饱和流率 | 干线 −2～−21% | FHWA Road Weather Management |
| 大雨通行能力（快速路） | −10～−17%；低能见度 −12% | Agarwal, Maze & Souleyrette 2005 |
| 行人 | 冷 / 降水让步行量少不到 20%（美国小镇，墨尔本没找到） | Aultman-Hall, Lane & Lambert 2009, TRR 2140 |
| 高温 | 高温让交通量**上升**（比利时） | Cools, Moons & Wets 2010, *Weather, Climate, and Society* |

按文献，`WXP` 大概偏在这几处（**你的回测来证实或推翻**）：雷暴 `rate .9` 对车来说是墨尔本实测的 3–7 倍；自行车在雨里掉得比车多得多，一个共用的 `rate` 表达不了；高温 `rate .8` 方向可能反了。

## 6. 验收

- `bash apps/roads/test.sh` 全绿；`bash scripts/check.sh --quick` 无 ❌，**贴汇总行原文**
- 新测试里至少有这几条反向断言：
  - 基线里没有任何 `wet` / `rain` / `fog` 小时
  - `excluded_days` 里的日子不出现在任何结果和个案里
  - `n_days < 3` 的格子 `ratio` 是 `null`（没有样本就不给数）
  - `weather_hourly.json` 的小时数 = 天数 × 24，时间是本地时间
  - 安慰剂的 `ci95` 包含 1.0
- 个案里每个雨天都有 `bom_daily_mm`；08-19 早上标成模型误报，不当雨天用
- `public/cbd/` 下每个 JSON < 2 MB（D-0929-1430）
- PR 说明里放一张表：`WXP` 字段 → 现在的值 → 你测到的 → 文献 → 结论

## 7. 不做

- **不改 `apps/web`**（`WXP` 在高h的模块）。你觉得 `WXP` 该改成多少，写进交接单第 2 节，lead 看完再决定要不要在冻结前改页面、页面上的「示意」要不要改成「按 2026 年 8–9 月实测校准」
- 不改引擎（引擎不管天气，冻结前也不加）
- 不写脚本自动抓 BoM；不用付费接口；不提交原始 SCATS、BoM 文件
- 回测不出结果（区间太宽）也是结论：照实写「8 周样本下看不出车流有显著变化，区间 [a, b]」，**不许为了好看挑时段**
