---
description: 总控：对齐实况、清交接单、合 PR、部署、更新任务板（仅 lead）
---

# `/lead`

> 回复可以慢，但**每次回答前都要先对齐一手进度**。这个会话不写功能，只做集成。只有它能改独占区。

## 🔒 第零步：用户每次发言前都跑

1. `git config hack.me` 必须等于 `hackathon.conf` 的 `LEAD`，否则停。
2. 切到 `lead/<slug>` 分支（在 main 上就 `git switch -c lead/<slug> origin/main`）。
3. `bash scripts/sync.sh`（零 token，一手实况）。
4. git / PR 的实况和 `docs/3-tasks.md` 冲突 → **以实况为准**，回填 3-tasks。
5. 没人说要关的分支或会话，不判定它已经死了。

## 第一步：只读

sync 输出 · `handoff/*.md`（不含 `done/`）· `docs/3-tasks.md` 全文 · `docs/2-plan.md` 里程碑表 · `docs/contract.md` 变更记录。
❌ 不读各模块源码细节，除非在排查失败。

## 第二步：清交接单

- 第 2 节的共享文件改动 → 在 lead 分支上落实
- 第 3 节要拍板的 → `AskUserQuestion` 问，定了追加进 `docs/decisions.md`
- 新任务 → 放进「未认领」
- 处理完 `git mv handoff/<文件> handoff/done/`（不删）

## 第三步：处理 PR

先列一张表「PR | 作者 | CI | 越界 / 契约」。顺序：`contract:` → 后端 → 前端。

| 情况 | 做法 |
|---|---|
| CI 绿、没越界 | 提醒作者自己合 |
| 碰了独占区或契约 | 审过、问过人后 `gh pr merge --squash --delete-branch` |
| 有冲突 | PR 里留言，让作者本地 `git merge origin/main` |
| 冻结期 | 只合 P0，每个 P0 单独一个 PR |

## 第四步：集成验证与部署

```bash
git switch main && git pull
bash scripts/check.sh                 # 全量
bash scripts/deploy.sh all            # 先问；只有 DEPLOYER 能跑
bash scripts/check.sh --e2e           # 地址读 conf 的 DEMO_URL
```

红了 → 在那个人的节里写备注，或问过人后回滚到上一个 tag。**对方没同意不替他改代码。**

## 第五步：时间盒检查

对照 `docs/2-plan.md` 的完成标准。落后 → 15 分钟内给「砍需求 / 换 mock / 降级」三个选项让人拍板，不延长时间盒。
到了冻结点 → 在 decisions 宣布，打 tag（先问）。

## 第六步：更新台账

- `docs/3-tasks.md` 顶部「现在停在哪」（时间、倒计时、main 绿不绿、线上版本、是否冻结）、「风险与 P0」、「未认领」
- `docs/2-plan.md`「实际进度记录」追加一行
- 新的固定模式 → `CLAUDE.md` §9

## 可以做的事

改独占区（改完追加一条 decision）· 跑 `new-app.sh` · 更新 `launch.json` 和 CODEOWNERS · 小改动 `ALLOW_MAIN=1` 直推并在 commit 里写原因 · 改了 RULES 块就同步四处镜像并跑 `check.sh` 确认 [7] 绿

## 收尾

一两句：线上版本、合了几个 PR、下一个集成点、下一件需要拍板的事。

## 🔒 不做的事

不写功能 · 不 force push · 不删交接单 · 超过 10 个 subagent 或任何 Workflow 先问
