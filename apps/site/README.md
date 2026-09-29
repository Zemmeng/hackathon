# site —— 同源网站外壳：一个网址挂全部模块，/api/* 留给 T5
Owner: @unicornnnnnny（部署人，D-0929-1322）· 代码：@Zemmeng

一个 Cloudflare Worker = 整个 demo 网址。部署时 `build.mjs` 把 `apps/<模块>/public/` 里 **git 已跟踪的文件**原样拷到 `/<模块>/public/`（契约 `docs/contract.md`：「lead 部署时把每个模块的 `public/` 原样挂到 `/<模块>/public/`」）。这样网页面板、引擎 JS、路网数据和路口仿真都在同一个网址下，互相 `fetch` / `import` 不用跨域。`/api/*` 转给 T5 的 api Worker（服务绑定，D-0929-1436），T5 上线前先回占位。

## 部署（高h 照做）

> 🔒 只走 `bash scripts/deploy.sh all`，不直接 `npm run deploy`。部署人是 `hackathon.conf` 的 `DEPLOYER`（@unicornnnnnny），备份部署人是 lead。

### 第一次（大约 15 分钟）

**0. lead 先做：** Cloudflare 后台 → Manage Account → Members → Invite，填高h 的邮箱。角色**只勾名字里带 Workers 的**（例如 Workers Admin），不给 Administrator（D-0929-1322）。

**1. 高h 收邮件，接受邀请。** 没有 Cloudflare 账号就按提示用同一个邮箱注册。

**2. 拿最新代码、装依赖**（在仓库根目录）：

```bash
git switch main && git pull
git config hack.me          # 必须打印 unicornnnnnny；空的话先跑 bash scripts/setup.sh
cd apps/site && npm ci      # 只装 wrangler，版本锁死在 package-lock.json
```

**3. 登录 Cloudflare**（还在 `apps/site` 里）：

```bash
npx wrangler login          # 浏览器弹出授权页：用被邀请的那个邮箱登录，点 Allow
npx wrangler whoami         # 列表里要能看到 lead 的账号
```

**4. whoami 列出了不止一个账号**（你自己也有 Cloudflare 账号时会这样）：

```bash
export CLOUDFLARE_ACCOUNT_ID=<lead 私下发你的账号 ID>   # 只在当前终端有效；不写进任何文件、不发群
npx wrangler whoami                                    # 再确认一次
```

**5. 部署**（回到仓库根目录）：

```bash
cd ../..
bash scripts/deploy.sh all
```

`deploy.sh` 先查 6 项：你是 DEPLOYER、工作区干净、在 main 上且和 origin 一致、冻结期规则、全量 `check.sh` 没有 ❌，然后在 `apps/site` 里跑 `npm run deploy`（= `node build.mjs && wrangler deploy`）。成功时终端打出网址：`https://hackathon-site.<账号子域>.workers.dev`。哪一项被拒，它会打印修法，照做就行。

**6. 打开看一眼：**

| 地址 | 应该看到 |
|---|---|
| `<网址>/` | 有 `apps/web` 就跳到网页面板 `/web/public/`；还没有就是模块目录 |
| `<网址>/?list` | 模块目录（每个模块的链接和文件数） |
| `<网址>/sim/public/` | 路口仿真 |
| `<网址>/roads/public/cbd/network.json` | 路网 JSON |
| `<网址>/api/health` | `{"ok":true,"v":"0.2.0","mock":true,"llm":{…}}`（T5 的 api Worker 回的；看到 `"api":false` = 服务绑定没生效） |

**7. 把网址发给 lead。** 网址不是秘密，群里发就行。lead 把它写进 `hackathon.conf` 的 `DEMO_URL` 和 README 顶部（这两处只有 lead 改）。

**8. lead 的改动合进 main 以后，跑线上冒烟：**

```bash
git pull && bash scripts/check.sh --e2e
# 等不及的话，直接给网址：bash scripts/check.sh --e2e https://hackathon-site.<账号子域>.workers.dev
```

最后一行是 `======== 汇总 0 ❌ 0 ⚠️` 就算通了（M1）。它查 4 件事：首页 200 且有 `data-smoke`、`/api/health` 有 `"ok":true`、首页没有 localhost、每个请求 3 秒内返回。

### 以后每次

队友的 PR 合进 main 后：`git switch main && git pull && bash scripts/deploy.sh all`。`DEMO_URL` 填好以后，`deploy.sh` 部署完会自己跑一遍 `--e2e`。

### 出错了

| 看到什么 | 怎么办 |
|---|---|
| `Not logged in` / `Authentication error` | 在 `apps/site` 里重新 `npx wrangler login`，再 `npx wrangler whoami` |
| `More than one account available` 或让你选账号 | 第 4 步：`export CLOUDFLARE_ACCOUNT_ID=…` |
| `permission` / `403` / `not authorized` | 可能是 Workers 角色的权限不够（还没实测过）。把报错原文发给 lead，lead 去后台调角色 |
| 问你要不要注册 workers.dev 子域 | 先别选，问 lead（lead 的账号应该已经有了） |
| `A Worker with this name already exists` 之类的重名 | 改 `wrangler.jsonc` 的 `name`（走 lead 分支），告诉 lead 新网址 |
| `Could not resolve service binding` | T5 的 api Worker 还没部署，或 `DEPLOY_MODULES` 里 `api` 没排在 `site` 前面（见下一节） |
| 部署成功但 `--e2e` 红 | `cd apps/site && npx wrangler tail` 开着，浏览器再点一次，看报错 |
| 线上坏了、演示快到了 | `deploy.sh` 失败时会打印回滚命令：切到上一个 `demo-*` tag 重新部署 |

## 接上 T5 的 api Worker（T19 已打开）

1. ✅ `hackathon.conf`：`DEPLOY_MODULES=api site`（`api` 必须排在前面：绑定的目标 Worker 要先存在）
2. ✅ `apps/site/wrangler.jsonc` 的 `services` 已打开：`{ "binding": "API", "service": "hackathon-api" }`，`hackathon-api` = `apps/api/wrangler.jsonc` 的 `name`（两边改名要一起改，`tests/config.test.mjs` 查）
3. **部署人** `bash scripts/deploy.sh all`：先部署 api，再部署 site
4. 验证：`<网址>/api/health` 变成 T5 的 `{"ok":true,"v":"0.2.0","mock":true,"llm":{"mode":"rules",…}}`（不再有 `"api":false`），`POST /api/read` 不再 503
5. 大模型的 key 放在 **api Worker** 上，不放 site：`cd apps/api && npx wrangler secret put LLM_API_KEY`，再把 MOCK 改成 `"0"` 重新部署（两步详见 `apps/api/README.md`「怎么接大模型」）。site 不需要任何 key
6. 可选：api Worker 自己也有一个 `hackathon-api.<账号子域>.workers.dev` 网址。想只留同源入口，把 `apps/api/wrangler.jsonc` 的 `workers_dev` 改成 `false`，服务绑定不受影响

`apps/api/public/`（`reader.js`、答案文件）照常挂在 `/api/public/…`，是静态文件，不转发给 T5。引擎从 `/api/public/js/reader.js` 引 `readSigns()`，`reader.js` 再同源调 `/api/read`。

本地同时起两个也能联调：先在 `apps/api` 里 `npm run dev`（8788），再起 site（8790），wrangler 会在本机把两个连起来（尚未实测）。

## 怎么跑

- Claude 会话里：preview 工具启动 `site`（`.claude/launch.json`，端口 8790）
- 手动：`cd apps/site && npm ci && npm run dev`，浏览器开 http://localhost:8790
- `npm run dev` 先 build 一次。改了别的模块的 `public/` → 重启 dev；**新加的文件要先 `git add` 才会被拷**（build 会打印「N 个没 git add 的文件没拷」）
- 只改某个模块自己的页面时，用那个模块自己的 launch.json 条目更快；site 用来查「挂到一个网址下以后，路径还对不对」

## 怎么测

- `bash apps/site/test.sh`：不需要 `npm ci`、不联网，3 个文件共 69 条断言
  - `build.test.mjs`：各模块 `public/` 拷到 `/<模块>/public/`、首页有 `data-smoke`、有 web 就跳、不清空别人的目录
  - `worker.test.mjs`：假 ASSETS / API 绑定下的路由、503 / 502 错误格式、没有 CORS 头
  - `config.test.mjs`：`wrangler.jsonc`、`package.json`、锁文件的关键项
- `cd apps/site && npm run dry-run`：打包但不上传，看配置和绑定对不对（需要先 `npm ci`；想关掉 wrangler 的匿名统计就在前面加 `WRANGLER_SEND_METRICS=false`）

## 对外接口（→ `docs/contract.md` §谁调谁、§路网数据文件、§错误格式）

| 路径 | 返回 |
|---|---|
| `/` | 首页，含 `data-smoke`。有 `apps/web/public/index.html` 就用 JS 跳 `/web/public/`（`/?list` 不跳，看模块目录） |
| `/<模块>/public/…` | `apps/<模块>/public/` 里 `git ls-files` 列出的文件原样挂上；被 gitignore 的（keys.json、*.pem、raw/、node_modules/）、没 git add 的、点开头的、符号链接都不拷；模块目录或 `public/` 是符号链接 → 整个模块跳过。git 不可用或不在仓库里 → build 报错不构建。新模块只要有 `public/` 就自动挂上，不用改 site |
| `/api/health` | 没绑 API：`{"ok":true,"v":"site-0.1","mock":true,"api":false}`；绑了：T5 的响应 |
| `/api/*`（`/api/public/*` 除外） | 绑了 API：原样转发（方法、查询串、请求体不变）；没绑：503 `{"ok":false,"error":"api_not_deployed","msg":"…"}`；API 抛错：502 `api_unreachable`，不带内部报错 |
| `/api/public/*` | `apps/api/public/` 的静态文件 |

故意不加 CORS 头：所有东西在同一个网址下。

## 外部 API

Cloudflare Workers（静态资源 + 服务绑定）。账号是 lead 的，登录方式见上面的部署步骤。

- 变量名：`CLOUDFLARE_ACCOUNT_ID`，只在一台电脑登录了两个账号时 `export`，值由 lead 私下给，不进任何文件
- 限制：单个静态文件 25 MiB、免费计划 20,000 个文件（`build.mjs` 超了会直接报错）；静态文件请求不收费，进 Worker 代码的请求（`/api/*`）占每天的免费额度
- 实测（2026-09-29，wrangler 4.143.0 本机 workerd，没上线）：
  - `/index.html` 返回 307 跳到 `/`，`/sim/public` 返回 307 跳到 `/sim/public/`
  - 没有的路径返回 404，响应体为空
  - `/api/public/…` 由静态资源处理，不进 Worker
  - `src/worker.js` 多导出一个字符串常量，整个 Worker 就起不来（`Incorrect type for map entry`）

## 结构

| 文件 | 一句话 |
|---|---|
| `build.mjs` | 各模块 `public/` → `out/<模块>/public/`，生成首页 `out/index.html`；每次先清空 `out/` |
| `src/worker.js` | `/api/*` 转发或占位，其余交给 ASSETS |
| `wrangler.jsonc` | Worker 名 `hackathon-site`（部署人可以改）、`assets.directory = out`、`run_worker_first`、`services`（API → `hackathon-api`） |
| `package.json` / `package-lock.json` | 只有 wrangler（锁 4.143.0）；`build` / `dev` / `dry-run` / `deploy` / `test` |
| `test.sh` + `tests/*.test.mjs` | 见「怎么测」 |
| `out/` | 构建产物，已 gitignore，不手改 |

## 本模块固定模式

- 🔒 `src/worker.js` 只导出 `default`（workerd 把具名导出当入口；`worker.test.mjs` 第一条查它）
- 🔒 `out/` 是产物：不进 git、不手改；`dev` / `deploy` 前自动重新 build
- 🔒 `/api/public/*` 永远是静态文件；`wrangler.jsonc` 的 `run_worker_first` 和 `worker.js` 两处都这么处理，改一处要改两处
- 首页不许出现 localhost（`check.sh --e2e` 会查）

## 已知问题

- 尚未验证：只给 Workers 角色的成员，能不能部署带静态资源的 Worker（第一次部署时就知道了）
- 尚未验证：绑上 T5 后的真实转发（T19 打开了绑定，要等第一次 `deploy.sh all`）。目前只用假绑定测过
- `hackathon-site` 这个名字在 lead 的账号里有没有被占用，第一次部署时才知道
