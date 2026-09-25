# KICKOFF：赛前清单 + 开赛前 90 分钟 + 开工 prompt

> Claude Code 的 lead 直接跑 `/kickoff`；本文件是这套流程的唯一出处。不用 Claude 的人照下面的表手动做。

---

## Part 0 · 赛前（lead，比赛前一天做完）

- [ ] 仓库已在 GitHub（`Zemmeng/hackathon`，private）。要改名：`gh repo rename <新名>`（本地 remote 会自动跟着改）
- [ ] 邀请队友（一人一条，**人来点**）：
  ```bash
  gh api -X PUT repos/Zemmeng/hackathon/collaborators/<队友handle> -f permission=push
  ```
- [ ] 有 Pro / 学生包就给 main 开保护：Settings → Branches → 必须走 PR，status check 选 `check`
- [ ] 填 `hackathon.conf` 的 `LEAD` `BACKUP_LEAD` `DEPLOYER` `TZ`；在 `docs/3-tasks.md` 给每人建一节 `## @handle`
- [ ] 把 `docs/onboarding.md`（或它导出的 PDF）发给每个队友：整份丢给 AI 就能装工具、clone、跑 setup、推 T0 热身 PR（验证 hook、CI、权限都通）
- [ ] 在另一个目录重新 clone 跑一遍 setup，确认冷启动没问题
- [ ] DEPLOYER 跑 `npx wrangler whoami` 确认已登录；用 starter 部署一次 hello-world 验证账号（见 `docs/deploy-cloudflare.md`）
- [ ] 共享 key 放密码管理器，不发群
- [ ] 约好沟通群 + 每 4 小时一次的集成点

---

## Part A · 开赛前 90 分钟（lead 主持，全员在场）

### 第 1 步 · 赛题落盘（15 分钟）

写 `docs/1-brief.md`，**只写事实不写方案**；填 `hackathon.conf` 的 `EVENT_NAME` `EVENT_URL` `START` `DEADLINE`（本地时间 + 时区名，注意 10-04 墨尔本切夏令时）。

🔒 规则核对，看到这些立刻停下来定：
| 赛规说 | 怎么办 |
|---|---|
| 禁止赛前代码 / 模板 | A：删掉 `starters/`，记进 decisions；B：`gh repo create <赛名> --template Zemmeng/hackathon --private --clone`，历史从零开始（先在 GitHub 设置勾 Template repository） |
| 仓库必须公开 | 先按 `docs/4-demo.md` 提交清单「仓库」小节第 1–3 项走一遍（尤其 `bash scripts/secret-scan.sh --history`） |
| 要求披露 AI 使用 | 提交清单加一项，`4-demo` 里写 |

### 第 2 步 · 选方案（30 分钟）

每人 3 分钟讲一个点子 → 按评分标准打分成表「方案 | 维度 1 | 维度 2 | 风险」→ 选定一个 → 写一句话 pitch、**3 个「哇」时刻**、不做清单 → 每个拍板点追加进 `docs/decisions.md`（原话 + 理由 + 被拒的备选）。

### 第 3 步 · 切模块、写契约、排时间盒（20 分钟）

- 模块表：**模块边界就是人的边界**，模块数 ≤ 人数，另指定 pitch owner
- 契约 v0 写进 `docs/contract.md`：端点、消息、带 `v` 的状态形状、错误格式、mock
- 在 `docs/2-plan.md` 的里程碑表里填实际时间
- 默认用 `starters/`；要换栈先在 decisions 写理由

### 第 4 步 · 骨架与派任务（15 分钟，只有 lead 动手）

```bash
git switch -c lead/kickoff origin/main
bash scripts/new-app.sh <模块名> web-worker --owner <handle>   # 每个模块一次
# 补 .github/CODEOWNERS、apps/README.md 登记表、hackathon.conf 的 DEPLOY_MODULES（new-app 会把要加的行打出来）
# 在 docs/3-tasks.md 拆任务：每条 ≤ 2 小时；第一批必须有「mock / 机器人用户」和「主路径最小闭环」
bash scripts/check.sh && git push -u origin HEAD && gh pr create --fill   # 合入 main
```

### 第 5 步 · 部署打通与全员开工（10 分钟 + 并行）

```bash
bash scripts/deploy.sh all            # DEPLOYER 跑；拿到 DEMO_URL 写回 conf 和 README 顶部
bash scripts/check.sh --e2e           # 地址读 conf 的 DEMO_URL
```

目标 **≤ T+3h 线上有 hello-world**。然后在群里发通知 → 全员 `git pull` → 读自己那节 → 开分支 → Claude 用户 `/start T<n>`，其他人贴 Part B。

---

## 节奏表

| 时间点 | 做什么 | 谁 |
|---|---|---|
| 每 4 小时 | 集成点：整点前全员 push → lead `/lead` → 20 分时全员 `git merge origin/main` | 全员 |
| 每 ≤ 2 小时 | 开一个 PR | 每人 |
| T+3h | 线上 hello-world | DEPLOYER |
| M2 骨架好了 | 打 `skeleton` tag | lead |
| T-8h 起 | 可以反复跑 `/demo` | pitch owner |
| T-6h | 🧊 功能冻结 | lead 宣布 |
| T-2h | 🔒 代码冻结，打 `demo-v1` | lead |
| T-1h | 录好兜底视频，跑 `/submit` | pitch owner |
| T-30min | 提交表单，打 `submission` | lead 亲手 |
| 睡前 | 一律写交接单 | 每人 |

## 群通知模板

> 中：`git pull` → 看 `docs/3-tasks.md` 你那节 → Claude 用户 `/start T<n>`，其他人贴 KICKOFF.md 的 Part B。截止 `<DEADLINE>`，T-6h 冻结功能。
> EN: `git pull` → read your section in `docs/3-tasks.md` → `/start T<n>` (Claude) or paste Part B of `KICKOFF.md`. Deadline `<DEADLINE>`, feature freeze at T-6h.

---

## Part B · 开工 prompt（`---8<---` 之间整段复制，先替换 `<>` 里的内容；Claude Code 用户不用贴，直接说「做 T3」）

---8<---

我是 `<handle>`，负责模块 `<模块>`，分支 `<handle>/<模块>/T<n>-<slug>`。**这个对话只做 T<n>：<一句话 + 验收标准>。**
项目一句话：`<lead 填>`。

**作用域**：只准写 `apps/<模块>/`、`handoff/` 下我新建的文件、`docs/3-tasks.md` 我那节；`docs/decisions.md` `docs/pitfalls.md` 只追加；其余只读。要改别处就告诉我，我去找 lead。

**硬约束**：截止 `<DEADLINE 带时区>`；T-6h 功能冻结，T-2h 代码冻结；付费 API 额度 `<数>`，默认 `MOCK=1`；技术栈 `<已定>`，不许引入新依赖，要引入先问。

<!-- RULES:BEGIN -->
🔒 **1. 不直接改 main。** 一个任务一个分支，合并走 PR。 / Never commit to `main`; one task = one branch = one PR.
🔒 **2. 只写自己模块的目录。** 公共文件只能新建或追加，要改别处先写交接单。 / Only write inside your own module; shared files are append-only.
🔒 **3. key / token 只放 .env。** 不进 git、不进聊天、不进交接单，文档里只写变量名。 / Secrets live only in `.env`; never in git, chat or handoff notes.
<!-- RULES:END -->

**先读**：`CLAUDE.md` → `CONTRIBUTING.md` → `docs/decisions.md` → `docs/pitfalls.md` → `docs/3-tasks.md` 我那节 → `docs/contract.md` 相关节 → `apps/<模块>/README.md`。不要通读整个仓库。

**雷区**（lead 从 pitfalls 挑最相关的 3–5 条贴这里，比赛中随时更新）：
- `<…>`

**常用命令**：
```bash
git fetch origin && git switch -c <handle>/<模块>/T<n>-<slug> origin/main
bash scripts/check.sh --quick
cd apps/<模块> && npm i && npm run dev   # 或模块 README 里的命令；端口看 apps/README.md 登记表
git push -u origin HEAD && gh pr create --fill
```

**记账**：完成就改我那节的状态；花钱就记 `docs/3-tasks.md` 的额度台账；花了 15 分钟以上的坑写进 `docs/pitfalls.md`。

**我要你怎么干**：
1. 先用 3 行报现状
2. 出 ≤ 5 步的计划，每步写完成标准，等我说「做」
3. 小步实现，每步跑 `bash scripts/check.sh --quick` 并贴汇总行
4. 拿不准先问，不猜 API，不编造报错
5. 不 push、不开 PR、不 deploy，除非我说
6. subagent 用 opus，超过 10 个先问
7. 结束时按 `handoff/README.md` 写交接单，然后说「收工」

---8<---

---

## 为什么要这么啰嗦（背景，不用复制）

- 多个会话改同一张表互相覆盖 → 写文件分区 + 交接单 + 越界检查
- 测试崩了却报绿 → 没有汇总行就算失败
- 规则写一次就沉底 → 用 hook 每条消息注入
- subagent 用贵模型，额度一次烧光 → 一律 opus，超过 10 个先问
- 旧项目文档里出现过密钥明文 → 只写变量名
