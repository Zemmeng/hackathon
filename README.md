# RippleTwin

**Model the road closure before the barriers go out.**

**Team Uncapped** · FEIT Hackathon Festival 2026 · Challenge 5 — RPM Hire, *Future Cities: Digital Tool for Temporary Infrastructure*

**Live demo:** https://hackathon-site.zemmmeng.workers.dev · **Built:** 29 Sep 09:30 → 1 Oct 12:00 AEST 2026 · **Repo:** public

---

## 1. The problem

Every week, councils approve traffic management plans, and contractors hire barriers, signs and VMS boards — from companies like RPM Hire. Before that gear goes out, nobody can say how long the queue will be, which buses will run late, or where pedestrians will have to walk. How many drivers detour is a rule of thumb, and every permit is checked on its own.

## 2. What RippleTwin does

RippleTwin is a digital twin of the Melbourne CBD for temporary works. Place the barriers, signs and VMS boards you would actually hire, and see what drivers, bus riders and pedestrians will see, do and lose — on real data.

| Step | What happens |
|---|---|
| **01 Plan** | Choose a street and hour, close lanes, place signs and VMS frames from a stand-in RPM catalogue. |
| **02 Stress test** | A scripted illustration of an extreme scenario (labelled as scripted in the UI — it is not the engine). |
| **03 Ripple trace** | See *why*: where the drivers went, which links slow down, which bus routes and footpaths absorb the cost. |
| **04 Repair** | Build up to three plans (Minimum / Standard / Guided) with stock and assumed day rates, pick one, export it. |

### One lane on Lonsdale Street, 8 am

| Standard sign — `ROADWORK AHEAD` | One more frame — `USE RUSSELL ST` |
|---|---|
| <img src="docs/pitch-assets/01-before-vms.jpg" alt="Panel: queue with ROADWORK AHEAD only" width="334"> | <img src="docs/pitch-assets/01-after-vms.jpg" alt="Panel: queue after adding USE RUSSELL ST" width="334"> |
| queue ≈ 900 m · ~8.5 min extra per car · ~175 vehicle-hours lost in that hour · 15 bus routes (~1,900 riders) slowed | queue ≈ 550 m · network delay −45% · bus riders −40% |

Same barriers, same sign board, same hire bill. Only the words changed. RippleTwin finds those words before the barriers go out.

## 3. It's live, and the numbers are computed — not written into the page

The engine runs in the browser in **under 10 ms** on the real CBD network and returns the same answer every time. Nothing on screen is a hard-coded result: delete the engine and the page has no numbers. A language model's only job is to read a sign the way a driver does — noticed, understood, trusted, which way it points. In the live demo that reading comes from DeepSeek, called only from our own Cloudflare Worker (answers cached, calls capped per day); without a key or over the cap it falls back to a transparent keyword rule set, and the screen always says which source was used. Every minute and percentage still comes from the engine.

## 4. What's real and what's assumed

We say which is which, on screen, everywhere.

**Real, open data:** 1,513 CBD links with real geometry and speeds · 8 weeks of hourly SCATS volume data · PTV GTFS tram and bus timetables · City of Melbourne pedestrian counts · building footprints and floor counts. All downloaded ahead of time by scripts in `apps/roads/tools/`; **no data API is called at runtime.**

**Our assumptions, labelled:** about three-quarters of link flows are interpolated · 29 of 37 behaviour parameters are low-confidence and shown with a range · equipment quantities and day rates are ours, because RPM Hire publishes no prices (16 equipment items, each with its source URL) · the pull of "save 9 minutes" on driver choice is our model's assumption. Following a *named* detour is calibrated to a field trial — roughly one driver in five (Erke, Sagberg & Hagman, 2007).

## 5. How to run it

Requires Node ≥ 20, Python ≥ 3.9, git.

```bash
git clone https://github.com/Zemmeng/hackathon.git && cd hackathon
bash scripts/setup.sh                  # checks tools, enables hooks, creates .env
bash scripts/check.sh --quick          # find the line "======== 汇总 0 ❌"

# the web page (needs no API — it falls back to preset numbers)
cd apps/web && python3 build.py && cd ../..
python3 -m http.server 4175 -d apps/web/public
# → http://localhost:4175

# the whole same-origin site + the sign-reading Worker
cd apps/site && npm ci && npm run dev  # → http://localhost:8790/web/public/
```

`bash scripts/check.sh` runs the full suite (nine checks, all module tests). `bash scripts/check.sh --e2e` smoke-tests the deployed URL. Deployment goes through `apps/site` (one Cloudflare Worker that mounts every module's `public/` and proxies `/api/*` to the `api` Worker) — see `apps/site/README.md`.

## 6. Tech stack

| Layer | What we used | Why |
|---|---|---|
| Data preparation | Python + OSMnx, networkx, geopandas, shapely | Offline only, never shipped |
| Road/traffic engine | Plain JavaScript, no framework | Runs in the browser and in Node; deterministic, <10 ms |
| Web page | Hand-written HTML/CSS/JS, one build script (`apps/web/build.py`) | No CDN, no bundler, no runtime dependency |
| Sign reading / explain API | Cloudflare Worker (`apps/api`) | Service binding behind the same origin |
| Hosting | Cloudflare Workers (`apps/site`) | One origin, no CORS |
| Fonts | Google Fonts (Inter, JetBrains Mono, Noto Sans SC, Space Grotesk, Barlow, IBM Plex Mono) | SIL OFL 1.1 |

Everything under `apps/` is our own code. No map tiles, no CDN JavaScript, no stock images, no 3D assets — the map is drawn from our own JSON.

## 7. Third-party material, APIs and AI tools

The full list — every dataset with its licence and attribution line, every purchase, and how AI was used — is in **[docs/submission.md](docs/submission.md)**. In short: only open data (OSM ODbL, DataVic / DTP and City of Melbourne CC BY), one paid service — the DeepSeek API, used by the deployed demo only to read sign text, on pay-as-you-go credit with a daily call cap — and no image or video generation models anywhere in the project.

## 8. Team

Team **Uncapped**, five members. Module ownership and reviewers are in [`.github/CODEOWNERS`](.github/CODEOWNERS).

## 9. Where things are

| Path | What |
|---|---|
| [`apps/`](apps/README.md) | Seven modules: `sim`, `roads`, `web`, `engine`, `api`, `params`, `site` |
| [`docs/1-brief.md`](docs/1-brief.md) | The challenge we picked, the rules, the marking criteria |
| [`docs/2-plan.md`](docs/2-plan.md) | Approach, module split, milestones |
| [`docs/contract.md`](docs/contract.md) | Interfaces between modules |
| [`docs/decisions.md`](docs/decisions.md) | Every product decision, with the alternatives we rejected |
| [`docs/arch/`](docs/arch/README.md) | Architecture and module PRDs |
| [`docs/pitch-assets/`](docs/pitch-assets/README.md) | Pre-screening PDF, architecture diagrams, before/after screenshots |
| [`docs/submission.md`](docs/submission.md) | Third-party list, AI use, what existed before the event |
| [`handoff/`](handoff/README.md) | Session hand-off notes — how the five of us actually worked |

---

# 中文：队内协作

## 三条硬规矩

<!-- RULES:BEGIN -->
🔒 **1. 不直接改 main。** 一个任务一个分支，合并走 PR。 / Never commit to `main`; one task = one branch = one PR.
🔒 **2. 只写自己模块的目录。** 公共文件只能新建或追加，要改别处先写交接单。 / Only write inside your own module; shared files are append-only.
🔒 **3. key / token 只放 .env。** 不进 git、不进聊天、不进交接单，文档里只写变量名。 / Secrets live only in `.env`; never in git, chat or handoff notes.
<!-- RULES:END -->

规矩怎么落到机制上：`不直推 main` 由 `.githooks/pre-push` 拦；`只写自己模块` 由 `scripts/check.sh [3]` 和 `.github/CODEOWNERS` 拦；`秘密不入库` 由 `.githooks/pre-commit`、`check.sh [1][2]` 和 CI 拦。

## 怎么跑

```bash
bash scripts/setup.sh                  # clone 后跑一次（幂等）：查工具、启用 hooks、建 .env
bash scripts/check.sh --quick          # 小步走完就跑；找「======== 汇总 0 ❌」那一行
bash scripts/check.sh                  # 全量：九项检查 + 所有模块测试
cd apps/<模块> && npm i && npm run dev  # 端口看 apps/README.md 的登记表
```

`bash scripts/sync.sh` 是零 token 的实况对齐（各分支最近提交、开着的 PR、没落账的交接单、倒计时）。

## 分支与提交

```bash
git fetch origin
git switch -c <handle>/<模块>/T<n>-<短名> origin/main
# …小步 commit：「<模块>: 做了什么 —— 为什么」…
git merge origin/main                   # 同步 main（merge，不 rebase）
bash scripts/check.sh --quick           # 全绿再推
git push -u origin HEAD && gh pr create --fill
```

合并后**不用你部署**：`hackathon.conf` 里的 `DEPLOYER`（当前 @unicornnnnnny）在每个集成点跑 `bash scripts/deploy.sh all`，线上地址见顶部 Demo。

## 收工

写一张交接单 `handoff/<handle>-T<n>-<MMDD-HHMM>.md`（四节模板在 [handoff/README.md](handoff/README.md)）并 push。接别人的活先 `gh pr checkout <号>` 再读那张单。

## 常见问题

| 症状 | 处理 |
|---|---|
| push 被拒：`🚫 pre-push：不直推 main` | 你在 main 上。开分支把改动带过去再推 |
| push 被拒：分支名不合规 | `git branch -m <handle>/<模块>/T<n>-<短名>` |
| PR 有冲突 | 本地 `git merge origin/main`；`decisions` / `pitfalls` 会自动两边保留 |
| `check [3]` 报越界 | 把改动写进交接单第 2 节让 lead 落实；确需跨模块：`ALLOW_CROSS=1 git push`，开 PR 后请 lead 打 `cross-module` 标签 |
| 端口被占 | 手动起就换端口，并把新端口写进 `apps/README.md` 的登记表 |
| Windows | 用 Git Bash 或 WSL；`.gitattributes` 已强制 LF |

## 文档地图

| 文件 | 什么时候看 |
|---|---|
| [hackathon.conf](hackathon.conf) | 截止时间、冻结点、谁部署 |
| [docs/1-brief.md](docs/1-brief.md) | 赛题、评分标准、提交物 |
| [docs/2-plan.md](docs/2-plan.md) | 方案、模块分工、里程碑 |
| [docs/contract.md](docs/contract.md) | 模块之间的接口 |
| [docs/3-tasks.md](docs/3-tasks.md) | 任务板、谁在做什么 |
| [docs/4-demo.md](docs/4-demo.md) | 演示脚本、pitch、兜底、提交清单 |
| [docs/decisions.md](docs/decisions.md) | 已定的事，别再推翻 |
| [docs/pitfalls.md](docs/pitfalls.md) | 踩过的坑，别再踩 |
| [docs/submission.md](docs/submission.md) | 第三方清单、AI 使用、赛前准备说明 |
| [docs/llm-apis/](docs/llm-apis/README.md) | 候选大模型 API：谁有 key、多少钱、怎么调 |
| [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) | 怎么部署到 Cloudflare |
| [handoff/](handoff/README.md) | 交接单怎么写 |
| [apps/README.md](apps/README.md) | 模块规则、端口表 |
| [scripts/README.md](scripts/README.md) | 脚本和 hook 一览 |

## 秘密与额度

- `.env` 从 `.env.example` 复制，文档里只写变量名
- 线上密钥：`npx wrangler secret put <NAME>`，见 [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)
- 付费脚本默认 dry-run，加 `--run` 才花钱；每次花钱记进 `docs/3-tasks.md` 的额度台账

## 披露与 License

本仓库的构建脚本、分支守卫和 CI 是赛前准备的协作工具，不含业务代码；赛前写的 `starters/` 通用骨架已按 D-0929-1311 删掉，业务代码全部在比赛期间写。唯一例外：`apps/api/test.sh` 和 `apps/api/tests/mini.mjs` 是零依赖的测试运行器（不含业务逻辑），开赛后从赛前的 starter 拷过来，未改写。逐项说明与第三方清单见 [docs/submission.md](docs/submission.md)。

`apps/roads/public/cbd/` 下的 `network.json`、`walk.json`、`buildings.json` 由 OpenStreetMap 衍生，按 **ODbL 1.0 share-alike** 分发，不是 MIT。其余代码见 [MIT](LICENSE)。
