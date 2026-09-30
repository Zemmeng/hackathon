# Submission notes: third-party material, AI use, pre-event prep

> For the judges (FEIT Hackathon 2026, Challenge 5, RPM Hire). Covers competition **rules 3, 5 and 6**: no development before the event, public code repository, and a list of every third-party asset and API.
> Compiled 2026-09-29 22:05 AEST from what the repository itself shows; updated 2026-09-30 (live LLM, Open-Meteo, SUMO).

## 1. Third-party data, assets, APIs and software

**Data used in the product.** We only use open data. All of it was downloaded ahead of time by scripts in `apps/roads/tools/`, and no data API is called at runtime.

| Source | Used for (file) | Licence | Attribution line |
|---|---|---|---|
| OpenStreetMap, fetched with OSMnx through public Overpass API instances | Road network, walking network and building outlines (`apps/roads/public/cbd/network.json`, `walk.json`, `buildings.json`) | ODbL 1.0 | © OpenStreetMap contributors |
| DataVic: Traffic Signal Volume Data (SCATS), DTP Victoria | Hourly vehicle flows, 2026-08-01 to 09-27 (`flows.json`, `apps/sim/public/demand/`) | CC BY 4.0 | Traffic Signal Volume Data, Department of Transport and Planning, Victoria |
| DataVic: Victorian Traffic Signals (site list) | Signal locations matched to network nodes (`network.json`) | CC BY 4.0 | same as above |
| DataVic: Traffic Signal Configuration Data Sheets | Detector layout for site 2921 (`apps/sim`) | CC BY 4.0 | same as above |
| DataVic: PTV GTFS Schedule, 2026-09-26 release | Tram (sub-feed 3) and metro bus (sub-feed 4) routes and stops (`transit.json`) | CC BY 4.0 | Public Transport Victoria, via DataVic |
| City of Melbourne: Pedestrian Counting System (hourly counts and sensor locations) | Footpath volumes (`peds.json`, `apps/sim`) | City of Melbourne Open Data (the dataset page states no licence; the other datasets in the series are CC BY) | City of Melbourne Open Data |
| City of Melbourne: 2018 Building Footprints | Building heights (`buildings.json`) | CC BY | City of Melbourne Open Data |
| City of Melbourne: Building information (CLUE census 2024) | Building use and floor count (`buildings.json`) | CC BY | City of Melbourne Open Data |
| Open-Meteo Historical Weather API (`archive-api.open-meteo.com`), model `ecmwf_ifs` | Hourly weather 2026-08-01 to 09-27 for an offline back-test of the weather layer (`apps/roads/public/cbd/weather_hourly.json`, `weather_backtest.json`); not shown on the page | CC BY 4.0 data, fetched once through the free API, whose terms allow non-commercial use (a student hackathon back-test) | Weather data by Open-Meteo.com |
| Bureau of Meteorology: daily weather observations, Melbourne (Olympic Park) | Manual cross-check of rain days for that back-test; downloaded by hand, not committed | © Commonwealth of Australia, reference only | Bureau of Meteorology |
| RPM Hire website product pages (checked 2026-09-29) | Equipment types and specifications (16 items in `equipment.json`: the 7 hire products link to their product pages, the 9 static signs use TfNSW sign codes). **Quantities and day rates are our own assumptions** because the site publishes no prices. No images or text were copied | Reference only | RPM Hire (challenge sponsor) |
| TfNSW sign register (codes T1-1, T2-16) | Sign codes in `equipment.json` | Reference only | Transport for NSW |

On the web page, source credits appear next to the layers that use them: "OSM · City of Melbourne" on the building layer, "Timetabled trips from PTV GTFS" in the tram panel and "City of Melbourne pedestrian counts" in the pedestrian panel.

**Numbers from the literature** (`apps/params/public/params.json`). Every value has a source and a confidence rating, and low-confidence values are labelled "assumed" on the page (D-0929-1536). Sources:

- ATAP Parameter Values: travel time
- City of Melbourne VISTA report (car occupancy 1.09)
- ABS Census 2016, via Huda et al. 2025
- ABS Survey of Motor Vehicle Use
- Chatterjee 2002 (TR Part A)
- Erke, Sagberg & Hagman 2007 (TR Part F)
- Bonsall 1999
- Wardman 1996
- Austroads GTM Part 10 / AS 4852
- NSW TSI-SP-008
- Dudek 2001 (NJDOT VMS manual)
- O'Fallon & Sullivan

The papers behind our design choices (Meister 2024, Xiong 2024, Wang et al. 2025, Song et al. 2025, Liu, Li & Yin 2026) are cited in `docs/decisions.md` only. We use their numbers and cite them; we do not reproduce their text.

**Software and services**

| Item | Role | Licence / terms |
|---|---|---|
| Cloudflare Workers (+ service binding between the `site` and `api` Workers) | Hosting of the demo at `hackathon-site.zemmmeng.workers.dev` | Cloudflare terms |
| Wrangler CLI (npm, dev dependency of `apps/api`, `apps/site`, `apps/web`) | Local dev and deploy | MIT / Apache-2.0 |
| GitHub Actions: `actions/checkout`, `actions/setup-node`, `actions/setup-python`, `cloudflare/wrangler-action` | CI checks and the manual-only deploy workflow (`.github/workflows/`) | Open source, see each action's repository |
| OSMnx (+ networkx, geopandas, shapely, requests) | Offline data preparation only (`apps/roads/requirements.txt`), not shipped | MIT / BSD-3 |
| Python 3 and Node.js standard libraries | Build scripts and tests | PSF / MIT |
| Google Fonts: Inter, JetBrains Mono, Noto Sans SC, Space Grotesk (`apps/web`); Barlow, Barlow Condensed, IBM Plex Mono (`apps/sim`) | UI type, loaded from fonts.googleapis.com | SIL OFL 1.1 |
| DeepSeek API (`deepseek-flash`, OpenAI-compatible) | **In use in the deployed demo**, server-side only in `apps/api`: it reads sign text (`/api/read`) and words the plan-comparison explanation (`/api/explain`), where any sentence with a number the engine did not produce is dropped (`sanitizeExplain`). Answers are cached in KV, the demo's sign readings are precomputed, and calls are capped at 600 a day; without a key, over the cap or on an error it falls back to rules, and the page labels which source was used (D-0929-2307, D-0929-1830). During development, two team members made a small number of test calls with their own keys and personal credit (see "Paid purchases" below; `docs/llm-apis/`) | DeepSeek API terms |
| Alibaba Cloud Model Studio (Bailian) | Evaluated (PR #28), then dropped (PR #37). Not used | — |
| Eclipse SUMO 1.27.1 + sumolib (PyPI `eclipse-sumo`, `sumolib`) | Prototype backend for a four-junction micro-simulation (`apps/web/tools/sumo`, PR #96). Runs locally only; not wired into the page and not part of the deployed demo | EPL-2.0 OR GPL-2.0-or-later (dual licence) |

We found no map tiles, CDN JavaScript libraries, stock images, audio or 3D assets under `apps/`: a grep for tile, CDN and font URLs returned only the Google Fonts above. The map is drawn from our own JSON.

**Paid purchases.** DeepSeek API credit only. @jinmingq topped up ¥10 from a personal account for development test calls (`docs/llm-apis/jinmingq-deepseek.md`). @louisxie316-dotcom made test calls on credit in a personal DeepSeek account; the amount is not recorded in the repo (`docs/llm-apis/louisxie316-dotcom-deepseek.md`). The team's own estimate for a full set of 10 demo sign texts is about ¥0.2 (PR #37). For the deployed demo, the lead set a DeepSeek key as a Cloudflare secret; precomputing the demo sign readings cost about ¥0.54 (estimate, ledger in `docs/3-tasks.md`), and live calls are capped at 600 a day. Members also used AI coding assistants on their own subscriptions (Claude Code, OpenAI Codex; see §2). No other paid services, data or assets were bought.

## 2. AI tools used

| Tool | How it was used | Evidence |
|---|---|---|
| **Claude Code** (Anthropic; Claude Opus 5.5 and Claude Fable 5.1 per commit trailers) | The main coding assistant for all five members. It wrote most of the code, tests, data-pipeline scripts, docs and HTML diagrams, working from specs the team wrote (`docs/arch/*-PRD.md`). Humans set the direction and made every product decision (`docs/decisions.md` quotes each one), reviewed the work and merged the PRs. The lead also ran parallel sub-agents for reviews | 59 commits on `main` carry a Claude `Co-Authored-By` trailer; 50 of the last 60 PR descriptions say "Generated with Claude Code" |
| **OpenAI Codex** | @jinmingq: the editable business-workflow SVG (PR #52). @unicornnnnnny: an early standalone "liquid glass" UI prototype, of which only the accent colour was reused (`handoff/unicornnnnnny-T14-0929-1905.md`) | PR #52 body; T14 handoff |
| Image or video generation models | **None found.** All diagrams are HTML or SVG written as code and rendered to PDF/PNG | grep of the repo for image-model names returns nothing |
| LLM inside the product | DeepSeek reads sign text and words plan explanations; every number still comes from the engine (see DeepSeek above) | live `/api/health` → `"mode":"llm"` |

## 3. What existed before the event (rule 3)

The event started on 2026-09-29 at 09:30 AEST. Before that, `main` had 9 commits, from 2026-09-26 01:29 to 2026-09-29 09:12 (`git log --before=2026-09-29T09:30:00+10:00`). All of it is **team-workflow tooling, with no product code, design, graphics or data**:

- **Process docs:**
  - `README`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `KICKOFF.md`
  - empty templates for `docs/1-brief`, `2-plan`, `3-tasks`, `4-demo`, `contract`, `decisions`, `pitfalls`, `deploy-cloudflare`, `onboarding`
  - `handoff/README.md`, `apps/README.md`, `hackathon.conf`, and a template MIT `LICENSE`
- **Guard scripts:**
  - `scripts/` (setup, check, sync, deploy, secret-scan; `new-app.sh` was already reduced to a one-message stub on 09-29 and removed on 09-30)
  - `.githooks/` (pre-commit, pre-push)
  - `.github/` (CI check, manual-only deploy workflow, CODEOWNERS, PR template)
- **AI assistant configuration:** `.claude/` (settings, 3 hooks, 6 slash commands, 2 agent definitions, launch.json).
- **Onboarding check:** one teammate's T0 test PR (#3, 09:12), which only touched the task board and a handoff note.

**Removed from the working tree on 09-30, still in git history.** On 2026-09-30 the team decided (D-0930-0200) to remove the collaboration-scaffold files that the project does not depend on: `KICKOFF.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `docs/onboarding.md`, `scripts/new-app.sh` and the whole `.claude/` directory. They were replaced by nothing: the three hard rules they carried now live in `README.md`, and the checks that enforced them (`scripts/check.sh`, `.githooks/`, CI) are unchanged.

This is a working-tree cleanup, **not** a rewrite of history. Every one of those files is still readable in commits dated 2026-09-26 to 09-29, and the repository is public, so nothing about the pre-event work is hidden. The disclosure above is the record; deleting the files was about the repository's shape, not about the record.

- **`starters/`:** two generic skeletons (a Cloudflare Worker + Durable Object room demo, and a Python CLI; 22 files). On 09-29 the team decided to remove them (D-0929-1311); they were removed from the repository in PR #65 on 2026-09-30. No product feature was built from them. Two **test-tooling** files in `apps/api` do come from the web-worker skeleton; they were copied in during the event (commit `fd6018c`, 2026-09-29 15:02):
  - `apps/api/tests/mini.mjs`, a 51-line assertion helper for the tests, is an unchanged copy of `starters/web-worker/tests/mini.mjs`;
  - `apps/api/test.sh`, the script that runs those tests, is a copy of `starters/web-worker/test.sh` with one line changed (86 of its 87 lines are identical; only the temp-directory name differs).

  Neither file is part of the deployed product. `apps/sim/bump.sh` (a 17-line cache-busting helper) was rewritten during the event from the same idea as the skeleton's version.

**Built during the event**, from the first product commit `cb7d3ee` at 2026-09-29 12:30 onward: everything under `apps/` (sim, roads, engine, api, web, site, params) apart from the two test-tooling files above, all data files, `docs/arch/`, `docs/pitch-assets/`, and the filled-in content of every doc.

## 4. Repository and secrets (rule 5)

Checked 2026-09-29 ~22:05:

| Check | Result |
|---|---|
| `bash scripts/secret-scan.sh --history`, all refs after `git fetch`, 176 commits | 0 hits |
| `.env`, `**/.dev.vars`, `raw/`, `.wrangler/`, `assets-src/` | Git-ignored. Only `*.example` files are tracked |
| `wrangler.jsonc` files | No `account_id`, no key. `DEMO_URL` shows the workers.dev subdomain, which is public anyway |
| GitHub Actions | Deploy is `workflow_dispatch` only. The Cloudflare token and account id live in GitHub Secrets, which forks cannot read |

---

## 中文备注（给队员）

- 这份是提交物里「第三方清单 + 赛前准备说明」那一项（`1-brief.md` 规则 5、6）。英文部分只写已经成立的事实，待办全在这一节。
- 仓库 09-30 01:30 由 lead 转为 **PUBLIC**（转之前 `secret-scan.sh --history` 扫过全部历史）。

**🟡 待拍板**

- 提交记录里的个人邮箱：去重后 6 个个人邮箱（4 个 gmail、1 个 outlook、1 个学校邮箱），另有 5 个 GitHub noreply 和 1 个 anthropic.com；文档里还有真名。改历史要 force push，D-07 禁止，队里定接不接受。Canvas 表只要队名。
- 放不放线上链接 + 二维码：网址子域里有队员 handle（`zemmmeng`），和「只写队名」可能冲突（`4-demo.md` 拍板 2）。`README.md` 顶部现在放了 Demo 链接。

**✅ 已定（09-30）**

- `apps/api` 里两个测试小工具来自赛前模板 → **如实披露，不改口**。第 3 节照实写着，`README.md` 的「披露与 License」同一口径，不再提「重写那两条」的备选。
- `docs/event/canvas-export.md`（Canvas 课程页逐字拷贝，含四家赞助商赛题原文）→ **已删**。赛题要点已在 `docs/1-brief.md`，不依赖该拷贝。
- 赛前协作脚手架（`KICKOFF.md`、`CONTRIBUTING.md`、`AGENTS.md`、`CLAUDE.md`、`docs/onboarding.md`、`.claude/`、`scripts/new-app.sh`）→ **已从工作区删除**（D-0930-0200）。三条硬规矩移到 `README.md`，`scripts/check.sh` / `.githooks/` / CI 的检查机制不变。历史保留，第 3 节已写明。

**🟡 待办**

1. ✅ 删 `starters/`：PR #65（09-30 01:25），第 3 节已改成过去式。
2. ✅ LICENSE 填队名：**Team Uncapped**。
3. ✅ 网页数据署名：`apps/web/src/js/5-app.js` 已按 ODbL / CC BY 4.0 写全（OSM、DataVic SCATS、PTV GTFS、City of Melbourne）。
4. `apps/roads/README.md` 补一行：OSM 衍生文件（`network.json`、`walk.json`、`buildings.json`）是 ODbL 1.0 share-alike，不是 MIT（根 `README.md` 的「披露与 License」已写）。
5. 问 @jinmingq 和 @louisxie316-dotcom：各自在 DeepSeek 上一共充了多少、花了多少。jinmingq 的卡写的是自费充值 ¥10，louis 的卡写「余额多少没看」。有出入就改第 1 节「Paid purchases」那段。
6. 问 @Unzzip：T12（`apps/params`）查文献用了什么工具（AI 搜索也算），补进第 2 节。
7. 行人计数数据集页面没写许可证，提交前再确认一次，确认后改第 1 节那一格。
8. Cloudflare 用的是哪个套餐没查，需要的话补进第 1 节。
9. ✅ 大模型已打开（线上 `/api/health` → `mode: llm`）：第 1 节 DeepSeek 那行已改成「演示中在用」，花费写进「Paid purchases」（09-30）。
10. 初筛 PDF 三页的队名、`docs/4-demo.md`「要全队拍板（提交前）」1–4 待全队定。
11. 线上 DeepSeek key 是谁的账户、一共充了多少：问 lead，补进第 1 节「Paid purchases」（现在只写了预算读数约 ¥0.54 和每天 600 次上限）。

**转公开的步骤（lead 做，本 PR 不改仓库设置）**

1. 合并开着的工作，再合上面 1–4 的修复。
2. `git fetch origin && bash scripts/secret-scan.sh --history` 再跑一次，必须打印「零命中」。有命中就**先轮换 key**，再处理仓库。
3. `bash scripts/check.sh` 全量：0 ❌。
4. 仓库设置：secrets 不动、deploy workflow 保持只能手动、`main` 开保护。
5. `gh repo edit Zemmeng/hackathon --visibility public --accept-visibility-change-consequences`。
6. 用未登录的浏览器窗口打开仓库确认能看，再把链接贴进 Canvas 提交。
7. **评审结束前不要改回私有、不要删**（规则 5）。
