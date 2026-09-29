# Submission notes: third-party material, AI use, pre-event prep

> For the judges (FEIT Hackathon 2026, Challenge 5, RPM Hire). Covers competition **rules 3, 5 and 6**: no development before the event, public code repository, and a list of every third-party asset and API.
> Compiled 2026-09-29 22:05 AEST from what the repository itself shows.

## 1. Third-party data, assets, APIs and software

**Data used in the product.** We only use open data. All of it was downloaded ahead of time by scripts in `apps/roads/tools/`, and no data API is called at runtime.

| Source | Used for (file) | Licence | Attribution line |
|---|---|---|---|
| OpenStreetMap, fetched with OSMnx through the Overpass API | Road network, walking network and building outlines (`apps/roads/public/cbd/network.json`, `walk.json`, `buildings.json`) | ODbL 1.0 | © OpenStreetMap contributors |
| DataVic: Traffic Signal Volume Data (SCATS), DTP Victoria | Hourly vehicle flows, 2026-08-01 to 09-27 (`flows.json`, `apps/sim/public/demand/`) | CC BY 4.0 | Traffic Signal Volume Data, Department of Transport and Planning, Victoria |
| DataVic: Victorian Traffic Signals (site list) | Signal locations matched to network nodes (`network.json`) | CC BY 4.0 | same as above |
| DataVic: Traffic Signal Configuration Data Sheets | Detector layout for site 2921 (`apps/sim`) | CC BY 4.0 | same as above |
| DataVic: PTV GTFS Schedule, 2026-09-26 release | Tram (sub-feed 3) and metro bus (sub-feed 4) routes and stops (`transit.json`) | CC BY 4.0 | Public Transport Victoria, via DataVic |
| City of Melbourne: Pedestrian Counting System (hourly counts and sensor locations) | Footpath volumes (`peds.json`, `apps/sim`) | City of Melbourne Open Data (the dataset page states no licence; the other datasets in the series are CC BY) | City of Melbourne Open Data |
| City of Melbourne: 2018 Building Footprints | Building heights (`buildings.json`) | CC BY | City of Melbourne Open Data |
| City of Melbourne: Building information (CLUE census 2024) | Building use and floor count (`buildings.json`) | CC BY | City of Melbourne Open Data |
| RPM Hire website product pages (checked 2026-09-29) | Equipment types and specifications (16 items in `equipment.json`, each with its source URL). **Quantities and day rates are our own assumptions** because the site publishes no prices. No images or text were copied | Reference only | RPM Hire (challenge sponsor) |
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
| OSMnx (+ networkx, geopandas, shapely) | Offline data preparation only (`apps/roads/requirements.txt`), not shipped | MIT / BSD-3 |
| Python 3 and Node.js standard libraries | Build scripts and tests | PSF / MIT |
| Google Fonts: Inter, JetBrains Mono, Noto Sans SC, Space Grotesk (`apps/web`); Barlow, Barlow Condensed, IBM Plex Mono (`apps/sim`) | UI type, loaded from fonts.googleapis.com | SIL OFL 1.1 |
| DeepSeek API (`deepseek-flash`, OpenAI-compatible) | **Candidate only.** The interface for reading sign text is wired in `apps/api`, but it is switched off (`MOCK=1`), and the deployed demo uses keyword rules labelled "rule-based estimate" (D-0929-1718, D-0929-1830). During development, two team members made a small number of test calls with their own keys and personal credit (see "Paid purchases" below; `docs/llm-apis/`) | DeepSeek API terms |
| Alibaba Cloud Model Studio (Bailian) | Evaluated (PR #28), then dropped (PR #37). Not used | — |

We found no map tiles, CDN JavaScript libraries, stock images, audio or 3D assets under `apps/`: a grep for tile, CDN and font URLs returned only the Google Fonts above. The map is drawn from our own JSON.

**Paid purchases.** One: @jinmingq topped up ¥10 of DeepSeek API credit from a personal account, used for development test calls (`docs/llm-apis/jinmingq-deepseek.md`). @louisxie316-dotcom made test calls on credit in a personal DeepSeek account; the amount is not recorded in the repo (`docs/llm-apis/louisxie316-dotcom-deepseek.md`). The team's own estimate for a full set of 10 demo sign texts is about ¥0.2 (PR #37). No other paid services, data or assets were bought.

## 2. AI tools used

| Tool | How it was used | Evidence |
|---|---|---|
| **Claude Code** (Anthropic; Claude Opus 5.5 and Claude Fable 5.1 per commit trailers) | The main coding assistant for all five members. It wrote most of the code, tests, data-pipeline scripts, docs and HTML diagrams, working from specs the team wrote (`docs/arch/*-PRD.md`). Humans set the direction and made every product decision (`docs/decisions.md` quotes each one), reviewed the work and merged the PRs. The lead also ran parallel sub-agents for reviews | 59 commits on `main` carry a Claude `Co-Authored-By` trailer; 50 of the last 60 PR descriptions say "Generated with Claude Code" |
| **OpenAI Codex** | @jinmingq: the editable business-workflow SVG (PR #52). @unicornnnnnny: an early standalone "liquid glass" UI prototype, of which only the accent colour was reused (`handoff/unicornnnnnny-T14-0929-1905.md`) | PR #52 body; T14 handoff |
| Image or video generation models | **None found.** All diagrams are HTML or SVG written as code and rendered to PDF/PNG | grep of the repo for image-model names returns nothing |
| LLM inside the product | None in the deployed demo (see DeepSeek above) | `apps/api/wrangler.jsonc` `MOCK=1` |

## 3. What existed before the event (rule 3)

The event started on 2026-09-29 at 09:30 AEST. Before that, `main` had 9 commits, from 2026-09-26 01:29 to 2026-09-29 09:12 (`git log --before=2026-09-29T09:30:00+10:00`). All of it is **team-workflow tooling, with no product code, design, graphics or data**:

- **Process docs:**
  - `README`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `KICKOFF.md`
  - empty templates for `docs/1-brief`, `2-plan`, `3-tasks`, `4-demo`, `contract`, `decisions`, `pitfalls`, `deploy-cloudflare`, `onboarding`
  - `handoff/README.md`, `apps/README.md`, `hackathon.conf`, and a template MIT `LICENSE`
- **Guard scripts:**
  - `scripts/` (setup, check, sync, deploy, new-app, secret-scan)
  - `.githooks/` (pre-commit, pre-push)
  - `.github/` (CI check, manual-only deploy workflow, CODEOWNERS, PR template)
- **AI assistant configuration:** `.claude/` (settings, 3 hooks, 6 slash commands, 2 agent definitions, launch.json).
- **Onboarding check:** one teammate's T0 test PR (#3, 09:12), which only touched the task board and a handoff note.
- **`starters/`:** two generic skeletons (a Cloudflare Worker + Durable Object room demo, and a Python CLI; 22 files). On 09-29 the team decided to remove them from the repository (D-0929-1311). No product feature was built from them. Two **test-tooling** files in `apps/api` do come from the web-worker skeleton; they were copied in during the event (commit `fd6018c`, 2026-09-29 15:02):
  - `apps/api/tests/mini.mjs`, a 51-line assertion helper for the tests, is an unchanged copy of `starters/web-worker/tests/mini.mjs`;
  - `apps/api/test.sh`, the script that runs those tests, is adapted from `starters/web-worker/test.sh` (44 of its 45 lines are the same).

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
- 仓库现在还是 **PRIVATE**（22:05 查）。

**🟡 待拍板**

- `apps/api` 里两个测试小工具来自赛前模板（第 3 节已如实写）。二选一：(a) 就这样如实写着交；(b) 删 `starters/` 之前让 @jinmingq 开赛后重写 `tests/mini.mjs` 和 `test.sh`，重写后把第 3 节那两条删掉、改回「apps/ 下没有来自模板的文件」。
- 提交记录里的个人邮箱：去重后 6 个个人邮箱（4 个 gmail、1 个 outlook、1 个学校邮箱），另有 5 个 GitHub noreply 和 1 个 anthropic.com；文档里还有真名。改历史要 force push，D-07 禁止，队里定接不接受。Canvas 表只要队名。
- `docs/event/canvas-export.md` 是 Canvas 课程材料的拷贝：确认能公开，否则删。

**🟡 待办**

1. 删 `starters/`（D-0929-1311 还没执行，22:05 仍在 main）。删完把第 3 节 starters 那条改成过去式（「were removed in PR #xx」）。
2. LICENSE 里还是 `<队名 / Team Name>`，填队名。
3. `apps/roads/README.md` 加一行：OSM 衍生文件（`network.json`、`walk.json`、`buildings.json`）是 ODbL 1.0 share-alike，不是 MIT。
4. 网页署名（交给 web 负责人）：已有部分署名（建筑图层「OSM · City of Melbourne」、电车面板「Timetabled trips from PTV GTFS」、行人面板「City of Melbourne pedestrian counts」）；缺规范写法「© OpenStreetMap contributors」（ODbL 要求）、DataVic / DTP 的 SCATS 车流署名、CC BY 许可说明。
5. 问 @jinmingq 和 @louisxie316-dotcom：各自在 DeepSeek 上一共充了多少、花了多少。jinmingq 的卡写的是自费充值 ¥10，louis 的卡写「余额多少没看」。有出入就改第 1 节「Paid purchases」那段。
6. 问 @Unzzip：T12（`apps/params`）查文献用了什么工具（AI 搜索也算），补进第 2 节。
7. 行人计数数据集页面没写许可证，提交前再确认一次，确认后改第 1 节那一格。
8. Cloudflare 用的是哪个套餐没查，需要的话补进第 1 节。
9. 上线前如果真把大模型打开（`MOCK` 改 `0`），第 1 节 DeepSeek 那行改成「演示中在用」，并写上花费。

**转公开的步骤（lead 做，本 PR 不改仓库设置）**

1. 合并开着的工作，再合上面 1–4 的修复。
2. `git fetch origin && bash scripts/secret-scan.sh --history` 再跑一次，必须打印「零命中」。有命中就**先轮换 key**，再处理仓库。
3. `bash scripts/check.sh` 全量：0 ❌。
4. 仓库设置：secrets 不动、deploy workflow 保持只能手动、`main` 开保护。
5. `gh repo edit Zemmeng/hackathon --visibility public --accept-visibility-change-consequences`。
6. 用未登录的浏览器窗口打开仓库确认能看，再把链接贴进 Canvas 提交。
7. **评审结束前不要改回私有、不要删**（规则 5）。
