# 4 · 演示、pitch、兜底、提交

> pitch owner 写，lead 也可以写。`/demo` 和 `/submit` 都照这份走。

## 演示脚本（决赛 7 分钟讲 + 3 分钟问答，10-01 13:30；T25 草稿 09-29 22:10，pitch owner 未定）

15 秒开场钩子（A 说；屏幕上只有 Lonsdale St 一条红色排队线）：**"8 am on a weekday, one lane closes on Lonsdale Street. Our model says the queue reaches about 900 metres. Same barriers, same sign board, same hire bill — change what the sign says, and in our model it drops under 100 metres. RippleTwin finds those words before the barriers go out."**

- 角色：A = 讲者 [ ]，B = 操作 [ ]。B 只点不说；A 说到 ▶ 时 B 点。所有台词都是英文原句，A 可以换说法，数字不换
- 开场前页面状态：EN、浅色、天气晴（D-0929-2012 天气只是「示意」，全程不碰）、地图框住 Lonsdale St 西行、08:00、封 1 条道、VMS 只留第一帧 ROADWORK AHEAD。⚠️ 线上 `demo('lonsdale')` 默认带第二帧 USE RUSSELL ST，开场前要删掉，3:30 再当场打回去
- 数字口径：嘴上说 2 位有效数字（约 900 m、约 8.5 分钟），幻灯片和屏幕给精确值。每个数的出处和复现方法见下面「评委问答预案」里的「问答和演示用的数」
- 彩排雷区（09-29 22:10 在 origin/main `6bedd9e` 上用 `connect()` 实测）：
  1. 别切 11:00 来证明「错峰更好」：只写 ROADWORK AHEAD 时 11:00 排队 932 m，比 8 点的 918 m 还长（17:00 是 860 m）。评委要换小时就换，不预告方向
  2. 顾问卡和三套方案的字不一样：main 上 `advise()` 现在给「USE / RUSSELL / SAVE 5 MIN」并替换掉两帧（8 点 → 191 m、1,964 车·分）；`options()` 的 o3 引导档是「ROADWORK AHEAD + USE / RUSSELL / SAVE 9 MIN」（→ 82 m、966）。稿子走 o3 这条；上场前照屏幕念数，不背稿
  3. 「全封」这次没核对（`closes.lanes` 要填 ≥ 车道数），彩排先点一遍再决定演不演
  4. 不切 La Trobe（D-0929-1650：几乎不堵）；不开路口微观仿真（La Trobe × Swanston，示意），只在问答被问到骑车、行人细节时拿出来 15 秒
  5. 4:50 叠加冲突、5:20 导出要冻结前上了页面才演（D-0929-2011 ②④）；没上就切幻灯片备用页，台词不变

| 时间 | 屏幕上是什么 | 说什么 | 谁操作 | 哇？ |
|---|---|---|---|---|
| 0:00 | 幻灯片 1：黑底，Lonsdale St 一条红色排队线 | 上面的 15 秒开场钩子 | A | ⭐ |
| 0:15 | 幻灯片 2：谁痛、怎么痛 | "Every week, councils approve traffic management plans, and contractors hire barriers, signs and VMS boards — from companies like RPM Hire. Before that gear goes out, nobody can say how long the queue will be, which buses run late, or where pedestrians must walk. How many drivers detour is a rule of thumb, and every permit is checked on its own." | A | |
| 0:45 | 幻灯片 3：一句话 + 数据底 | "RippleTwin is a digital twin of the Melbourne CBD for temporary works. You place the barriers, signs and VMS you would actually hire; it shows what drivers, bus riders and pedestrians will see, what they will do, and what it costs. Real data: 1,513 CBD road links, 8 weeks of SCATS counts, PTV timetables, City of Melbourne pedestrian counters." | A | |
| 1:00 | 线上页面 Step 1 Plan：▶ 点 Lonsdale St 西行 → 1 lane → 08:00；VMS 第一帧 ROADWORK AHEAD @ 300 m；标志牌 RIGHT LANE CLOSED @ 100 m；规则检查 ✓ | "This is live, in the browser. One lane on Lonsdale Street westbound, 8 am. Signs where the standard puts them — rule check is green. The engine answers straight away: a queue of about 900 metres, about eight and a half extra minutes for every car that reaches it, about 175 vehicle-hours lost across the network in that hour, and 15 bus routes — about 1,900 riders — slowed down." | B 点 · A 讲 | ⭐ 数字当场跳出 |
| 2:00 | Step 1 同屏：▶ 人行道切成封一侧（left），讲完切回 | "The brief also asks about pedestrians. Close the footpath on one side: 185 people an hour now walk an extra 176 metres and cross the road twice more. That one is an estimate — most footpath counts here are interpolated, and the page says so." | B 点 · A 讲 | |
| 2:30 | Step 2 See the impact：地图框住排队红线、绕行线（线宽 = 占比）、变慢路段、受影响公交线；右边「车往哪走」「谁受影响、为什么」 | "Here is why. 86% of drivers stay on Lonsdale and queue; Russell, Exhibition and Spring take about 5% each. The sign only says ROADWORK AHEAD — it warns people, it doesn't tell them where to go. Commuters, locals, visitors and delivery drivers read it differently, and the panel says why. Buses can't detour, so their riders wear the queue: about 18,700 rider-minutes in one hour." | A 讲 · B 指 | |
| 3:30 | Step 3 Fix：▶ 在 VMS 第二帧打 USE RUSSELL ST | "So change the words, not the street. One more frame: USE RUSSELL ST. The queue drops from about 900 to about 550 metres. Network delay down 45%. Bus riders down 40%." | B 打字 · A 讲 | ⭐ 哇 1 |
| 3:55 | 三套方案并排（`be.options()`：Minimum / Standard / Guided，按库存、带租金，标「假设价」） | "It also builds plans from RPM's inventory. Minimum — barriers and signs — A$515 for five days. Standard adds an arrow board and a VMS: A$1,765, and the queue doesn't move, because a sign that only warns changes nobody's route. Guided is the same hardware at the same price; the VMS names the fastest detour and the time it saves. Queue: about 80 metres. Delay down about 90%." | B 点 · A 讲 | ⭐⭐ 同价不同字 |
| 4:30 | 同屏：绕行 14% → 61% 旁的假设灰字；或切备用页 B1 敏感性 | "Too good to be true? It depends on how many drivers follow a named detour. We calibrate to a field trial — about one driver in five (Erke et al., 2007) — not to what people say in surveys: in London, real diversion was a fifth of stated intention. If only half as many follow, Guided still cuts the queue from 918 to about 160 metres. The size is uncertain; the direction isn't." | A | |
| 4:50 | 叠加冲突：▶ 加附近同一周的第二处施工 → 冲突成本 → 一键错开 | "Now the problem nobody owns: two permits, each fine on its own, same streets, same week. Together they cost [T21 number] extra vehicle-minutes — that's the clash. Stagger one by [T21 number] days and it drops to [T21 number]."（T21 没上页面就切备用页，说 "on our test grid, 29,850 vehicle-minutes of clash; a five-day stagger takes it to zero"） | B 点 · A 讲 | ⭐ 哇 2 |
| 5:20 | ▶ 选定 Guided → 一页导出（设备清单 + 报价 + VMS 排程 + 通知对象） | "The planner picks Guided and exports one page: the equipment list and quote for RPM, the VMS schedule, and who to notify. The numbers go into the approval; the gear goes on the truck." | B 点 · A 讲 | |
| 5:40 | 幻灯片 4：怎么做到的（架构 v2）+ 真实 / 假设 | "A language model's only job is to read the sign like a driver: noticed, understood, trusted, which way it points. Today that reading is a transparent rule set, labelled on screen; the model hook is built and switched off. Every number comes from the engine, in under 10 milliseconds, same answer every time. And we label what's assumed: three-quarters of link flows are interpolated, 29 of 37 behaviour parameters are low-confidence, each shown with a range." | A | |
| 6:15 | 幻灯片 5：谁用、谁买单、路线图（8 步） | "Council officers approving plans, contractors writing them, and RPM Hire — who can attach an impact report to every quote and sell the right words, not just the boards. Next: validate against a real past closure, check clashes across all the city's permits, and switch on the language model for sign reading." | A | |
| 6:45 | 幻灯片 6：收尾 + 链接 / 二维码（队定） | "Before the barriers go out, try the closure on the twin. Change the words, not the street. Thank you." | A | ⭐ |
| | | | | |

## 预置数据与重置方法

- 演示账号 / 房间：`<不写凭据，写在哪拿>`
- 重置：`<命令>` —— ⚠️ 只用「清空数据保留链接」，**不用会让已发出链接失效的破坏性重置**

## Pitch 大纲（每页 2–3 句讲稿）

主线 = 一处工地（Lonsdale St 西行 08:00）、一个故事、三步（Plan → See the impact → Fix）。「可验证的效果」不单做一页，数字在演示里当场出，幻灯片 4 只放「真实 / 假设」对照。

| 页 | 内容 | 讲稿（2–3 句，原句见演示脚本） | 时间 |
|---|---|---|---|
| 1 | 钩子：Lonsdale St 一条红色排队线 + 「Change the words, not the street」 | 一条道、约 900 m 排队；同样的设备同样的价钱，换屏上的字就降到 100 m 以下（模型结果） | 0:15 |
| 2 | 问题：谁痛（council、承包商、RPM 的客户）、怎么痛（排队、公交、行人事先算不出；绕行比例拍脑袋；每张许可单独审） | 赛题点名的三类影响：surrounding traffic、pedestrians、public transport | 0:30 |
| 3 | 方案一句话 + 数据底（1,513 条路段 · 8 周 SCATS · PTV 时刻表 · 市政行人计数器） | 摆你真会租的护栏、标志牌、VMS；看各类人看到什么、会怎么做、代价多少 | 0:15 |
| —（线上页面） | 演示 Plan → Impact → Fix → 三套方案 → 叠加冲突 → 导出 | 见上表 1:00–5:40；每一步都有一张隐藏的截图备用页 D1–D6（线上挂了就翻截图，台词不变） | 4:40 |
| 4 | 怎么做到的：架构 v2（大模型只读屏、今天是规则；引擎算所有数，< 10 ms，同样输入同样结果）+ 真实 / 假设两栏 | 真实：SCATS、PTV GTFS、市政行人计数器、OSM 路网；假设：74% 路段车流插值、37 个参数里 29 个低置信、每趟载客、租金 | 0:35 |
| 5 | 谁用、谁买单 + 8 步路线图（D-0929-2011：登记 → 现状 → 出方案 → 仿真 → 叠加 → AI 解读 → 人来定 → 导出；已做的打勾） | RPM 每张报价单附影响报告、卖「对的字」；council 拿到审批要的数；下一步先做真实封路回测 | 0:30 |
| 6 | 收尾一句 + 链接 / 二维码（队定，见初筛拍板第 2 条） | "Change the words, not the street." | 0:15 |
| B1–B6 | 问答备用页（不放映）：B1 敏感性表、B2 数据出处和许可、B3 验证计划、B4 和 Aimsun / Mooven 等的区别、B5 真路网冲突成本 [T21]、B6 引擎公式（BPR + 排队 + 分类型选择模型 + 两点校准） | 被问到才翻 | — |

Slides 链接：`<>` · 导出 PDF：`docs/pitch-assets/slides.pdf`

## 评分标准对照（以 `1-brief` 为准）

| 评分项 | 我们的证据 | 在第几页 / demo 哪一步 |
|---|---|---|
| 潜在成效 40% | 用赛题点名的输入（barriers / signage / VMS）回答赛题点名的三类影响：车（排队约 900 m、每车 +8.5 分钟）、公交（15 条线 18,693 人·分）、行人（185 人/时多走 176 m、多过 2 次马路）；而且能改变决定：换屏上的字 −45%，同价的引导档 −91%；叠加冲突给出错开天数 | 幻灯片 2；演示 1:00–5:20 |
| 技术可行性 30% | 线上能打开（Cloudflare），计算在浏览器里、单次 < 10 ms、同样输入同样结果；任意一条 CBD 路段都能点；真数据 1,513 条路段 / 56 天 SCATS / PTV GTFS / 市政行人计数器；引擎 7 个测试文件，含反向断言；哪些是估算当场标出（74% 路段车流插值、29/37 参数低置信） | 演示 1:00（现场算）、3:30（打字数字就变）；幻灯片 4；问答 1–4 |
| 原创性 15% | 模拟「人读到了什么」而不只是「路少了一段」（大模型读屏、引擎算数，D-0929-1435）；按实地试验校准，不按问卷口头说法；叠加冲突成本 D(A+B) − D(A) − D(B)；按真实租赁库存出方案并报价 | 演示 3:30–5:20；幻灯片 4 |
| 商业与社会可行性 10% | RPM：每张报价附影响报告，卖「引导」而不只卖设备（同价差 90%）；council：审 TMP 要的数；承包商：浏览器打开就用、不装软件；只用开放数据（ODbL / CC BY），不碰个人数据 | 幻灯片 5；演示 5:20 导出 |
| 展示 5% | 一处工地、一个故事、三步；嘴上 2 位有效数字；假设在被问之前先说（4:30）；彩排 ≥ 2 次、兜底 A/B/C | 全程；下面彩排记录 |

## 评委问答预案

🔥 = 模拟评委团（`docs/arch/judge-panel-0929.md`）点名会问的。回答先一句结论，再一个数或出处；不知道就说「not yet」+ 下一步。

| # | 问题 | 回答要点（英文照说） | 谁答 |
|---|---|---|---|
| 1 | 🔥 Is this computed live, or scripted? | Live, in your browser. Every click reruns the engine on the real network — under 10 ms, same input same answer. Name a street or an hour and we'll run it now. The only thing not "live" is sign reading, and today that's a rule set, labelled on screen.（别当场演「全封」和「错峰更好」，见彩排雷区） | [ ] |
| 2 | 🔥 Where do the numbers come from? | Traffic: 8 weeks (56 days) of SCATS hourly counts on 1,513 OpenStreetMap links; 386 links measured, 1,127 interpolated and marked "estimated". Buses and trams: PTV GTFS timetables; riders per trip assumed (25 per bus at peak). Pedestrians: City of Melbourne counters, mostly interpolated. Delay: BPR travel times plus a deterministic queue. | [ ] |
| 3 | 🔥 How do you know drivers follow the sign? | We don't assume it; we calibrate it. A warning-only sign moves about 3% of drivers, a named detour about 20% (Erke, Sagberg & Hagman 2007 field trial, range 10–30%). We deliberately don't use survey answers: in London real diversion was a fifth of stated intention (Chatterjee 2002). If only 10% follow, USE RUSSELL ST still gives −24% delay and Guided still takes the queue from 918 to 161 m. Size uncertain, direction robust. | [ ] |
| 4 | 🔥 Has it been validated? | Not against a real closure yet — that's step one after the hackathon. What we have: baseline flows come from real counts, behaviour anchors from field trials, 7 engine test files with reverse assertions (e.g. a closure can never make anyone faster). Plan: back-test a past Melbourne CBD closure using before/after SCATS counts. | [ ] |
| 5 | 🔥 Why not Aimsun, VISSIM or SIDRA? | Those are expert tools — very accurate, days of calibration by a traffic engineer, desktop licences. We're the 30-second screening layer before that: a planner or an RPM sales rep can test sign wording and staging in a browser. They model lost capacity; we also model what the sign says. Big jobs still go to them. | [ ] |
| 6 | 🔥 Why not Mooven / one.network? | As far as we know, Mooven measures travel-time impact once works are on the road — after. We're before the barriers go out. Works registers such as one.network show overlapping permits; we put a price in minutes on the overlap and suggest the stagger.（🟡 竞品点名前按初筛拍板第 6 条确认） | [ ] |
| 7 | 🔥 Is the LLM real? | Not in this demo, on purpose. Sign reading is a transparent keyword rule, labelled "rules estimate". The LLM hook is built (OpenAI-compatible endpoint, answers cached, off by default); switching it on is configuration. Even then the model only reads the sign — noticed, understood, trusted, which route — and every number comes from the engine, so it stays reproducible.（D-0929-1718、1830） | [ ] |
| 8 | 🔥 What does RPM Hire get? | A reason to sell guidance, not just hardware: Standard and Guided cost the same (A$1,765 for 5 days, assumed prices) and differ by 90% in delay — the value is in the words. An impact report on every quote helps their customers get council approval faster. Plans never exceed stock. Model: per-plan fee, or bundled with hire. | [ ] |
| 9 | 🔥 Data licences? Privacy? | All open data: OpenStreetMap (ODbL, credited on the page), SCATS via DataVic, PTV GTFS and City of Melbourne (CC BY 4.0). Only aggregate counts — no personal data, no tracking, no login. | [ ] |
| 10 | 🔥 Negative delays? Data quality? | We found one and fixed it: a slow side street (Little Bourke St, 20 km/h) made detours look like savings; now a closure can never make a trip faster (#58). Broken SCATS detectors (negative reads) are flagged and those links estimated, with the method recorded per link; some links already run over capacity, so we only count the extra caused by the works. | [ ] |
| 11 | 🔥 Why 918 m from 513 vehicles an hour? Isn't that too precise? | Say "about 900 metres". It's a deterministic queue at the reduced capacity for that hour, with demand from SCATS (513 vehicles on that link at 8 am). We treat the before/after difference as the result and the absolute as indicative; spillback into upstream junctions isn't modelled yet.（🟡 lead 补：封一道后该路段通行能力的数） | [ ] |
| 12 | Where do the four traveller types and 50/25/10/15 come from? | Assumed — there's no CBD survey split — and labelled "assumed" with a range on screen (D-0929-1536). Parameters per type (hurry, familiarity, trust, queue aversion, truck-only) each carry a source and a confidence in params.json. | [ ] |
| 13 | Cyclists? Wheelchair users? | Not yet. Cycling isn't modelled; step-free access is null because the footpath data has no kerb or ramp detail. We have an intersection micro-simulation prototype at La Trobe × Swanston — illustrative only, shown on request. | [ ] |
| 14 | Does it scale beyond the CBD? | The engine is generic: OpenStreetMap plus SCATS, which DataVic publishes statewide. The CBD was chosen because counts are dense. Bigger areas need data preparation, not a new engine. | [ ] |
| 15 | Which LLM, what does it cost, where is data sent? | Provider-agnostic. Each sign message is read once per traveller type and cached — a fraction of a cent each. For councils we'd use an Australian-hosted model (DeepSeek is off the table on federal devices). | [ ] |
| 16 | What did you build during the hackathon? | All product code after kickoff. Before the event we only prepared collaboration scripts (branch checks, secret scan), disclosed in the README（D-0929-1311）. | [ ] |
| 17 | Will you keep going? | [ 队定 ] 建议：validate on one past closure → switch on LLM reading with cached answers → pilot with RPM on one live worksite. | [ ] |

### 问答和演示用的数（09-29 22:10 在 origin/main `6bedd9e` 上用 `connect()` 实测，T5 规则读屏；Lonsdale St 西行、封 1 条道、08:00、路人占比是假设值）

| 说法 | 数 | 怎么复现 |
|---|---|---|
| 基线：屏上只写 ROADWORK AHEAD | 排队 918 m；每辆受影响车 +509 s；绕行 14%；全网 10,493 车·分；公交 15 条线、1,925 人/时、18,693 人·分 | `be.run(be.demo('lonsdale', { frames: [['ROADWORK','AHEAD']] }))` |
| 加一帧 USE RUSSELL ST（线上默认） | 548 m；5,746（−45%）；+244 s；绕行 35%；公交 11,206（−40%） | `be.run(be.demo('lonsdale'))` |
| o1 最省 / o2 标准 | A$515 / A$1,765（5 天，价格是假设值）；都是 918 m、10,493 | `be.options(be.demo('lonsdale'))` |
| o3 引导（ROADWORK AHEAD + USE / RUSSELL / SAVE 9 MIN） | A$1,765；82 m；966（−91%）；+48 s；绕行 61%；公交 1,722 | 同上 |
| 顾问 `advise()`（main 现状） | USE / RUSSELL / SAVE 5 MIN，替换两帧 → 8 点 191 m、1,964 | `be.advise(be.demo('lonsdale'))`；和 o3 不一致，见下面拍板 2 |
| 敏感性：点名绕行锚点 20% → 10% | USE RUSSELL ST 730 m、7,975（−24%）；o3 的字 161 m、1,685（−84%） | `params.json` 的 `anchors.named_route_divert` 改 0.1 再 `connect()` |
| 敏感性：锚点 → 5% | 856 m、9,641（−8%）；o3 的字 309 m、3,126（−70%） | 同上改 0.05 |
| 封一侧人行道（left） | 185 人/时，每人多走 176 m，多过 2 次马路，417 人·分；封另一侧（right）多走 67 m | `closes.footpath: 'left'`；T17 README 实测一致 |
| 叠加冲突 | 方格测试路网 29,850 车·分，推迟 5 天 → 0；真 CBD 路网 [T21 number] | `node apps/engine/tools/demo.mjs --real`；真路网等 T21 |
| 参数、路段 | 37 个参数里 29 个低置信或假设；1,513 条路段里 1,127 条车流是插值 | 初筛出处表（T15 分支） |

### 要 lead / 全队拍板

1. pitch owner、讲者 A、操作 B 是谁
2. 演示走哪条「改字」：o3 引导档（SAVE 9 MIN → 82 m）还是顾问卡（main 上现在是 SAVE 5 MIN → 191 m）；两处的字最好冻结前统一，不然评委看到两个说法
3. T21 真路网冲突成本出来后，把 4:50 那行和上表的 [T21 number] 换掉；出不来就按脚本里的备用说法讲方格路网
4. 问答 6 能不能点名竞品（同初筛拍板第 6 条）

## 兜底（三级）

| 级 | 方式 | 条件 | 谁的电脑 |
|---|---|---|---|
| A | 线上 `DEMO_URL` | 网络正常 | |
| B | 本地 preview + `MOCK=1` | 线上挂 / 断网 | |
| C | 录屏视频（`out/demo.mp4`，不入库；链接写 conf 的 `VIDEO_URL`） | 什么都挂 | |

## 演示前 30 分钟清单

- [ ] `?v=` 已更新，线上是最新版
- [ ] 无痕窗口提前开好标签页（线上 + 本地）
- [ ] 关通知、放大字号（浏览器 125%）
- [ ] 充电、备用热点
- [ ] 断网测一遍 B 线

## 彩排记录

| 次数 | 时间 | 用时 | 卡在哪 | 改了什么 |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

## 试跑观察（`/demo` 第三步写入）

| 编号 | 严重度 | 几人独立撞上 | 问题 | 状态 |
|---|---|---|---|---|
| | | | | |

经核查不成立的：`<单列，别混进上表>`
失败 / 没返回的 agent：`<数量，单独计>`

## 对外文案审阅

| 文案 | AI 起草 | 谁过目 | 状态 |
|---|---|---|---|
| README 评委段 | | | 🟡 |
| 提交表单各字段 | | | 🟡 |
| 视频字幕 / 旁白 | | | 🟡 |

## 🔒 提交清单（以 `1-brief` 的官方要求为准；每项要有验证方式）

### 仓库

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 1 | `bash scripts/check.sh` 全量绿 | lead | 贴汇总行 | ⬜ |
| 2 | `bash scripts/secret-scan.sh --history` 零命中 | lead | 贴输出 | ⬜ |
| 3 | `.env`、数据、大文件不在历史里 | lead | `git log --all --stat` 抽查 | ⬜ |
| 4 | LICENSE 里的队名已改 | lead | 打开看 | ⬜ |
| 5 | README 顶部评委段：截图、在线地址、视频、运行方法、英文段（pitch owner 在「对外文案审阅」里起草，README 是 lead 独占区，由 lead 落盘） | lead | 打开看 | ⬜ |
| 6 | 没用到的 `starters/` 已删或已说明 | lead | `ls starters` | ⬜ |
| 7 | 赛前模板已在 README「披露」节说明 | lead | 打开看 | ⬜ |

### 演示

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 8 | `DEMO_URL` 在无痕窗口 + 手机网络下都能开 | DEPLOYER | 手机试 | ⬜ |
| 9 | 视频 unlisted 可播放，时长合规 | pitch owner | 换个账号打开 | ⬜ |

### 材料

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 10 | Slides 导出 PDF 放 `docs/pitch-assets/` | pitch owner | 文件存在 | ⬜ |
| 11 | 表单各字段草稿写在上面「对外文案审阅」并已过目 | pitch owner | 状态 ✅ | ⬜ |
| 12 | 成员、赛道、AI 使用披露齐全 | lead | 对照 1-brief | ⬜ |

### 收尾（**由人亲手点**）

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 13 | `git tag -a submission -m "提交版本 <时间>" && git push origin submission` | lead | `git tag` | ⬜ |
| 14 | 仓库转 public（如果要求）：`gh repo edit --visibility public` | lead 亲手 | 无痕窗口打开仓库 | ⬜ |
| 15 | 在比赛平台提交表单 | lead 亲手 | 成功页截图放 `docs/pitch-assets/` | ⬜ |
| 16 | `3-tasks` 顶部标「已提交 <时间>」；提交后 main 不再改代码 | lead | | ⬜ |
