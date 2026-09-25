# hackathon 仓库接入说明书 —— 给你的 AI 助手

> **给人看的三行**：把这份文件整个发给你的 AI 助手（Codex / Claude / Cursor 都行），说一句「照这份文档把我接进仓库」。只有两步要你亲手在浏览器里点：登录 GitHub、接受仓库邀请。其余 AI 会替你做，做完你会有一个绿色的 PR。
> **For humans:** hand this whole document to your AI assistant and say "onboard me following this document". Only two steps need you in a browser: GitHub login and accepting the repo invitation. Everything else the AI does for you.

仓库：https://github.com/Zemmeng/hackathon （private）· lead：@Zemmeng

---

## 0. 给 AI 的总指令 / Instructions for the AI

- 你在帮队员把这台电脑接进 GitHub 仓库 `Zemmeng/hackathon`。目标：能 clone、`bash scripts/setup.sh` 通过、推一个 T0 热身 PR 并且 CI 绿。
- 逐步执行第 1–5 节，**每步跑完把命令输出的最后几行贴给人看**；失败就停下来报错，不要猜、不要跳步。
- 🔒 **不替人输入密码或验证码**。需要浏览器的步骤（第 2、3 节）停下来，把链接和要做的事告诉人，等人说「好了」再继续。
- 🔒 不要动 `main` 分支；不要改 `.github/` `.claude/` `scripts/` `starters/` 这些基建目录；除了本文档要求的，不要创建别的文件。
- 接入完成后先读仓库里的 `AGENTS.md`（Codex / Cursor 自动读）或 `CLAUDE.md`（Claude Code），网页版 AI 则复制 `KICKOFF.md` 的 Part B；之后一切规矩以它们为准，本文档只管接入。
- **EN:** Work step by step through sections 1–5, paste the last lines of every command's output, stop on errors. Never type passwords or one-time codes for the human. Don't touch `main` or the infra folders. After onboarding, read `AGENTS.md` (Codex / Cursor) or `CLAUDE.md` (Claude Code) and follow those.

## 1. 装工具 / Tools

| 工具 | 要求 | 怎么查 |
|---|---|---|
| git | 任意版本 | `git --version` |
| gh（GitHub CLI） | 任意版本 | `gh --version` |
| Node | ≥ 20 | `node --version` |
| Python | ≥ 3.9 | `python3 --version` |

缺什么装什么：

```
# macOS（Homebrew）
brew install git gh node python

# Windows：PowerShell 里装，之后所有命令都在 Git Bash 里跑
winget install Git.Git GitHub.cli OpenJS.NodeJS.LTS Python.Python.3.12

# Ubuntu / Debian
sudo apt install -y git python3
# gh：https://github.com/cli/cli/blob/trunk/docs/install_linux.md
# Node 20：https://nodejs.org/en/download （或 nvm install 20）
```

四个 `--version` 都能打出版本号再往下走。

## 2. 登录 GitHub（人来点）/ GitHub login

```
gh auth login
```

选项依次选：**GitHub.com → HTTPS → Yes（用 gh 做 git 凭据）→ Login with a web browser**。它会打印一个 8 位验证码和一个链接。

- **AI**：把验证码和链接原样告诉人，然后等。
- **人**：打开链接，粘贴验证码，点 Authorize。

验证：`gh auth status` 显示 `Logged in to github.com`。

## 3. 接受仓库邀请（人来点）/ Accept the invitation

- **人**：打开 https://github.com/Zemmeng/hackathon/invitations 点 **Accept**（邮箱里也有一封邀请信，点那个链接也行）。
- 页面说没有邀请 → 把你的 GitHub 用户名发给 lead（@Zemmeng），等他加完再刷新。

验证：

```
gh repo view Zemmeng/hackathon --json name -q .name
```

打出 `hackathon` 就是有权限了；报 `Could not resolve` 就是还没接受邀请。

## 4. clone 并跑 setup / Clone and set up

```
gh repo clone Zemmeng/hackathon && cd hackathon
bash scripts/setup.sh
```

`setup.sh` 会：查工具 → 启用 git hooks → 从 `.env.example` 复制出 `.env` → 记下你的 GitHub 用户名 → 跑一遍检查。

期望输出的最后几行：

```
[7/7] bash scripts/check.sh --quick
      ======== 汇总 0 ❌ 1 ⚠️
      [9] hackathon.conf ⚠️ DEADLINE 未设置（倒计时显示 --；kickoff 时 lead 填）

setup 跑完：环境齐了 ✅
下一步：看 README ④
```

那一条 ⚠️ 是「截止时间还没填」，赛前就是这样，正常。
如果 `[6/7]` 说 `docs/3-tasks.md` 里没有你的节 → 告诉 lead 加一节 `## @你的用户名`，不影响继续。

## 5. T0 热身 PR / Warm-up PR

这一步证明 hooks、CI、权限全通。把 `<handle>` 换成你的 GitHub 用户名，`<MMDD-HHMM>` 换成现在的月日时分（例 `0928-1930`）。

```
git switch -c <handle>/hello/T0-hello origin/main
```

新建文件 `handoff/<handle>-T0-<MMDD-HHMM>.md`，内容照下面写（AI 直接写，尖括号里填实际值）：

```
# T0 热身 —— 交接

## 1. 事实
- 做了什么：接入仓库，setup 通过
- 停在哪（带时间）：<MM-DD HH:MM> 等开赛
- 分支 / PR：<handle>/hello/T0-hello
- 验证：bash scripts/check.sh --quick → 汇总 0 ❌
- 尚未验证：无
- 本次花了多少钱：0

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| 无 | | |

## 3. 留给 lead
- 我的环境：<macOS / Windows / Linux，Node 版本，用的 AI 工具>

## 4. 下一步
- git pull 之后看 docs/3-tasks.md 我那节
```

然后：

```
bash scripts/check.sh --quick
git add handoff/<handle>-T0-<MMDD-HHMM>.md
git commit -m "hello: T0 热身 —— 验证流程"
git push -u origin HEAD
gh pr create --fill
```

期望：`check` 打出 `======== 汇总 0 ❌ 1 ⚠️`；commit 时 pre-commit 打出三个 ✅；push 时 pre-push 打出「检查通过」；最后得到一个 PR 链接。
过一分钟看 PR 页面，`check` 变绿 → **接入完成**。把 PR 链接发给 lead。

## 6. 开赛后怎么干活 / During the event

| 做什么 | 命令 |
|---|---|
| 拿任务 | `git pull`，看 `docs/3-tasks.md` 里 `## @你` 那一节 |
| 开分支 | `git switch -c <handle>/<module>/T<n>-<slug> origin/main` |
| 写代码 | 只写 `apps/<module>/`（你的模块） |
| 跑检查 | `bash scripts/check.sh --quick`，找「汇总 0 ❌」那一行 |
| 交 | `git push -u origin HEAD && gh pr create --fill` |
| 收工 / 睡前 | 写 `handoff/<handle>-T<n>-<MMDD-HHMM>.md` 并 push |

三条硬规矩，hooks 和 CI 会替你盯：

- 🔒 不直接改 main。一个任务一个分支，合并走 PR。
- 🔒 只写自己模块的目录。公共文件只能新建或追加，要改别处先写交接单。
- 🔒 key / token 只放 `.env`。不进 git、不进聊天、不进交接单。

## 7. 出问题看哪 / Troubleshooting

| 症状 | 处理 |
|---|---|
| `gh: command not found` | 第 1 节没装完；Windows 装完要重开 Git Bash |
| `Could not resolve to a Repository` | 邀请还没接受（第 3 节） |
| push 被拒：`不直推 main` | 你在 main 上，`git switch -c <handle>/<module>/T<n>-x` 再推 |
| push 被拒：分支名不合规 | `git branch -m <handle>/<module>/T<n>-<slug>` 再推 |
| `check [3]` 报越界 | 改动超出你的模块：写进交接单第 2 节让 lead 落实 |
| `check [8]` 报交接单格式 | 文件名或四个标题写错了，照第 5 节的样子 |
| Windows 报 `bad interpreter` | 换行符问题：`git add --renormalize .` 后重试 |
| 汇总里有 ⚠️ 但没有 ❌ | 正常，可以继续 |

