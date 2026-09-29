# 踩过的坑，别再踩

只追加（`merge=union`）。花了 15 分钟以上才解决的必须记；队员对 AI 的纠正也记在这里（类别 `AI`）。
每条一行：`| 类别 | **一句话症状** | 根因 → 解法 | 谁 · 时间 |`。类别：env / git / 前端 / 后端 / 部署 / AI。

| 类别 | 症状 | 根因 → 解法 | 谁 · 时间 |
|---|---|---|---|
| env | **macOS 自带没有 `timeout` 命令** | 脚本在 Linux 能跑、Mac 上直接报 command not found → 用「后台运行 + `kill -0` 轮询」，`scripts/check.sh` 里有现成写法 | 模板预置 |
| env | **bash 不认中文变量名** | `我的变量=1` 报语法错 → 变量名、文件名、目录名一律 ASCII，中文只放内容 | 模板预置 |
| env | **Windows 队友的 hook 报 `bad interpreter`** | 文件被存成 CRLF → `.gitattributes` 已强制 `*.sh` 用 LF；已经坏了的 `git add --renormalize .` | 模板预置 |
| git | **worktree 里判断「是不是仓库」失败** | worktree 的 `.git` 是文件不是目录 → 用 `[ -e .git ]`，不用 `-d` | 模板预置 |
| git | **`.wrangler/` 缓存被提交进仓库** | 没 gitignore 就 `git add .` → 已 gitignore；已进去的 `git rm -r --cached .wrangler` | 模板预置 |
| git | **合并冲突出现在 decisions.md** | 两个人同时追加 → `merge=union` 只在本地 `git merge` 生效，GitHub 网页冲突编辑器不认，本地合 | 模板预置 |
| 前端 | **改了 JS/CSS 线上还是旧的** | ES module 按 URL 缓存 → 改完跑 `bump.sh` 把 `?v=` 加 1 | 模板预置 |
| 前端 | **用户正要点的按钮被吞掉、下拉框选到一半被重置** | 轮询/推送重绘时 render 无脑重建 DOM → 签名守卫：同一签名不重建，照 `app.js` 的 `render()` 做 | 模板预置 |
| 前端 | **加了 transform 动画后，关闭按钮点不到了** | transform 把元素提升成层叠上下文，盖住同级绝对定位元素 → 给按钮更高 z-index 或把动画放到子元素上 | 模板预置 |
| 前端 | **靠解析日志文本驱动动效**（`line.includes("碰")`） | 文案一改动效全失效 → 动效由新旧 state 对比驱动 | 模板预置 |
| 后端 | **DO 广播整份状态，别人的暗牌全泄露** | 没按用户裁剪 → `viewFor()` 裁完再发；写反向断言测「别人的 secret 不出现在我的视图」 | 模板预置 |
| 后端 | **DO 空转把额度烧光** | 机器人回合无限循环 → `MAX_ROUNDS` 封顶 | 模板预置 |
| 后端 | **两个请求交错把存档写成 null** | DO 在 await 点交错执行 → `commit()` 串行化，`save()` 拒绝写空值 | 模板预置 |
| 部署 | **`wrangler dev` 里 `env.XXX` 是 undefined** | wrangler dev 优先读**模块目录**的 `.dev.vars`，没有才读模块目录的 `.env`；仓库根的 `.env` 不会进 Worker 的 env（但会进 wrangler 进程环境，所以根 `.env` 里别放 `CLOUDFLARE_API_TOKEN`）→ 本地变量写模块的 `.dev.vars` | 模板预置 |
| 部署 | **改 DO 类名后 deploy 报 migration 错** | 改了旧 migration → 只加新 tag，用 `renamed_classes` | 模板预置 |
| 部署 | **截止时间算错一小时** | 墨尔本 2026-10-04 02:00 切夏令时，写死 UTC 偏移就错 → conf 用时区名，脚本用 zoneinfo 现算 | 模板预置 |
| 部署 | **「重置」把所有已发出的链接全作废** | 重置重新生成了 token → 破坏性重置和「清空数据保留链接」分成两个按钮，演示前只用后者 | 模板预置 |
| AI | **测试在打印计数前崩溃，总账照样报绿** | 只 grep 计数不看退出码 → `check.sh [5]` 把「缺计数行」和「退出码非 0」都算失败 | 模板预置 |
| AI | **Workflow schema 用中文键名，agent 全挂，且被静默算成「驳回」** | 键名非 ASCII → 键名 ASCII；汇总时 failed 单独计数 | 模板预置 |
| AI | **多 agent 跑到一半被叫停，成果全丢** | 结果只在内存里 → 每个 agent 先 Write 到 `.claude/agent-out/` 再返回 | 模板预置 |
| AI | **第三方 API 响应层级照文档猜，取不到值** | 文档和实际不一致 → 先打一条最小请求，把实际路径写进模块 README 的「外部 API」节 | 模板预置 |
| AI | **AI 说「我没有出图/部署工具」把活推回给人** | 没先查本机 → 先看 `gh` `wrangler` `codex` `python3` 在不在，能跑的自己跑 | 模板预置 |
| 前端 | **仿真里左转车和直行自行车互相等，路口死锁** | 用「朝向射线」找前车，把正在穿过自己路线的车也当成了前车 → 同一路线按弧长找前车，别的路线只认朝向几乎平行的（点积 ≥ 0.9），并道单独列出；用 node 跑整小时的测试能抓到（进场量会远低于数据） | lead · 09-29 |
| 前端 | **屏幕关着或 Chrome 在后台时，canvas 动画不动，截图只有开头一两帧** | 浏览器不给不可见页面跑 requestAnimationFrame → 仿真逻辑写成不碰 DOM 的纯函数，用 node 验证整小时结果；看动画用 preview 面板或亮屏的前台页 | lead · 09-29 |
| env | **`bash scripts/check.sh` 报 `mod：: unbound variable`（UTF-8 环境）** | bash 把 `$mod，` 解析成变量名的一部分（全角逗号 U+FF0C）；`set -u` 找不到就崩 → 临时 `LC_ALL=C bash scripts/check.sh`；根治把 `$var` 后面紧跟非 ASCII 的改成 `${var}`（check.sh 约 22 处，独占区由 lead 改） | @Unzzip · 09-29 |
| env | **Mac 上 `check.sh` 在队员分支崩：`mod: unbound variable`，连汇总行都没有** | `"…模块 $mod，…"` 这种 `$变量` 后面紧跟全角字符的写法，macOS 的 bash 在 UTF-8 下会把全角字符的首字节（0xEF）当成字母吞进变量名，`set -u` 直接退出；Linux bash 5.2 不复现，用 Latin-1 locale 能复现 → 一律写 `${变量}`；`check [6]` 会提醒。@Unzzip 在 #5 报的 | lead · 09-29 |
| AI | **AI 在留言和汇报里自己估时间，写出了还没到的时刻（15:38、15:35），实际是 15:31** | 没看 hook 注入的「现在 …」就凭感觉写 → 说时间一律照抄 UserPromptSubmit hook 给的那行，不估 | lead · 09-29 |
| AI | **两个 lead 会话同时给 louis 派了同一件事（T10 底图 vs T11 建筑），PR 撞车** | 同一个指令在两个会话里都下了，各自开了 PR → 派任务只在一个会话做；派之前先查开着的 PR / issue 有没有同类（按需求方原文为准） | lead · 09-29 |
| git | **Stop 门禁报 `.claude/worktrees/wf_*` 越界，无关会话每个回合都被拦** | Workflow 开 worktree 隔离时把临时 worktree 建在仓库里的 `.claude/worktrees/`，没被 gitignore，`check [3]` 用 `git ls-files --others --exclude-standard` 把它当成本分支的越界改动 → `.gitignore` 加 `.claude/worktrees/`（check.sh 已带 `--exclude-standard`，不用改）；别删这些目录，别的会话可能还在用 | lead · 09-29 |
| AI | **开了带 worktree 隔离的 Workflow 后，`check.sh [3]` 报 `.claude/worktrees/…` 越界，`deploy.sh` 报工作区不干净** | Workflow 把临时 worktree 建在仓库里的 `.claude/worktrees/`，这个目录没进 .gitignore（AI 不许改 .gitignore）→ workflow 跑完先 `git worktree list` 核对，合并完分支后 `git worktree remove <路径>` 删掉再部署；lead 把 `.claude/worktrees/` 加进 .gitignore | lead · 09-29 |
| git | **叠在一起的 PR（#54 以 #53 的分支为目标）：`gh pr merge 53 --delete-branch` 以后 #54 被直接关掉，本地放这个分支的 worktree 目录也被删了** | 命令行删分支不触发 GitHub 的自动改目标，gh 清本地分支时连 worktree 一起删 → 先 `gh pr edit <下一个> --base main`，再 `gh pr merge <n> --squash`（不带 `--delete-branch`），最后 `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<分支>` 删远端；已经被关的：从本地提交把分支推回去（pre-push 只许推当前 HEAD，要在 worktree 里切过去推）→ `gh pr reopen` → 改目标 | @jinmingq · 09-29 |
| AI | **给评审的架构图被打回三轮：小字多、写了任务号和分工、框里留白多** | AI 照内部架构图画，把负责人、决定编号、提交门禁都塞进去 → 给评审的图只讲产品：每个框只留名字 + 最多一行，最小字 ≥ 画布宽的 1/90，文字居中，框按内容收紧，画布和幻灯片一样 16:9 | lead · 09-29 |
| git | **放在 `docs/arch/` 的 pitch 图，队员改了 `check [3]` 报越界** | `docs/arch/` 只有 lead 分支能写 → 要大家都能改的图和素材放 `docs/pitch-assets/`，开 `<handle>/pitch/T<n>-…` 分支就放行 | lead · 09-29 |
