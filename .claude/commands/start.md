---
description: 开工：认领任务、开分支、这个会话只做这一件事
argument-hint: [T<n>]
---

# `/start [T<n>]`

> **这个会话只做一件事：把 `$ARGUMENTS` 做到能合并。** 功能和修 bug 都用它。做完就 `/handoff`，不接别的活。

## 🔒 第零步：身份与分支（30 秒）

1. `git config hack.me` 是我；`git status` 看现状。
2. 没给任务号 → 用 `AskUserQuestion` 列出 `docs/3-tasks.md` 我那节里 ⬜/⏸ 的前 3 条 + 「认领一条未认领任务」，让人点。
3. 在 main 上 → `git fetch origin && git switch -c <handle>/<模块>/T<n>-<slug> origin/main`。
4. 工作区里有**不是本会话留下的**未提交改动 → 停下来问，建议开 worktree。

## 第一步：只读下面这些，别读别的

| 读什么 | 不在就 |
|---|---|
| `docs/3-tasks.md` 我那节 + 该任务那行 | 找不到就问 lead，**不自己编任务** |
| `apps/<模块>/README.md` | 模块还没生成 → 停下，等 `/kickoff` |
| `handoff/*T<n>*.md`（带这个任务号的交接单） | 没有就跳过 |
| `docs/contract.md` 相关节 | 只在要碰接口时读 |
| `docs/decisions.md` 最后 10 条标题 | — |

❌ **不要读**：别的模块源码、`handoff/done/`、`docs/4-demo.md`、`node_modules`，也不要通读整个仓库。

## 第二步：登记

在我那节把任务改成 🔨，写上分支名和开始时间（格式 `MM-DD HH:MM`）。

## 第三步：报现状、出计划，等确认

- 现状 ≤ 3 行
- 计划 ≤ 5 步，每步写验证方式
- 要改分区外的文件 → 列出来，建议写进交接单第 2 节
- 等用户说「做」。需求明确的 bug 可以直接做。

## 第四步：小步做

- 每步跑 `bash apps/<模块>/test.sh` 或 `bash scripts/check.sh --quick`
- 新增约束就加测试；隐私和鉴权写**反向断言**
- 外部 API 先用 `MOCK` 跑通；调通后当场把**实测的响应路径**写进模块 README 的「外部 API」节
- UI 改动：用 preview 截桌面和 375px 两张图自查；跑 `bump.sh`
- 花了 15 分钟以上的坑 → 追加进 `docs/pitfalls.md`；人拍板的事 → 追加进 `docs/decisions.md`
- 每完成一个能演示的小点就 commit（自己分支上不用问）

## 收尾

执行 `/handoff` 的全部步骤，一步都不能少。

## 🔒 这个会话里不做的事

不改独占区 · 不碰别人的模块 · 不顺手重构 · 不做第二个任务 · 不引入新依赖（要引入先问）· 冻结期不做新功能 · 不开超过 10 个 subagent · 不起 Workflow · 不 push main · 不合 PR · 不 deploy
