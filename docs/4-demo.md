# 4 · 演示、pitch、兜底、提交

> pitch owner 写，lead 也可以写。`/demo` 和 `/submit` 都照这份走。

## 演示脚本（总时长 `<N>` 分钟）

15 秒开场钩子：`<一句话让评委抬头>`

| 时间 | 屏幕上是什么 | 说什么 | 谁操作 | 哇？ |
|---|---|---|---|---|
| 0:00 | | | | |
| 0:15 | | | | ⭐ |
| | | | | |

## 初筛 3 页（09-30 12:30 截止，草稿 09-29 17:40，21:00 按 T16–T19 上线后的数字更新）

- PDF：`docs/pitch-assets/00-prescreen.pdf`（16:9，3 页，约 410KB）· 源文件 `00-prescreen.html`（浏览器打开就是三页，改字直接改 HTML）
- 第 1 页右边前后对比 `01-before-*.jpg` / `01-after-*.jpg`：线上页面（液态玻璃版）Lonsdale St 08:00，屏上只写 ROADWORK AHEAD 对比加一帧 USE RUSSELL ST 的面板截图（09-29 20:51，无头 Chrome 切到「详细」后截）
- 第 3 页嵌的是 `03-architecture-v2.html?lang=en`：在 #42 原图上改了 6 处字，把 AI 框标成「rules today」（D-0929-1718：大模型读屏先不接）；行人电车 T17/T18 已接上，不再标 next。原图 `03-architecture.html` 没动
- 重新导出（Mac）：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=5000 --print-to-pdf=docs/pitch-assets/00-prescreen.pdf "file://$PWD/docs/pitch-assets/00-prescreen.html"`；或浏览器打印 → 另存为 PDF → 边距「无」→ 勾「背景图形」
- 过程：4 个 agent 核实仓库里的数 → 2 版草稿合成 → 事实 / 评委 / 规矩三路挑错 → 定稿（全文在 lead 本机 `.claude/agent-out/prescreen-*.md`，不入库）

### 要全队拍板（提交前）

| # | 事 | 现在页面上 |
|---|---|---|
| 1 | 队名 | 三页都是 `[Team name]` 占位；提交只写队名，不写队员姓名 |
| 2 | 放不放线上链接 + 二维码：网址子域里有队员 handle（zemmmeng），和「只写队名」可能冲突 | 第 2 页 `[demo link + QR — team to confirm]` |
| 3 | 头条用 Lonsdale −45%（和线上默认场景一致，D-0929-1650）；公交乘客 −40% 作副标题 | 第 1 页绿条、第 2 页 |
| 4 | 冲突成本 29,850 是方格测试路网上的数；要不要今晚在真 CBD 上重跑 | 第 2 页标了 test grid |
| 5 | 第 2 页 MVP 照 #48 的「冻结前做 5 件」写：叠加冲突上页面、按库存出 3 套方案带租金、多方案对比 + 选定 + 一页导出；团队看做不做得完 | 第 2 页 MVP 栏 |
| 6 | 点名 RPM VMS Preview、Mooven、one.network 行不行（只写文字，不用 logo） | 第 1 页 What's different |
| 7 | 第 3 页用架构图 v2 还是原图 | 用 v2 |
| 8 | 谁在 09-30 12:30 前交到 Canvas「Pre-screening Submissions」；交前把第 2 页脚注的 Status 时间改成交稿时间 | — |

### 页面上每个数的出处（评委问「数哪来的」照这个答）

| 页面上的说法 | 出处 |
|---|---|
| Lonsdale St 延误 −45%（10,493 → 5,746 车·分钟，排队 918 → 548 m） | `backend.js` 的 `connect().compare()`，demo `lonsdale`（1 条车道、8 点、513 辆车），读屏是关键词规则；线上页面同一条路径，截图里的数一致 |
| 公交乘客 −40%（15 条线、每小时 1,925 人，18,693 → 11,206 人·分钟） | 同一次 `compare()` 的 `summary.transit`（T17，PTV GTFS）；每班 25 人是假设值 |
| 封一侧人行道：每小时 185 人多走 176 m、多过 2 次马路 | `run()` 的 `summary.peds`（T18），`closes.footpath: 'left'`；这段人流按同街插值（`method: street_interp`），不是实测 |
| 顾问改写「USE / RUSSELL / SAVE 9 MIN」后排队 82 m、8 点延误 966 车·分钟 | `advise()` 第一个改法重跑（规则版顾问）；没上页面，口头备用 |
| London 实际绕行只有问卷说法的 1/5（Chatterjee 2002） | `apps/params/public/params.json` 里的出处原文 |
| 1,513 条路段、8 周 SCATS | `network.json` links 数；`flows.json` period 2026-08-01..09-27（用了 56 天） |
| 29,850 车·分钟冲突成本（A 3,015 + B 500，一起 33,365）；推迟 5 天 → 0 | `node apps/engine/tools/demo.mjs --real` 第二、三幕，5×9 方格 + 假设车流 |
| < 10 ms 一次 | `demo.mjs --real` 实测 1.4–6.6 ms |
| 37 个参数里 29 个是假设或低置信；74% 路段车流是估算 | `params.json` confidence none 18 + low 11；`flows.json` coverage estimated 1,127 / 1,513 |
| 竞品说法 | lead 本机调研 `idea-prior-art.md` `idea-users.md`；不说「首创」 |

## 预置数据与重置方法

- 演示账号 / 房间：`<不写凭据，写在哪拿>`
- 重置：`<命令>` —— ⚠️ 只用「清空数据保留链接」，**不用会让已发出链接失效的破坏性重置**

## Pitch 大纲（每页 2–3 句讲稿）

| 页 | 内容 | 时间 |
|---|---|---|
| 1 | 问题：谁痛、怎么痛 | 30s |
| 2 | 方案：一句话 | 20s |
| 3–5 | Demo | `<>` |
| 6 | 怎么做到的（架构一张图） | 30s |
| 7 | 可验证的效果（数字） | 20s |
| 8 | 下一步 + 团队 | 20s |

Slides 链接：`<>` · 导出 PDF：`docs/pitch-assets/slides.pdf`

## 评分标准对照（以 `1-brief` 为准）

| 评分项 | 我们的证据 | 在第几页 / demo 哪一步 |
|---|---|---|
| | | |

## 评委问答预案

| 问题 | 回答要点 | 谁答 |
|---|---|---|
| 和现有的 X 有什么区别 | | |
| 数据 / 隐私怎么处理 | | |
| 赛后会继续做吗 | | |

## 兜底（三级）

| 级 | 方式 | 条件 | 谁的电脑 |
|---|---|---|---|
| A | 线上 `DEMO_URL` | 网络正常 | |
| B | 本地 preview + `MOCK=1` | 线上挂 / 断网 | |
| C | 录屏视频（`out/demo.mp4`，不入库；链接写 conf 的 `VIDEO_URL`） | 什么都挂 | |

## 演示前 30 分钟清单

- [ ] `?v=` 已更新，线上是最新版
- [ ] 无痕窗口提前开好标签页（线上 + 本地）
- [ ] 关通知、放大字号（浏览器 125%）
- [ ] 充电、备用热点
- [ ] 断网测一遍 B 线

## 彩排记录

| 次数 | 时间 | 用时 | 卡在哪 | 改了什么 |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

## 试跑观察（`/demo` 第三步写入）

| 编号 | 严重度 | 几人独立撞上 | 问题 | 状态 |
|---|---|---|---|---|
| | | | | |

经核查不成立的：`<单列，别混进上表>`
失败 / 没返回的 agent：`<数量，单独计>`

## 对外文案审阅

| 文案 | AI 起草 | 谁过目 | 状态 |
|---|---|---|---|
| README 评委段 | | | 🟡 |
| 提交表单各字段 | | | 🟡 |
| 视频字幕 / 旁白 | | | 🟡 |

## 🔒 提交清单（以 `1-brief` 的官方要求为准；每项要有验证方式）

### 仓库

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 1 | `bash scripts/check.sh` 全量绿 | lead | 贴汇总行 | ⬜ |
| 2 | `bash scripts/secret-scan.sh --history` 零命中 | lead | 贴输出 | ⬜ |
| 3 | `.env`、数据、大文件不在历史里 | lead | `git log --all --stat` 抽查 | ⬜ |
| 4 | LICENSE 里的队名已改 | lead | 打开看 | ⬜ |
| 5 | README 顶部评委段：截图、在线地址、视频、运行方法、英文段（pitch owner 在「对外文案审阅」里起草，README 是 lead 独占区，由 lead 落盘） | lead | 打开看 | ⬜ |
| 6 | 没用到的 `starters/` 已删或已说明 | lead | `ls starters` | ⬜ |
| 7 | 赛前模板已在 README「披露」节说明 | lead | 打开看 | ⬜ |

### 演示

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 8 | `DEMO_URL` 在无痕窗口 + 手机网络下都能开 | DEPLOYER | 手机试 | ⬜ |
| 9 | 视频 unlisted 可播放，时长合规 | pitch owner | 换个账号打开 | ⬜ |

### 材料

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 10 | Slides 导出 PDF 放 `docs/pitch-assets/` | pitch owner | 文件存在 | ⬜ |
| 11 | 表单各字段草稿写在上面「对外文案审阅」并已过目 | pitch owner | 状态 ✅ | ⬜ |
| 12 | 成员、赛道、AI 使用披露齐全 | lead | 对照 1-brief | ⬜ |

### 收尾（**由人亲手点**）

| # | 项 | 负责人 | 验证方式 | 状态 |
|---|---|---|---|---|
| 13 | `git tag -a submission -m "提交版本 <时间>" && git push origin submission` | lead | `git tag` | ⬜ |
| 14 | 仓库转 public（如果要求）：`gh repo edit --visibility public` | lead 亲手 | 无痕窗口打开仓库 | ⬜ |
| 15 | 在比赛平台提交表单 | lead 亲手 | 成功页截图放 `docs/pitch-assets/` | ⬜ |
| 16 | `3-tasks` 顶部标「已提交 <时间>」；提交后 main 不再改代码 | lead | | ⬜ |
