# apps/ —— 各模块的代码放这里

kickoff 前这个目录只有这份 README。模块全部开赛后手工建（赛前的 `starters/` 已按 D-0929-1311 删掉，`new-app.sh` 随之停用）。

## 规则

- 一个模块一个子目录，**目录名 = 模块名 = commit 前缀 = 分支名里的模块段**
- 只写自己的模块；和别的模块对接只看 `docs/contract.md`
- 确实要共享代码 → 放 `apps/shared/`，视同契约，只能走 lead 的 PR

## 模块登记表（lead 写）

| 模块 | 负责人 | 来自哪个 starter | 本地端口 | 线上地址 |
|---|---|---|---|---|
| sim | @Zemmeng | 没用 starter（手工建的静态页） | 4174 | — |
| roads | @louisxie316-dotcom | 没用 starter（数据管线 + 静态 JSON） | — | — |
| web | @unicornnnnnny | 没用 starter（单文件静态页；`src/` 由 `build.py` 拼成 `public/index.html`） | 4175 | — |
| engine | @Zemmeng（lead 的引擎会话，T9） | 没用 starter（纯 JS 路网引擎，浏览器和 node 都能跑） | —（`node apps/engine/tools/demo.mjs`） | `/engine/public/js/index.js` |
| api | @jinmingq | 部分：`test.sh`、`tests/mini.mjs`（测试运行器）拷自赛前的 web-worker starter（#22）；业务代码手写 | 8788 | — |
| params | @Unzzip | 没用 starter（静态 JSON + 出处表） | — | — |
| site | @unicornnnnnny（部署）· @Zemmeng（代码） | 没用 starter（手写 Worker：各模块 `public/` 挂到 `/<模块>/public/`，`/api/*` 转给 T5） | 8790 | `DEMO_URL`（部署后 lead 填） |

## 端口约定

| 类型 | 从哪起 | 谁分配 |
|---|---|---|
| Worker（`wrangler dev`） | **8788** 起（8787 原是 starter-worker，已删） | lead 手工分配，写进 `.claude/launch.json` |
| Python 服务 | 8000 | lead 手工分配 |
| 静态页（`python3 -m http.server`） | 4174 起（4173 原是 starter-static，已删） | 要单独预览某模块的 `public/` 就照 `sim` 那条手动加 |

## 加新模块（只能 lead 在 `lead/*` 分支执行）

`new-app.sh` 已停用（它只会复制 `starters/`，D-0929-1311 删了）。手工建：`apps/<模块名>/` 放下一节要求的文件 → 登记表加一行 → `.github/CODEOWNERS` 加 `/apps/<模块名>/ @<handle>` → 要本地预览再往 `.claude/launch.json` 加一条。

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
