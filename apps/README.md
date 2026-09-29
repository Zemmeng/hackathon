# apps/ —— 各模块的代码放这里

kickoff 前这个目录只有这份 README。赛题公布后 lead 用 `new-app.sh` 从 `starters/` 生成模块。

## 规则

- 一个模块一个子目录，**目录名 = 模块名 = commit 前缀 = 分支名里的模块段**
- 只写自己的模块；和别的模块对接只看 `docs/contract.md`
- 确实要共享代码 → 放 `apps/shared/`，视同契约，只能走 lead 的 PR

## 模块登记表（lead 写）

| 模块 | 负责人 | 来自哪个 starter | 本地端口 | 线上地址 |
|---|---|---|---|---|
| sim | @Zemmeng | 没用 starter（手工建的静态页） | 4174 | — |
| roads | @louisxie316-dotcom | 没用 starter（数据管线 + 静态 JSON） | — | — |
| engine | @Zemmeng（暂管，T4 认领后改） | 没用 starter（纯 JS 路网引擎，浏览器和 node 都能跑） | —（`node apps/engine/tools/demo.mjs`） | `/engine/public/js/index.js` |
| api | @Zemmeng（暂管，T5 认领后改） | 没用 starter（Cloudflare Worker + 共用的 `public/js/`） | 8788 | `/api/*` |

## 端口约定

| 类型 | 从哪起 | 谁分配 |
|---|---|---|
| Worker（`wrangler dev`） | 8787 被 `starter-worker` 占用，模块从 **8788** 起 | `new-app.sh` 自动分配，写进 `.claude/launch.json` |
| Python 服务 | 8000 | `new-app.sh` 自动分配 |
| 静态页（`python3 -m http.server`） | 4173 被 `starter-static` 占用 | 不自动分配；要单独预览某模块的 `public/` 就照 `starter-static` 那条手动加 |

## 生成新模块（只能 lead 在 `lead/*` 分支执行）

```bash
bash scripts/new-app.sh <模块名> web-worker --owner <handle>
bash scripts/new-app.sh <模块名> py-tool --owner <handle>
```

## 每个模块必须有

| 文件 | 要求 |
|---|---|
| `README.md` | 含 `Owner: @handle` 一行（`check.sh [4]` 查） |
| `test.sh` | 可执行；最后一行输出 `N passed, M failed`；失败退出码非 0（`check.sh [5]` 自动发现） |
| `npm run deploy` 或 `deploy.sh` | 要部署的模块才需要 |

## 模块 README 模板

```markdown
# <模块> —— 一句话
Owner: @<handle>

## 怎么跑
## 怎么测
## 对外接口（→ docs/contract.md 第 X 节）
## 外部 API（只写变量名、申请入口、**实测的响应路径**、限流和价格、坑）
## 结构
| 文件 | 一句话 |
|---|---|
## 本模块固定模式
## 已知问题
```

## 数据与素材

- 小样例放模块的 `fixtures/`
- 大文件放 `raw/` 或 `out/`（已 gitignore），共享走网盘，链接写进模块 README
- AI 原图放 `assets-src/`（已 gitignore），压缩后再放进 `public/`
