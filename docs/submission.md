# Submission notes: third-party material, AI use, pre-event prep

> For the judges (FEIT Hackathon 2026, Challenge 5, RPM Hire). Covers competition **rules 3, 5 and 6**: no development before the event, public code repository, and a list of every third-party asset and API.
> Compiled 2026-09-29 22:05 AEST from what the repository itself shows. 🟡 = not yet verified. Lead: update this file if anything changes before 10-01 12:00.

## 1. Third-party data, assets, APIs and software

**Data used in the product.** We only use open data. All of it was downloaded ahead of time by scripts in `apps/roads/tools/`, and no data API is called at runtime.

| Source | Used for (file) | Licence | Attribution line |
|---|---|---|---|
| OpenStreetMap, fetched with OSMnx through the Overpass API | Road network, walking network and building outlines (`apps/roads/public/cbd/network.json`, `walk.json`, `buildings.json`) | ODbL 1.0 | © OpenStreetMap contributors |
| DataVic: Traffic Signal Volume Data (SCATS), DTP Victoria | Hourly vehicle flows, 2026-08-01 to 09-27 (`flows.json`, `apps/sim/public/demand/`) | CC BY 4.0 | Traffic Signal Volume Data, Department of Transport and Planning, Victoria |
| DataVic: Victorian Traffic Signals (site list) | Signal locations matched to network nodes (`network.json`) | CC BY 4.0 | same as above |
| DataVic: Traffic Signal Configuration Data Sheets | Detector layout for site 2921 (`apps/sim`) | CC BY 4.0 | same as above |
| DataVic: PTV GTFS Schedule, 2026-09-26 release | Tram (sub-feed 3) and metro bus (sub-feed 4) routes and stops (`transit.json`) | CC BY 4.0 | Public Transport Victoria, via DataVic |
| City of Melbourne: Pedestrian Counting System (hourly counts and sensor locations) | Footpath volumes (`peds.json`, `apps/sim`) | CC BY (🟡 the dataset page does not state a licence; other datasets in the series are CC BY. Confirm before submitting) | City of Melbourne Open Data |
| City of Melbourne: 2018 Building Footprints | Building heights (`buildings.json`) | CC BY | City of Melbourne Open Data |
| City of Melbourne: Building information (CLUE census 2024) | Building use and floor count (`buildings.json`) | CC BY | City of Melbourne Open Data |
| RPM Hire website product pages (checked 2026-09-29) | Equipment types and specifications (16 items in `equipment.json`, each with its source URL). **Quantities and day rates are our own assumptions** because the site publishes no prices. No images or text were copied | Reference only | RPM Hire (challenge sponsor) |
| TfNSW sign register (codes T1-1, T2-16) | Sign codes in `equipment.json` | Reference only | Transport for NSW |

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
| Cloudflare Workers (+ service binding between the `site` and `api` Workers) | Hosting of the demo at `hackathon-site.zemmmeng.workers.dev` | Cloudflare terms; plan 🟡 not checked |
| Wrangler CLI (npm, dev dependency of `apps/api`, `apps/site`, `apps/web`) | Local dev and deploy | MIT / Apache-2.0 |
| OSMnx (+ networkx, geopandas, shapely) | Offline data preparation only (`apps/roads/requirements.txt`), not shipped | MIT / BSD-3 |
| Python 3 and Node.js standard libraries | Build scripts and tests | PSF / MIT |
| Google Fonts: Inter, JetBrains Mono, Noto Sans SC, Space Grotesk (`apps/web`); Barlow, Barlow Condensed, IBM Plex Mono (`apps/sim`) | UI type, loaded from fonts.googleapis.com | SIL OFL 1.1 |
| DeepSeek API (`deepseek-flash`, OpenAI-compatible) | **Candidate only.** The interface for reading sign text is wired in `apps/api`, but it is switched off (`MOCK=1`), and the deployed demo uses keyword rules labelled "rule-based estimate" (D-0929-1718, D-0929-1830). Team members made a few test calls with their own keys during development (`docs/llm-apis/`). **If it is switched on before judging, update this row** | DeepSeek API terms |
| Alibaba Cloud Model Studio (Bailian) | Evaluated (PR #28), then dropped (PR #37). Not used | — |

We found no map tiles, CDN JavaScript libraries, stock images, audio or 3D assets under `apps/`: a grep for tile, CDN and font URLs returned only the Google Fonts above. The map is drawn from our own JSON. **Paid purchases: none** (🟡 the lead should confirm whether any DeepSeek credit was bought).

## 2. AI tools used

| Tool | How it was used | Evidence |
|---|---|---|
| **Claude Code** (Anthropic; Claude Opus 5.5 and Claude Fable 5.1 per commit trailers) | The main coding assistant for all five members. It wrote most of the code, tests, data-pipeline scripts, docs and HTML diagrams, working from specs the team wrote (`docs/arch/*-PRD.md`). Humans set the direction and made every product decision (`docs/decisions.md` quotes each one), reviewed the work and merged the PRs. The lead also ran parallel sub-agents for reviews | 59 commits on `main` carry a Claude `Co-Authored-By` trailer; 50 of the last 60 PR descriptions say "Generated with Claude Code" |
| **OpenAI Codex** | @jinmingq: the editable business-workflow SVG (PR #52). @unicornnnnnny: an early standalone "liquid glass" UI prototype, of which only the accent colour was reused (`handoff/unicornnnnnny-T14-0929-1905.md`) | PR #52 body; T14 handoff |
| Image or video generation models | **None found.** All diagrams are HTML or SVG written as code and rendered to PDF/PNG | grep of the repo for image-model names returns nothing |
| LLM inside the product | None in the deployed demo (see DeepSeek above) | `apps/api/wrangler.jsonc` `MOCK=1` |

🟡 The literature search for T12 (`apps/params`): which tool was used is not recorded in the repo. Ask @Unzzip.

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
- **`starters/`:** two generic skeletons (a Cloudflare Worker + Durable Object room demo, and a Python CLI; 22 files). D-0929-1311 decided to delete them. **At 22:05 they are still on `main`**, so the deletion is still to do. No app was built from them: none of their source files exist under `apps/`. `apps/sim/bump.sh` (a 17-line cache-busting helper) was rewritten during the event from the same idea.

**Built during the event**, from the first product commit `cb7d3ee` at 2026-09-29 12:30 onward: everything under `apps/` (sim, roads, engine, api, web, site, params), all data files, `docs/arch/`, `docs/pitch-assets/`, and the filled-in content of every doc.

## 4. Checklist before making the repo public (rule 5); the lead does these steps, this PR does not

**Where things stand (2026-09-29 ~22:05):**

| Check | Result |
|---|---|
| `Zemmeng/hackathon` visibility | **PRIVATE** |
| `bash scripts/secret-scan.sh --history`, all refs after `git fetch`, 176 commits | **0 hits** (✅ printed "零命中") |
| `.env`, `**/.dev.vars`, `raw/`, `.wrangler/`, `assets-src/` | Ignored ✅. Only `*.example` files are tracked |
| `wrangler.jsonc` files | No `account_id`, no key. `DEMO_URL` shows the workers.dev subdomain, which is public anyway |
| GitHub Actions | Deploy is `workflow_dispatch` only. The Cloudflare token and account id live in GitHub Secrets, which forks cannot read |

**Still to decide or fix (🟡):**

1. Delete `starters/` (D-0929-1311).
2. `LICENSE` still says `<队名 / Team Name>`. Fill in the team name.
3. ODbL: the OSM-derived files (`network.json`, `walk.json`, `buildings.json`) are share-alike. Add one line to `apps/roads/README.md` saying they are ODbL 1.0 and not MIT.
4. Credits on the page: the web page does not show "© OpenStreetMap contributors" or the DataVic / City of Melbourne credits (grep of `apps/web`, `apps/site`). ODbL and CC BY require attribution, so this is for the web owners to add.
5. `docs/event/canvas-export.md` is a copy of the Canvas course material. Confirm it may be republished, or remove it.
6. Personal data in history: commit author emails (4 gmail, 1 student address) and real names in the docs. Rewriting history needs a force push, which D-07 forbids, so the team should decide whether this is acceptable. The Canvas form itself asks for the team name only.

**Order of steps for the lead:**

1. Merge the open work, then the fixes for items 1 to 5 above.
2. `git fetch origin && bash scripts/secret-scan.sh --history` again: it must print "零命中". If there are hits, **rotate the key first**, then deal with the repo.
3. `bash scripts/check.sh` (full run): 0 ❌.
4. Repo Settings: secrets stay secret, the deploy workflow stays manual-only, and `main` is protected.
5. `gh repo edit Zemmeng/hackathon --visibility public --accept-visibility-change-consequences`.
6. Open the repo in a logged-out browser window to confirm it loads, then paste the link into the Canvas submission.
7. **Do not make it private or delete it until judging ends** (rule 5).

---

## 中文备注（给队员）

- 这份是提交物里「第三方清单 + 赛前准备说明」那一项（`1-brief.md` 规则 5、6），英文部分直接给评委看。
- 🟡 待办：
  - 删 `starters/`（D-0929-1311 还没执行）
  - LICENSE 填队名
  - 网页底部加数据署名（web 负责人）
  - `apps/roads/README.md` 写明 OSM 衍生文件是 ODbL
  - 决定 `docs/event/canvas-export.md` 和提交记录里的邮箱怎么处理
  - 问 @Unzzip 查文献用了什么工具
  - 确认有没有给 DeepSeek 充过值
- 上线前如果真把大模型打开（`MOCK` 改 `0`），第 1 节 DeepSeek 那行要改成「演示中在用」，并写上花费。
- 转公开这件事由 lead 做，按第 4 节的顺序；本 PR 不改仓库设置。
