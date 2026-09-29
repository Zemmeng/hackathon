# 3 · 任务板（唯一的任务台账；🔨 就是「我在做」的登记）

lead 以 `hackathon.conf` 的 `LEAD` 为准。每人只改自己那一节。节与节之间空两行，减少相邻行冲突。
状态：⬜ 未开始 · 🔨 进行中 · ⏸ 暂停（见交接单）· ✅ 已开 PR 或已合并 · ❌ 放弃
开始时间一律写 `MM-DD HH:MM`（`sync.sh` 靠它算「已开始多久」）。

## 现在停在哪（只有 lead 改，写时间）

- 里程碑：M0 完成，M1 未到（09-29 15:15）· 倒计时 45h · main：绿（`check.sh` 全量 `0 ❌`，6 个模块 379 passed）· 冻结：否
- 线上版本：还没有（目标 09-29 21:00 前有一个 Cloudflare 网址；`apps/web` 已带静态部署配置，等部署人 `deploy.sh web`）
- 已合：#9 #12 #14 路网和第二期数据、#15 数据文件 2MB、#16 契约 v2、#17 `docs/llm-apis/`、#18 T2 方向、#19 T2 网页、#22 T5 读屏规则版、#24 T11
- 在做：T11 临街建筑（louis，issue #21）· T4 引擎由 lead 的「AI流程基础架构」会话做（#20，任务号 T9）· T12 参数找出处（Unzzip，新派）
- #5 等 Unzzip 拆或关；T10 作废（和 T11 重复，#25 已关）

## 风险与 P0（lead 写，`/demo` 的结果也写这）

| # | 问题 | 严重度 | 负责人 | 状态 |
|---|---|---|---|---|
| R1 | T4 路网计算：由 lead 的「AI流程基础架构」会话在做（#20，T9），没有队员负责人；T5 已派 @jinmingq 并合了规则版（#22） | 中 | @Zemmeng | 等 #20 按 D-0929-1500 改完转正式 |
| R2 | 初筛 3 页幻灯片 09-30 12:30 截止，还没人负责 | 高 | lead | 17:00 集成点定 |
| R3 | `apps/web` 已由 T2 分支自建（登记表、CODEOWNERS、launch.json 已补）；`starters/` 还没删（D-0929-1311） | 中 | @Zemmeng（T6） | starters 待删 |
| R4 | `apps/roads/public/cbd/network.json` 511,186 字节，离 check [6] 的 500KB 警告线只差不到 1KB | 低 | @louisxie316-dotcom | ✅ 已解决：数据 JSON 上限 2MB、不再报 500KB（D-0929-1430） |
| R5 | T2 网页做成「极端天气压力测试」为主线，全是模拟数字，没接 T3 真路网，和 D-0929-1310 的 6 步不一致 | 高 | @unicornnnnnny | D-0929-1445：主路径接回计划，天气留作加分层；17:00 前对齐 |
| R6 | #20（lead 另一个会话）和 #22（T5）都新建 `apps/api`，10 个同名文件；#20 还按被推翻的 D-0929-1333 写、借用了 louis 的 T7 | 高 | @Zemmeng | D-0929-1500：api 归 #22，#20 只留 engine 并对齐；已在 #20 留言 |

## 额度台账（付费 API）

开工时额度 `<>` · 已用 `<>` · 剩余 `<>`

| 时间 | 谁 | 服务 | 花了多少 | 干了什么 |
|---|---|---|---|---|
| | | | | |

## 未认领（lead 维护；任务号全局唯一，每个 ≤ 2 小时）

| T# | 任务 | 预计 | 依赖 |
|---|---|---|---|
| T0 | 热身：分支 `<handle>/hello/T0-hello`，只新建一张交接单，开 PR（做法见 README ①） | 15m | — |
| T2 | 给 @unicornnnnnny：**网页面板**（第 1、2、6 步）——地图显示 CBD、在路上选一段施工、摆护栏 / 标志牌 / VMS、写屏上文案、显示结果和前后对比；17:00 前先做到地图 + 选路段 + 文案输入，结果用假数据上色。模块 `apps/web`（lead 今天建好空架子）；看 `docs/2-plan.md` 和 `docs/arch/` | 2h | — |
| T3 | 给 @louisxie316-dotcom：**路网数据**——CBD 真实路网 + 真实车流整理成 `network.json` / `flows.json` / `signals.json`。**详细要求全在 `apps/roads/PRD.md`**；分支 `louisxie316-dotcom/roads/T3-network`；17:00 前先交最小版 `network.json`（draft PR） | 2h + 2h | — |
| T4 | ~~路网计算~~ → 骨架在 `apps/engine`（T9，#20），由 lead 的引擎会话继续做，暂不派给队员（D-0929-1500） | — | — |
| T5 | 给 @jinmingq：**大模型读懂屏上的字**（第 ③ 步，D-0929-1435 / 1436）——新建模块 `apps/api`：浏览器端 `readSigns()`、关键词规则兜底、Cloudflare Worker `/api/read` + KV 缓存、`prompts.md`。**要求全在 `docs/arch/T5-PRD.md`**，接口见 `docs/contract.md` §路人读数；分支 `jinmingq/api/T5-reader`；17:00 前 `readSigns()` 用规则返回读数 + `test.sh` 绿 + draft PR（不调大模型、不花钱） | 2h + 3h | — |
| T7 | 给 @louisxie316-dotcom：**T3 第二期**——行人、公交、设备库存（`apps/roads/PRD-2.md`，PR #12）。**先做 A `equipment.json`**（T2 设备面板要用），B 公交、C 行人排在后面；分支 `louisxie316-dotcom/roads/T7-equipment`，#9 合完再开 | 1h + 4h | T3（PR #9） |
| T8 | 任何人：**传一张大模型 API 卡**——手里有哪家的 key / 免费额度，照 `docs/llm-apis/README.md` 写一张卡（只写变量名）；分支 `<handle>/llm-apis/T8-<服务商>`，像 T0 一样人人可做、不用认领 | 15m | — |
| T11 | 给 @louisxie316-dotcom：**临街建筑 `buildings.json`**（issue #21，@unicornnnnnny 提）——CBD 临街建筑的真实轮廓、高度、名称、用途和临街路段，给 T2 地图换掉随机楼块。**要求全在 issue #21**；分支 `louisxie316-dotcom/roads/T11-buildings`；先交 P0（OSM 轮廓 + 高度 + 用途）draft PR；排在 T7 A `equipment.json` 后面 | 1h + 2h | T3 |
| T12 | 给 @Unzzip：**引擎参数找依据**——4 类路人占比、校准锚点（3% / 20% / 1/5）、信不信屏、时间价值、屏上文字可读距离，每个数带出处和置信度，交 `apps/params/public/params.json`。**要求全在 `docs/arch/T12-params-PRD.md`**；分支 `Unzzip/params/T12-evidence`；先把 #5 拆完或关掉；17:00 交有出处的 P0 一半 | 2h | — |

认领：在自己那节加一行标 🔨；「未认领」里对应那行由 lead 下一轮清掉。


## @Zemmeng

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T1 | Swanston/La Trobe 路口仿真 demo（`apps/sim`，真实流量 + 施工模式对比） | ✅ | `lead/sim-demo` / PR #6 | 09-29 11:31 |
| T6 | 集成上线：删 starters、建 web / engine / api 空架子、Cloudflare 上线一个网址、把 T2–T5 接起来、接上路口放大 | 🔨 | `lead/kickoff` | 09-29 13:05 |
| T9 | 引擎骨架（T4 的底，D-0929-1435 版）：`apps/engine` 找绕行 · 场景卡 · 读数 + 每类人参数的选择模型 · 两点校准 · 分流算延误 · 冲突成本 · 顾问改法重算，对外 `evaluate(方案)`；跑在 T3 真路网上 | 🔨 | `claude/lead/ai-infra` / PR #20 | 09-29 13:50 |
| T10 | 同源部署外壳 `apps/site`：一个 Worker 挂所有模块的 `public/`（`/<模块>/public/`），`/api/*` 留给 T5 的服务绑定；高h 照 `apps/site/README.md` 部署（T10 原号作废的任务是 #25，已关，沿用） | 🔨 | `claude/lead/deploy-site`（未推） | 09-29 15:00 |

卡住了：


## @louisxie316-dotcom

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T0 | 热身：验证本机环境、hooks、CI 与仓库权限 | ✅ | `louisxie316-dotcom/hello/T0-hello` / PR #3 | 09-27 14:48 |
| T3 | 路网数据：CBD 真实路网 + 车流 → `network.json` / `flows.json` / `signals.json`（`apps/roads/PRD.md`） | ✅ | `louisxie316-dotcom/roads/T3-network` / PR #9 | 09-29 13:19 |
| T7 | T3 第二期：设备库存、公交、行人 → `equipment.json` ✅ / `transit.json` ✅ / `walk.json` + `peds.json` ✅（P0 三样齐了；P1 未做）（`apps/roads/PRD-2.md`） | ✅ | `louisxie316-dotcom/roads/T7-equipment` / PR #14 | 09-29 13:53 |

卡住了：


## @Unzzip

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T12 | 引擎参数找依据：`apps/params/public/params.json` + 出处表 + `test.sh`；字段已对齐引擎 `applyParams`（familiar 等） | ✅ | `Unzzip/params/T12-evidence` / PR #31 | 09-29 15:20 |

卡住了：无。#5（Canvas 材料）已按 lead 留言拆完，等 `cross-module` 标签。


## @jinmingq

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T5 | 大模型读懂屏上的字：新建 `apps/api`，`readSigns()` + 关键词规则 + Worker `/api/health` `/api/read`（`docs/arch/T5-PRD.md`）。17:00 档（规则版）已合 #22；21:00 档：workerd 跑通、`checkSigns()` 软警告、演示文案清单 | 🔨 | `jinmingq/api/T5-worker`（规则版 #22 已合） | 09-29 14:40 |

卡住了：


## @unicornnnnnny

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T2 | 网页面板（`apps/web`）：GIS 地图 + 六种极端天气 + 四步红队流程 + 中英切换；交接单 `handoff/unicornnnnnny-T2-0929-1440.md` | 🔨 待 review | `unicornnnnnny/web/T2-gis-weather-ui` | 09-29 14:40 |

卡住了：


## @<队友handle>（kickoff 前 lead 给每人建一节）

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：
