# 3 · 任务板（唯一的任务台账；🔨 就是「我在做」的登记）

lead 以 `hackathon.conf` 的 `LEAD` 为准。每人只改自己那一节。节与节之间空两行，减少相邻行冲突。
状态：⬜ 未开始 · 🔨 进行中 · ⏸ 暂停（见交接单）· ✅ 已开 PR 或已合并 · ❌ 放弃
开始时间一律写 `MM-DD HH:MM`（`sync.sh` 靠它算「已开始多久」）。

## 现在停在哪（只有 lead 改，写时间）

- 里程碑：M0 完成，M1 未到（09-29 15:48）· 倒计时 44h · main：绿（`check.sh` 全量 `0 ❌`，8 个模块 728 passed）· 冻结：否
- 线上版本：https://hackathon-site.zemmmeng.workers.dev · commit `7e035d9`（#60 T20：删写死的假数 + 天气标示意 + 模拟评委 5 条）· 09-29 22:13 由 @unicornnnnnny 部署；线上冒烟 0 ❌；`/api/health` = `llm.mode rules`（没放 key）
- main 上已有：T3/T7 路网 + 行人 / 公交 / 设备、T11 临街建筑、T9 引擎（契约 v3）、T5 读屏规则版、T12 有出处的参数、`docs/llm-apis/` 百炼卡
- **没有开着的 PR**；最大缺口是 T2 网页还没把这些串起来（R5）
- 交接：`handoff/Zemmeng-T6-0929-1548.md`（17:00 集成点的待办和要拍板的事）

## 风险与 P0（lead 写，`/demo` 的结果也写这）

| # | 问题 | 严重度 | 负责人 | 状态 |
|---|---|---|---|---|
| R1 | T4 路网计算由 lead 的引擎会话做（T9，#20 已合）；引擎把 `readSigns()` 报错静默当成「没人被说动」，已转引擎会话另开 PR | 中 | @Zemmeng | 等引擎会话修 |
| R2 | 初筛 3 页幻灯片 09-30 12:30 截止 | 高 | lead | 草稿已出（T15，PR #44，21:00 按 T16–T19 更新）；等全队定队名、放不放链接、谁提交 |
| R3 | `apps/web` 已合（#19）；`starters/` 还没删（D-0929-1311） | 低 | @Zemmeng（T6） | starters 待删 |
| R4 | `apps/roads/public/cbd/network.json` 511,186 字节，离 check [6] 的 500KB 警告线只差不到 1KB | 低 | @louisxie316-dotcom | ✅ 已解决：数据 JSON 上限 2MB、不再报 500KB（D-0929-1430） |
| R5 | T2 网页还没把路网 / 建筑 / 引擎 / 读屏 / 参数串起来（D-0929-1445）；高he 15:00 后无推送 | 高 | @unicornnnnnny | 17:00 前要看到进展 |
| R6 | #20 和 #22 都建 `apps/api` | — | — | ✅ 已解决：api 归 T5（#22），#20 只留 engine（D-0929-1500） |

## 额度台账（付费 API）

开工时额度 `<>` · 已用 `<>` · 剩余 `<>`

| 时间 | 谁 | 服务 | 花了多少 | 干了什么 |
|---|---|---|---|---|
| 09-29 23:18 | @Zemmeng | DeepSeek `deepseek-flash` | 约 ¥0.54（估算：92 条请求 × 3 = 276 次调用，含 2 条试水） | 预先算演示读数 `apps/api/tools/precompute.mjs --run` → `apps/api/public/answers/demo.json`（D-0929-2307） |

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
| T20 | 给 @unicornnnnnny：**删掉页面上写死的假数 + 天气标示意**（D-0929-2011 ①、D-0929-2012）——#48 B 节 1–3：顶栏安全分和第 4 步结果表（`RESULTS` 查表）、第 2 步假进度和「变体 22/30」清单、「Run AI red team」「250 agents × 30」字样；B4–B5：天气去掉「实时」和随机闪电数、标示意，演示默认晴天、不读 `rt-wx`。分支 `unicornnnnnny/web/T20-no-fake-numbers` **＋补充 5 条（地图对准 Lonsdale、引擎数字别折叠、单位、两个施工同屏、假设亮出来）见 `docs/arch/T20-addendum.md`** | 2h | — |
| T23 | 给 @jinmingq：**多方案并排对比 + 选定 + 一页导出**（D-0929-2011 ④，#48 第 ④⑦⑧ 步）——3 套方案卡并排（车延误、公交乘客、行人、租金），「选这个」+ 理由，导出一页打印视图（设备清单和报价、VMS 文字）；改的是 `apps/web`，跨模块先在群里说一声并请 lead 打 `cross-module` 标签；数字只用 `backend.js` 给的，不在页面里算 | 2h | T22（方案生成） |
| T26 | 给 @unicornnnnnny：**T20 收尾**——顶栏场景名还写 La Trobe、「回到施工区」飞回 La Trobe、1440×900 改 VMS 要滚动、375 px 施工标签被图例盖、「53% 照屏走」说错且没标假设值、「绕行 14%→61%」固定标绿、步骤条和几处按钮名不副实。**要求全在 `docs/arch/T26-T27-web-PRD.md` 第 1、2、4 节**；合并顺序 #72 → `lead/ai-panel` → T26；分支 `unicornnnnnny/web/T26-t20-tail` | 1.5h | #72、`lead/ai-panel` |
| T27 | 给 @unicornnnnnny：**地图放下整个 CBD**（D-0929-2354）——精细窗口不动，外面加一层预渲染的全城路网 + 建筑（Hoddle Grid 外扩约 150 m），放开拖动和缩放，排队线 / 绕行线 / 公交线画全，全 CBD 路段可点。**要求全在 `docs/arch/T26-T27-web-PRD.md` 第 3、4 节**；时间盒 09-30 22:00，没绿就不合、走兜底；分支 `unicornnnnnny/web/T27-full-cbd` | 5h（阶段 1） | T26、T28 |

认领：在自己那节加一行标 🔨；「未认领」里对应那行由 lead 下一轮清掉。


## @Zemmeng

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T1 | Swanston/La Trobe 路口仿真 demo（`apps/sim`，真实流量 + 施工模式对比） | ✅ | `lead/sim-demo` / PR #6 | 09-29 11:31 |
| T6 | 集成上线：删 starters、建 web / engine / api 空架子、Cloudflare 上线一个网址、把 T2–T5 接起来、接上路口放大 | 🔨 | `lead/kickoff`；初筛架构图 `claude/lead/arch-v2` / PR #42 ✅（`docs/pitch-assets/03-architecture*`；要按 D-0929-1718 / 2011 改，见 `handoff/Zemmeng-T6-0929-2255.md`） | 09-29 13:05 |
| T9 | 引擎骨架（T4 的底，D-0929-1435 版）：`apps/engine` 找绕行 · 场景卡 · 读数 + 每类人参数的选择模型 · 两点校准 · 分流算延误 · 冲突成本 · 顾问改法重算，对外 `evaluate(方案)`；跑在 T3 真路网上 | ✅ | `claude/lead/ai-infra` / PR #20 ✅；`claude/lead/engine-fixes` / PR #34 ✅（后端接线层 `backend.js`、不走小巷、审查 15 条、契约 v3.1、派 T13） | 09-29 13:50 |
| T13 | 网页接后端（接手原派给 @unicornnnnnny 的 T13，D-0929-1650）：第 1 步真路网上放封道 / 写 VMS / 选时段、第 3 步路网涟漪 + 每类人理由、第 4 步顾问改法 + 前后对比，数字全由引擎算；然后部署上线 | ✅ | `Zemmeng/web/T13-wiring` / PR #43 | 09-29 16:30 |
| T16 | 地图画真实建筑：`buildings.json`（OSM + 墨尔本市轮廓 + 2024 普查）换掉随机楼块，取不到时退回合成的 | ✅ | `lead/integrate-t16-19`（合并 `Zemmeng/web/T15-buildings`（合并时改名 T16；T15 已被初筛幻灯片会话占用）） | 09-29 17:36 |
| T17 | 电车 / 公交受的影响：引擎按 PTV 时刻表算经过施工的线路、每班多等几秒、乘客·分钟、全封时停运 / 改线；页面第 1/3/4 步和地图显示 | ✅ | `lead/integrate-t16-19`（合并 `lead/t16-transit` + `Zemmeng/web/T17-impacts-ui`） | 09-29 17:36 |
| T18 | 行人受的影响：方案加 `closes.footpath`，引擎按行人计数和人行道网络算绕行距离、多过几次马路；页面第 1 步加人行道开关 | ✅ | `lead/integrate-t16-19`（合并 `lead/t17-peds` + `Zemmeng/web/T17-impacts-ui`） | 09-29 17:36 |
| T19 | 大模型接口留好：api Worker 接 OpenAI 兼容接口（默认 DeepSeek）+ 缓存 + 失败回规则 + 预算演示答案脚本，部署并绑到 site；默认 MOCK=1 不花钱，lead 之后只放 key | ✅ | `lead/integrate-t16-19`（合并 `lead/t19-llm-ready`） | 09-29 17:37 |
| T10 | 同源部署外壳 `apps/site`：一个 Worker 挂所有模块的 `public/`（`/<模块>/public/`），`/api/*` 留给 T5 的服务绑定；高h 照 `apps/site/README.md` 部署（T10 原号作废的任务是 #25，已关，沿用） | ✅ 已上线（`DEMO_URL`，lead 备份部署） | `claude/lead/deploy-site` / PR #35 ✅（高危已修：只拷 git 已跟踪的文件）；部署归 @unicornnnnnny，网址回来后 lead 填 `DEMO_URL` | 09-29 15:00 |
| T21 | 叠加冲突上页面（D-0929-2011 ②）：真 CBD 路网上两处施工的冲突成本 + 一键错开，引擎已有 `conflict()` / `shiftWorksite()`，页面加第二处施工 | ✅ | `lead/t21-clash` | 09-29 22:01 |
| T22 | 按库存出 3 套方案（D-0929-2011 ③）：引擎 `be.options(施工, { n: 3 })`，从 `equipment.json` 配设备、不超 `qty`、带 `day_rate_aud` 租金（标假设值） | ✅ | `lead/t22-options` | 09-29 21:35 |
| T24 | `contract:` PR（D-0929-2011 ⑤）：§施工方案 加登记表字段（#53）和 `equipment[].item / qty`（#55）；§HTTP API 补 `/api/worksites` 四个、`/api/explain`、health 的 `register`；`options[]` 等 T22 | ✅ | `lead/t24-contract` | 09-29 21:32 |
| T28 | 引擎 `raw.links` 加 `extra_min`（和不施工时比，`apps/engine/public/js/pipeline.js:214` 已算好）——页面的「变慢路段」现在和自由流比，T27 视野一放开，Flinders / King St 本来就有的排队会在每个方案里被画成施工涟漪；加反向断言。T27 合并前要先进 main（`docs/arch/T26-T27-web-PRD.md` 第 3.2 节） | ⬜ | — | — |

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
| T5 | 大模型读懂屏上的字：新建 `apps/api`，`readSigns()` + 关键词规则 + Worker `/api/health` `/api/read`（`docs/arch/T5-PRD.md`）。已合 #22 #26 #29；DeepSeek 卡 #37；大模型接口由 lead 在 T19 留好，演示先用规则（D-0929-1718 / 1830） | ✅ | #22 #26 #29 #37 | 09-29 14:40 |
| T5 | 施工登记表（提案 #48 第 ⑤ 步，只做后端）：`/api/worksites` GET / POST、`/api/worksites/<id>` GET / PATCH，Durable Object `WorksiteRegister`，改要凭 `edit_token`；预置 3 条演示施工（含一条和 Lonsdale 叠加的）；浏览器端 `public/js/worksites.js` 等网页来接（D-0929-2011：页面接入不排在冻结前） | ✅ | #53 | 09-29 20:20 |
| T5 | AI 解读（提案 #48 第 ⑥ 步，只做后端）：`POST /api/explain` 规则版 + 数字追溯（解读里的数只能来自引擎）+ 浏览器端 `explainOptions()` / `optionFromRun()`；大模型版后续（D-0929-2011：页面接入不排在冻结前） | ✅ | #54 | 09-29 20:55 |
| T5 | 执行包和设备租金（提案 #48 第 ⑧ 步、第 ④ 步租金，只做后端）：`public/js/pack.js` 报价（RPM 库存 × 件数 × 天数，假设值）、多处施工共用库存检查、配置检查、要通知谁、中英文字版；T23 导出接它；`packDoc()` 给网页排版、负数 `at_m` = 施工起点下游 | ✅ | #55 #66 | 09-29 21:10 |
| T23 | 多方案并排对比 + 选定 + 一页导出（D-0929-2011 ④）：`apps/web/src/js/8-compare.js`，第 4 步顾问下面；T22 `be.options()` 的 3 套（拿不到退回现在的方案 + 顾问改法），车延误 / 电车公交 / 行人 / 租金，选定 + 理由，导出接 `pack.js`；导出排成一页 A4（中 / 英）；09-29 22:50 线上验过 | ✅ | #61 | 09-29 21:55 |
| T15（素材协作） | 用户要求：业务流程图重绘为可编辑 SVG 并上传；已上传并通过检查，状态保留原 pre-screen 快照，交 pitch owner 复核 | ✅ | `jinmingq/pitch/T15-workflow-svg` | 09-29 20:18 |

卡住了：


## @unicornnnnnny

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T2 | 网页面板（`apps/web`）：GIS 地图 + 六种极端天气 + 四步红队流程 + 中英切换；交接单 `handoff/unicornnnnnny-T2-0929-1440.md` | ✅ 已合（#19） | `unicornnnnnny/web/T2-gis-weather-ui` | 09-29 14:40 |
| T14 | 网页改液态玻璃：地图铺满、顶栏 / 图层栏 / 分析面板 / 时间轴浮在地图上；面板和顶栏真折射（Chromium 桌面），其余磨砂；右侧面板「简洁 / 详细」+ 分节折叠 + 可收起；道路描边、建筑压暗；交接单 `handoff/unicornnnnnny-T14-0929-1905.md` | ✅ 已合 #47、#50，已上线 b1ef637 | `unicornnnnnny/web/T14-liquid-glass` | 09-29 17:30 |
| T20 | 删掉页面上写死的假数（安全分、查表的修复前后对比、复现种子、第 2 步假进度 / 变体、「AI 红队」字样）+ 天气标示意、默认晴天 + 评委 5 条（地图对准 Lonsdale、引擎数字不折叠、单位、一个施工一个时间、假设亮出来）；交接单 `handoff/unicornnnnnny-T20-0929-2201.md` | 🔨 待 review | `unicornnnnnny/web/T20-no-fake-numbers` | 09-29 21:40 |

卡住了：


## @<队友handle>（kickoff 前 lead 给每人建一节）

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：
