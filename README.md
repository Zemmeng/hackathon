# Hackathon Team Template —— 一句话说清项目（kickoff 后 lead 改）

> 赛事：`<EVENT_NAME>` · 截止：`<DEADLINE>`（`<TZ>`）· Demo：[https://hackathon-site.zemmmeng.workers.dev](https://hackathon-site.zemmmeng.workers.dev) · 视频：`<VIDEO_URL>` · Lead：@Zemmeng
> （以上取自 [hackathon.conf](hackathon.conf)，`check.sh [9]` 会核对 Demo 链接一致）

## English Quick Start

Prereqs: `git`, `gh` (`gh auth login`), Node ≥ 20, Python ≥ 3.9. Windows: use Git Bash or WSL.

```bash
gh repo clone Zemmeng/hackathon && cd hackathon
bash scripts/setup.sh                                   # checks tools, enables git hooks, creates .env
git switch -c <handle>/<module>/T<n>-<slug> origin/main # one task = one branch
bash scripts/check.sh --quick                           # look for the line "======== 汇总 0 ❌ …"; ⚠️ lines after it are OK
git push -u origin HEAD && gh pr create --fill
```

- **First task (T0, before the event):** `git switch -c <handle>/hello/T0-hello origin/main` → create `handoff/<handle>-T0-<MMDD-HHMM>.md` from the template in `handoff/README.md` → `bash scripts/check.sh --quick` → push → `gh pr create --fill`. That proves hooks, CI and your access all work.
- **Find your work:** `docs/3-tasks.md` → your `## @<handle>` section. Your code lives in `apps/<module>/` (table in `apps/README.md`). Run it with `cd apps/<module> && npm i && npm run dev`.
- **Before you stop:** write `handoff/<handle>-T<n>-<MMDD-HHMM>.md` (4 headings, keep them in Chinese) and push.
- **You don't deploy:** the `DEPLOYER` named in `hackathon.conf` deploys after merge.
- **Reading script output:** `汇总` = summary · `越界` = outside your module · `❌` = must fix · `⚠️` = fine to continue.

<!-- RULES:BEGIN -->
🔒 **1. 不直接改 main。** 一个任务一个分支，合并走 PR。 / Never commit to `main`; one task = one branch = one PR.
🔒 **2. 只写自己模块的目录。** 公共文件只能新建或追加，要改别处先写交接单。 / Only write inside your own module; shared files are append-only.
🔒 **3. key / token 只放 .env。** 不进 git、不进聊天、不进交接单，文档里只写变量名。 / Secrets live only in `.env`; never in git, chat or handoff notes.
<!-- RULES:END -->

AI tools: Claude Code reads `CLAUDE.md`; Codex / Cursor read `AGENTS.md`; any other AI: paste Part B of `KICKOFF.md`. Docs are mostly Chinese, ask your AI to translate.

---

## 5 分钟上手（全仓库唯一必读，其余按需看）

### ① 一次性准备

```bash
gh repo clone Zemmeng/hackathon && cd hackathon
bash scripts/setup.sh     # 查工具 · 启用 .githooks · 复制 .env · 记下你的 handle · 打印倒计时
```

**T0 热身（赛前每人做一次，验证 hook / CI / 权限都通）：**

```bash
git switch -c <handle>/hello/T0-hello origin/main
# 在 handoff/ 新建 <handle>-T0-<MMDD-HHMM>.md，内容照 handoff/README.md 的四节模板随便写几行
bash scripts/check.sh --quick
git add handoff/<handle>-T0-*.md && git commit -m "hello: T0 热身 —— 验证流程"
git push -u origin HEAD && gh pr create --fill
```

### ② 我能写哪

| 路径 | 放什么 | 谁写 |
|---|---|---|
| `apps/<你的模块>/` | 你的代码 | 你 |
| `docs/3-tasks.md` 的 `## @你` 那节 | 你的任务状态 | 你 |
| `docs/decisions.md` · `docs/pitfalls.md` | 已定的事 · 踩过的坑 | 所有人，**只追加** |
| `handoff/` | 交接单 | 所有人，**只新建** |
| `docs/llm-apis/<你>-<服务商>.md` | 你手里的大模型 API 卡（只写变量名，不写 key） | 你，只动自己的卡 |
| 其余 | 基建、赛题、计划、契约 | lead |

完整定义见 [CONTRIBUTING.md §1](CONTRIBUTING.md#1-写文件分区)。

### ③ 怎么跑

```bash
bash scripts/check.sh --quick      # 秘密 · 越界 · 你改过的模块的测试；找「======== 汇总 0 ❌」那一行，后面列的是 ⚠️ 明细
bash scripts/check.sh              # 全量（合 PR 前、lead 集成时）
cd apps/<模块> && npm i && npm run dev   # 第一次要 npm i；端口看 apps/README.md 登记表；py-tool 模块看它自己的 README
```

用 Claude Code 的人：**起 dev server 用 preview 工具**，按 [.claude/launch.json](.claude/launch.json) 里的名字选，别用 Bash 起。端口表见 [apps/README.md](apps/README.md)。

### ④ 怎么交

```bash
git fetch origin
git switch -c <handle>/<模块>/T<n>-<短名> origin/main   # 开分支
# …小步 commit：「<模块>: 做了什么 —— 为什么」…
git merge origin/main                                   # 同步 main（merge，不 rebase）
bash scripts/check.sh --quick                           # 全绿
git push -u origin HEAD
gh pr create --fill                                     # 只动了自己模块且 CI 绿 → 自己 squash merge
```

合并后**不用你部署**：`hackathon.conf` 里的 DEPLOYER（当前 @Zemmeng）在每个集成点跑 `bash scripts/deploy.sh all`，线上地址见顶部 Demo。

### ⑤ 收工、换人、睡前

写一张交接单 `handoff/<handle>-T<n>-<MMDD-HHMM>.md`（模板在 [handoff/README.md](handoff/README.md)）并 push。
接别人的活：`gh pr checkout <号>`，先读交接单。

---

## 🔒 三条硬规矩 —— 谁在盯

| 规矩 | 谁在盯 |
|---|---|
| 不直推 main | `.githooks/pre-push` · Claude settings 的 deny |
| 只写自己模块 | `scripts/check.sh [3]` · CODEOWNERS |
| 秘密不入库 | `.githooks/pre-commit` · `check.sh [1][2]` · CI · 提交前全历史扫描 |

## 用不用 AI 都行

| 你用什么 | 怎么开始 |
|---|---|
| Claude Code | 在仓库目录开 `claude`，直接说要干什么，它会弹菜单让你选。命令只是快捷方式：`/start` `/handoff` `/lead` `/kickoff` `/demo` `/submit` |
| Codex / Cursor | 自动读 [AGENTS.md](AGENTS.md) |
| 网页版 AI | 复制 [KICKOFF.md](KICKOFF.md) 的 Part B 贴进去 |
| 不用 AI | 照上面 ①–⑤ 做，hook 和 CI 会替你检查 |

同一台机器开第二个会话 → 必须用 `git worktree`（[CONTRIBUTING §2](CONTRIBUTING.md#2-分支与-worktree)）。

## 文档地图（按需看）

| 文件 | 什么时候看 | 谁写 |
|---|---|---|
| [docs/onboarding.md](docs/onboarding.md) | 队友接入说明书：整份丢给 AI 就能装工具、clone、推 T0 PR | lead |
| [KICKOFF.md](KICKOFF.md) | 赛前 / 开赛前 90 分钟 / 要给 AI 一段开工 prompt | lead |
| [hackathon.conf](hackathon.conf) | 要看截止时间、冻结点、谁部署 | lead |
| [docs/1-brief.md](docs/1-brief.md) | 赛题原文、评分标准、提交物 | lead |
| [docs/2-plan.md](docs/2-plan.md) | 方案、模块分工、里程碑时间盒 | lead |
| [docs/contract.md](docs/contract.md) | 模块之间的接口 | lead 合并 |
| [docs/3-tasks.md](docs/3-tasks.md) | 任务板、谁在做什么、额度台账 | 每人自己那节 |
| [docs/4-demo.md](docs/4-demo.md) | 演示脚本、pitch、兜底、提交清单 | pitch owner |
| [docs/decisions.md](docs/decisions.md) | 已定的事，别再推翻 | 所有人追加 |
| [docs/pitfalls.md](docs/pitfalls.md) | 踩过的坑，别再踩 | 所有人追加 |
| [docs/llm-apis/](docs/llm-apis/README.md) | 候选大模型 API：谁有 key、多少钱、怎么调 | 每人只动自己的卡 |
| [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) | 怎么部署到 Cloudflare、队友怎么拿到部署权限 | lead |
| [handoff/](handoff/README.md) | 交接单怎么写 | 所有人 |
| [apps/README.md](apps/README.md) | 模块规则、端口表、模块 README 模板 | lead |
| [scripts/README.md](scripts/README.md) | 脚本和 hook 一览 | lead |
| [CLAUDE.md](CLAUDE.md) | 给 AI 的操作规则 | lead |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 协作规矩的唯一出处 | lead |

## 比赛全程

| 阶段 | 时间盒 | 产出 | 命令 |
|---|---|---|---|
| 赛前 | 比赛前一天 | 每人跑通 setup，做完上面 ① 的 T0 热身 PR | lead 看 `KICKOFF.md` Part 0 |
| M0 读题 | T+0 ~ 1h | `docs/1-brief.md`、`hackathon.conf` | `/kickoff` |
| M1 方案 + 部署打通 | ≤ T+3h | `2-plan`、`contract`、线上 hello-world | `/kickoff` |
| M2 骨架 | 48h 赛制 ≤ T+10h | MOCK 下主路径线上能点通，打 `skeleton` tag | `/start` |
| M3 核心 | — | 3 个「哇」时刻真实可用 | `/start` |
| M4 打磨 + pitch | — | `4-demo`、彩排 ≥2 次、兜底录屏 | `/demo` |
| 🧊 功能冻结 | T-6h | 只修 bug | |
| 🔒 代码冻结 | T-2h | 打 `demo-v1`，从 tag 部署 | `/demo` |
| 提交 | T-1h ~ T-30m | 提交清单逐项打勾，打 `submission` | `/submit` |

实际时间以 `docs/2-plan.md` 的里程碑表为准。

## 秘密与额度

- `.env` 从 `.env.example` 复制，文档里只写变量名
- 线上密钥：`npx wrangler secret put <NAME>`，见 [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)
- 付费脚本默认 dry-run，加 `--run` 才花钱；每次花钱记进 `docs/3-tasks.md` 的额度台账

## 常见问题

| 症状 | 处理 |
|---|---|
| push 被拒：`🚫 pre-push：不直推 main` | 你在 main 上。`git switch -c <handle>/<模块>/T<n>-x` 把改动带过去再推 |
| push 被拒：分支名不合规 | `git branch -m <handle>/<模块>/T<n>-<短名>` 再推 |
| PR 有冲突 | 本地 `git merge origin/main`；`decisions` / `pitfalls` 会自动两边保留 |
| `check [3]` 报越界 | 把改动写进交接单第 2 节让 lead 落实；确需跨模块：`ALLOW_CROSS=1 git push`，开 PR 后请 lead 打 `cross-module` 标签 |
| 第一次开 `claude` 弹 hooks 信任提示 | 先读 `.claude/hooks/*.sh`（都是只读检查 + 注入文字），再点信任 |
| Stop 门禁卡住回合 | 先修；实在要绕：`HACK_NO_GATE=1 claude`，并在交接单里写明原因 |
| 端口被占 | `launch.json` 已开 autoPort；手动起就换端口 |
| 紧急要 `--no-verify` | 可以，但 CI 会再查，PR 里说明原因 |
| Windows | 用 Git Bash 或 WSL；`.gitattributes` 已强制 LF |

## 提交给评委前

按 [docs/4-demo.md](docs/4-demo.md) 的提交清单逐项打勾。提交时 lead 把「评委段」（截图、在线地址、运行方法、技术亮点、团队）插到本文件最顶上，团队协作部分往下挪。

## 披露与 License

本仓库的工具脚本、hook 和流程文档是赛前准备的协作工具，不含业务代码；赛前写的 `starters/` 通用骨架已按 D-0929-1311 删掉，业务代码全部在比赛期间写。唯一例外：`apps/api/test.sh` 和 `apps/api/tests/mini.mjs` 是零依赖的测试运行器（不含业务逻辑），开赛后从赛前的 starter 拷过来，未改写。用到的第三方 API 和 AI 工具在 `docs/4-demo.md` 的提交清单里列明。[MIT](LICENSE)。
