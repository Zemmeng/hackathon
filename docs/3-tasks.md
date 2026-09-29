# 3 · 任务板（唯一的任务台账；🔨 就是「我在做」的登记）

lead 以 `hackathon.conf` 的 `LEAD` 为准。每人只改自己那一节。节与节之间空两行，减少相邻行冲突。
状态：⬜ 未开始 · 🔨 进行中 · ⏸ 暂停（见交接单）· ✅ 已开 PR 或已合并 · ❌ 放弃
开始时间一律写 `MM-DD HH:MM`（`sync.sh` 靠它算「已开始多久」）。

## 现在停在哪（只有 lead 改，写时间）

- 里程碑：M0 完成，M1 未到（09-29 14:00）· 倒计时 46h · main：绿（`check.sh` 全量 `0 ❌`，155 passed）· 冻结：否
- 线上版本：还没有（目标 09-29 21:00 前有一个 Cloudflare 网址）
- 开着的 PR：#9 路网数据 ✅、#12 PRD-2 ✅（都已提醒作者自己合）；#5 赛题材料 ❌ 越界（已留言让作者拆）
- 下一个集成点：**09-29 17:00**，然后 21:00；整点前把自己的分支 push 上来

## 风险与 P0（lead 写，`/demo` 的结果也写这）

| # | 问题 | 严重度 | 负责人 | 状态 |
|---|---|---|---|---|
| R1 | T4 路网计算、T5 大模型和云端没人认领（@Unzzip、@jinmingq 名下为空） | 高 | lead | 17:00 集成点定 |
| R2 | 初筛 3 页幻灯片 09-30 12:30 截止，还没人负责 | 高 | lead | 17:00 集成点定 |
| R3 | `apps/web` 空架子还没建，T2 网页面板开不了工；`starters/` 还没删（D-0929-1311） | 中 | @Zemmeng（T6） | 待做 |
| R4 | `apps/roads/public/cbd/network.json` 511,186 字节，离 check [6] 的 500KB 警告线只差不到 1KB | 低 | @louisxie316-dotcom | 已提醒 |

## 额度台账（付费 API）

开工时额度 `<>` · 已用 `<>` · 剩余 `<>`

| 时间 | 谁 | 服务 | 花了多少 | 干了什么 |
|---|---|---|---|---|
| | | | | |

## 未认领（lead 维护；任务号全局唯一，每个 ≤ 2 小时）

| T# | 任务 | 预计 | 依赖 |
|---|---|---|---|
| T0 | 热身：分支 `<handle>/hello/T0-hello`，只新建一张交接单，开 PR（做法见 README ①） | 15m | — |
| T2 | 给 @unicornnnnnny：**网页面板**（第 1、2、6 步）——地图显示 CBD、在路上选一段施工、摆护栏 / 标志牌 / VMS、写屏上文案、显示结果和前后对比；17:00 前先做到地图 + 选路段 + 文案输入，结果用假数据上色。模块 `apps/web`（lead 今天建好空架子）；看 `docs/2-plan.md` 和 `docs/arch/` | 2h | — |
| T3 | 给 @louisxie316-dotcom：**路网数据**——CBD 真实路网 + 真实车流整理成 `network.json` / `flows.json` / `signals.json`。**详细要求全在 `apps/roads/PRD.md`**；分支 `louisxie316-dotcom/roads/T3-network`；17:00 前先交最小版 `network.json`（draft PR） | 2h + 2h | — |
| T4 | **路网计算**（第 4、5 步，创新点）——封一段路后车往哪绕、堵多久；多个施工叠加的冲突成本。17:00 前先在 5×5 小方格路网上跑通「封一段 → 重新分车 → 算延误」。看 `docs/arch/` 的「Agent 接入架构」第 2 页 | 2h | T3（先用小方格，不用等） |
| T5 | **大模型和云端**（第 3、5 步，创新点）——4 类路人的画像和提问模板、Cloudflare 接口、缓存、施工清单；17:00 前接口先返回假数据（MOCK）。看 `docs/arch/` 的「Agent 接入架构」 | 2h | — |
| T7 | 给 @louisxie316-dotcom：**T3 第二期**——行人、公交、设备库存（`apps/roads/PRD-2.md`，PR #12）。**先做 A `equipment.json`**（T2 设备面板要用），B 公交、C 行人排在后面；分支 `louisxie316-dotcom/roads/T7-equipment`，#9 合完再开 | 1h + 4h | T3（PR #9） |
| T8 | 任何人：**传一张大模型 API 卡**——手里有哪家的 key / 免费额度，照 `docs/llm-apis/README.md` 写一张卡（只写变量名）；分支 `<handle>/llm-apis/T8-<服务商>`，像 T0 一样人人可做、不用认领 | 15m | — |

认领：在自己那节加一行标 🔨；「未认领」里对应那行由 lead 下一轮清掉。


## @Zemmeng

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T1 | Swanston/La Trobe 路口仿真 demo（`apps/sim`，真实流量 + 施工模式对比） | ✅ | `lead/sim-demo` / PR #6 | 09-29 11:31 |
| T6 | 集成上线：删 starters、建 web / engine / api 空架子、Cloudflare 上线一个网址、把 T2–T5 接起来、接上路口放大 | 🔨 | `lead/kickoff` | 09-29 13:05 |

卡住了：


## @louisxie316-dotcom

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| T0 | 热身：验证本机环境、hooks、CI 与仓库权限 | ✅ | `louisxie316-dotcom/hello/T0-hello` / PR #3 | 09-27 14:48 |
| T3 | 路网数据：CBD 真实路网 + 车流 → `network.json` / `flows.json` / `signals.json`（`apps/roads/PRD.md`） | ✅ | `louisxie316-dotcom/roads/T3-network` / PR #9 | 09-29 13:19 |

卡住了：


## @Unzzip

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：


## @jinmingq

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：


## @unicornnnnnny

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：


## @<队友handle>（kickoff 前 lead 给每人建一节）

| T# | 任务 | 状态 | 分支 / PR | 开始时间（MM-DD HH:MM） |
|---|---|---|---|---|
| | | | | |

卡住了：
