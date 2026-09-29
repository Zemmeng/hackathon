# T3 第二期 PRD：行人、公交、设备库存

> 负责人：@louisxie316-dotcom · 模块：`apps/roads/` · 分支：lead 分配任务号后开 `louisxie316-dotcom/roads/T<n>-…` · 对应 issue #11
> 写于 2026-09-29 13:55（@jinmingq 整理）。接在 `PRD.md`（第一期，PR #9）之后做。新文件格式是草案，定稿后由 lead 写进 `docs/contract.md`。
>
> **EN:** Phase 2 of T3. PR #9 covers vehicle traffic. The brief also names **pedestrians, public transport** and the **equipment inventory (barriers, signage, VMS)** — none of which has data yet. Please produce `equipment.json`, `transit.json`, `walk.json` + `peds.json` (P0), linked to `network.json` link ids. Same rules as `PRD.md` §9.

## 1. 为什么要补

题目原文：*"…knock-on effects on surrounding **traffic, pedestrians, and public transport** … using typical traffic **equipment inventory (barriers, signage, VMS boards)**…"*

PR #9 已经把「车流」做完了。另外两类影响（行人、公共交通）和设备库存目前**没有任何数据**：T4 算不了行人和公交受的影响，T2 的设备面板也没有设备清单。`PRD.md` §4 里写的「行人路网、公交线路（后面单独开任务）」就是这一单。

## 2. 总规矩（和 `PRD.md` §9 一样，只多一条）

- 只改 `apps/roads/`；脚本放 `tools/*.py`，一条命令能重跑，范围用 `--bbox`，不写死
- 原始数据放 `raw/`（已 gitignore），产物放 `public/cbd/`，**每个文件 < 2 MB**；不要 key，不花钱
- 🆕 **所有新文件都要挂到 `network.json` 的路段 id 上**（字段 `road_link`）。T4 封掉一段路时，要能直接查到这段路上的人行道、电车 / 公交线路和站点
- 时段和 `flows.json` 对齐：2026-08-01..09-27，工作日 `wd` / 周末 `we` 各 24 个数（下标 = 小时）
- 估出来的数都标 `method`，假设写进 `assumptions`，README 写清楚

## 3. P0：必须做（题目点名的三样）

| # | 文件 | 给谁用 | 预计 |
|---|---|---|---|
| A | `equipment.json` 设备库存 | T2 设备面板、T4 算设备效果、T5 VMS 字数 | 1h |
| B | `transit.json` 电车和公交 | T4 公交影响、T2 画线路和站点 | 2h |
| C | `walk.json` + `peds.json` 行人 | T4 行人绕行、T2 画人行道 | 2–3h |

### A. `equipment.json`：设备库存

题目的输入就是「常见设备库存」，用户靠它描述施工方案。每类设备都要说清楚**它在模型里起什么作用**。

```json
{
  "version": 1,
  "sources": ["RPM Hire 官网产品页（类型、规格）", "数量和日租价为假设"],
  "items": [
    { "id": "barrier_water", "category": "barrier", "name": "Water-filled barrier",
      "effect": "close", "can_close": ["lane", "footpath", "bike_lane"], "unit_len_m": 2.0,
      "qty": 200, "day_rate_aud": 0, "assumed": ["qty", "day_rate_aud"],
      "url": "https://www.rpmhire.com.au/products/water-filled-barriers/" },
    { "id": "sign_footpath_closed", "category": "sign", "name": "Footpath closed, use other side",
      "effect": "route_peds", "qty": 50, "day_rate_aud": 0, "assumed": ["qty", "day_rate_aud"] },
    { "id": "vms", "category": "vms", "name": "Variable Message Sign",
      "effect": "message", "lines": 3, "chars_per_line": 0, "qty": 6, "day_rate_aud": 0,
      "assumed": ["qty", "day_rate_aud"],
      "url": "https://www.rpmhire.com.au/products/variable-message-signs/" }
  ]
}
```
（示例里的数字只是占位，按官网规格填）

- `category` ∈ `barrier / sign / vms / arrow_board / ped_signal`
- `effect` 先用这 6 个值，要加先跟 T4 说：`close`（护栏围住 `can_close` 里的东西）、`route_vehicles`（车辆绕行指示）、`route_peds`（行人改道）、`warn`（前方施工一类的提前警告）、`message`（VMS 自由文案）、`control_crossing`（行人临时信号灯）
- **最少要有**：护栏 1–2 种；静态标志 5–6 种（Roadwork ahead、Lane closed、Detour 左 / 右 / 直行、Footpath closed use other side、Bike lane closed / Bicycles merge、End roadwork）；VMS；箭头板；行人临时信号灯。标志有标准编号（AS 1742.3 / AGTTM）就填 `code`
- 规格（护栏单节长度、VMS 几行、每行几个字）从 RPM 官网产品页抄：[设备总目录](https://www.rpmhire.com.au/) · [VMS](https://www.rpmhire.com.au/products/variable-message-signs/) · [箭头板](https://www.rpmhire.com.au/products/arrow-boards/) · [行人临时信号灯](https://www.rpmhire.com.au/products/pedestrian-portable-traffic-lights/) · [注水护栏](https://www.rpmhire.com.au/products/water-filled-barriers/)。官网**没有公开价格**：`qty` 和 `day_rate_aud` 用假设值，并列进 `assumed`
- 只记类型、规格和链接，**不要复制官网的图片和大段文字**

### B. `transit.json`：电车和公交

CBD 最关键的一点：**电车不能绕行**（在轨道上）。T4 要靠这份数据判断三件事：施工碰到电车线就是「线路中断」；电车和汽车混行的路段，拥堵会传到电车上；公交可以绕行，但会跳过站点。

- 数据：[DataVic「GTFS Schedule」](https://discover.data.vic.gov.au/dataset/gtfs-schedule)（CC BY 4.0，09-26 更新）。总包 275 MB，里面按交通方式各有一个 `google_transit.zip`，按 PTV 惯例 `3/` 是电车（18 MB）、`4/` 是市区巴士（104 MB），解压后看 `routes.txt` 确认。服务器支持 HTTP Range，可以照 `fetch_scats.py` 的做法只抽 `3/` 和 `4/`。火车不受路面施工影响，不做
- 选一个普通工作日和一个周六（避开公众假期），日期写进 `service_dates`

```json
{
  "version": 1,
  "sources": ["PTV GTFS Schedule (DataVic, CC BY 4.0), 2026-09-26"],
  "service_dates": { "wd": "2026-09-29", "we": "2026-10-03" },
  "routes": [
    { "id": "tram_96", "mode": "tram", "short": "96", "name": "…",
      "dirs": [ { "dir": 0, "headsign": "…", "links": ["l12", "l13"], "offnet_m": 0,
                  "stops": ["s1001", "s1002"],
                  "trips": { "wd": [0, 0, "…共 24 个"], "we": ["…共 24 个"] },
                  "geometry": [[-37.81, 144.96]] } ] }
  ],
  "stops": [ { "id": "s1001", "name": "…", "lat": -37.81, "lon": 144.96, "road_link": "l12", "routes": ["tram_96"] } ],
  "coverage": { "routes": 0, "stops": 0, "matched_len_pct": 0 }
}
```

- `links`：把 `shapes.txt` 的走向按顺序对到 `network.json` 的有向路段上（距离 15 m 内、方向一致）
- `offnet_m`：对不上机动车路网的长度，比如 Swanston St、Bourke St Mall 这类只走电车的段。这些段保留 `geometry` 给 T2 画，不用硬塞进 `links`
- `trips`：每小时、每个方向的班次数；`stops[].road_link`：站点所在的路段
- 平均载客人数放进 P1-E

### C. `walk.json` + `peds.json`：行人

**`walk.json`**：行人路网，不分方向。

```json
{
  "version": 1,
  "sources": ["© OpenStreetMap contributors (ODbL)"],
  "nodes": [ { "id": "w123", "lat": -37.81, "lon": 144.96 } ],
  "links": [ { "id": "wl1", "a": "w1", "b": "w2", "len_m": 35.2, "kind": "sidewalk",
               "crossing": null, "road_link": "l12", "side": "left",
               "geometry": [[-37.81, 144.96], [-37.8102, 144.9603]] } ]
}
```

- 首选 OSMnx `network_type="walk"`。**先看 CBD 里人行道是不是单独画成了线**：如果大多只是道路上的 `sidewalk=*` 标签，就改用 City of Melbourne 的 [Pedestrian Network](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-network/)（CC BY）。选了哪个写进 README
- `kind` ∈ `sidewalk / crossing / path / mall / other`；`crossing` ∈ `signal / zebra / uncontrolled / null`
- `road_link` + `side`：这段人行道挨着哪条有向路段、在它的左边还是右边。澳洲靠左行驶，所以双向路上挨着某个行车方向的人行道一般在那条有向路段的左边。T4 封「人行道」时就靠这个找到要断开的行人路段
- id 从 OSM id 派生，重跑保持稳定

**`peds.json`**：行人流量，格式和 `flows.json` 对齐。

```json
{
  "version": 1, "unit": "ped/h",
  "period": "2026-08-01..2026-09-27（同 flows.json）",
  "sensors": [ { "id": "45", "name": "Swa148_T", "lat": -37.8141, "lon": 144.9661, "walk_link": "wl88", "road_link": "l12" } ],
  "days": { "wd": { "wl88": [0, 0, "…共 24 个"] }, "we": { "…": [] } },
  "method": { "wl88": "sensor" },
  "coverage": { "links": 0, "measured": 0, "estimated": 0 }
}
```

- 数据：City of Melbourne 的 [Pedestrian Counting System（counts per hour）](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-monthly-counts-per-hour/) 和 [Sensor Locations](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-sensor-locations/)，都是 CC BY。09-29 核对过，数据已经更新到 09-28
- 直接用 API 导出这 8 周的数据，约 13 万行，不用下全量：
  ```
  curl -G "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/pedestrian-counting-system-monthly-counts-per-hour/exports/csv" \
    --data-urlencode "where=sensing_date>=date'2026-08-01' and sensing_date<=date'2026-09-27'" -o apps/roads/raw/peds.csv
  ```
- 列：`location_id, sensing_date, hourday, direction_1, direction_2, pedestriancount, sensor_name, location`。`pedestriancount` = 两个方向之和（抽查过几行）。CBD 附近这 8 周有数的传感器约 96 个
- `method` ∈ `sensor / street_interp / class_default`，意思和 `flows.json` 的一样

## 4. P1：加分，P0 做完再做

- **D. 路人比例要有依据**：T5 的 4 类路人比例（通勤 50%、本地人 25%、游客 10%、送货 15%）目前是拍脑袋的。能找到的依据：送货比例用 [Historical AADT](https://discover.data.vic.gov.au/dataset/historical-annual-average-daily-traffic-volume) 的重型车占比（到 2019 年，只覆盖主干道）。其余三类找得到公开来源就用，找不到就在 README 写「无来源，保留假设」。先和认领 T5 的人对一下，谁找都行
- **E. `params.json` 折算参数**：出行时间价值和车辆载客率用 [ATAP PV2 · Travel time](https://www.atap.gov.au/parameter-values/road-transport/3-travel-time)；电车和巴士每车平均载客人数用 [Monthly average patronage by day type and by mode](https://discover.data.vic.gov.au/dataset/monthly-average-patronage-by-day-type-and-by-mode) 除以班次数估算，写明方法。T4 用它把车·分钟换成人·分钟，pitch 用它把延误换成澳元
- **F. 车流校正**：就是 PR #9 写的下一步，多对几个路口的检测器配置表（`detector_map`），修正「每车道比实测偏低约 1/3」
- **G. `rules.json` 摆放规则**：提前警告距离、渐变段长度、行人临时通道最小宽度。来源 AGTTM / AS 1742.3，找得到原表就填，找不到写假设。T2 用它检查设备摆得合不合规

## 5. P2：有时间再做

- 轮椅：City of Melbourne 的 [Footpath steepness](https://data.melbourne.vic.gov.au/explore/dataset/footpath-steepness/)，标出太陡、轮椅走不了的绕行
- 自行车：SCATS 里有的检测器是自行车专用的（见 `PRD.md` §6），整理出来就是骑车的流量

## 6. 验收（加进 `tests/test_roads.py`，`bash apps/roads/test.sh` 全绿才算过）

1. 每个新文件：`version` 是整数，文件 < 2 MB
2. 引用完整：所有 `road_link`、`routes[].dirs[].links` 都是 `network.json` 里真有的路段；`walk_link`、`stops`、`routes` 之间的引用都存在
3. `peds.json` 和 `transit.json` 的每个 24 小时数组：长度 24，数都非负
4. `equipment.json`：id 唯一；`category` 和 `effect` 在上面的取值里；`barrier` 有 `unit_len_m > 0`；`vms` 有 `lines` 和 `chars_per_line`；每项都有 `qty ≥ 0`，假设过的字段都列进了 `assumed`
5. `walk.json` 连通：最大连通块 ≥ 90% 节点
6. 常识检查：
   - La Trobe St 的路段上至少挂着一条电车线路；电车线路用到的路段里，≥ 80% 在 `network.json` 里 `tram = true`（顺便验证 PR #9 的电车标记）
   - 所有传感器工作日最忙的那个小时，最大值在 500–10000 人 / 小时之间。参考：Swanston St 的 `Swa148_T` 09-27 17 点是 1626 人

## 7. 时间盒（建议，lead 可以调）

| 时间 | 交出什么 |
|---|---|
| PR #9 合进 main 后 | 从 main 开新分支 `louisxie316-dotcom/roads/T<n>-…`，先交 A（`equipment.json`），T2 马上能做设备面板 |
| 21:00 集成点 | B（`transit.json`） |
| 周三 09:00 集成点 | C（`walk.json` + `peds.json`）；PR 转正式，`check.sh --quick` 全绿 |
| 周三中午前 | P1 能做多少做多少 |

## 8. 不做

- 行为参数本身（T5）、延误和绕行计算（T4）、界面（T2）
- GTFS Realtime、PTV Timetable API：要 key，演示也用不上实时数据

## 变更记录

| 时间 | 谁 | 改了什么 |
|---|---|---|
| 09-29 13:55 | @jinmingq | 初版（内容同 issue #11） |
