# 项目名（kickoff 后改）：给 AI 的操作规则

> 这份文件只放**每个回合都用得到的动作**。协作规矩导入 CONTRIBUTING，不重写；「为什么这么定」见 decisions。
> 🔒 只有 lead 在 `lead/*` 分支上改。超过 200 行就删最不常用的。

@CONTRIBUTING.md
@docs/decisions.md
@docs/pitfalls.md

## 0. 开场（每个会话第一件事）

- 读 SessionStart 注入的导航层。**它是地图，不是全部状态**，要细节自己按 §3 去取。
- 我是谁 = `git config hack.me`，对应 `docs/3-tasks.md` 的 `## @handle` 节；只有等于 `hackathon.conf` 的 `LEAD` 才做 lead 的事。
- 在 main 上：先要任务号，开分支后再动手。
- 🔒 **用户第一句没说要干什么 → 用 `AskUserQuestion` 摆菜单**：他名下 ⬜/⏸ 的前 3 条 + 「认领一条未认领任务」+ 「收工 / 写交接」，是 lead 时再加「集成 /lead」。**他点名了就直接开工。不许反问「用哪个命令」，不许让人背命令。**

## 1. 会话类型：一个对话只做一件事

| 命令 | 谁用 | 能写哪里 | 干完为止 |
|---|---|---|---|
| `/start [T<n>]` | 队员 | 本模块 + 公共区 | PR 开出来、交接单写完 |
| `/lead` | lead | 全仓库 | 本轮集成完成 |
| `/kickoff` | lead | docs、骨架 | 每人拿到第一个任务 |
| `/demo` `/submit` | lead / pitch owner | `4-demo`、tag | 清单打完 |
| `/handoff` | 所有人 | 交接单、3-tasks 自己那节 | 说出「收工」 |

中途想到别的事 → 写进交接单第 3 节，**不当场切**。同机并行 → 开 worktree。

## 2. 命令

```bash
bash scripts/setup.sh                 # clone 后跑一次，可重复
bash scripts/check.sh --quick         # 每步做完都跑；最后一行「======== 汇总 X ❌ Y ⚠️」
bash scripts/check.sh                 # 全量：合 PR 前、lead 集成时
bash scripts/check.sh --e2e           # 线上冒烟（地址读 hackathon.conf 的 DEMO_URL）
bash scripts/sync.sh                  # 零 token 对齐实况（lead 每次发言前）
bash scripts/new-app.sh <名> <starter>    # 仅 lead：从 starter 生成模块
bash scripts/deploy.sh <模块|all>     # 仅 DEPLOYER；执行前先问
bash scripts/secret-scan.sh --history # 转 public 前扫全部历史
```

🔒 **起 dev server 只用 preview 工具**，按 `.claude/launch.json` 里的名字启动，不用 Bash。

## 3. 要找什么去哪读（只读清单）

| 需要什么 | 读哪里 |
|---|---|
| 我的进度 / 任务 | `docs/3-tasks.md` 自己那节 |
| 赛题、评分、提交物 | `docs/1-brief.md` |
| 范围、时间盒、模块分工 | `docs/2-plan.md` |
| 接口 | `docs/contract.md` 相关节 |
| 为什么这么定 | `docs/decisions.md` |
| 坑 | `docs/pitfalls.md` |
| 外部 API 怎么调 | 模块 README 的「外部 API」节 |
| 怎么部署、队友怎么拿权限 | `docs/deploy-cloudflare.md` |

❌ 不要通读：别的模块源码、`handoff/done/`、`node_modules`、`.claude/agent-out/` 全文。

## 4. 🔒 AI 专属硬约束（括号里是守它的机制）

1. 不读 `.env` / `.dev.vars`，不打印任何 key，只提变量名（settings deny · `check [1][2]`）
2. push、开 PR、合 PR、打 tag、deploy、改仓库设置 **每次先问，一次同意不能推广到下次**；在自己分支上 commit 可以直接做（settings ask）
3. 不 force push、不 `git add -f` / `-A` / `.`、不 `--no-verify`、不改 `.gitignore` `.gitattributes`；`git add` 只加具体路径（settings deny 全部拦下）
4. 只写本模块 + 公共区；要改别处 → 交接单第 2 节，或 `contract:` PR（`check [3]` · CODEOWNERS）
5. 说「好了」之前：`check --quick` 无 ❌ **并贴汇总行原文**；UI 改动用 preview 截桌面和 375px 两张图自己看过；没跑过的写「尚未验证」（Stop hook）
6. 付费 API 默认 `MOCK=1` 或 dry-run；真调用前先报调用次数和花费估算；花了就记进额度台账
7. 每新增一条约束就同时加一个测试；鉴权、隐私、计费至少各有一条**反向断言**（「响应里不能出现别人的 X」）
8. decisions 里已定的事不重提；冲突时说「这和 D-xxx 冲突」然后问人

## 5. 确认粒度与沟通

| 情况 | 做法 |
|---|---|
| 改架构、换依赖、改契约、删文件、对外文案 | 先问 |
| 需求明确的 bug、写测试、读代码、跑命令查事实 | 直接做。**不问「要不要查」，不说「我没这个能力」把活推回给人** —— 先看本机有没有 `gh` `wrangler` `codex` `python3` |
| 产品方向、pitch 叙事、UI 风格 | 人定，AI 只提建议 |

- 汇报：先说结论（用户能看到的效果），再给能复现的数字（`N passed` + 命令）。只报需要拍板的（一句话给选项）和影响排期的。**不贴 diff 摘要、不列改动文件清单、不播报后台任务。**
- 版式：对话里的表格 ≤ 4 列、约 60 字符宽；段落 ≤ 3 行；长内容写进文件，只给路径。
- 事实可追溯：不凭函数名 / 字段名猜，先读源码或实测；不编造报错；数量结论标注时间。
- 语言：默认中文；队友用英文提问就用英文答。
- **只存在于对话里的东西等于不存在**：决定 → decisions；坑 → pitfalls；调通的 API → 模块 README。

## 6. 🔒 Subagent 与额度

| 规模 | 做法 |
|---|---|
| 1–10 个 | 直接开。只用 `.claude/agents/` 里的定义，或显式传 `model: opus`。**禁用 fable** |
| > 10 个，或任何 `Workflow` | 先报方案（几个、做什么、预计 token、产出落在哪），等人说「开始」 |

- 有队友正在赶功能时不跑大批量审查；每批只跑 2–3 个维度
- 每个 agent 的 prompt 写明：只读哪些文件；工具调用 ≤ 20 次；先查 `.claude/agent-out/<名>.md` 有没有现成的；做完先 Write 落盘再返回（被叫停也不丢）
- schema 键名用 ASCII，中文只放 description；汇总时 failed 单独计数，不能算进「已排除」
- 写代码的子代理继承本会话的分区；审查类只读

## 7. 🔒 冻结期

- T-6h 功能冻结：只合 bugfix 和打磨
- T-2h 代码冻结：lead 打 `demo-v1` 并从 tag 部署；main 只收 P0（主路径断、崩溃、数据错），lead 合
- 冻结后禁止：新功能、改依赖、重构、改契约、大批量 subagent。30 分钟修不好就回滚到 `demo-v1`
- 收到新功能请求 → 提醒冻结，建议写进 pitch 的「下一步」

## 8. 硬约束和守它的检查

| # | 约束 | 守它的检查 |
|---|---|---|
| 1 | 秘密不入库 | `check [1][2]` · pre-commit |
| 2 | 不直推 main | pre-push · settings deny |
| 3 | 不越界 | `check [3]` · CODEOWNERS |
| 4 | 模块都有 README + test.sh 且全绿 | `check [4][5]` |
| 5 | subagent 用 opus | `check [6]` |
| 6 | RULES 块四处一致 | `check [7]` |
| 7+ | 按赛题补，例「用户看不到别人的数据」 | `apps/<m>/tests/` 里的反向断言 |

## 9. 本项目的固定模式（lead 维护；同类 bug 修到第二次就写进来）

格式：🔒 模式名 | 什么时候用 | 照哪个函数 / 文件做

用 `web-worker` starter 时预置：
- 🔒 状态带单调递增版本号 `v` | 所有广播 | `starters/web-worker/public/js/shared/logic.js` 的 `reduce()`（`src/room.js` 的 `commit()` 负责落 storage）
- 🔒 会重建 DOM 的 render 必须有签名守卫 | 任何轮询 / 推送重绘 | `starters/web-worker/public/js/app.js` 的 `render()`
- 🔒 动效由新旧 state 对比驱动，不解析日志文本 | 前端 | 同上
- 🔒 隐私数据按用户裁剪后再下发 | 服务端 | `starters/web-worker/public/js/shared/logic.js` 的 `viewFor()`
- 🔒 改了 CSS/JS 就跑 `bump.sh` 把 `?v=` 加 1 | 每次前端改动 | `starters/web-worker/bump.sh`
- 🔒 LLM prompt 只放在一个文件里 | 用到 LLM 时 | `apps/<m>/prompts.md`
- 🔒 AI 出图：数量和文字交给程序画，质感交给模型 | 出素材时 | —

## 10. 已定的事 / 踩过的坑

已通过顶部 `@` 导入。花了 15 分钟以上的坑、用户纠正过的做法，**当场追加一行**。

## 11. 收工暗号「收工」

说「收工」= CONTRIBUTING §10 的五件都做完了：check 无 ❌ 且贴了汇总行、交接单、3-tasks、commit、push 和 PR 已问过。没做完不许说。回复只要两句：交接单路径 + 下一步第一条命令，外加 PR 链接。

## 12. 维护这份文件

只有 lead 改。队员对 AI 的纠正先进 pitfalls 的 `AI` 类；同一类纠正第二次出现就提进本文件；第三次还被违反就搬进 `every-prompt` hook（最多 4 条）。
