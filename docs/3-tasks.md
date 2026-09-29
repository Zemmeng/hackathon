# 3 · 任务板（唯一的任务台账；🔨 就是「我在做」的登记）

lead 以 `hackathon.conf` 的 `LEAD` 为准。每人只改自己那一节。节与节之间空两行，减少相邻行冲突。
状态：⬜ 未开始 · 🔨 进行中 · ⏸ 暂停（见交接单）· ✅ 已开 PR 或已合并 · ❌ 放弃
开始时间一律写 `MM-DD HH:MM`（`sync.sh` 靠它算「已开始多久」）。

## 现在停在哪（只有 lead 改，写时间）

- 里程碑：M0 完成，M1 未到（09-29 15:48）· 倒计时 44h · main：绿（`check.sh` 全量 `0 ❌`，8 个模块 728 passed）· 冻结：否
- 线上版本：https://hackathon-site.zemmmeng.workers.dev · commit `a50b8fe`（#46：真实建筑、电车公交、行人影响、大模型接口留好）· 09-29 18:30 由 @Zemmeng 备份部署 api + site；线上冒烟 `check.sh --e2e` 0 ❌；`/api/health` = `llm.mode rules`（没放 key）
- main 上已有：T3/T7 路网 + 行人 / 公交 / 设备、T11 临街建筑、T9 引擎（契约 v3）、T5 读屏规则版、T12 有出处的参数、`docs/llm-apis/` 百炼卡
- **没有开着的 PR**；最大缺口是 T2 网页还没把这些串起来（R5）
- 交接：`handoff/Zemmeng-T6-0929-1548.md`（17:00 集成点的待办和要拍板的事）

## 风险与 P0（lead 写，`/demo` 的结果也写这）

| # | 问题 | 严重度 | 负责人 | 状态 |
|---|---|---|---|---|
| R1 | T4 路网计算由 lead 的引擎会话做（T9，#20 已合）；引擎把 `readSigns()` 报错静默当成「没人被说动」，已转引擎会话另开 PR | 中 | @Zemmeng | 等引擎会话修 |
| R2 | 初筛 3 页幻灯片 09-30 12:30 截止，还没人负责 | 高 | lead | 17:00 集成点定 |
| R3 | `apps/web` 已合（#19）；`starters/` 还没删（D-0929-1311） | 低 | @Zemmeng（T6） | starters 待删 |
| R4 | `apps/roads/public/cbd/network.json` 511,186 字节，离 check [6] 的 500KB 警告线只差不到 1KB | 低 | @louisxie316-dotcom | ✅ 已解决：数据 JSON 上限 2MB、不再报 500KB（D-0929-1430） |
| R5 | T2 网页还没把路网 / 建筑 / 引擎 / 读屏 / 参数串起来（D-0929-1445）；高he 15:00 后无推送 | 高 | @unicornnnnnny | 17:00 前要看到进展 |
| R6 | #20 和 #22 都建 `apps/api` | — | — | ✅ 已解决：api 归 T5（#22），#20 只留 engine（D-0929-1500） |

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
| T13 | ~~给 @unicornnnnnny：**网页接后端**——RippleTwin 第 1、3、4 步的数字从预设换成引擎真算的；后端 lead 已接好，页面只调 `backend.js` 的 `connect()` → `run / compare / advise / check`（D-0929-1540）。**要求全在 `docs/arch/T13-web-wiring-PRD.md`**；分支 `unicornnnnnny/web/T13-wiring`；先做第 3 步排队 + 分流和第 4 步「只改一行字」的前后对比~~ → lead 已做完（PR #43，D-0929-1650），高h 不用做 | — | — |
| T14 | 给 @unicornnnnnny：**网页改「液态玻璃」风格**——只改外观不改功能：地图上浮着的 HUD、右侧面板卡片、按钮 / chips、顶栏、时间轴换成 Apple Liquid Glass 那套（半透明折射、边缘高光、胶囊控件），深浅两套主题；可读性、无障碍退回、帧率有硬要求。**要求全在 `docs/arch/T14-liquid-glass-PRD.md`**；分支 `unicornnnnnny/web/T14-liquid-glass` | 2h | T13（PR #43，已合） |

认领：在自己那节加一行标 🔨；「未认领」里对应那行由 lead 下一轮清掉。


## @Zemmeng

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T1 | Swanston/La Trobe 路口仿真 demo（`apps/sim`，真实流量 + 施工模式对比） | ✅ | `lead/sim-demo` / PR #6 | 09-29 11:31 |
| T6 | 集成上线：删 starters、建 web / engine / api 空架子、Cloudflare 上线一个网址、把 T2–T5 接起来、接上路口放大 | 🔨 | `lead/kickoff` | 09-29 13:05 |
| T9 | 引擎骨架（T4 的底，D-0929-1435 版）：`apps/engine` 找绕行 · 场景卡 · 读数 + 每类人参数的选择模型 · 两点校准 · 分流算延误 · 冲突成本 · 顾问改法重算，对外 `evaluate(方案)`；跑在 T3 真路网上 | ✅ | `claude/lead/ai-infra` / PR #20 ✅；`claude/lead/engine-fixes` / PR #34 ✅（后端接线层 `backend.js`、不走小巷、审查 15 条、契约 v3.1、派 T13） | 09-29 13:50 |
| T13 | 网页接后端（接手原派给 @unicornnnnnny 的 T13，D-0929-1650）：第 1 步真路网上放封道 / 写 VMS / 选时段、第 3 步路网涟漪 + 每类人理由、第 4 步顾问改法 + 前后对比，数字全由引擎算；然后部署上线 | ✅ | `Zemmeng/web/T13-wiring` / PR #43 | 09-29 16:30 |
| T16 | 地图画真实建筑：`buildings.json`（OSM + 墨尔本市轮廓 + 2024 普查）换掉随机楼块，取不到时退回合成的 | ✅ | `lead/integrate-t16-19`（合并 `Zemmeng/web/T15-buildings`（合并时改名 T16；T15 已被初筛幻灯片会话占用）） | 09-29 17:36 |
| T17 | 电车 / 公交受的影响：引擎按 PTV 时刻表算经过施工的线路、每班多等几秒、乘客·分钟、全封时停运 / 改线；页面第 1/3/4 步和地图显示 | ✅ | `lead/integrate-t16-19`（合并 `lead/t16-transit` + `Zemmeng/web/T17-impacts-ui`） | 09-29 17:36 |
| T18 | 行人受的影响：方案加 `closes.footpath`，引擎按行人计数和人行道网络算绕行距离、多过几次马路；页面第 1 步加人行道开关 | ✅ | `lead/integrate-t16-19`（合并 `lead/t17-peds` + `Zemmeng/web/T17-impacts-ui`） | 09-29 17:36 |
| T19 | 大模型接口留好：api Worker 接 OpenAI 兼容接口（默认 DeepSeek）+ 缓存 + 失败回规则 + 预算演示答案脚本，部署并绑到 site；默认 MOCK=1 不花钱，lead 之后只放 key | ✅ | `lead/integrate-t16-19`（合并 `lead/t19-llm-ready`） | 09-29 17:37 |
| T10 | 同源部署外壳 `apps/site`：一个 Worker 挂所有模块的 `public/`（`/<模块>/public/`），`/api/*` 留给 T5 的服务绑定；高h 照 `apps/site/README.md` 部署（T10 原号作废的任务是 #25，已关，沿用） | 🔨 代码已合，等高h 部署 | `claude/lead/deploy-site` / PR #35 ✅（高危已修：只拷 git 已跟踪的文件）；部署归 @unicornnnnnny，网址回来后 lead 填 `DEMO_URL` | 09-29 15:00 |

卡住了：


## @louisxie316-dotcom

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T0 | 热身：验证本机环境、hooks、CI 与仓库权限 | ✅ | `louisxie316-dotcom/hello/T0-hello` / PR #3 | 09-27 14:48 |
| T3 | 路网数据：CBD 真实路网 + 车流 → `network.json` / `flows.json` / `signals.json`（`apps/roads/PRD.md`） | ✅ | `louisxie316-dotcom/roads/T3-network` / PR #9 | 09-29 13:19 |
| T7 | T3 第二期：设备库存、公交、行人 → `equipment.json` ✅ / `transit.json` ✅ / `walk.json` + `peds.json` ✅（P0 三样齐了；P1 未做）（`apps/roads/PRD-2.md`） | ✅ | `louisxie316-dotcom/roads/T7-equipment` / PR #14 | 09-29 13:53 |
| T11 | 临街建筑 `buildings.json`（issue #21）PR #33；后续 PR #40：VMS 每行改 10 字、`test.sh` 的 `${变量}`、`use` 用市政普查补映射（other 76% → 36%）；P2 出入口没做 | ✅ | `louisxie316-dotcom/roads/T11-buildings` / PR #33、#40 | 09-29 15:02 |

卡住了：


## @Unzzip

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T12 | 引擎参数找依据：`apps/params/public/params.json` + 出处表 + `test.sh`；字段已对齐引擎 `applyParams`（familiar 等） | ✅ | `Unzzip/params/T12-evidence` / PR #31 | 09-29 15:20 |

卡住了：无。#5（Canvas 材料）已按 lead 留言拆完，等 `cross-module` 标签。


## @jinmingq

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T15（素材协作） | 用户要求：业务流程图重绘为可编辑 SVG 并上传；已上传并通过检查，状态保留原 pre-screen 快照，交 pitch owner 复核 | ✅ | `jinmingq/pitch/T15-workflow-svg` | 09-29 20:18 |
| T5 | 大模型读懂屏上的字：新建 `apps/api`，`readSigns()` + 关键词规则 + Worker `/api/health` `/api/read`（`docs/arch/T5-PRD.md`）。17:00 档已合 #22；21:00 档已合 #26（workerd 跑通、`checkSigns()`、演示文案清单）；现在：接住 #20 引擎的请求（箭头板、长读屏秒数、路名字符）。剩真调大模型，等 lead 定用哪家 | 🔨 | `jinmingq/api/T5-engine-compat` | 09-29 14:40 |

卡住了：


## @unicornnnnnny

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T2 | 网页面板（`apps/web`）：GIS 地图 + 六种极端天气 + 四步红队流程 + 中英切换；交接单 `handoff/unicornnnnnny-T2-0929-1440.md` | ✅ 已合（#19） | `unicornnnnnny/web/T2-gis-weather-ui` | 09-29 14:40 |
| T14 | 网页改液态玻璃：地图铺满、顶栏 / 图层栏 / 分析面板 / 时间轴浮在地图上；面板和顶栏真折射（Chromium 桌面），其余磨砂；右侧面板「简洁 / 详细」+ 分节折叠 + 可收起；道路描边、建筑压暗；交接单 `handoff/unicornnnnnny-T14-0929-1905.md` | ✅ 已合 #47、已上线 e84aec5；按 lead 意见再调透（底色 0.30）🔨 待 review | `unicornnnnnny/web/T14-more-clear` | 09-29 17:30 |

卡住了：


## @<队友handle>（kickoff 前 lead 给每人建一节）

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：
