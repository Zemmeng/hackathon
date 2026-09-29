# scripts/ —— 脚本清单

一眼看出谁在什么时候跑什么。都在仓库根目录用 `bash scripts/<名字>` 跑（从别的目录跑也行，按当前所在仓库找根目录）。每个脚本 `--help` 打印头注释。

| 脚本 | 做什么 | 谁跑 | 什么时候跑 |
|---|---|---|---|
| `setup.sh` | 检查工具（git / gh / node ≥20 / python3 ≥3.9）、启用 `.githooks`、复制 `.env`、建本地目录、设 `hack.me`、建议 noreply 邮箱、打印倒计时和 `check --quick` 汇总 | 每个人 | clone 后跑一次；换电脑、拉到新 hooks 后再跑（幂等） |
| `check.sh` | **唯一的检查 / 测试入口**：[1]–[9] 九项检查，末尾固定「`======== 汇总 X ❌ Y ⚠️`」，写 `logs/last-check.txt`，有 ❌ 退出 1 | 每个人；Stop hook、pre-push、CI 自动调 | 每完成一小步；commit / push 前；收工前 |
| `secret-scan.sh` | 扫 key / token / 私钥，只输出「文件:行号:模式名」，绝不打印值 | pre-commit、check [1] 自动调；lead 手动跑 `--history` | 每次 commit（自动）；仓库转 public 前（`--history` 必跑） |
| `sync.sh` | 零 token 实况对齐：各分支最近提交、开着的 PR 和 CI、没落账的交接单、3-tasks 里的 🔨、main 最近 5 条、倒计时 | lead；Codex / 不用 AI 的人 | lead 每次开口前；任何人开工前 |
| `new-app.sh` | 从 `starters/` 生成 `apps/<名>`：替换 `__NAME__`、分配端口、追加 `.claude/launch.json`、填 Owner，打印 CODEOWNERS 和登记表要加的两行 | 只有 lead（`lead/*` 分支） | kickoff 切模块时；中途加模块时 |
| `deploy.sh` | 前置检查（DEPLOYER 本人、工作区干净、在 main 或 tag 上且与 origin 一致、冻结期只从 `demo-*` tag、全量 check 无 ❌）→ 逐个模块部署 → `check --e2e` 冒烟 → 记 `logs/deploy.log`；失败打印回滚命令 | DEPLOYER（不在时 BACKUP_LEAD）；🔒 AI 执行前必须先问人 | M1 部署打通；每个集成点；打 `demo-*` tag 后 |
| `.githooks/pre-commit` | `secret-scan.sh --staged`；拦暂存区里的 `.env` / `.dev.vars` / `settings.local.json` / `keys.json`；拦单个 >1MB 的文件 | git 自动（`setup.sh` 启用后） | 每次 `git commit` |
| `.githooks/pre-push` | 目标是 `main` 且没设 `ALLOW_MAIN=1` 就拒绝；跑 `check.sh --quick`（限时 90 秒），有 ❌ 就拒绝并打印汇总节 | git 自动 | 每次 `git push` |
| CI（`.github/workflows/check.yml`） | PR 上跑 `check.sh --base origin/main`，push 到 main 跑全量；PR 带 `cross-module` 标签时设 `ALLOW_CROSS=1`；汇总节写进 job summary | GitHub Actions | 开 PR / 更新 PR / 打标签 / 合进 main |

## 参数

| 命令 | 参数 | 说明 |
|---|---|---|
| `bash scripts/check.sh` | （无） | 全量：扫全部文件，跑 `apps/*` 和 `starters/*` 的全部 `test.sh` |
| | `--quick` | 秘密扫描和测试只覆盖相对 base 改动过的文件 / 模块（没有 base 就全跑） |
| | `--base <ref>` | 对比基准，默认 `origin/main` → `main`；都没有（还没提交 / 没远端）就跳过 diff 类检查并 ⚠️ |
| | `--e2e [URL]` | 只做线上冒烟：`GET /` 200 且含 `data-smoke`；`/api/health` 含 `"ok":true`；HTML 无 `localhost`；每个请求 ≤3 秒。**不给 URL 就读 `hackathon.conf` 的 `DEMO_URL`**（为空 → ❌）。日常就写 `bash scripts/check.sh --e2e` |
| | `--selftest` | 在临时仓库里造 8 种场景（直推 main / 假 key / 越界 / 测试崩溃 / 不打计数 / 分支名不合约定 / RULES 标记缺失 + 全绿基线），确认门禁该红就红 |
| | `--time` / `--time-raw` | 只打印现在时间、离截止多久、阶段；`-raw` 是 `KEY=VALUE`（`PHASE=`），给脚本用 |
| `bash scripts/secret-scan.sh` | `--all`（默认） | 所有已跟踪文件 + 未跟踪但没被忽略的文件 |
| | `--staged` | 只扫暂存区里将要提交的内容（pre-commit 用） |
| | `--files <路径>…` | 只扫给定文件（`check.sh --quick` 用） |
| | `--history` | 全部 git 历史里新增过的行，输出「提交号:文件:模式名」 |
| `bash scripts/sync.sh` | `[小时数]` | 看最近几小时的提交，默认 6 |
| `bash scripts/new-app.sh <名> <web-worker\|py-tool>` | `--owner <handle>` | 填进模块 README 的 `Owner:` 行（不给就留 `@<填我>`） |
| | `--port N` | 指定端口（被 `launch.json` 占用就拒绝）；不给就自动取下一个：worker 8787 起、python 8000 起。静态页端口不自动分配 |
| `bash scripts/deploy.sh` | `<模块>` / `all` | `all` = `hackathon.conf` 的 `DEPLOY_MODULES` |
| | `--hotfix` | 代码冻结期允许不在 `demo-*` tag 上部署（P0 紧急修复；事后打 tag、写 decisions） |
| | BACKUP_LEAD | `hack.me` 等于 conf 的 `BACKUP_LEAD` 时也放行，打 ⚠️，`deploy.log` 标「备份部署」 |

## check.sh 的九项

| # | 检查 | ❌ | ⚠️ |
|---|---|---|---|
| [1] | 秘密扫描（`--quick` 只扫改动的文件） | 命中任何模式 | — |
| [2] | 秘密文件被跟踪 | `.env*`、`.dev.vars`、`settings.local.json`、`keys.json`、`*.pem`、`*.key`、`credentials*.json` 在 git 里 | — |
| [3] | 分支与越界（分支名 `<handle>/<模块>/T<n>-<slug>` 推出模块；模块 `pitch` 另可写 `docs/4-demo.md`、`docs/pitch-assets/`） | main 上有改动；分支名不合约定且有改动；改了模块范围外的文件；decisions / pitfalls 有删除行；改了别人的交接单或新建的交接单前缀不是自己；`docs/llm-apis/` 里改 / 删了别人的卡、新建的卡不以自己的 handle 开头、卡的文件名不是 ASCII 或后缀不是 `.md` / `.json`、动了 `README.md` `TEMPLATE.md` 或建了子目录 | 还没有提交 / 没有 base；`lead/*` 分支但你不是 LEAD / BACKUP_LEAD；`ALLOW_CROSS=1` 放行 |
| [4] | 模块结构 | `apps/*` 缺 README、缺 `Owner:` 行、缺可执行的 `test.sh` | Owner 没填 |
| [5] | 模块测试（单个限时 `CHECK_TEST_TIMEOUT`，默认 120 秒） | 退出码非 0；最后一行不是 `N passed, M failed`；超时 | 一个 `test.sh` 都没有；test.sh 留了后台进程（已清理） |
| [6] | 仓库卫生 | 跟踪文件 >1MB（`apps/<模块>/public/` 下的 `.json` 数据文件 >2MB，不报 500KB 提醒）；`.claude/agents/*.md` 的 frontmatter 不是恰好一行 `model: opus`，或文件里出现 `fable` | 跟踪文件 >500KB；`*.sh` / hooks 缺可执行位或是 CRLF；shell 文件里 `$变量` 后面紧跟中文 / 全角字符（macOS 上会崩，改成 `${变量}`） |
| [7] | RULES 块一致（README / CONTRIBUTING / AGENTS / KICKOFF） | 缺 BEGIN / END 标记、有多个 BEGIN、块内容不逐字相同 | 某个文件不存在 |
| [8] | 交接单格式 | — | 文件名不对；缺四节；根目录有超过 12 小时没处理的单 |
| [9] | hackathon.conf | 解析不了；TZ 无效；时间格式不对 | DEADLINE 未设置；DEMO_URL 有值但 README 里没有 |

汇总节 = 「`======== 汇总 X ❌ Y ⚠️`」一行 + 所有 ❌ / ⚠️ 行的副本。Stop hook、pre-push、CI 只看这一节；**没有汇总行一律按失败处理**（崩溃不许伪装成全绿）。

## 原则

- **幂等**：重复跑不会坏事（setup 不覆盖 `.env`，new-app 目标已存在就拒绝）。
- **有进度输出**：`[i/N]` 或 `[N] 名称 ✅/❌/⚠️`，长任务每步都打一行。
- **失败时打印修法**：❌ 后面写原因和下一条该敲的命令，不只说「失败了」。
- **文件头写用途 / 用法 / 退出码**：`--help` 就是打印这段头注释。
- 兼容 macOS 自带 bash 3.2 和 ubuntu（CI）；时间一律用 python3 `zoneinfo` 按 `hackathon.conf` 的 TZ 算（墨尔本 10-04 进夏令时，不写死偏移）。
- 🔒 脚本不自动 commit / push，不读、不打印任何 key 的值。

## 环境变量开关

| 变量 | 作用 | 什么时候用 |
|---|---|---|
| `ALLOW_MAIN=1` | pre-push 放行直推 main；check [3]「在 main 上有改动」降为 ⚠️ | lead 的小改动：`ALLOW_MAIN=1 git push`（commit 里写原因） |
| `ALLOW_CROSS=1` | check [3] 越界文件、分支名不合约定降为 ⚠️；new-app.sh 允许不在 `lead/*` 分支上跑 | CI 在 PR 带 `cross-module` 标签时自动设；队员**经 lead 同意**跨模块后，push 前 `ALLOW_CROSS=1 git push`，PR 打 `cross-module` 标签 |
| `HACK_NO_GATE=1` | Claude 的 Stop hook 直接放行（逃生开关） | 门禁本身坏了、要先修门禁的时候 |
| `CHECK_TEST_TIMEOUT=<秒>` | 单个 `test.sh` 限时，默认 120；门禁（Stop hook / pre-push）会传更小的值 | 测试确实慢的模块（先想想能不能拆） |
| `BRANCH=<名>` / `GITHUB_ACTOR` | check.sh 认的分支名 / `lead/*` 分支核身份用的人（本地用 `git config hack.me`） | CI 设置（PR 的 checkout 是 detached merge commit） |
