# AGENTS.md —— 给 Codex / Cursor / 其他 agent 的入口

规则的唯一出处是 **[CLAUDE.md](CLAUDE.md)**（AI 操作规则）和 **[CONTRIBUTING.md](CONTRIBUTING.md)**（协作规矩）。本文件不复述规则，只告诉你去哪读、以及 Claude 专属机制在你这边怎么等价。

**English one-liner:** all rules live in `CLAUDE.md` and `CONTRIBUTING.md`; never fork them here.

## 1. 开工必读顺序

1. `CLAUDE.md`（里面的 `@文件` 是 Claude 专用导入语法，**你要自己打开那些文件**）
2. `CONTRIBUTING.md`
3. `docs/decisions.md`（已定的事，别再提议）
4. `docs/pitfalls.md`（踩过的坑）
5. `docs/3-tasks.md` 里你负责人的那一节
6. `docs/contract.md` 相关的节（要碰接口时）
7. `apps/<模块>/README.md`

❌ 不要通读整个仓库、别的模块源码、`handoff/done/`、`node_modules`。

## 2. 三条硬规矩

<!-- RULES:BEGIN -->
🔒 **1. 不直接改 main。** 一个任务一个分支，合并走 PR。 / Never commit to `main`; one task = one branch = one PR.
🔒 **2. 只写自己模块的目录。** 公共文件只能新建或追加，要改别处先写交接单。 / Only write inside your own module; shared files are append-only.
🔒 **3. key / token 只放 .env。** 不进 git、不进聊天、不进交接单，文档里只写变量名。 / Secrets live only in `.env`; never in git, chat or handoff notes.
<!-- RULES:END -->

## 3. Claude 专属机制，你这边怎么做

| Claude Code 有的 | 你的等价做法 |
|---|---|
| SessionStart 注入导航层 | 开场先跑 `bash scripts/sync.sh` 和 `git status` |
| Stop 门禁 | 交结果前跑 `bash scripts/check.sh --quick`，把汇总行贴在回复里 |
| `/start` `/handoff` `/lead` `/kickoff` `/demo` `/submit` | 打开 `.claude/commands/<名>.md` 当清单照着做 |
| preview 工具起 dev server | 照 `.claude/launch.json` 里的命令手动起 |
| `AskUserQuestion` 弹菜单 | 用编号列表让人选 |
| `.claude/agents/reviewer.md` `tester.md` | 把正文当 prompt 用；模型用便宜的 |

## 4. 子代理和并行

遵守 `CLAUDE.md` 的「Subagent 与额度」节：一律 opus、数量不限（D-0929-1429），结果先落盘到 `.claude/agent-out/` 再返回。

## 5. Cursor

Cursor 会读本文件。**不要**另建 `.cursor/rules` 复制一份规则。

## 6. 冲突时

以 `CLAUDE.md` 为准，把冲突写进交接单第 3 节「留给 lead」。
