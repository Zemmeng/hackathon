# sim —— Swanston St / La Trobe St 路口仿真（车、自行车、电车、行人，一小时 20 秒回放）
Owner: @Zemmeng（引擎、数据、测试）· 界面：@unicornnnnnny（`public/` 下的 index.html、style.css、js/ui.js，见 D-0929-1226）

第 5 题（RPM Hire：Digital Tool for Temporary Infrastructure）的第一个 demo：用真实开放数据驱动一个路口的多类道路使用者仿真，可以打开「施工模式」看封掉一段自行车道后的排队和冲突。纯前端，不需要后端，不花钱。

## 怎么跑

- Claude 会话里：preview 工具启动 `sim`（`.claude/launch.json`，端口 4174）
- 手动：`python3 -m http.server 4174 -d apps/sim/public`，浏览器开 http://localhost:4174
- ⚠️ 直接双击 `index.html`（file://）打不开：`ui.js` 要 `fetch` 数据文件
- 发成单文件网页（手机直接开、发给别人）：`python3 apps/sim/tools/build_single.py`，产物在 `out/sim-single.html`（out/ 不进仓库）

## 怎么测

`bash apps/sim/test.sh` —— 用 node 不开浏览器把整小时跑完，14 条断言：进场量对得上数据、同 seed 结果一致、正常情况无死锁、施工后排队和冲突变多、信号配时和行人灯。最后一行 `N passed, M failed`。

## 对外接口

没有跨模块接口。模块内部，界面（`ui.js`）只通过 `sim.js` 的导出用引擎，改界面的人不用看引擎内部：

| 导出 | 用法 |
|---|---|
| `new Sim({ data, hour, day, wz, seed })` | `data` = `demand_2921.json`；`hour` 0–23；`day` `'wd'` 工作日 / `'we'` 周末；`wz` 施工模式；同一 `seed` 结果完全一样 |
| `sim.step()` | 前进 `DT` = 0.25 秒；`sim.t` 是当前秒数，0 到 `HOUR` = 3600 是计分的一小时，构造后先预热 300 秒（`t` 从 -300 起） |
| `sim.agents` | 场上所有人和车：`mode`（car / bike / tram / ped）、`P`（路径）、`s`（沿路径的车头位置，米）、`sPrev`、`v`、`len`、`w` |
| `pathAt(P, s, out)` | 路径上 s 处的 `{x, y, hx, hy}`，坐标米，路口中心为原点，x 向东、y 向北 |
| `sim.events` | 冲突：`{ t, kind, label, x, y, val }`，`val` 是 PET / TTC 秒数，< 0.5 算严重 |
| `sim.summary()` | `{ spawned, expected, delay, qEB, qWB（全小时最长排队，米）, delayCarEB, delayCarWB（La Trobe 东行 / 西行汽车平均延误，秒；排到画面外还没进场的不算在内）, outside（排到画面外还没进场的车）, conflicts, severe, byLabel }` |
| `sigState(phase, t)` / `walkOn(crosswalk, t)` | 信号灯 `'G' / 'Y' / 'R'`；行人灯是否放行 |
| `HALF` `HOUR` `DT` `WZ` `hashStr` | 画面半宽 90 米、一小时秒数、步长、施工区范围、种子哈希 |

## 外部 API（数据来源，全部免费、不要 key）

| 数据 | 入口 | 许可证 | 用到的部分 |
|---|---|---|---|
| Traffic Signal Volume Data（SCATS） | https://discover.data.vic.gov.au/dataset/traffic-signal-volume-data | CC BY 4.0 | 站点 2921，2026-08-01 至 09-27 |
| Victorian Traffic Signals（站点表） | https://discover.data.vic.gov.au/dataset/victorian-traffic-signals | CC BY 4.0 | 站点经纬度，`MUNICIPALITY = MBN` 是 City of Melbourne |
| Traffic Signal Configuration Data Sheets | https://discover.data.vic.gov.au/dataset/traffic-signal-configuration-data-sheets | CC BY 4.0 | 2921 的配置表：第 2 页检测器平面图、第 3 页相位图、第 4 页检测器功能表 |
| Pedestrian Counting System（每小时） | https://data.melbourne.vic.gov.au 数据集 `pedestrian-counting-system-monthly-counts-per-hour` | 元数据没写，同系列标 CC BY，提交前确认 | 传感器 3、66、62、187 |

**实测的格式（2026-09-29）：**

- SCATS 每月一个全州 zip（约 120–135 MB），里面每天一个 `VSDATA_YYYYMMDD.csv`（约 30 MB）。一行 = 一个站点的一个检测器一天：`NB_SCATS_SITE, QT_INTERVAL_COUNT（日期）, NB_DETECTOR, V00…V95（96 个 15 分钟时段）, NM_REGION, CT_RECORDS, QT_VOLUME_24HOUR, CT_ALARM_24HOUR`
- 服务器支持 HTTP Range，可以远程只抽 zip 里的某一天，不用下全量
- 行人 API：`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/<id>/exports/csv`，滚动保留两年，每天更新；列 `location_id, sensing_date, hourday, direction_1, direction_2, pedestriancount`，两个方向的含义看传感器位置表的 `direction_1 / direction_2`（如 North / South）

**坑：**

- 负数 = 检测器故障或缺失，当空值；2921 在 8–9 月约 2.7% 的格子是负数
- 检测器号不带车道和方向，要对照配置表；2921 的 1、2、4、6、8 是自行车检测器，11、13、22 是电车
- 2921 的 6 号（La Trobe 东行自行车）57 天全是 0，坏了；行人按钮 24–28 全是 0，拿不到行人数
- 8 月的包缺 08-31；09-25 是公众假期，算平均时去掉
- 数据更新后重算：`python3 apps/sim/tools/build_demand.py --scats … --ped … --sensors …`（参数说明在脚本开头）

## 结构

| 文件 | 一句话 |
|---|---|
| `public/index.html` | 页面结构；`?v=N` 缓存版本号 |
| `public/style.css` | 样式，颜色都是 token，亮色 / 暗色两套 |
| `public/js/sim.js` | 仿真引擎：几何、信号、IDM 跟驰、让行、冲突检测，纯函数不碰 DOM |
| `public/js/ui.js` | 画布绘制、控件、读数、正常 vs 施工对比 |
| `public/demand/demand_2921.json` | 每小时流量画像（`build_demand.py` 生成） |
| `tests/sim.test.mjs` | node 跑整小时的断言 |
| `tools/build_demand.py` | 原始开放数据 → `demand_2921.json` |
| `tools/build_single.py` | 拼成单文件 HTML，发手机链接用 |
| `bump.sh` | 改完 CSS / JS 把 `?v=` 全部 +1 |

## 本模块固定模式

- 数据目录叫 `public/demand/`，别叫 `data/`：仓库 `.gitignore` 忽略所有 `data/` 目录

- 引擎和界面分开：界面只用上表的导出；引擎不许碰 DOM，这样 `test.sh` 能用 node 跑
- 同一个 seed 结果完全一样：到达和每个人的属性都从各自流向的随机数流里取，正常和施工两次对比公平
- 找前车：同一路线按弧长找；别的路线只认朝向几乎平行的（点积 ≥ 0.9），并道单列在 `MERGE_FROM`。用「朝向射线」找会让左转车和直行自行车互相等，路口死锁（见 docs/pitfalls.md）
- 改了 CSS / JS / 数据就跑 `bash apps/sim/bump.sh`

## 已知问题

- 信号配时是假设的：参考配置表相位图简化成 A（Swanston 直行 30 秒）/ B（Swanston 左转 10 秒）/ C（La Trobe 44 秒），100 秒周期；真实路口是 SCATS 自适应
- 按假设补的流向：La Trobe 东行自行车按西行、Swanston 南行自行车按北行、La Trobe 东行电车按西行、La Trobe 南侧人行道按北侧
- 行人路线比例（60% 直行过街 / 25% 拐弯不过街 / 15% 拐弯过另一条街）和 10% 分心司机是假设
- 只模拟了 Swanston 北口左转进 La Trobe 的车；La Trobe 上的转弯车没有模拟
- 施工模式下车不能超自行车，西行通行能力掉得偏狠
- 本模块没有用 `starters/` 的代码（开赛前写的），等主办方答复能不能用
