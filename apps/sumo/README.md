# sumo —— 现场 SUMO 上云：Worker `hackathon-sumo` + Cloudflare Container，连不上就回预先跑好的结果
Owner: @Zemmeng

T37（D-0930-1700「C + Cloudflare 容器」）。浏览器 → site 的 `/api/sumo/v1/*` →（服务绑定 `SUMO`）→ 本 Worker → 容器里的 `apps/web/tools/sumo/serve.py`（原生 SUMO 1.27.1）的 `/sumo/v1/*`。

- **C（默认、必须有）**：预先跑好的结果放 `public/baked/`（线上 `/sumo/public/baked/…`，`tools/bake.py` 生成），网页经 `public/js/sumo-client.js` 调用；云端没开 / 连不上 / 在启动 / 限流 / 忙 / 超时 / 运行失败都回它，并标「预先跑好」。
- **B（加分）**：本目录的 Worker + 容器，只开 **1 个** standard-2 实例（1 vCPU / 6 GiB）。页面**不许依赖它**：挂了自动回 C。
- **实网（T40，contract v2）**：`POST /runs` 带 `"network":"real"` 就在**真实 CBD 路网**（`apps/roads/public/cbd/` 的 OSM 路网 + SCATS 路口 + SCATS 08:00 流量）上跑 `baseline` / `original` / `ai` 三个情景（`apps/web/tools/sumo/build_real.py`）；不带 `network` 或 `"synthetic"` 还是原来的 2×2。预跑的实网结果在 `public/real/`。

## 部署（只有 lead，在自己的 Mac 上）

> 🔒 不走 `scripts/deploy.sh`：`sumo` 故意**不在** `hackathon.conf` 的 `DEPLOY_MODULES` 里 —— 镜像要 Docker 构建，没 Docker 的机器跑 `deploy.sh all` 会直接失败。
> 高h 的 Workers Editor 角色**不能新建 Worker**，第一次部署必须 lead 来；之后镜像有改动也由 lead 部署。

前置：账号已升级 Workers Paid（没升级时 `npx wrangler containers list` 报「requires the Workers Paid plan」）。

```bash
colima start --vm-type vz --vz-rosetta     # Docker；Cloudflare 只跑 linux/amd64，Apple 芯片靠 Rosetta 转译构建
docker info > /dev/null && echo docker ok
cd apps/sumo && npm ci                      # wrangler 4.143.0 + @cloudflare/containers，版本锁死在 package-lock.json
npx wrangler whoami                         # 确认是 lead 的账号
npx wrangler deploy                         # 构建镜像（首次约 1–2 分钟，约 290 MB）→ 推到 Cloudflare 的镜像仓库 → 上线 Worker
npx wrangler containers list                # 看容器应用的状态
```

- **第一次部署后要等几分钟**：Worker 先上线，容器还在供应；这期间 `/api/sumo/v1/*` 回 `503 sumo_starting`，页面照常用预跑结果。
- **然后才部署 site**（它的 `SUMO` 服务绑定要求 `hackathon-sumo` 已存在，否则报 Could not resolve service binding）：高h 照常 `bash scripts/deploy.sh all`。
- **冒烟**（评审前也这样预热一次：容器冷启动几秒，醒着 12 h）：

```bash
curl -s https://hackathon-site.zemmmeng.workers.dev/api/sumo/v1/health    # {"version":1,"engine":"Eclipse SUMO sumo 1.27.1","status":"ready","active_jobs":0}
curl -s -X POST -H 'content-type: application/json' --data '{}' https://hackathon-site.zemmmeng.workers.dev/api/sumo/v1/runs   # 202 + id
curl -s https://hackathon-site.zemmmeng.workers.dev/api/sumo/v1/runs/<id>  # queued → running → complete（1 vCPU 上约 10–20 s）
# 实网（三个情景）：
curl -s -X POST -H 'content-type: application/json' --data '{"network":"real"}' https://hackathon-site.zemmmeng.workers.dev/api/sumo/v1/runs
curl -s https://hackathon-site.zemmmeng.workers.dev/api/sumo/v1/runs/<id>/index.json   # complete 以后；再读 <baseline|original|ai>/manifest.json、frames-NNN.json
```

- 日志：`npx wrangler tail hackathon-sumo`，或 Cloudflare 后台 Workers Logs（容器启动 / 停止、转发出错都会打）。

### 费用（D-09 记账）

Workers Paid **US$5/月** + 容器按醒着的时间计费：standard-2 约 **US$0.05/h**（内存 6 GiB + 盘；CPU 只在跑 SUMO 时另算，100 次运行也在每月赠送额度内）。`sleepAfter` 是 12 h，醒满 48 h 约 US$2–3。**决赛后 lead 退订 Workers Paid。**

### 关掉（kill switch）

1. **只关现场、保留预跑**：删掉 `apps/site/wrangler.jsonc` 里的 `SUMO` 绑定，重新部署 site → `/api/sumo/*` 回 `503 sumo_off`，页面自动用预跑结果。⚠️ `apps/site/tests/config.test.mjs`（要求正好 API、SUMO 两个绑定）和 `tests/config.test.mjs`（查 site 的 `SUMO` 绑定名）会因此变红，`deploy.sh` 的 [5/6] 全量 check 就拒绝部署：同一个提交里要把这两处断言一起放宽。
2. **评审结束后彻底删**：先做第 1 步，再 `cd apps/sumo && npx wrangler delete`（Worker + Durable Object）；`npx wrangler containers list` 里还有 `hackathon-sumo-sumocontainer` 就 `npx wrangler containers delete <ID>`，`npx wrangler containers images list` 里的镜像用 `npx wrangler containers images delete <image>` 删；最后退订。

## 怎么跑（本机）

```bash
cd apps/sumo && npm ci && npm run dev       # = wrangler dev --port 8791：要 Docker；本机构建镜像并在 Docker 里跑容器
curl -s http://localhost:8791/api/sumo/v1/health
```

只想跑容器、不要 Worker（构建上下文是 `apps/`，不是 `apps/web`）：`docker build --platform linux/amd64 -f apps/sumo/Dockerfile -t hackathon-sumo:dev apps && docker run --rm -p 8792:8080 hackathon-sumo:dev`，然后 `curl http://localhost:8792/sumo/v1/health`（注意没有 `/api` 前缀，也没有白名单和限流）。实网冒烟：`curl -s -X POST -H 'content-type: application/json' --data '{"network":"real"}' http://localhost:8792/sumo/v1/runs`。

## 怎么测

```bash
bash apps/sumo/test.sh      # 最后一行「N passed, M failed」；不需要 npm i、不需要 Docker、不联网
```

| 测试 | 查什么 |
|---|---|
| `tests/worker.test.mjs` | 假容器 + 假限流器测 `proxy.js` / `worker.js`：白名单、只有 `/runs` 收 POST、删头、路径改写、缓存头、限流、忙闸、每个错误码；`worker.js` 只导出 `default` 和 `SumoContainer`（用 `node:module` 钩子把 `@cloudflare/containers` 换成 `tests/fake-containers.mjs`） |
| `tests/config.test.mjs` | `wrangler.jsonc`（standard-2、`max_instances` 1、`workers_dev` false、构建上下文 `..`、DO 绑定 + migration、限流 3 / 60 s）、`Dockerfile`（COPY 的文件都在 `apps/` 下、实网的 `build_real.py` + roads 三个 JSON 进镜像、`SUMO_ROADS_DIR` 指对、numpy / scipy 锁版本、ENV 和 `envVars` 一致、构建自检参数在公开范围内）、`package.json` / lock、site 的 `SUMO` 绑定名、`sumo` 不在 `DEPLOY_MODULES` |
| `tests/client.test.mjs` | `public/js/sumo-client.js`（另见文件头） |

改了 `Dockerfile` 或 `apps/web/tools/sumo/` 以后，再跑一次 `npx wrangler deploy --dry-run --outdir .wrangler/dry-run`（要 Docker）：它会真的构建镜像，构建时自带 `ldd` 缺库检查、SUMO 版本检查和一次最小的端到端运行。

## 对外接口（→ `docs/contract.md` §HTTP API `/api/sumo/v1/*`）

对外只有这些（别的一律 `404 not_found`，不唤醒容器）：

| 方法 | 路径（前缀 `/api/sumo/v1`） | 缓存 |
|---|---|---|
| GET / HEAD | `/health`（容器原样透传，一个字段都不加） | `no-store` |
| POST | `/runs`（body ≤ 2048 字节；先按 IP 限流，再过忙闸） | `no-store` |
| GET / HEAD | `/runs/<32 位小写 hex>`（状态；`result` 字段是容器内路径 `/sumo/v1/…`，拼地址请用 `id`） | `no-store` |
| GET / HEAD | `/runs/<id>/index.json`、`/runs/<id>/<baseline\|closure\|guided\|footpath>/<manifest\|frames-NNN>.json`；实网运行是 `<baseline\|original\|ai>/…`（容器已认，Worker 白名单见 `src/proxy.js`） | 200 时 `public, max-age=86400, immutable` |
| GET / HEAD | `/runs/<id>/frame?scenario=…&t=…`（只有它带查询串过去；只给 2×2，实网运行回 404） | `no-store` |

- 转发前删掉 `Origin`、`Cookie`、`Authorization`（容器的 `ALLOW_ORIGINS` 是空的，带 Origin 会 403）。
- 错误一律 `{ ok:false, error, msg }`：

| 状态 | `error` | 什么时候 |
|---|---|---|
| 404 | `not_found` | 不在白名单；或容器说没有这个运行（容器重启后旧 id 全部 404） |
| 405 | `method_not_allowed` | 方法不对（带 `Allow` 头） |
| 413 | `too_big` | POST 请求体 > 2048 字节 |
| 429 | `sumo_rate` | 同一 IP 一分钟内第 4 次 POST（`Retry-After: 60`） |
| 429 | `sumo_busy` | 容器里已有 ≥ 2 个任务（`Retry-After: 15`） |
| 503 | `sumo_starting` | 容器还在供应 / 启动 / 端口没就绪（`Retry-After: 10`） |
| 502 | `sumo_down` | 容器连不上、断线、抛错，或容器回了不是仓库格式的 5xx（serve.py 自己的 `500 sumo_error` 是仓库格式，按下一行原样给） |
| 409 / 400 | `not_ready` / `bad_request` | 容器的旧格式报错按状态码翻译；serve.py 已经回 `{ ok:false, error, msg }` 的（如 `400 bad_config`、`500 sumo_error`，码表见 `apps/web/tools/sumo/README.md`）连状态码原样给 |

## 结构

| 文件 | 一句话 |
|---|---|
| `wrangler.jsonc` | Worker `hackathon-sumo`：容器（standard-2、最多 1 个实例、构建上下文 `..` = `apps/`）、DO 绑定 `SUMO_CONTAINER`、migration v1、限流 `SUMO_RL` |
| `Dockerfile` | python:3.12-slim + `eclipse-sumo==1.27.1` + numpy / scipy + X11/GL/libatomic 运行库 + roads 的 network / signals / flows（`SUMO_ROADS_DIR`）；镜像里按仓库原样摆 `web/tools/sumo/`、`roads/public/cbd/`；构建时查缺库、版本、跑一次最小 2×2 仿真、查 build_real 能 import |
| `src/worker.js` | 入口：`SumoContainer`（端口 8080、`sleepAfter` 12h、环境变量）+ `default.fetch` 把请求交给 `proxy.js` |
| `src/proxy.js` | 白名单、删头、限流、忙闸、错误码、缓存头；不 import Cloudflare 模块，node 里能直接测 |
| `tests/fake-containers.mjs` | 测试用的假 `@cloudflare/containers` |
| `public/`、`tools/bake.py` | 兜底 C：预跑结果和网页客户端（见各自文件头） |

## 本模块固定模式

- `src/worker.js` 除了 `default` 和 `SumoContainer` 不许有别的 export（workerd 把每个具名导出都当入口）；别的函数放 `proxy.js`。
- 永远只用 `getContainer(env.SUMO_CONTAINER, 'main')` 这一个实例：serve.py 的任务状态在内存和容器临时盘里，多实例查不到彼此的运行。
- 容器环境变量改动要同时改 `proxy.js` 的 `CONTAINER_ENV` 和 `Dockerfile` 的 `ENV`（`tests/config.test.mjs` 查）。
- 404 / 405 在取容器之前就回，乱敲的路径不会唤醒容器。

## 已知问题

- 容器的盘是临时的：睡眠（12 h 没请求）、Cloudflare 换机器、重新部署都会清空，旧运行 id 之后一律 404；页面要回预跑结果。
- `SUMO_RL` 是每个 Cloudflare 机房各自计数、最终一致，不是精确限流；兜底是忙闸（同时 ≥ 2 个任务回 429）和 serve.py 自己的队列上限。
- 用 `tools/bake.py` 对线上接口预跑 16 次（1 个预设 + 15 个格点）时会撞每分钟 3 次的限流，它会等一会儿重试，整批至少 5–6 分钟。
- 本机 `wrangler dev` 里容器是 amd64 镜像在 Rosetta 下跑的，速度不代表线上（实测一次 4 情景约 15 s）。
- 构建上下文是整个 `apps/`：BuildKit（buildx）只传 COPY 用到的文件；老的非 BuildKit 构建会把三个 `node_modules`（各约 200 MB）也打包进去，很慢但结果一样。
