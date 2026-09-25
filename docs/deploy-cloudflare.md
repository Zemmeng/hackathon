# 部署到 Cloudflare —— 怎么连、怎么发、队友怎么拿权限

> 这套做法在 lead 之前的四个线上项目里跑过（房间制联机、静态站、Durable Object 状态）。照抄就能上线。
> 🔒 本文只写变量名和命令，不写任何 key。账号相关的值都在 lead 本机或 GitHub Secrets 里。

## 0. 一句话

一个模块 = 一个 Worker：`public/` 里的静态页由 Worker 的 assets 绑定托管，`/api/*` 和 `/ws` 走 Worker 代码，需要状态就绑一个 Durable Object。`npx wrangler deploy` 一条命令上线，URL 立刻可用。

## 1. 账号与登录（lead 本机已经好了）

| 项 | 现状 |
|---|---|
| Cloudflare 账号 | lead 的个人账号，wrangler 已用 `npx wrangler login`（浏览器 OAuth）登录 |
| 凭据存在哪 | `~/Library/Preferences/.wrangler/config/default.toml`（wrangler 自己管，**不在仓库里**） |
| 已授权范围 | workers / workers_routes / workers_scripts（写）、d1（写）、pages（写）、workers_tail（读） |
| 域名 | `wawazhiliao.com` 托管在这个账号，任何 `<子域>.wawazhiliao.com` 一行配置就能绑 |
| workers.dev 子域 | 账号自带一个 `<账号子域>.workers.dev`，`workers_dev: true` 时自动给每个 Worker 一个 `<name>.<账号子域>.workers.dev` |

自查：

```bash
npx wrangler whoami        # 看到账号名和 scope 就是登录着的
```

## 2. 一个模块的标准配置（`apps/<模块>/wrangler.jsonc`）

`starters/web-worker/wrangler.jsonc` 已经是这个样子（starter 里 `name` 是占位 `web-worker-starter`，`new-app.sh` 复制时会把它改成模块名）：

```jsonc
{
  "name": "web-worker-starter",       // Worker 名，也是 workers.dev 链接的前缀；new-app.sh 改成模块名
  "main": "src/worker.js",
  "compatibility_date": "2026-08-01",
  "workers_dev": true,                // 比赛期间开着拿 demo 链接；赛后想关就改 false
  "preview_urls": false,
  "observability": { "enabled": true },                       // 线上日志在后台 Workers Logs 里看
  "assets": { "directory": "public", "binding": "ASSETS" },   // 静态页
  "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
  // 要绑正式域名时打开（DNS 记录会自动创建，不用去后台点）：
  // "routes": [{ "pattern": "<模块>.wawazhiliao.com", "custom_domain": true }]
}
```

要点：
- **DO 用 `new_sqlite_classes`**（免费版也能用），不用老的 `new_classes`
- `migrations` 的 `tag` 只增不改：改类名要加一条新 migration，不是改旧的
- 纯静态页不需要 `main` 和 `durable_objects`，只留 `assets`
- 子域名别撞已经在用的：先在 Cloudflare 后台 → Workers & Pages 看一眼已占用的名字

## 3. 命令

```bash
cd apps/<模块>
npm ci                               # 只装 wrangler（有 package-lock.json，版本锁死）
npm run dev                          # = wrangler dev --port <本模块端口，见 apps/README.md 登记表>；Claude 用户用 preview 工具按 launch.json 的名字起
npm run deploy                       # = wrangler deploy，几秒钟上线，打印 URL
npx wrangler tail                    # 看线上实时日志（排查 500 用）
npx wrangler deployments list        # 看历史版本
npx wrangler delete                  # 下线整个 Worker（赛后清理）
```

本地开发的变量放 `apps/<模块>/.dev.vars`（从 `.dev.vars.example` 复制，已 gitignore）。wrangler dev 优先读**模块目录**的 `.dev.vars`，没有才读模块目录的 `.env`；仓库根的 `.env` 不会进 Worker 的 `env`（但会进 wrangler 进程环境，所以根 `.env` 里别放 `CLOUDFLARE_API_TOKEN`）。

## 4. 密钥

```bash
npx wrangler secret put <NAME>       # 交互式粘贴，值不会出现在 shell 历史
npx wrangler secret list             # 只列名字
npx wrangler secret delete <NAME>
```

代码里 `env.<NAME>` 读。本地想有值就写进 `.dev.vars`；想在 dev 命令行临时给：`wrangler dev --var NAME:value`（launch.json 里的 `--var MOCK:1` 就是这么来的）。

🔒 密钥只在 Cloudflare secret 和本机 `.dev.vars` 两个地方。文档、交接单、README、commit 里只写变量名。

## 5. 队友怎么部署（三选一，kickoff 时定）

| 方式 | 适合 | 怎么做 |
|---|---|---|
| **A · 只有 DEPLOYER 部署**（默认） | 3–5 人、部署频率每几小时一次 | 队友合 PR 到 main → DEPLOYER 跑 `bash scripts/deploy.sh all`。`hackathon.conf` 的 `DEPLOYER` 就是这个人 |
| **B · 把第二个人加进 Cloudflare 账号** | lead 睡了 / 联系不上时能救火 | ① Cloudflare 后台 → Manage Account → Members → 邀请邮箱，角色选 *Administrator*（最省事）或带「Workers」字样的 Admin 角色，加完让对方实测能 deploy ② 对方本机 `npx wrangler login`；**对方自己也有 Cloudflare 账号的话会有两个账号**，部署前 `export CLOUDFLARE_ACCOUNT_ID=<lead 的账号 ID>`（lead 私下给，不进仓库），再 `npx wrangler whoami` 确认 ③ 把 TA 填进 `hackathon.conf` 的 `BACKUP_LEAD`，`deploy.sh` 会放行（打 ⚠️ 并在 `logs/deploy.log` 标「备份部署」）。**不许绕过 `deploy.sh` 直接 `npm run deploy`** |
| **C · 在 GitHub 网页上点按钮部署** | DEPLOYER 手边没有本机环境或 wrangler 时 | lead 在 Cloudflare 后台 → My Profile → API Tokens → 用 *Edit Cloudflare Workers* 模板建一个 token；把 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 填进 GitHub 仓库 Settings → Secrets → Actions。然后 Actions 页手动跑 `deploy` 工作流（`.github/workflows/deploy.yml`：只能手动触发、只有 DEPLOYER 能跑、部署前会跑全量 check 和冻结期检查） |

无论哪种，**部署前 `bash scripts/check.sh` 全量绿**：A / B 由 `deploy.sh` 自己查，C 由工作流查。

## 6. 域名

- 比赛用 workers.dev 链接就够（`workers_dev: true`，deploy 后终端会打出来）。写进 `hackathon.conf` 的 `DEMO_URL` 和 README 顶部
- 想要好看的正式域名：打开 `routes` 那行，改成 `<模块>.wawazhiliao.com`，再 deploy 一次，DNS 和证书自动配好，一两分钟生效
- 备用链接：workers.dev 那个一直都在，演示时一个挂了切另一个

## 7. Durable Object 的三条规矩（踩过的）

1. **状态每次变更都要 `commit()` 落 storage**，实例随时可能被回收；`v` 单调递增，客户端靠它判断广播新旧
2. **`fetch()` 里的 await 点会交错执行**，别在两次 await 之间假设状态没变；starter 的 `commit()` 已串行化
3. **广播前按用户裁剪视图**（`viewFor()`），整份状态广播出去等于把别人的私有字段送人

## 8. 常见问题

| 症状 | 原因 / 处理 |
|---|---|
| `Not logged in` | `npx wrangler login`；CI 里是没设 `CLOUDFLARE_API_TOKEN` |
| `A route with this pattern already exists` | 子域被别的 Worker 占了，换名字或去后台解绑 |
| 改了 DO 类名 deploy 报 migration 错 | 加一条新 `migrations`（`renamed_classes` 或 `deleted_classes`），别改旧 tag |
| 改了 CSS/JS 线上没变 | 浏览器缓存。`bash bump.sh` 把 `?v=` 加 1 再 deploy |
| 静态页 404 但文件在 `public/` | 看 `assets.directory` 路径；SPA（前端自己管路由）在 `assets` 里加 `"not_found_handling": "single-page-application"`，未命中的导航请求回退到 `index.html`，`/api/*` 和 `/ws` 仍进 Worker |
| WebSocket 连不上 | 本地 `ws://`、线上 `wss://`；前端用 `location.protocol` 判断（starter 已处理） |
| `.wrangler/` 出现在 `git status` | 已 gitignore；如果被 `git add -f` 过，`git rm -r --cached .wrangler` |
| 想看线上报错 | `npx wrangler tail` 开着，再复现一次 |

## 9. 纯静态站的另一条路：Cloudflare Pages

不需要后端时也可以直接发 Pages（lead 之前的纯静态站就是这么发的）：

```bash
npx wrangler pages deploy public --project-name <名字>
```

Pages 也能绑 `<子域>.wawazhiliao.com`，在后台 Pages → Custom domains 里加。但同一个项目别两条路都走，选一个。
