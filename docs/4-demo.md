# 4 · 演示、pitch、兜底、提交

> pitch owner 写，lead 也可以写。`/demo` 和 `/submit` 都照这份走。

## 演示脚本（决赛 7 分钟讲 + 3 分钟问答，10-01 13:30；T25 草稿 09-29 22:10，已按审查修过；pitch owner 未定）

20 秒开场钩子（A 说；屏幕上只有 Lonsdale St 一条红色排队线）：**"8 am on a weekday, one lane closes on Lonsdale Street: a queue of about 900 metres. Same barriers, same sign board, same hire bill — change what the sign says, and in our model it drops under 100 metres. RippleTwin finds those words before the barriers go out."**

- 角色：A = 讲者 [ ]，B = 操作 [ ]。B 只点不说；A 说到 ▶ 时 B 点。所有台词都是英文原句，A 可以换说法，数字不换
- 步骤名一律用页面上的真名：顶部是 **01 Plan / 02 Stress test / 03 Ripple trace / 04 Repair**。演示只走 01 → 03 → 回 01；**02 Stress test 不点**（写死的示意场景，见雷区 4），04 Repair 不点（见雷区 2）
- 开场前页面状态：EN、浅色、天气晴（D-0929-2012 天气只是「示意」，全程不碰）、01 Plan、预设「Lonsdale St · 08:00」、封 1 条道、VMS 只留第 1 帧 ROADWORK AHEAD。⚠️ 线上 `demo('lonsdale')` 默认带第 2 帧 USE RUSSELL ST，开场前要删掉，3:15 再当场打回去
- 数字口径：嘴上说 2 位有效数字（约 900 m、约 8.5 分钟），幻灯片和屏幕给精确值。每个数的出处和复现方法见下面「评委问答预案」里的「问答和演示用的数」
- 时长：口播按每分钟 150 词估，每格的词数都在格子时长以内；6:45 讲完，留 15 秒余量
- 彩排雷区（09-29 22:10 在 origin/main `6bedd9e` 上用 `connect()` 实测）：
  1. 别切 11:00 来证明「错峰更好」：只写 ROADWORK AHEAD 时 11:00 排队 932 m，比 8 点的 918 m 还长（17:00 是 860 m）。评委要换小时就换，不预告方向
  2. 顾问卡和三套方案的字不一样：04 Repair 调的是 `advise()`，现在给「USE / RUSSELL / SAVE 5 MIN」并替换掉两帧（8 点 → 191 m、1,964 车·分）；`options()` 的 o3 引导档是「ROADWORK AHEAD + USE / RUSSELL / SAVE 9 MIN」（→ 82 m、966）。稿子走 o3 这条，演示不点 04 Repair；评委要看再点，照屏幕念数，不背稿
  3. 「全封」这次没核对（`closes.lanes` 要填 ≥ 车道数），彩排先点一遍再决定演不演
  4. 不切 La Trobe（D-0929-1650：几乎不堵）。**不点 02 Stress test，也不主动展示 La Trobe × Swanston 路口微观仿真**：那是 `script:true`、seed 4218 写死的示意场景（`5-app.js` 的 `newStress`），屏上有 CRITICAL RIPPLE、C-17、D-42，和问答 1 的「live, not scripted」正面冲突。被问到就直说 "that's a scripted illustration, not the engine"
  5. 3:40 三套方案并排、4:15 的「绕行 14% → 61%」、5:05 选定和导出都靠 **T23**（@jinmingq，`be.options()` 上页面 + 并排 + 选定 + 导出），线上 `6-engine.js` 现在不调 `options()`；4:35 叠加冲突靠 **T21**。冻结前没上页面就走各格写的兜底，台词不变
  6. 页面上还没有 OpenStreetMap / 数据署名（`apps/web/src`、`public/index.html` 里都搜不到 OpenStreetMap、ODbL）：加上之前，问答 9 不说 "credited on the page"（见拍板 5）

| 时间 | 屏幕上是什么 | 说什么 | 谁操作 | 哇？ |
|---|---|---|---|---|
| 0:00 | 幻灯片 1：黑底，Lonsdale St 一条红色排队线 | 上面的 20 秒开场钩子 | A | ⭐ |
| 0:20 | 幻灯片 2：谁痛、怎么痛 | "Every week, councils approve traffic management plans, and contractors hire barriers, signs and VMS boards — from companies like RPM Hire. Before that gear goes out, nobody can say how long the queue will be, which buses run late, or where pedestrians must walk. How many drivers detour is a rule of thumb, and every permit is checked on its own." | A | |
| 0:50 | 幻灯片 3：一句话 + 数据底（1,513 条路段 · 8 周 SCATS · PTV 时刻表 · 市政行人计数器，**只放屏上，不念**） | "RippleTwin is a digital twin of the Melbourne CBD for temporary works. Place the barriers, signs and VMS you would actually hire, and see what drivers, bus riders and pedestrians will see, do, and lose — on real data." | A | |
| 1:05 | 线上页面 **01 Plan**：▶ 点预设「Lonsdale St · 08:00」（Lonsdale St 西行）→「1 lane」→ 08:00；VMS 第 1 帧 ROADWORK AHEAD @ 300 m、第 2 帧空；标志牌 S-1 RIGHT LANE CLOSED @ 100 m；规则检查没有红色 ✕；同面板下方「Engine · real CBD flows」结果卡出数 | "This is live, in the browser. One lane on Lonsdale Street westbound, 8 am. Signs where the standard puts them — no rule-check errors. The engine answers straight away: a queue of about 900 metres, about eight and a half extra minutes for every car that reaches it, about 175 vehicle-hours lost across the network in that hour, and 15 bus routes — about 1,900 riders — slowed down." | B 点 · A 讲 | ⭐ 数字当场跳出 |
| 1:55 | 还在 01 Plan：▶ 人行道点「Works-side footpath closed」，讲完点回「Footpath open」 | "The brief also asks about pedestrians. Close the footpath on the works side: 185 people an hour now walk an extra 176 metres and cross the road twice more. That one is an estimate — most footpath counts here are interpolated, and the page says so." | B 点 · A 讲 | |
| 2:25 | ▶ 点顶部 **03 Ripple trace**（跳过 02）：地图框住排队红线、绕行线（线宽 = 占比）、变慢路段、受影响公交线；右边「Where drivers go」「Who is hit · and why」，上面一行写着 1,072 veh/h 过施工段、只能过 810 veh/h | "Here is why. 86% of drivers stay on Lonsdale and queue; Russell, Exhibition and Spring take about 5% each. The sign only says ROADWORK AHEAD — it warns people, it doesn't tell them where to go. Commuters, locals, visitors and delivery drivers read it differently, and the panel says why. Buses can't detour, so their riders wear the queue: about 18,700 rider-minutes in one hour." | A 讲 · B 指 | |
| 3:15 | ▶ 点回 **01 Plan**，在 VMS 第 2 帧（`#vmsF2`）打 USE / RUSSELL ST（每行一句） | "So change the words, not the street. One more frame: USE RUSSELL ST. The queue drops from about 900 to about 550 metres. Network delay down 45%. Bus riders down 40%." | B 打字 · A 讲 | ⭐ 哇 1 |
| 3:40 | **[depends on T23]** 三套方案并排（`be.options()`：Minimum / Standard / Guided，按库存、带租金，标「假设价」）。**T23 没上页面的兜底**：B 在 01 Plan 把第 2 帧改成 USE / RUSSELL / SAVE 9 MIN（三行，每行 ≤ 10 字，共 7 个词，能过规则检查；可能出黄色「!」提示行长 > 8，不影响）→ 结果卡出 82 m、绕行 61%；价格对比翻备用截图页 D4 | "It also builds plans from a stand-in RPM catalogue with assumed day rates. Minimum — barriers and signs — A$515 for five days. Standard adds an arrow board and a VMS: A$1,765, and the queue doesn't move, because a sign that only warns changes nobody's route. Guided is the same hardware at the same price; the VMS names the fastest detour and the time it saves. In our model the queue drops to about 80 metres, delay down about 90%." | B 点 · A 讲 | ⭐⭐ 同价不同字 |
| 4:15 | **[depends on T23]** 同屏：绕行 14% → 61% 旁的假设灰字；T23 没上就指 01 Plan 结果卡的「Detouring 61%」，或切备用页 B1 敏感性 | "Too good to be true? Following a named detour is calibrated to a field trial — about one driver in five (Erke et al., 2007). The extra pull of 'save 9 minutes' is our model's assumption: halve driver trust and Guided still cuts the queue, to about 500 metres." | A | |
| 4:35 | **[depends on T21]** 叠加冲突：▶ 加附近同一周的第二处施工 → 冲突成本 → 一键错开 | "Now the problem nobody owns: two permits, each fine on its own, same streets, same week. Together they cost [T21 number] extra vehicle-minutes — that's the clash. Stagger one by [T21 number] days and it drops to [T21 number]."（T21 没上页面就切备用页，说 "on our test grid, 29,850 vehicle-minutes of clash; a five-day stagger takes it to zero"） | B 点 · A 讲 | ⭐ 哇 2 |
| 5:05 | **[depends on T23]** ▶ 选定 Guided → 一页导出（设备清单 + 报价 + VMS 排程 + 通知对象）；没上就翻备用页 D6 | "The planner picks Guided and exports one page: the equipment list and quote for RPM, the VMS schedule, and who to notify. The numbers go into the approval; the gear goes on the truck." | B 点 · A 讲 | |
| 5:25 | 幻灯片 4：怎么做到的（架构 v2）+ 真实 / 假设 | "A language model's only job is to read the sign like a driver: noticed, understood, trusted, which way it points. Today that reading is a transparent rule set, labelled on screen; the model hook is built and switched off. Every number comes from the engine, in under 10 milliseconds, same answer every time. And we label what's assumed: three-quarters of link flows are interpolated, 29 of 37 behaviour parameters are low-confidence, each shown with a range." | A | |
| 6:00 | 幻灯片 5：谁用、谁买单、路线图（8 步） | "Council officers approving plans, contractors writing them, and RPM Hire — who can attach an impact report to every quote and sell the right words, not just the boards. Next: validate against a real past closure, check clashes across all the city's permits, and switch on the language model for sign reading." | A | |
| 6:30 | 幻灯片 6：收尾 + 链接 / 二维码（队定） | "Before the barriers go out, try the closure on the twin. Change the words, not the street. Thank you." | A | ⭐ |
| 6:45 | （余量 15 秒） | | | |

## 初筛 3 页（09-30 12:30 截止，草稿 09-29 17:40，21:00 按 T16–T19 上线后的数字更新）

- PDF：`docs/pitch-assets/00-prescreen.pdf`（16:9，3 页，约 410KB）· 源文件 `00-prescreen.html`（浏览器打开就是三页，改字直接改 HTML）
- 第 1 页右边前后对比 `01-before-*.jpg` / `01-after-*.jpg`：线上页面（液态玻璃版）Lonsdale St 08:00，屏上只写 ROADWORK AHEAD 对比加一帧 USE RUSSELL ST 的面板截图（09-29 20:51，无头 Chrome 切到「详细」后截）
- 第 3 页嵌的是 `03-architecture-v2.html?lang=en`：在 #42 原图上改了 6 处字，把 AI 框标成「rules today」（D-0929-1718：大模型读屏先不接）；行人电车 T17/T18 已接上，不再标 next。原图 `03-architecture.html` 没动
- 重新导出（Mac）：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=5000 --print-to-pdf=docs/pitch-assets/00-prescreen.pdf "file://$PWD/docs/pitch-assets/00-prescreen.html"`；或浏览器打印 → 另存为 PDF → 边距「无」→ 勾「背景图形」
- 过程：4 个 agent 核实仓库里的数 → 2 版草稿合成 → 事实 / 评委 / 规矩三路挑错 → 定稿（全文在 lead 本机 `.claude/agent-out/prescreen-*.md`，不入库）

### 要全队拍板（提交前）

| # | 事 | 现在页面上 |
|---|---|---|
| 1 | 队名 | 三页都是 `[Team name]` 占位；提交只写队名，不写队员姓名 |
| 2 | 放不放线上链接 + 二维码：网址子域里有队员 handle（zemmmeng），和「只写队名」可能冲突 | 第 2 页 `[demo link + QR — team to confirm]` |
| 3 | 头条用 Lonsdale −45%（和线上默认场景一致，D-0929-1650）；公交乘客 −40% 作副标题 | 第 1 页绿条、第 2 页 |
| 4 | 冲突成本 29,850 是方格测试路网上的数；要不要今晚在真 CBD 上重跑 | 第 2 页标了 test grid |
| 5 | 第 2 页 MVP 照 #48 的「冻结前做 5 件」写：叠加冲突上页面、按库存出 3 套方案带租金、多方案对比 + 选定 + 一页导出；团队看做不做得完 | 第 2 页 MVP 栏 |
| 6 | 点名 RPM VMS Preview、Mooven、one.network 行不行（只写文字，不用 logo） | 第 1 页 What's different |
| 7 | 第 3 页用架构图 v2 还是原图 | 用 v2 |
| 8 | 谁在 09-30 12:30 前交到 Canvas「Pre-screening Submissions」；交前把第 2 页脚注的 Status 时间改成交稿时间 | — |

### 页面上每个数的出处（评委问「数哪来的」照这个答）

| 页面上的说法 | 出处 |
|---|---|
| Lonsdale St 延误 −45%（10,493 → 5,746 车·分钟，排队 918 → 548 m） | `backend.js` 的 `connect().compare()`，demo `lonsdale`（1 条车道、8 点、513 辆车），读屏是关键词规则；线上页面同一条路径，截图里的数一致 |
| 公交乘客 −40%（15 条线、每小时 1,925 人，18,693 → 11,206 人·分钟） | 同一次 `compare()` 的 `summary.transit`（T17，PTV GTFS）；每班 25 人是假设值 |
| 封一侧人行道：每小时 185 人多走 176 m、多过 2 次马路 | `run()` 的 `summary.peds`（T18），`closes.footpath: 'left'`；这段人流按同街插值（`method: street_interp`），不是实测 |
| 顾问改写「USE / RUSSELL / SAVE 9 MIN」后排队 82 m、8 点延误 966 车·分钟 | `advise()` 第一个改法重跑（规则版顾问）；没上页面，口头备用 |
| 3 套方案 A$515–1,765，引导那套排队 918 → 82 m | `be.options(demoPlan('lonsdale'))`（T22，#59）：o1 最省 A$515 / 918 m，o2 标准 A$1,765 / 918 m，o3 引导 A$1,765 / 82 m；租 5 天，日租价和库存是假设值 |
| London 实际绕行只有问卷说法的 1/5（Chatterjee 2002） | `apps/params/public/params.json` 里的出处原文 |
| 1,513 条路段、8 周 SCATS | `network.json` links 数；`flows.json` period 2026-08-01..09-27（用了 56 天） |
| < 10 ms 一次 | `demo.mjs --real` 实测 1.4–6.6 ms |
| 37 个参数里 29 个是假设或低置信；74% 路段车流是估算 | `params.json` confidence none 18 + low 11；`flows.json` coverage estimated 1,127 / 1,513 |
| 竞品说法 | lead 本机调研 `idea-prior-art.md` `idea-users.md`；不说「首创」 |

## 预置数据与重置方法

- 演示账号 / 房间：`<不写凭据，写在哪拿>`
- 重置：`<命令>` —— ⚠️ 只用「清空数据保留链接」，**不用会让已发出链接失效的破坏性重置**

## Pitch 大纲（每页 2–3 句讲稿）

主线 = 一处工地（Lonsdale St 西行 08:00）、一个故事、三步（01 Plan 摆设备 → 03 Ripple trace 看影响 → 回 01 Plan 改屏上的字）。「可验证的效果」不单做一页，数字在演示里当场出，幻灯片 4 只放「真实 / 假设」对照。

| 页 | 内容 | 讲稿（2–3 句，原句见演示脚本） | 时间 |
|---|---|---|---|
| 1 | 钩子：Lonsdale St 一条红色排队线 + 「Change the words, not the street」 | 一条道、约 900 m 排队；同样的设备同样的价钱，换屏上的字就降到 100 m 以下（模型结果） | 0:20 |
| 2 | 问题：谁痛（council、承包商、RPM 的客户）、怎么痛（排队、公交、行人事先算不出；绕行比例拍脑袋；每张许可单独审） | 赛题点名的三类影响：surrounding traffic、pedestrians、public transport | 0:30 |
| 3 | 方案一句话 + 数据底（1,513 条路段 · 8 周 SCATS · PTV 时刻表 · 市政行人计数器；数据清单只放屏上） | 摆你真会租的护栏、标志牌、VMS；看各类人看到什么、会怎么做、代价多少 | 0:15 |
| —（线上页面） | 演示 01 Plan → 03 Ripple trace → 回 01 Plan 改字 → 三套方案 [T23] → 叠加冲突 [T21] → 导出 [T23] | 见上表 1:05–5:25；每一步都有一张隐藏的截图备用页 D1–D6（线上挂了、或 T21 / T23 没上页面就翻截图，台词不变） | 4:20 |
| 4 | 怎么做到的：架构 v2（大模型只读屏、今天是规则；引擎算所有数，< 10 ms，同样输入同样结果）+ 真实 / 假设两栏 | 真实：SCATS、PTV GTFS、市政行人计数器、OSM 路网；假设：74% 路段车流插值、37 个参数里 29 个低置信、每趟载客、租金 | 0:35 |
| 5 | 谁用、谁买单 + 8 步路线图（D-0929-2011：登记 → 现状 → 出方案 → 仿真 → 叠加 → AI 解读 → 人来定 → 导出；已做的打勾） | RPM 每张报价单附影响报告、卖「对的字」；council 拿到审批要的数；下一步先做真实封路回测 | 0:30 |
| 6 | 收尾一句 + 链接 / 二维码（队定，见初筛拍板第 2 条） | "Change the words, not the street." | 0:15 |
| B1–B6 | 问答备用页（不放映）：B1 敏感性表（锚点 10% / 5%、trust 减半）、B2 数据出处和许可（含 © OpenStreetMap contributors, ODbL）、B3 验证计划、B4 和 Aimsun / Mooven 等的区别、B5 真路网冲突成本 [T21]、B6 引擎公式（BPR + 排队 + 分类型选择模型 + 两点校准） | 被问到才翻 | — |

Slides 链接：`<>` · 导出 PDF：`docs/pitch-assets/slides.pdf`

## 评分标准对照（以 `1-brief` 为准）

| 评分项 | 我们的证据 | 在第几页 / demo 哪一步 |
|---|---|---|
| 潜在成效 40% | 用赛题点名的输入（barriers / signage / VMS）回答赛题点名的三类影响：车（排队约 900 m、每车 +8.5 分钟）、公交（15 条线 18,693 人·分）、行人（185 人/时多走 176 m、多过 2 次马路）；而且能改变决定：换屏上的字 −45%，同价的引导档 −91%（模型结果；trust 减半仍 −51%）；叠加冲突给出错开天数 | 幻灯片 2；演示 1:05–5:05 |
| 技术可行性 30% | 线上能打开（Cloudflare），计算在浏览器里、单次 < 10 ms、同样输入同样结果；任意一条 CBD 路段都能点；真数据 1,513 条路段 / 56 天 SCATS / PTV GTFS / 市政行人计数器；引擎 7 个测试文件，含反向断言；哪些是估算当场标出（74% 路段车流插值、29/37 参数低置信） | 演示 1:05（现场算）、3:15（打字数字就变）；幻灯片 4；问答 1–4 |
| 原创性 15% | 模拟「人读到了什么」而不只是「路少了一段」（大模型读屏、引擎算数，D-0929-1435）；点名绕行按实地试验校准，不按问卷口头说法；叠加冲突成本 D(A+B) − D(A) − D(B)；按库存出方案并报价（替身目录、假设租金） | 演示 3:15–5:05；幻灯片 4 |
| 商业与社会可行性 10% | RPM：每张报价附影响报告，卖「引导」而不只卖设备（模型里同价差 90%）；council：审 TMP 要的数；承包商：浏览器打开就用、不装软件；只用开放数据（ODbL / CC BY），不碰个人数据 | 幻灯片 5；演示 5:05 导出 |
| 展示 5% | 一处工地、一个故事、三步；嘴上 2 位有效数字；假设在被问之前先说（4:15）；彩排 ≥ 2 次、兜底 A/B/C | 全程；下面彩排记录 |

## 评委问答预案

🔥 = 模拟评委团（`docs/arch/judge-panel-0929.md`）点名会问的。回答先一句结论，再一个数或出处；不知道就说「not yet」+ 下一步。

| # | 问题 | 回答要点（英文照说） | 谁答 |
|---|---|---|---|
| 1 | 🔥 Is this computed live, or scripted? | Live, in your browser. Every click reruns the engine on the real network — under 10 ms, same input same answer. Name a street or an hour and we'll run it now. The only thing not "live" is sign reading, and today that's a rule set, labelled on screen.（别当场演「全封」和「错峰更好」；这时候千万别点 02 Stress test，那页是写死的示意场景，见彩排雷区 4） | [ ] |
| 2 | 🔥 Where do the numbers come from? | Traffic: 8 weeks (56 days) of SCATS hourly counts on 1,513 OpenStreetMap links; 386 links measured, 1,127 interpolated and marked "estimated". Buses and trams: PTV GTFS timetables; riders per trip assumed (25 per bus at peak). Pedestrians: City of Melbourne counters, mostly interpolated. Delay: BPR travel times plus a deterministic queue. | [ ] |
| 3 | 🔥 How do you know drivers follow the sign? | We calibrate where there is evidence. A named detour moves about 20% of drivers (Erke, Sagberg & Hagman 2007 field trial, range 10–30%). The warning-only 3% is our assumption, range 1–6%. We deliberately don't use survey answers: in London real diversion was a fifth of stated intention (Chatterjee 2002). If only 10% follow a named detour, USE RUSSELL ST still gives −24% delay and Guided still takes the queue from 918 to 161 m. The extra pull of "save 9 minutes" is our model's assumption; halve driver trust and Guided still gets to about 500 m. Size uncertain, direction robust.（3% 依据 D-0929-1536） | [ ] |
| 4 | 🔥 Has it been validated? | Not against a real closure yet — that's step one after the hackathon. What we have: baseline flows come from real counts, the named-detour anchor from a field trial, 7 engine test files with reverse assertions (e.g. a closure can never make anyone faster). Plan: back-test a past Melbourne CBD closure using before/after SCATS counts. | [ ] |
| 5 | 🔥 Why not Aimsun, VISSIM or SIDRA? | Those are expert tools — very accurate, days of calibration by a traffic engineer, desktop licences. We're the 30-second screening layer before that: a planner or an RPM sales rep can test sign wording and staging in a browser. They model lost capacity; we also model what the sign says. Big jobs still go to them. | [ ] |
| 6 | 🔥 Why not Mooven / one.network? | As far as we know, Mooven measures travel-time impact once works are on the road — after. We're before the barriers go out. Works registers such as one.network show overlapping permits; we put a price in minutes on the overlap and suggest the stagger.（🟡 竞品点名前按初筛拍板第 6 条确认） | [ ] |
| 7 | 🔥 Is the LLM real? | Not in this demo, on purpose. Sign reading is a transparent keyword rule, labelled "rules estimate". The LLM hook is built (OpenAI-compatible endpoint, answers cached, off by default); switching it on is configuration. Even then the model only reads the sign — noticed, understood, trusted, which route — and every number comes from the engine, so it stays reproducible.（D-0929-1718、1830） | [ ] |
| 8 | 🔥 What does RPM Hire get? | A reason to sell guidance, not just hardware: Standard and Guided cost the same (A$1,765 for 5 days — a stand-in catalogue with assumed day rates, since RPM doesn't publish prices) and in our model differ by about 90% in delay — the value is in the words. An impact report on every quote helps their customers get council approval faster. Plans never exceed stock. Model: per-plan fee, or bundled with hire. | [ ] |
| 9 | 🔥 Data licences? Privacy? | All open data: OpenStreetMap (ODbL), SCATS via DataVic, PTV GTFS and City of Melbourne (CC BY 4.0); the attribution is on our data slide. Only aggregate counts — no personal data, no tracking, no login.（页面署名行加上之后才能改说 "credited on the page"，见拍板 5；要翻就翻 B2） | [ ] |
| 10 | 🔥 Negative delays? Data quality? | We found one and fixed it: a slow side street (Little Bourke St, 20 km/h) made detours look like savings; now a closure can never make a trip faster (#58). Broken SCATS detectors (negative reads) are flagged and those links estimated, with the method recorded per link; some links already run over capacity, so we only count the extra caused by the works. | [ ] |
| 11 | 🔥 Why 918 m? Isn't that too precise? | Say "about 900 metres". At 8 am, 1,072 vehicles an hour still use the works section; with one lane closed it passes 810. The extra 262 an hour queue — at about 7 metres a car over two lanes, that's roughly 900 m. It's written on screen in Ripple trace. We treat the before/after difference as the result and the absolute as indicative; spillback into upstream junctions isn't modelled yet.（别说 513：那只是要做绕行选择的那股车 `approach.volume`，屏上显示的是 1,072 / 810） | [ ] |
| 12 | Where do the four traveller types and 50/25/10/15 come from? | Assumed — there's no CBD survey split — and labelled "assumed" with a range on screen (D-0929-1536). Of the per-type parameters, route familiarity has a source; hurry, sign trust and queue aversion are our defaults, low confidence. In params.json only 8 of 37 values are medium or high confidence. | [ ] |
| 13 | Cyclists? Wheelchair users? | Not yet. Cycling isn't modelled; step-free access is null because the footpath data has no kerb or ramp detail.（不主动提路口微观仿真；被追问就说 "we have a scripted illustration of an intersection, not the engine"，见雷区 4） | [ ] |
| 14 | Does it scale beyond the CBD? | The engine is generic: OpenStreetMap plus SCATS, which DataVic publishes statewide. The CBD was chosen because counts are dense. Bigger areas need data preparation, not a new engine. | [ ] |
| 15 | Which LLM, what does it cost, where is data sent? | Provider-agnostic. Each sign message is read once per traveller type and cached — a fraction of a cent each. For councils we'd use an Australian-hosted model (DeepSeek is off the table on federal devices). | [ ] |
| 16 | What did you build during the hackathon? | All product code after kickoff. Before the event we prepared collaboration scripts (branch checks, secret scan) and a generic starter skeleton we didn't use; both are disclosed in the README.（D-0929-1311 删 `starters/` 还没做，main 上还在、README:181 也这么写；做掉以后才能改说 "only collaboration scripts"，见拍板 6） | [ ] |
| 17 | Will you keep going? | [ 队定 ] 建议：validate on one past closure → switch on LLM reading with cached answers → pilot with RPM on one live worksite. | [ ] |

### 问答和演示用的数（09-29 22:10 在 origin/main `6bedd9e` 上用 `connect()` 实测，T5 规则读屏；Lonsdale St 西行、封 1 条道、08:00、路人占比是假设值）

| 说法 | 数 | 怎么复现 |
|---|---|---|
| 基线：屏上只写 ROADWORK AHEAD | 排队 918 m；每辆受影响车 +509 s；绕行 14%；全网 10,493 车·分；公交 15 条线、1,925 人/时、18,693 人·分 | `be.run(be.demo('lonsdale', { frames: [['ROADWORK','AHEAD']] }))` |
| 施工段流量 vs 通行能力（问答 11） | 1,072 veh/h 要过，封一道后只能过 810 veh/h；每小时多出 262 辆，按 7 m/辆、分 2 道排 ≈ 918 m | 上一行的 `run().hot[0]`（`v` 1072、`cap` 810、`queue_m` 918）；页面 03 Ripple trace 第一行 |
| 加一帧 USE RUSSELL ST（线上默认） | 548 m；5,746（−45%）；+244 s；绕行 35%；公交 11,206（−40%） | `be.run(be.demo('lonsdale'))` |
| o1 最省 / o2 标准 | A$515 / A$1,765（5 天，替身目录、价格是假设值，`options().inventory.assumed = true`）；都是 918 m、10,493 | `be.options(be.demo('lonsdale'))` |
| o3 引导（ROADWORK AHEAD + USE / RUSSELL / SAVE 9 MIN） | A$1,765；82 m；966（−91%）；+48 s；绕行 61%；公交 1,722 | 同上；T23 没上页面时在 01 Plan 手打这两帧也得 82 m |
| 顾问 `advise()`（04 Repair，main 现状） | USE / RUSSELL / SAVE 5 MIN，替换两帧 → 8 点 191 m、1,964 | `be.advise(be.demo('lonsdale'))`；和 o3 不一致，见下面拍板 2 |
| 敏感性：点名绕行锚点 20% → 10% | USE RUSSELL ST 730 m、7,975（−24%）；o3 的字 161 m、1,685（−84%） | `params.json` 的 `anchors.named_route_divert` 改 0.1 再 `connect()` |
| 敏感性：锚点 → 5% | 856 m、9,641（−8%）；o3 的字 309 m、3,126（−70%） | 同上改 0.05 |
| 敏感性：4 类人的 trust 都减半 | USE RUSSELL ST 623 m、6,637（−37%）、绕行 30%；o3 的字 498 m、5,172（−51%）、绕行 37%；只写 ROADWORK AHEAD 不变（918 m） | `params.json` 的 `persona.<类型>.trust` 设成引擎默认值 × 0.5（commuter 0.5、local 0.3、tourist 0.55、delivery 0.4），`connect({ params: applyParams(p) })`；09-29 在 `6bedd9e` 上 node 实测 |
| 「省 9 分钟」多劝动的那部分靠什么 | 两点校准只管 3%（只写施工）和 20%（点名路线）两个锚点；35% → 61% 靠 SAVE 9 MIN，由 hurry / trust / queue_averse 决定，这三个在 `status().params_used.persona` 里都是 `default`（引擎内置默认值），只有 `familiar` 读了 `params.json` | `api.status().params_used.persona` |
| 3% 锚点 | `anchors.generic_warning_divert` = 0.03，置信度 low，lead 的假设，区间 1–6% | `apps/params/public/params.json` |
| 叠加冲突 | 方格测试路网 29,850 车·分，推迟 5 天 → 0；真 CBD 路网 [T21 number] | `node apps/engine/tools/demo.mjs --real`；真路网等 T21 |
| 参数、路段 | `params.json` 里 37 个带置信度的数：high 3、medium 5、low 11、none 18（29 个低置信或没有）；1,513 条路段里 1,127 条车流是插值 | 数 `confidence` 字段；路段见初筛出处表（T15 分支） |

### 要 lead / 全队拍板

1. pitch owner、讲者 A、操作 B 是谁
2. 演示走哪条「改字」：o3 引导档（SAVE 9 MIN → 82 m）还是顾问卡（main 上现在是 SAVE 5 MIN → 191 m）；两处的字最好冻结前统一，不然评委看到两个说法
3. T21 真路网冲突成本出来后，把 4:35 那行和上表的 [T21 number] 换掉；出不来就按脚本里的备用说法讲方格路网。T23 没在冻结前上页面，就走 3:40 的手打兜底 + 截图页
4. 问答 6 能不能点名竞品（同初筛拍板第 6 条）
5. 页面加一行署名 "© OpenStreetMap contributors (ODbL) · SCATS / PTV / City of Melbourne CC BY 4.0"：web 区归 T20 @unicornnnnnny，需要 lead 转给她（写进 T20 交接单）；加上后把问答 9 改回 "credited on the page"
6. 提交前做不做 D-0929-1311（删 `starters/`、改 README:181）：做了就把问答 16 改回 "only collaboration scripts"
7. 步骤名：稿子已按页面现名写（01 Plan / 02 Stress test / 03 Ripple trace / 04 Repair）。如果要改成 Plan / See the impact / Fix，交给 T20 并写进它的交接单，再回来改稿

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
