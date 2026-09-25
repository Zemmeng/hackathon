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
