# web-worker starter — 零构建前端 + Cloudflare Worker + Durable Object 房间

Owner: @__OWNER__ <!-- new-app.sh 复制成 apps/<模块>/ 后改成你的 GitHub handle -->

## 这是什么

默认栈的最小骨架，赛题公布后用 `bash scripts/new-app.sh <模块名> web-worker` 复制到 `apps/<模块名>/` 再改。

- 前端：纯 HTML / CSS / ES module，零构建，Canvas、SVG 随便用
- 后端：Cloudflare Worker 薄路由 + 一个 Durable Object「房间」（服务端权威状态，WebSocket 广播）
- 测试：Node 自带能力，零依赖，不用 `npm i` 也能跑
- 演示业务：房间里若干成员各自点 ±1（共享计数）、发消息、改自己的「暗号」（只有本人看得到的私有字段）。换成你们的业务时，主要改 `public/js/shared/logic.js`

## 怎么跑

```bash
npm i && npm run dev                          # Worker + DO + 静态页，http://localhost:8787 ；需要 Node ≥ 20
python3 -m http.server 4173 -d public         # 纯静态，不用 npm i；/api 不通，页面自动进 MOCK
```

- 端口：starter 本身是 8787；复制成模块后的实际端口看 `apps/README.md` 登记表（new-app.sh 会按表改 `package.json` 的 dev 端口）。
- 在 `starters/` 里直接跑 wrangler 时 Worker 名是 `web-worker-starter`；`new-app.sh` 复制到 `apps/<模块>/` 时会把 `wrangler.jsonc` 的 `name` 改成模块名（只能小写字母、数字、连字符）。
- 两个标签页打开同一个房间链接 = 两个成员（身份令牌存在 sessionStorage，按标签页区分）。
- 本地变量：`cp .dev.vars.example .dev.vars`（wrangler dev 读 `.dev.vars`，不读 `.env`）。
- Claude 用户：不要用 Bash 起服务，用 preview 工具按名字启动 `starter-worker`（wrangler，带 `--var MOCK:1`）或 `starter-static`（python 静态）；配置在仓库根 `.claude/launch.json`。复制成模块后按模块名启动。

## 怎么测

```bash
bash test.sh                                  # 任意目录都能跑；只要 node ≥ 18，不用 npm i
node tests/logic.test.mjs                     # 只跑纯逻辑
node tests/sim.mjs 400 7                      # 只跑模拟：400 步、随机种子 7（失败时用同一种子复现）
```

`test.sh` 自动发现 `tests/*.test.mjs` 和 `tests/sim.mjs`，单文件限时 60 秒；某个文件崩溃、超时、缺最后一行计数都记为失败。最后一行固定是 `N passed, M failed`，有失败退出码 1。新加测试文件命名成 `tests/xxx.test.mjs` 就会被自动带上。

## 怎么部署

```bash
npx wrangler login                            # 第一次；只有 DEPLOYER 需要
npm run deploy                                # = wrangler deploy
npx wrangler secret put SOME_API_KEY          # 线上密钥只走这里，不写进任何文件
curl -s https://__NAME__.<子域>.workers.dev/api/health   # 期望 {"ok":true,...}
```

- 比赛期间 `workers_dev: true` 拿 demo 链接，赛后改成 `false` 再部署一次关掉。
- 正式部署走 `scripts/deploy.sh`（只允许 DEPLOYER，自带前置检查和线上冒烟）。详见 `docs/deploy-cloudflare.md`。

## 结构

| 文件 | 一句话 |
|---|---|
| `src/worker.js` | 薄路由：`/api/health`、`POST /api/create` 建房、`/ws?room=CODE` 转给 DO，其余走静态资源 |
| `src/room.js` | `Room`（Durable Object）：权威状态、按成员裁剪后广播、Hibernation、闲置清房 |
| `public/js/shared/logic.js` | 前后端共用纯函数：房间码、`reduce(state, action)`、`viewFor(state, memberId)`、各种上限 |
| `public/js/app.js` | 前端：ui 状态 + 签名守卫 `render()` + 状态差驱动的动效 + 后端不通时本地 MOCK |
| `public/index.html` | 页面骨架，`data-smoke="ok"` 给线上冒烟用，资源带 `?v=N` |
| `public/style.css` | CSS 变量、移动端优先、深色模式 |
| `tests/mini.mjs` | 零依赖断言 `ok / eq / throws / sec / done` |
| `tests/logic.test.mjs` | 纯逻辑测试 |
| `tests/sim.mjs` | 假 storage + 假 WebSocket 直接驱动 `Room`，每步查不变量 |
| `test.sh` | 跑全部测试并汇总计数 |
| `bump.sh` | `index.html` 里所有 `?v=N` 加 1 |
| `wrangler.jsonc` | Worker / 静态资源 / DO / migration 配置 |
| `.dev.vars.example` | 本地变量示例（只有 `MOCK=1`） |

## 接口

| 路径 | 说明 |
|---|---|
| `GET /api/health` | `{"ok":true,"v":"0.1.0","mock":true}`；`mock` 取自 `env.MOCK === "1"` |
| `POST /api/create` | `{"ok":true,"code":"ABCDE"}`；房间码 5 位，去掉了 0 O 1 I L |
| `GET /ws?room=CODE` | WebSocket。发：`{t:"join",token,nick}` → `{t:"inc",n:±1}` / `{t:"say",text}` / `{t:"secret",text}`；收：`{t:"joined",code,me}` / `{t:"state",s}` / `{t:"err",msg}` |

## 固定模式（改业务时别丢）

- **版本号 v**：每个成功的动作 v+1（在 `reduce` 里）；客户端丢弃同房间里 v 不更大的广播。不要用时间戳判断新旧。
- **服务端权威**：客户端只发意图；`room.js` 按白名单逐字段重建动作，`by` 只认连接绑定的身份，客户端传的 `by` / `token` / `secret` 一律丢弃。
- **按用户裁剪**：广播前对每条连接单独算 `viewFor(state, 成员id)`；`viewFor` 用白名单拼字段，新加的私有字段默认不下发。每加一个私有字段，就在测试里加一条「别人看不到」的反向断言。
- **签名守卫**：`render()` 分块算签名，签名没变就不重建那块 DOM，否则正要点的按钮会被换掉、点击被吞。
- **动效看状态差**：`fx(prev, next)` 对比新旧 state 决定播什么，不解析消息文本。
- **每次变更都 commit()**：落 storage 并把闲置闹钟往后推（6 小时没动静就清房）；实例休眠唤醒后从 storage 读回。
- **MAX_ROUNDS 封顶**：每房间最多 1000 次成员动作（`logic.js`），防挂机脚本和前端死循环空转；前端 MOCK 共用同一上限。
- **改 CSS/JS 后 `?v=` 都 +1**：跑 `bash bump.sh`，否则浏览器拿旧缓存。子模块（如 `shared/logic.js`）的 import 不带版本号，拿不准时硬刷新。
- **Node 能直接 import `Room`**：`room.js` 顶层不碰 `WebSocketPair` 等 Cloudflare 专有全局，`sim.mjs` 才跑得起来。
- **MOCK 兜底**：`/api/health` 不通就在页面上跑 `logic.js`，头部显示橙色「MOCK」；demo 现场断网也能演。
