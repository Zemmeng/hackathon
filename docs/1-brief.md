# 1 · 赛题（只写事实，不写方案）

> 所有「官方怎么要求」都以这里为准。🔒 只有 lead 改。没核实的按最严理解并标 🟡。
> 方案去 `2-plan.md`，别写在这。
> 来源：Student Briefing PDF、Canvas 课程页（赛题 10:45 解锁后存档）、中文整理稿《评分标准》《赛题总结》。细节有出入时以英文原文为准。

## 一句话赛题

我们做**第 5 题**（D-0929-1215）：RPM Hire「Digital Tool for Temporary Infrastructure」，主题 Future Cities。做一个数字工具，在封路或施工区**上现场之前**，用常见的交通设备库存（护栏、标志牌、VMS 屏）模拟它对周边车流、行人和公共交通的连锁影响。

第 5 题原文要点（英文原文在 Canvas「Problem Statements」模块的 RPM Hire 页）：

- 用户：councils（市政）和 contractors（承包商）
- 痛点：规划 road closures 和 work zones 时，很难预见 knock-on effects；受影响对象点名三类：surrounding traffic、pedestrians、public transport
- 要做：一个 digital tool，原文动词是「simulates the impact of a planned road closure or work zone」
- 输入：typical traffic equipment inventory，点名 barriers、signage、VMS boards
- 时机：before it is deployed on site
- 原文没给数据集、没给专项评分标准、没规定交付形式，按总评分标准评

全部 9 题（5 家赞助商）：

| # | 赞助商 | 一句话 | 主题 |
|---|---|---|---|
| 1 | Airwallex | 入门活被 AI 做了，新人怎么练成专家 | Future Work |
| 2 | Airwallex | 给收入不固定的人设计金融基础设施 | Future Work |
| 3 | RPM Hire | 交通指挥员：用 AI 减疲劳、实时发现危险 | Future Work |
| 4 | RPM Hire | 施工排队队尾预警（VMS + 可变限速牌 + 报警联动）加一套指南 | Future Work |
| 5 | RPM Hire | 封路 / 施工区上线前的影响模拟工具 ← 我们 | Future Cities |
| 6 | RPM Hire | 设备运输车队换电车的商业论证和基础设施测算（5 年期） | Future Energy |
| 7 | SMEC AI | 澳洲小企业真会用、推理和数据不出境的「主权 AI」 | 原文未标 |
| 8 | Cremorne Digital Hub | 让不到 1 km² 的园区作为一个系统来运营，要能跑的原型 | Cities · Work · Energy |
| 9 | Untapped | 用 AI 让学习像游戏一样投入、像导师一样有用 | Future Work |

两个单项奖（各 $1,000）：

- **SMEC 主权 AI 奖**（Sovereign AI Award – Makers, not Takers）：资格同第 7 题硬规则，所有推理和业务数据处理只能跑在队伍自控的硬件或澳洲境内托管设施上，不能带业务数据调海外 API（open-weight 模型可以）。评四问：老板周一会用吗 · 主权程度多高 · 用得起吗 · 做得怎么样；原文没给权重
- **Untapped 创新奖**（Untapped Innovation Award）：创意与原创 25% · 技术卓越 25% · 原型 / PoC 质量 25% · 用户体验与投入度 15% · 可扩展性 10%。Canvas 页存档里只有 4 行（缺「原型 / PoC 质量」），5 行版出自中文整理稿 🟡

## 官方链接与要点

- 官网 / 赛题页：Canvas 课程 https://canvas.lms.unimelb.edu.au/courses/244146 （赛题在「Problem Statements」模块；提交入口是「Pre-screening Submissions」和「Final Presentations」）
- 要点：
  - 赛事：FEIT Hackathon Festival 2026，University of Melbourne 工程与 IT 学院，2026-09-29（周二）至 10-01（周四）
  - 形式不限：产品点子、方案、编程语言、设备都行；原文说是 open-ended、beginner friendly
  - 两轮：9/30 初筛交 3 页幻灯片，选出前 12–15 队；只有入围队 10/1 上台决赛
  - 场地：周二、周三在 Sidney Myer Asia Centre 的 Carrillo Gantner Theatre（Parkville）；周四在 Science Gallery Theatre（Melbourne Connect）
  - 名牌要一直带着：凭名牌领餐，免费咖啡券挂在名牌上
  - 主办方希望各活动和 workshop 每队至少 1–2 人在场
  - 原文不一致：Briefing 把初筛截止写成「Tuesday 30 September」、把决赛日写成「Wednesday 1 October」；9/30 是周三、10/1 是周四，以 Canvas 为准

## 关键时间（全部带时区，和 `hackathon.conf` 的 START / DEADLINE 核对）

时区 Australia/Melbourne；比赛三天都是 AEST（UTC+10），夏令时 10-04 才开始。

| 事件 | 时间 | 备注 |
|---|---|---|
| 签到 | 2026-09-29 08:45–09:20 AEST | Carrillo Gantner Theatre 外登记台领名牌 |
| 开赛 | 2026-09-29 09:30 AEST | 开幕式；与 conf `START` 一致 |
| 赛题解锁 | 2026-09-29 10:45 AEST | Canvas「Problem Statements」 |
| Hacking Time（日程表） | 周二 13:30–17:15 · 周三 09:30–13:00 · 周四 09:30–12:00 AEST | 老师确认比赛期间随时可以做，不限这几段（D-0929-1222） |
| 初筛截止 | 2026-09-30（周三）12:30 AEST | Canvas「Pre-screening Submissions」，3 页幻灯片 PDF |
| 初筛结果公布 | 🟡 没找到时间 | 入围 12–15 队 |
| 截止 | 2026-10-01（周四）12:00 AEST | 最终提交，Canvas「Final Presentations」；与 conf `DEADLINE` 一致 |
| 演示 / 评审 | 2026-10-01 13:30 AEST 起 | 入围队上台，每队 7 分钟讲 + 3 分钟问答；16:00 评委讨论 |
| 结果公布 | 2026-10-01 17:00 AEST | 颁奖 |

## 评分标准

官方总标准，初筛和决赛共用，每项 1–5 分。「评委看什么」是我们的理解，原文只有名称和权重 🟡。第 5 题没有专项评分标准；单项奖标准见上。

| 维度 | 权重 | 评委看什么 | 我们怎么拿分 |
|---|---|---|---|
| 潜在成效 Potential Effectiveness | 40% | 能不能真正解决题目里的问题，影响多大 | 初筛第 1 页（Problem Statement、方案概述）；决赛演示 |
| 技术可行性 Technical Feasibility | 30% | 已经跑通了什么，三天内能交付什么 MVP | 初筛第 2 页（技术栈、现状、MVP 计划）和第 3 页图 |
| 原创性 Originality | 15% | 思路新不新，和已有方案比有什么不同 | 初筛第 1 页方案概述 |
| 商业与社会可行性 Viability (Business & Social Uptake) | 10% | 有没有人会用、会买单，怎么推广落地 | 初筛第 1 页 |
| 展示表达 Presentation of Ideas | 5%（仅决赛） | 讲得清不清楚、有没有说服力 | 决赛 7 分钟讲 + 3 分钟问答 |

- 初筛只用前四项（合计 95%），原文没说怎么折算 🟡

## 提交物（同步到 `4-demo.md` 的提交清单）

- [ ] 代码仓库：必须公开，提交里附链接，整个评审过程所有代码保持可访问；原文没要求许可证 — 截止 2026-10-01 12:00 AEST（随最终提交）
- [ ] 演示视频：官方没要求；初筛可附 demo 视频或仓库的二维码 / 链接当加分项（出自中文整理稿，Briefing 原文没有）🟡 — 截止 无
- [ ] Slides / 文档：初筛 3 页 PDF —— 第 1 页 Project Overview（队名、项目名、Problem Statement、方案概述）；第 2 页 Tech & Progress（技术栈 / 工具、目前做出了什么、第 3 天交付的 MVP 计划）；第 3 页可选 Visuals / UI / Diagrams（mockup、线框图、架构图或用例流程）— 截止 2026-09-30 12:30 AEST。决赛「Final Presentations」要交什么、什么格式没找到原文 🟡 — 截止 2026-10-01 12:00 AEST
- [ ] 提交表单：Canvas 作业「Pre-screening Submissions」和「Final Presentations」；要有提交标题（官方建议「项目名 + 一句 tagline」）；只写队名，不写队员姓名；队名、项目名还没定 — 截止 同上两个时间
- [ ] 第三方素材与 API 清单：所有第三方素材和 API（含付费购买的）全部列出，另附赛前准备的协作工具说明 — 截止 2026-10-01 12:00 AEST

## 🔒 规则限制

| 项 | 官方说法 | 我们的理解 | 核实状态 |
|---|---|---|---|
| 能不能用赛前代码 / 模板 | 规则 2：不能拿已有项目参赛。规则 3：开赛前不能做任何开发或设计，包括但不限于代码、图形、音频、3D | 按最严：删掉 `starters/`（D-0929-1311，另开 PR 执行）；项目代码开赛后手写；提交里说明赛前准备的协作工具 | 🟡 没问，按最严处理 |
| 制作时间 | 规则 4：只能在规定时间内制作 | 老师确认比赛期间随时可以做（D-0929-1222） | ✅ 已问清（口头） |
| 仓库是否必须公开 | 规则 5：写了代码就必须放公开仓库，提交附链接，评审全程所有代码保持可访问 | 必须公开；评审结束前不改私有、不删仓库 | ✅ 原文明确 |
| 许可证要求 | 代码许可证原文没提。规则 6：第三方素材必须合法授权、公众可下载或购买，可以自费买 | 代码许可证不强制；数据按各自许可署名（OSM ODbL、DataVic CC BY 4.0） | 🟡 代码许可证没问 |
| 队伍人数 | Canvas 讨论区：每队 3–5 人 | 我们 5 人：@Zemmeng（lead）、@louisxie316-dotcom、@jinmingq、@Unzzip、@unicornnnnnny | 🟡 讨论区说法，Briefing 没写 |
| 允许哪些 AI 工具 / API | 原文不限工具。规则 6：所有第三方素材和 API（含付费）都要在提交里列出。第 7 题和 SMEC 奖另有主权规则 | 能用；用到的全部列进清单；主权规则只管第 7 题和 SMEC 奖 | 🟡 没明说 |
| AI 使用是否要披露 | 原文没提 | 按最严：用到的 AI 工具随第三方清单一起列出 | 🟡 |
| 演示时长 | 决赛每队 7 分钟讲 + 3 分钟问答（Canvas 日程） | 只有入围队上台 | ✅ Canvas |
| 决赛资格 | Briefing：前 12–15 队入围；Canvas 资源页写 15 队 | 以初筛结果为准 | 🟡 两处数字不一致 |

## 可用资源

只写名字、申请入口、谁申请了。**不写 key。**

| 资源 | 申请入口 | 谁申请了 | 额度 |
|---|---|---|---|
| Cloudflare 账号（Workers / Durable Objects） | dash.cloudflare.com | @Zemmeng | 🟡 没核套餐 |
| 大模型 API | 待定 | 待定 | 待定；key 只放 Cloudflare，不进仓库 |
| OpenStreetMap 路网 | openstreetmap.org | 公开数据，免申请 | 免费；ODbL，要署名 |
| DataVic SCATS 信号灯流量（站点 2921） | discover.data.vic.gov.au | 公开数据，免申请 | 免费；CC BY 4.0，要署名 |
| City of Melbourne 行人计数 | data.melbourne.vic.gov.au | 公开数据，免申请 | 免费；许可证 🟡 没核 |
| Canvas 课程 | 主办方邀请 | 全队 | — |

## 待问主办方

| 问题 | 谁去问 | 答复 |
|---|---|---|
| `starters/` 这类赛前通用骨架算不算赛前代码 | — | 不问了：已按最严决定删掉 `starters/` |
| 两个单项奖是否只限做对应赞助商的题 | 待定 | 未问 |
| Untapped 说附了网络安全样例素材，但 PDF 和 Canvas 都找不到 | 待定 | 未问 |
| 「Final Presentations」要交什么（slides / 视频 / 链接）、什么格式 | 待定 | 未问 |
| 初筛结果何时、在哪公布 | 待定 | 未问 |
