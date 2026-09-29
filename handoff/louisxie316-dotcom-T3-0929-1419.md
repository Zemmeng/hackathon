# T3 第二期 行人、公交、设备库存 —— 交接

## 1. 事实
- 做了什么：按 @jinmingq 的 `PRD-2.md`（issue #11）做 P0 三样
  - A `equipment.json` ✅ 已提交：16 种设备（护栏 3、静态标志 9、VMS 2、箭头板、行人临时信号灯）；`qty`、`day_rate_aud` 是假设
  - B `transit.json` ✅ 已提交：电车 22、巴士 25 条线路，站点 182；走向对上路网 90.6%；电车线路用到的路段 98% 在 `network.json` 标了 tram
  - C `walk.json` + `peds.json` 🔨 生成好了、测试全过，但分别 1.7 MB、1.8 MB，**超过 pre-commit 的 1 MB 上限，没提交**（见第 2 节）
- 停在哪（09-29 14:19）：等 lead 放宽大小上限；本地文件在，重跑一条命令即可
- 分支 / PR：`louisxie316-dotcom/roads/T3-phase2`（从 T3 分支开，含 PR #9 的提交），还没 push、没开 PR
- 验证：`bash apps/roads/test.sh` → `41 passed, 0 failed`；`bash scripts/check.sh --quick` → `======== 汇总 0 ❌ 1 ⚠️`（⚠️ 就是这两个未跟踪的大文件）
- 尚未验证：T4 / T2 还没读过这几个文件；人行道 side（左 / 右）只按几何算，没人工抽查
- 本次花了多少钱：0

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| `.githooks/pre-commit` | [3] 大文件，`MAX_BYTES=1048576` | `apps/*/public/**/*.json` 放宽到 2 MB（和 `PRD.md` §7、`PRD-2.md` §6 的「每个文件 < 2 MB」一致），其余文件仍 1 MB |
| `scripts/check.sh` | [6] 卫生，已跟踪文件 `sz > MB` 报 ❌ | 同上，`apps/*/public/**/*.json` 到 2 MB 才报 ❌（500 KB–2 MB 可以继续报 ⚠️） |

## 3. 留给 lead
- 需要拍板：
  - T3 第二期的任务号（现在分支名借用 T3：`louisxie316-dotcom/roads/T3-phase2`，发号后 `git branch -m` 改）
  - `PRD-2.md` 在 @jinmingq 的分支 `jinmingq/roads/T3-phase2-prd` 上，要不要合进 main；新文件格式是草案，定稿后写进 `docs/contract.md`
  - 大小上限如果不放宽，备选：peds.json 改成「77 条曲线表 + 每条路段引用」（约 300 KB），walk.json 省略直线路段的 geometry、null 字段、缩短 id —— 会和 PRD-2 草案格式不同
- 风险：本分支依赖 PR #9（network.json），PR #9 先合，本分支再 merge main
- 需要别人配合：T2 / T4 读 `equipment.json`、`transit.json` 前看一眼 `apps/roads/README.md` 第二期那段
- 中途想到的别的事：用户问过把大模型 key 放进 GitHub，已按硬规矩 3 和 D-0929-1310 拒绝，建议走 lead 定供应商 → 部署人设 Cloudflare secret

## 4. 下一步
- 下一个人要敲的第一条命令：`apps/roads/.venv/bin/python apps/roads/tools/build_walk.py && bash apps/roads/test.sh`（上限放宽后再 `git add apps/roads/public/cbd/walk.json apps/roads/public/cbd/peds.json`）
- dev server 的名字（launch.json）：无（静态数据文件）
