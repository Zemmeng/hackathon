---
description: 赛题公布后跑一次：落盘、选方案、切模块、骨架、派任务、打通部署（仅 lead）
argument-hint: <赛题链接或文件>
---

# `/kickoff <赛题链接或文件>`

> 照 `KICKOFF.md` Part A 的第 1–5 步执行，目标 **≤ T+3h 线上有 hello-world**。步骤只写在 `KICKOFF.md`，这里只写 AI 怎么配合。

## 第零步

本会话是 lead（`hack.me == LEAD`）· 在 `lead/kickoff` 分支上 · 已经 `git pull`。不满足就停。

## 第一步：赛题落盘

- 请用户粘贴赛题原文或链接（`$ARGUMENTS`），结构化写进 `docs/1-brief.md`，**只写事实**
- 填 `hackathon.conf` 的 `EVENT_NAME` `EVENT_URL` `START` `DEADLINE`（本地时间 + 时区名）
- 🔒 看到「禁止赛前代码」「比赛中才建仓库」「必须开源」之类的规则 → **立刻停下**，按 `KICKOFF.md` 第 1 步的表给出选项问用户
- 没核实的按最严理解，标 🟡

## 第二步：出方案

出 3 个方案，每个：一句话、3 个哇时刻、和评分标准的匹配度、48h 内的风险、要用的外部 API。做成 ≤ 4 列的表，用 `AskUserQuestion` 让用户选。
🔒 **不替用户选。** 选定后追加 decision（原话、理由、被拒的备选）。

## 第三步：写计划

- `docs/2-plan.md`：MVP 三列、模块表、里程碑实际时间、mock 方案、风险
- `docs/contract.md` v0
- 选栈默认 `starters/`；换栈要追加理由

## 第四步：骨架与派任务

先把要执行的东西列给用户看（`new-app.sh` 跑几次、CODEOWNERS 加哪几行、`hackathon.conf` 的 `DEPLOY_MODULES` 填什么、任务清单），点头后再执行：

```bash
bash scripts/new-app.sh <模块> <starter> --owner <handle>   # 每个模块一次
```

- 每条任务 ≤ 2 小时；第一批包括「mock / 机器人用户」和「主路径最小闭环」
- 指定 pitch owner 和 backup lead，写进 conf 和 2-plan

## 第五步：部署打通

`bash scripts/check.sh` 全绿 → 开 lead PR 并合入（先问）→ 请 DEPLOYER 跑 `bash scripts/deploy.sh all` → 把 `DEMO_URL` 写回 conf 和 README 顶部 → `bash scripts/check.sh --e2e` 通过（地址读 conf）。

## 第六步：开工材料

- 填 `KICKOFF.md` Part B 的公共占位和雷区（从 pitfalls 挑 3–5 条）
- 按官方要求改 `docs/4-demo.md` 的提交清单
- 给出一段可以直接发群的中英双语通知

## 收尾（缺一不可）

check 全绿 · kickoff PR 已合 · `DEMO_URL` 可访问 · 每人都有第一个任务 · 下一个集成点时间写进 `3-tasks` 顶部

## 🔒 不做的事

不替用户拍板 · 不写业务代码 · 不把赛题材料写进 `CLAUDE.md` · 调研 subagent ≤ 5 个
