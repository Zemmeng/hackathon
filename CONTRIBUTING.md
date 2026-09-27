# 怎么一起干活 / How we work together

> 人和 AI 都守这一份。协作规矩只写在这里，别处（README / CLAUDE.md / AGENTS.md / KICKOFF.md）只放指针和下面那个镜像块。
> 改这份文件等于改基建，只能 lead 在 `lead/*` 分支上改。

**English summary:** one task = one branch = one PR; write only inside `apps/<your-module>/`; shared docs are append-only; secrets only in `.env`; before you stop, write a handoff note in `handoff/` and push. Everything else below is detail.

---

## 0. 三条硬规矩

<!-- RULES:BEGIN -->
🔒 **1. 不直接改 main。** 一个任务一个分支，合并走 PR。 / Never commit to `main`; one task = one branch = one PR.
🔒 **2. 只写自己模块的目录。** 公共文件只能新建或追加，要改别处先写交接单。 / Only write inside your own module; shared files are append-only.
🔒 **3. key / token 只放 .env。** 不进 git、不进聊天、不进交接单，文档里只写变量名。 / Secrets live only in `.env`; never in git, chat or handoff notes.
<!-- RULES:END -->

这三条不靠自觉：`.githooks/pre-push` 拦直推 main，`scripts/check.sh [3]` 查越界，`.githooks/pre-commit` + `check.sh [1]` 扫秘密，CI 再查一遍，Claude 的 Stop hook 也跑同一份 `check.sh`。

---

## 1. 写文件分区

| 区 | 路径 | 谁写 | 怎么写 |
|---|---|---|---|
| 模块区 | `apps/<模块>/` | 只有负责人 | 随便改 |
| 自己那节 | `docs/3-tasks.md` 的 `## @你的handle` | 只有本人 | 改自己那节，不碰别人的 |
| 只追加区 | `docs/decisions.md` · `docs/pitfalls.md` | 所有人 | 只在末尾加行（`check [3]` 查删除行数必须为 0） |
| 只新建区 | `handoff/` | 所有人 | 新建带自己 handle 的文件，不改别人的 |
| pitch 区 | `docs/4-demo.md` · `docs/pitch-assets/` | pitch owner | 用 `<handle>/pitch/T<n>-<短名>` 分支（模块段写 `pitch`，不需要有 `apps/pitch/`），随便改 |
| 独占区 | README · CLAUDE.md · AGENTS.md · CONTRIBUTING · KICKOFF · hackathon.conf · `docs/1-brief` `2-plan` `contract` `deploy-cloudflare` · `.claude/` `.github/` `.githooks/` `scripts/` `starters/` · `.gitignore` `.gitattributes` | 只有 lead | 在 `lead/*` 分支上改 |

判定链：**分支名 → 模块 → 可写路径**，`scripts/check.sh [3]` 自动查，不靠人盯。

要改分区外的东西，三选一：
1. 写进交接单第 2 节「要改的共享文件」，lead 落实
2. 接口变了 → 开 `contract:` 开头的 PR（见 §6）
3. 真要跨模块（先在群里说一声）→ `ALLOW_CROSS=1 git push` 让本地门禁放行，开 PR 后请 lead 打 `cross-module` 标签，CI 放行；Claude 会话里是 `ALLOW_CROSS=1 claude`

---

## 2. 分支与 worktree

- 命名：`<handle>/<模块>/T<n>-<短名>`，例 `alice/api/T3-login`；lead 用 `lead/<短名>`；pitch 工作用 `<handle>/pitch/T<n>-<短名>`
- 🔒 名字不合规的分支 `check [3]` 直接 ❌，pre-push 会拒（`git branch -m` 改名就行）
- Claude Code **云端会话**推的分支会自动带 `claude/` 前缀，`check` 会忽略这个前缀，后面仍要是 `<handle>/<模块>/T<n>-<短名>`：开云端会话时第一句就说清分支名
- 从最新的 main 开：

```bash
git fetch origin
git switch -c <handle>/<模块>/T<n>-<短名> origin/main
```

- 🔒 **一个分支只做一个任务**，存活不超过半天
- 🔒 **同一台机器并行开第二个会话必须用 worktree**，绝不让两个会话共用一个工作目录（两个 AI 同时改同一个文件会互相覆盖，踩过）：

```bash
git worktree add ../hackathon-T<n> -b <handle>/<模块>/T<n>-<短名> origin/main
# 在那个目录里另开会话；做完 git worktree remove ../hackathon-T<n>
```

---

## 3. 认领任务

- 任务号 `T<n>` 全局唯一，由 lead 放在 `docs/3-tasks.md` 的「未认领」里发放，每个不超过 2 小时
- 认领 = 在自己那节加一行、状态标 🔨。**这一行同时就是「我在做这个」的登记**，lead 靠它对齐进度
- 可以先开一个 draft PR 占坑

---

## 4. 提交

标题格式：**`<模块>: 做了什么 —— 为什么 / 现象`**。示例：

```
api: 加 /rooms/:id 的 404 —— 前端进空房间直接白屏
web: 房间列表改成轮询 3 秒 —— WebSocket 在校园网被断
api: 修房间码撞号 —— 生成时没查已有房间，两队同时开房会进同一间
```

第三条是修 bug：**必须写根因**，不写「修复 bug」。

正文（可选但推荐）：改了什么 · 怎么验证（命令 + 汇总行原文）· 还没做 / 尚未验证的。
AI 参与的提交保留它加的 `Co-Authored-By` 行。

- 能演示一个小点就提交一次，别攒
- 素材 > 500KB 先压缩；原图放 `assets-src/`（已 gitignore）

---

## 5. 合并

同步 main 只用 merge，**不 rebase 已推送的分支，禁止 force push**：

```bash
git fetch origin && git merge origin/main
```

开 PR 前三步：merge main → `bash scripts/check.sh --quick` 全绿 → 按模板填 PR。

| 情况 | 谁合 |
|---|---|
| 只动了自己模块 + 公共区，CI 绿 | 自己 `gh pr merge --squash --delete-branch` |
| 碰了独占区或契约 | lead 审过再合 |
| 冻结期 | 只合 P0，lead 合 |

冲突处理：`decisions.md` / `pitfalls.md` 设了 `merge=union`，本地 merge 会自动两边保留（GitHub 网页冲突编辑器不认，所以在本地合）；**模块区出现冲突 = 有人越界了**，停下来找 lead。

---

## 6. 契约变更

模块之间只通过 `docs/contract.md` 对接。改它：PR 标题以 `contract:` 开头 → lead 合并 → 在群里通知依赖方。优先向后兼容（加字段不删字段）。

---

## 7. 交接

什么时候写、文件名、四节模板：全在 `handoff/README.md`。一句话：**只存在于对话里的东西，等于不存在。**

---

## 8. 决定与踩坑

- 拍板的事当场追加进 `docs/decisions.md`（编号、原话、理由）。推翻只能追加一行「推翻 D-xxx：理由」，不删旧行
- 花了 15 分钟以上的坑、对 AI 的纠正，追加进 `docs/pitfalls.md`

---

## 9. 冻结

| 时间点 | 叫什么 | 还能干什么 |
|---|---|---|
| 截止前 `FEATURE_FREEZE_HOURS` 小时（默认 6h） | 🧊 功能冻结 | 只合 bugfix 和打磨 |
| 截止前 `CODE_FREEZE_HOURS` 小时（默认 2h） | 🔒 代码冻结 | lead 打 `demo-v1` tag 并从 tag 部署；main 只收 P0（主路径断、崩溃、数据错），lead 合 |

时间点由 `hackathon.conf` 算，hook 每条消息都会提醒。

---

## 10. 收工清单（人和 AI 一样）

1. `bash scripts/check.sh --quick` 汇总无 ❌
2. 交接单已写（没做完或要换人时）
3. `docs/3-tasks.md` 自己那节已更新
4. 已 commit
5. 已 push，PR 已开或已更新（AI 要先问）

五件都做完才能说「收工」。

---

## 11. 不用 AI 的队友

规矩一样，githooks 和 CI 会替你检查。交接的四节可以直接写进 PR 描述（PR 模板里已有「要改的共享文件」和「下一步」两节），不一定要建文件。

---

## 12. 代码地图与常见改动怎么下手

> kickoff 后 lead 填，写到具体函数名。格式照下面：

| 想改什么 | 去哪 |
|---|---|
| （例）加一个 API | `apps/api/src/worker.js` 的路由表 + `docs/contract.md` |
| （例）改界面 | `apps/web/public/js/app.js` 的 `render()`，改完跑 `bump.sh` |
