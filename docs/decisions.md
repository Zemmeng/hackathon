# 已定的事，别再推翻

只追加。多人同时追加会自动两边保留（`.gitattributes` 设了 `merge=union`）。
推翻旧决定只能追加一行「推翻 D-xxx：理由」，不删旧行。
🔒 AI 不许重新提议已定的事；遇到冲突就说「这和 D-xxx 冲突」然后问人。
编号用 `D-MMDD-HHMM`（比赛中）避免撞号；下面的预置项用 `D-01`…

| 编号 | 决定 | 理由（附原话） | 谁拍板 · 时间 |
|---|---|---|---|
| D-01 | 协作模型 = 分支 + 模块分区 + 交接单 + markdown 任务板，不用 GitHub Issues | 之前的项目从没用过 Issues/PR 流程，台账一向用 markdown；比赛 48 小时学不起新流程 | lead · 2026-09-26 |
| D-02 | subagent 一律 `model: opus`，禁用 fable；超过 10 个或任何 Workflow 先问 | 原话「如果有非常多的 subagent，subagent 不要用 fable 用 opus，不然我的额度马上就干了」「超过十个的时候需要经过我的同意」 | lead · 2026-09-26 |
| D-03 | 默认栈 = 零构建前端（HTML/CSS/ES module）+ Cloudflare Workers/DO + 系统 python3；不预置 React/Vite；换栈要写理由 | 四个线上项目都是这套，队里没人需要学；开赛时按赛题确认 | lead · 2026-09-26 |
| D-04 | 不每回合自动 commit；Stop 门禁只跑 `check.sh --quick`，红了拦回合 | 自动 commit 静默失败过一次，新会话读到过期状态把做完的事又做了一遍 | lead · 2026-09-26 |
| D-05 | 文件名、目录名、命令名、schema 键名一律 ASCII；文档以中文为主；README 带英文 Quick Start | 中文键名让整批 agent 全挂过；队里可能有非中文母语者 | lead · 2026-09-26 |
| D-06 | main 只经 PR；lead 小改共享文件可 `ALLOW_MAIN=1` 直推，commit 里写原因 | 三条硬规矩第 1 条；lead 改一行 conf 也走 PR 太慢 | lead · 2026-09-26 |
| D-07 | 同步 main 用 merge，不 rebase 已推送的分支，不 force push | force push 会毁掉别人已经 checkout 的分支 | lead · 2026-09-26 |
| D-08 | T-6h 功能冻结、T-2h 代码冻结（24h 赛制改 4h / 1h，在 conf 里改） | 最后两小时改功能只会把能演示的搞坏 | lead · 2026-09-26 |
| D-09 | 默认 `MOCK=1`；付费脚本默认 dry-run，`--run` 才花钱，`--check` 自检 | 原话「不要凭空估价，不要一上来就批量提交」；上次直接批量调付费 API，大半额度交了学费 | lead · 2026-09-26 |
| D-10 | 只有 `DEPLOYER` 部署；比赛期间 `workers_dev: true` 拿 demo 链接，赛后关掉 | 一个人部署最不容易乱；需要备用再按 deploy-cloudflare.md 方式 B 加人 | lead · 2026-09-26 |
| D-11 | AI 可以在自己分支上 commit 不用问；push、PR、merge、tag、deploy 前必须问，一次同意不能推广到下次 | 原话「push 前再单独问一次」 | lead · 2026-09-26 |
| D-0929-1215 | 选题 = 第 5 题（RPM Hire：Digital Tool for Temporary Infrastructure）；方向 = 把不同道路使用者做成 agent 仿真，自动找出施工方案引出的冲突；演示路口 = Swanston St / La Trobe St | 原话「第五个」「就以city里」；这个路口车、自行车、电车、行人四类都有公开的真实流量数据（SCATS 站点 2921 + City of Melbourne 行人计数器） | lead · 2026-09-29 |
| D-0929-1222 | 比赛期间任何时间都可以做，不限日程表上的 Hacking Time；截止仍是周四 10/1 12:00 最终提交、周三 9/30 12:30 初筛 | 原话「老师说了什么时候都可以做」；Briefing 第 4 条「only build during the allocated time」有歧义，已问清 | lead · 2026-09-29 |
| D-0929-1226 | sim 模块的界面文件（`apps/sim/public/` 下的 index.html、style.css、js/ui.js）由 @unicornnnnnny（高he）负责改；引擎 js/sim.js、数据和测试仍归 @Zemmeng。两边只通过 README「对外接口」那张表对接 | 原话「我同学负责前端 底层的这个仿真ok了你就push上去」「unicornnn」 | lead · 2026-09-29 |
