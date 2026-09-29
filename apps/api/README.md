# api —— 大模型读懂屏上的字（第 ③ 步）+ 施工登记表（提案 #48 第 ⑤ 步）+ AI 解读（第 ⑥ 步）+ 执行包和设备租金（第 ⑧、④ 步）

读屏：某一类路人看到这串标志后，看到没、看懂没、叫你走哪条、信不信。登记表：大家登记的施工存在一处，多处施工才能互相影响。解读：读引擎给每套方案算的数，写优缺点、谁最吃亏、风险和倾向，**不替人拍板**。执行包：人选定以后，拿走设备清单和报价、VMS 排程、配置检查和要通知谁。
Owner: @jinmingq

任务 T5，要求全在 `docs/arch/T5-PRD.md`；决定 D-0929-1435（大模型只读懂，比例由引擎算）、D-0929-1436。
**只读懂，不算比例**：各条路走多少人归 T4 的引擎。

## 怎么跑

- 引擎里直接 import `apps/api/public/js/reader.js` 的 `readSigns`（上线后的网址由 T6 集成时定）
- 本地起 Worker（先在本目录 `npm i`）：`cp .dev.vars.example .dev.vars` → `npx wrangler dev --port 8788`
  - Claude 会话里：等 lead 把 `api` 加进 `.claude/launch.json` 后用 preview 工具按名字起
  - 自检：`curl -s localhost:8788/api/health` → `{"ok":true,"v":"0.3.0","mock":true,"llm":{"mode":"rules","model":"deepseek-flash","key":false,"cache":"cache-api","prompt_v":"r2","provider":"deepseek","budget":true,"per_day":600,"per_min":60},"register":true}`（线上 `*.workers.dev` 的 `cache` 是 `memory`，见下面 KV）
  - 已在 workerd（真 Workers 运行时）里跑通：`node tests/workerd.test.mjs`（wrangler 的 `unstable_dev`，按 `wrangler.jsonc` 起，查 health / read / 400 / 413 / 静态资源；再起一个 MOCK=0 的，大模型地址指向测试进程里的假服务器，查 Durable Object 每日封顶）。变量用 `vars` 显式覆盖，**不受 `wrangler.jsonc` 的 MOCK 和本机 `.dev.vars` 影响**，不会连真服务商
- 默认（`MOCK` 不是 `"0"`，或没有 `LLM_API_KEY`）**只走规则，不会有任何付费调用**，和 T19 以前一模一样。打开大模型见下一节

## 怎么接大模型（T19；lead 只做两步）

代码都在了（`src/llm.js`：问 3 次合成、缓存、限流、熔断、任何一步出错回规则），线上只差 key 和开关。
**前提**：T19 已合进 main 并 `bash scripts/deploy.sh all` 部署过（`DEPLOY_MODULES=api site`，先 api 后 site）。这时 `<DEMO_URL>/api/health` 是上面那串（`mode: "rules"`），`/api/read` 不再 503。

**第 0 步（在服务商那边）：只充一点钱**，例 ¥10。DeepSeek 是预付费，余额就是最后一道闸：Worker 里的每日上限（下面 `LLM_MAX_CALLS_PER_DAY`）万一没生效，最多也只花掉这些。

**第 1 步：放 key**（只做一次；粘贴时终端不回显，不进任何文件）

```bash
cd apps/api && npm ci && npx wrangler secret put LLM_API_KEY; cd ../..
```

提示 `Enter a secret value` 时粘贴 key 回车（没登录先 `npx wrangler login`；登了两个账号先 `export CLOUDFLARE_ACCOUNT_ID=…`，同 `apps/site/README.md` 第 4 步）。
放完立即生效：`/api/health` 的 `llm.key` 变 `true`，`mode` 仍是 `rules`（MOCK 还是 1），仍然不花钱。

**第 2 步：打开开关，重新部署**

```bash
git switch main && git pull
# 把 apps/api/wrangler.jsonc 里的 "MOCK": "1" 改成 "MOCK": "0"（只改这一处）
git add apps/api/wrangler.jsonc
git commit -m "api: MOCK=0 打开大模型读屏 —— key 已放进 Worker secret"
ALLOW_MAIN=1 git push            # D-06 lead 小改直推
bash scripts/deploy.sh api
curl -s https://hackathon-site.zemmmeng.workers.dev/api/health   # llm.mode 变成 "llm"、llm.budget 是 true（网址 = hackathon.conf 的 DEMO_URL）
```

**验证**：换一句 `demo.json` 里没有的屏上文字，读数的 `src` 是 `llm`，同一句再问一次是 `kv`（缓存命中，不再花钱）：

```bash
curl -s -X POST https://hackathon-site.zemmmeng.workers.dev/api/read -H 'content-type: application/json' \
  -d '{"persona":"tourist","kmh":40,"signs":[{"kind":"vms","frames":[["USE","RUSSELL ST"]],"read_s":9}],"roads":["La Trobe Street","Russell Street"]}'
```

同一句第二次是 `kv` 可能只是同一个实例的内存缓存；没做下面的 KV 时，换了实例还会再问一次（花的钱仍在每日上限里）。

回的是 `src: "rule"` 带 `note` 时看短码：`http_401` key 不对 · `http_402` 余额不够 · `timeout` 连不上或太慢 · `bad_json` / `invalid` 模型没按格式回 · `llm_paused` 连续失败后暂停 1 分钟 · `llm_rate_limited` 超了本实例每分钟上限 · `llm_daily_cap` 今天的全局上限用完了（UTC 0 点，墨尔本上午 10 / 11 点清零）· `llm_no_budget` / `llm_budget_error` 每日计数（Durable Object `BUDGET`）没绑上或出错，为了不花没记账的钱直接不调用。

**花钱的上限**（`/api/read` 是公开的，谁都能 POST，换个 `read_s` 就绕过缓存）：
- 全局每天 `LLM_MAX_CALLS_PER_DAY`（默认 600 次 ≈ ¥1.2，最坏约 ¥2.4）：所有实例、所有入口记同一本账（`src/budget.js` 的 Durable Object，SQLite 后端，免费版可用，随 `deploy.sh api` 一起建好，不用另外操作）。要调就改 `wrangler.jsonc` 再部署；改成 `"0"` = 一次都不调
- 每个实例每分钟 `LLM_MAX_CALLS_PER_MIN`（默认 60 = 演示一页 20 条请求 × 3 次）：只防一分钟里把一天的额度用光，不是账单上限
- api Worker 关了自己的 `workers.dev` 网址（`workers_dev: false`），公开入口只有 site 的 `/api/*`
- 最后一道闸是服务商余额（第 0 步）

**急停**（不改代码、不部署，立刻回规则）：`cd apps/api && npx wrangler secret delete LLM_API_KEY`。或者 MOCK 改回 `"1"` 再部署。

**可选 · 预先问好演示读数**（演示时不等、不花钱、断网也能演）：

```bash
node apps/api/tools/precompute.mjs                        # dry-run：09-29 估 92 条请求 × 3 = 276 次调用，DeepSeek 高峰约 ¥0.54
node --env-file=apps/api/.dev.vars apps/api/tools/precompute.mjs --run --limit 2   # 先试 2 条
node --env-file=apps/api/.dev.vars apps/api/tools/precompute.mjs --run            # 全量，写 public/answers/demo.json
node apps/api/tools/precompute.mjs --check                # 校验；然后提交 demo.json、deploy.sh all
```

- 请求 = `fixtures/demo-signs.json`（8 句 × 4 类人）+ 引擎两个演示方案（lonsdale / latrobe 的 run、前后对比、规划顾问）实际会发的请求；key 从本机 `.dev.vars` 的 `LLM_API_KEY` 读（DeepSeek 也认 `DEEPSEEK_API_KEY`）
- ⚠️ `demo.json` 一有内容，浏览器先用它（`src: "file"`）：**线上就算 `MOCK=1` 也会显示这些大模型读数**。想退回纯规则就把 `answers` 清空
- 键里有 `read_s`：引擎改了车速或可读距离的算法，旧键就对不上，那几条改走 `/api/read`

**推荐 · KV 缓存**（跨实例、跨访客共享；不做也能用，只是会多问几次）：`cd apps/api && npx wrangler kv namespace create READINGS`，把打印的 id 填进 `wrangler.jsonc` 末尾注释掉的 `kv_namespaces` 并取消注释，提交后 `deploy.sh api`，`/api/health` 的 `llm.cache` 变成 `kv`。
没有 KV 时 `llm.cache` 是 `memory`：DEMO_URL 在 `*.workers.dev` 上，Cloudflare 的 Cache API 按域名存、在 `*.workers.dev` 上不生效（官方文档），所以只剩每个实例的内存缓存 500 条，新实例对问过的句子会再问一次（每次 3 次调用，算在每日上限里）。有自己域名时才是 `cache-api`。

**换服务商**：只改 `wrangler.jsonc` 的 `LLM_BASE_URL`、`LLM_MODEL`，`npx wrangler secret put LLM_API_KEY` 换成那家的 key，重新部署。模型名进缓存键，换了会重新问。

| 服务商 | `LLM_BASE_URL` | `LLM_MODEL` | 自动加的参数 |
|---|---|---|---|
| DeepSeek（默认） | `https://api.deepseek.com` | `deepseek-flash` | `thinking: {type: disabled}` |
| 百炼 国际站 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `enable_thinking: false` |
| 百炼 国内站 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `enable_thinking: false` |
| 其他 OpenAI 兼容 | 例 `https://api.openai.com/v1` | 例 `gpt-4o-mini` | 无 |

只有 DeepSeek 实测过（`docs/llm-apis/jinmingq-deepseek.md`）；百炼和 OpenAI 那两行照兼容格式写，**尚未实测**。都要支持 `response_format: {"type":"json_object"}`。

| 变量 | 放哪 | 默认 | 说明 |
|---|---|---|---|
| `LLM_API_KEY` | `wrangler secret`（本地 `.dev.vars`） | 无 | 没有 = 规则 |
| `MOCK` | `wrangler.jsonc` vars | `"1"` | 只有 `"0"` 才调用 |
| `LLM_BASE_URL` / `LLM_MODEL` | vars | DeepSeek | 必须 https |
| `LLM_MAX_CALLS_PER_DAY` | vars | `600` | **全局**每天（UTC），真封顶；`0` = 不调用 |
| `LLM_MAX_CALLS_PER_MIN` | vars | `60` | 每实例每分钟，尽力而为，不是账单上限 |
| `LLM_TIMEOUT_MS` | vars（可不设） | `6000` | 每次调用；浏览器等 8 秒 |
| `BUDGET` | Durable Object 绑定（`wrangler.jsonc` 里已配） | 类 `LlmBudget` | 每日计数；没绑上 = 不调用 |
| `READINGS` | KV 绑定（推荐） | 无 | 读数缓存 30 天 |

## 施工登记表（`/api/worksites` · 提案 #48 第 ⑤ 步）

多处施工要互相影响，系统得先知道「别处有哪些施工」。登记表把大家登记的施工存在一处（Durable Object `WorksiteRegister`，全局一个实例），网页拿去逐对调引擎的 `conflict(a, b)` 算冲突成本。**只做后端**：网页还没接，接的时候 import `/api/public/js/worksites.js`。

**「施工」对象** = `docs/contract.md` §施工方案（`links` / `closes` / `time` / `equipment`，原样）+ 登记表字段：

```json
{
  "id": "W-7KQ2MX", "title": "Collins St water main", "kind": "utility", "status": "decided",
  "links": ["l595594354_9756035316"], "closes": { "lanes": 1, "footpath": "left" },
  "time": { "from": "2026-10-12", "to": "2026-10-14", "hours": [9, 15] },
  "equipment": [{ "id": "VMS-1", "type": "vms", "at_m": 200, "frames": [["USE", "RUSSELL ST"]] }],
  "decision": { "option": "o2", "by": "council", "reason": "least tram delay", "at": "2026-09-30T02:00:00.000Z" },
  "seed": false, "created": "2026-09-30T01:00:00.000Z", "updated": "2026-09-30T02:00:00.000Z"
}
```

- `kind` ∈ `road / utility / building / event / other`（默认 other）；`status` ∈ `draft / assessed / decided / exported / withdrawn`（默认 draft；`decided` / `exported` 必须有 `decision`）；`decision.by` ∈ `contractor / council`，`decision.at` 由服务端盖
- `id`、`seed`、`created`、`updated` 由服务端给，客户端给的不算；**白名单以外的字段一律丢掉**（邮箱、名字不会被存）
- `title` ≤ 80 字、`decision.reason` ≤ 280 字，不许有 `< >` 和控制字符（网页用 innerHTML 拼模板）
- `links` 1–20 个；`closes.lanes` 0–8（0 要配人行道封闭）；`time.hours` 每天 `[开始, 结束)` 整点，**跨午夜的夜间施工要拆两条**；工期 ≤ 366 天
- `equipment` ≤ 30 件，id 不重复，`at_m` 0–2000；屏上文字沿用读屏的规范（`signs.js`：2 帧 × 4 行 × 10 字符、8 个词，短码也一样，例 `too_many_lines`）

| 接口 | 说明 |
|---|---|
| `GET /api/worksites?from=&to=&status=` | `{ ok, register: "do" \| "seed", n, worksites }`：预置 + 登记的，按开工日期排；`from` / `to` 是 YYYY-MM-DD，工期和窗口有交集就算。没绑 DO 或 DO 出错时 `register: "seed"`，只回预置的 |
| `GET /api/worksites/<id>` | `{ ok, worksite }`；没有 404 |
| `POST /api/worksites` | 请求体 = 「施工」→ 201 `{ ok, worksite, edit_token }`。**`edit_token` 只回这一次**，库里只存它的 SHA-256；页面自己存好（localStorage） |
| `PATCH /api/worksites/<id>` | 请求头 `x-edit-token` + 要改的字段（`title / kind / status / links / closes / time / equipment / decision`）→ `{ ok, worksite }`；合并后整份重新校验 |

错误都是 §错误格式 `{ ok:false, error, msg }`：`400` 字段短码（`bad_title` `bad_text` `bad_links` `bad_closes` `bad_time` `bad_equipment` `bad_decision` `bad_status` `bad_patch` `bad_query` `bad_json`，屏上文字沿用 `signs.js` 的）· `403 bad_token`（没带 / 不对，包括拿别人那条的 token）· `403 locked`（预置的演示施工）· `404 not_found` · `405 method`（没有删除，要撤就改成 `withdrawn`）· `409 full`（满 200 条）· `413 too_large`（> 16KB）· `429 daily_cap`（全局每天写 500 次，UTC 0 点清零）· `503 no_register` / `register_error`。

**预置的演示施工**（`public/js/worksites-seed.js`，只读、不进库）：`W-LONSDALE` / `W-LATROBE` 同引擎演示方案（`backend.js` 的 `DEMOS`）；`W-LTLBOURKE` 封在 Lonsdale 演示的绕行路线上（Russell St → Little Bourke St），和 Lonsdale 有 3 天重叠。09-29 本地用 main 上的引擎试过：10-07、10-08 早 8 点两个时刻，`conflict()` 的冲突成本约 1 万车·分钟（同样两个时刻，改封 Russell St 本身的一条车道，算出来是 0）。**数以引擎现场算的为准**。

**浏览器端**（`public/js/worksites.js`，同源部署时 apiBase 留空；`opts: { fetch, apiBase, timeoutMs }`）：

| 函数 | 说明 |
|---|---|
| `listWorksites(query?, opts?)` → `{ src: "api" \| "seed", worksites }` | 接口不通（断网、site 没绑 api 回 503）就退回预置的 3 条，页面照样能演 |
| `createWorksite(施工, opts?)` → `{ worksite, edit_token }` | 先在浏览器里规范化，不合规范直接抛 `WorksiteError`（`.code` 短码），不发请求 |
| `updateWorksite(id, 改动, token, opts?)` → `worksite` · `getWorksite(id, opts?)` | 接口的错误短码原样抛 |
| `overlapping(施工, 列表)` | 时间上重叠的其他施工（撤回的不算）→ 逐对调引擎 `conflict(a, b)` |
| `toEngineWorksite(施工)` | → 引擎 §施工方案 对象（去掉 title / status 这些） |
| `normalizeWorksite` · `applyPatch` · `timeOverlap` · `selectWorksites` · `parseQuery` | 纯函数，Worker 用的是同一份 |

**部署**：新加的 Durable Object 走 `wrangler.jsonc` 的 migration `v2`（`new_sqlite_classes`，免费版可用），部署人照常 `bash scripts/deploy.sh api`，不用另外操作；`/api/health` 的 `register` 变 `true`。已部署的 `v1` 不能改（`config.test.mjs` 查）。

## AI 解读（`POST /api/explain` · 提案 #48 第 ⑥ 步）

读引擎给 1–5 套方案算出的数字，给每套写：一句概括、优点、缺点、谁最吃亏、风险；再给一个**倾向**（哪套、为什么），外加固定的一句「由负责人决定」。**只做后端**，网页还没接。

- 原则（D-0929-1310「大模型出主意，引擎算数字」）：解读里的每个数字都得来自引擎给的数（`allowedNumbers()`：请求里的数、各方案合计，以及它们的取整 / 一位小数 / 百分数）。追溯不到的句子整句丢掉
- **现在只有规则版**（`src: "rule"`：确定、不花钱、每个数都能追溯）。大模型版以后走同一个请求 / 响应格式，回来的字先过 `sanitizeExplain()`：字段不对整份作废；编的数、带 `< >` 的句子丢掉；「谁最吃亏」和规则版的风险始终按引擎的数算，外来的删不掉；多余字段（例 `final`）丢掉
- 倾向 = 「车·分钟 + 乘客·分钟 + 行人·分钟」直接相加最少的那套（没按载客人数换算，`why` 里写明），租金不是最低、有风险都会在 `why` 里提；有一套缺全网延误、或几套一样多时不给倾向

**请求**（≤ 8KB）：

```json
{ "lang": "zh",
  "options": [
    { "id": "o1", "label": "只写前方施工",
      "metrics": { "delay_veh_min": 10493, "queue_m": 918, "mean_delay_s": 509, "detour_share": 0.14,
                   "transit_pax_min": 18693, "transit_blocked_pax_h": 0, "peds_extra_min": 0, "peds_blocked_h": 0,
                   "blocked_vph": 0, "hire_aud": 900, "days": 5 },
      "per_capita_min": { "commuter": 3.9, "local": 4.4, "tourist": 5.1, "delivery": 3.0, "transit": 2.2, "pedestrian": 0 },
      "flags": { "params_assumed": true, "reading_rules": true } } ] }
```

- 指标都可以不写（不写就不比）；都是 ≥ 0 的数，`detour_share` 是 0–1；`label` ≤ 60 字，不许有 `< >`；不认识的字段丢掉
- **网页不用自己拼**：`optionFromRun(id, 名字, be.run(方案) 的结果, { hire_aud, days })` 直接从引擎结果转（全网延误、排队、每车多等、绕行比例、电车公交、行人、每类人每人多几分钟、假设值 / 规则读屏标记）

**响应**：`{ ok: true, explain: { src, lang, options: [{ id, summary, pros[], cons[], hardest_hit: { group, min, text } | null, risks[] }], lean: { option, why } | null, decide } }`；不合规范 400（`bad_options` `bad_label` `bad_text` `bad_number` `bad_lang` `bad_json`），> 8KB 413。

**浏览器端**（`public/js/explain.js`）：`explainOptions(请求, opts?)` → 解读。接口不通（断网、site 没绑 api）就在浏览器里跑同一份规则版；接口回来的字也过 `sanitizeExplain()`；请求不合规范直接抛 `ExplainError`。`summary` / `pros` 这些用 `textContent` 显示。

## 执行包和设备租金（`public/js/pack.js` · 提案 #48 第 ⑧ 步、第 ④ 步的租金）

人选定方案以后拿走一份能执行的东西。**纯函数，在浏览器里跑**（路网、库存、引擎结果都在浏览器里），不是新接口；网页还没接。

| 函数 | 说明 |
|---|---|
| `loadInventory(opts?)` | 取 `apps/roads` 发布的 `/roads/public/cbd/equipment.json`（RPM 库存：16 种设备、件数、日租价） |
| `linkInfoFrom(network)` | `network.json` → 每段路的长度、路名、车道数、有没有电车 |
| `quote(施工, 库存, { links })` | 设备清单和租金：`{ days, length_m, lines[{ item, name, qty, day_rate_aud, days, cost_aud, over_stock }], total_aud, partial_total_aud, unmatched, over_stock, notes, assumed: true }` |
| `stockCheck(施工们, 库存, { links })` | 多处施工同几天共用一份库存：哪种设备哪天不够（每种只报缺得最多的那天；撤回的不算） |
| `buildPack(施工, { inventory, links, impacts, now })` | 执行包：地点（路名、长度、封法）、时间、决定、报价、VMS 排程（每一屏）、标志牌、配置检查、要通知谁。`impacts` = 选定方案的 metrics（`optionFromRun()`），用来决定通知谁、写原因 |
| `packText(执行包, "zh" \| "en")` | 纯文本，网页的「复制」「打印」用 |

- **现场设备 → 库存**：写了 `item`（equipment.json 的 id）就用写的；否则 VMS → `vms_a`、箭头板 → `arrow_board`、护栏 → `barrier_water`、标志牌按牌上的字（`RIGHT LANE CLOSED` → `sign_lane_closed_right`，`END ROADWORK`、`DETOUR LEFT`、`FOOTPATH CLOSED` 等）。**对不上的不瞎配**（例 `ROAD CLOSED` 库存里没有），列进 `unmatched`、不算钱
- **件数**：写了 `qty` 就用；护栏按封闭段总长 ÷ 每节长度向上取整（要给 `links`，不给就标 `length_unknown`，合计给「至少多少」）；其余 1 件。天数按日历天含两头
- 登记表的设备可以带可选的 `item`、`qty`（`worksites.js` 校验；引擎不看这两个字段）
- **配置检查**（只查清单看得出的，不引标准条款）：封车道没护栏、封人行道没「人行道封闭」牌、没有「施工结束」牌、全封既没绕行牌也没 VMS、超库存、对不上库存、长度不知道
- **要通知谁**（只写角色，不写机构和联系方式）：市政交通管理、沿街商户和居民（总是）；电车 / 公交运营方（有乘客延误、停运，或封闭路段上有电车）；应急服务（全封或有车无路可绕）；行人和无障碍出行者（封人行道或行人要绕）
- 🔒 日租价和库存件数是**假设值**（equipment.json 自己写着「官网没有公开价格」）：报价和文字版一律写「假设值，以 RPM Hire 正式报价为准」（`pack.test.mjs` 反向断言）

## 怎么测

`bash apps/api/test.sh`（只要 node ≥ 18；`tests/workerd.test.mjs` 要先 `npm i`，没装 wrangler 就自动跳过）—— 规则、规范校验、读数校验、取数顺序、Worker 路由，含 PRD 要求的 5 条（反向断言：AVOID 永远不读成 use、游客看缩写不比本地人懂得多、屏上写指令 advice 仍为空、超规范被拒；另有「MOCK 下外部请求 0 次」）。最后一行 `N passed, M failed`。

T19 加的（全用假 fetch，一次真调用都没有）：`llm.test.mjs`（默认不花钱、3 次合成、兜底、缓存、`*.workers.dev` 上报 `memory`、限流熔断、**全局每日上限**（40 条换 `read_s` 的请求、每 5 条换一个实例，外部调用仍正好等于上限）、没绑 `BUDGET` 不调用、DeepSeek 参数、key 不出现在任何响应 / 报错里）、`worker.test.mjs`（请求体按字节限 8KB，超了不整个读进内存）、`prompt.test.mjs`（`src/prompt.js` 和 `prompts.md` 一致、消息逐行对模板）、`precompute.test.mjs`（dry-run 不调用、`--run` 写文件、`--check`、写出的文件 `readSigns()` 真能用）、`config.test.mjs`（Worker 名、vars 里没有 key、`workers_dev: false`、`BUDGET` / `REGISTER` 是 SQLite DO、migration `v1` 没被改、锁文件、`workerd.test.mjs` 用 vars 覆盖）。

登记表加的：`worksites.test.mjs`（规范化、白名单、各种短码、PATCH 合并、查询、和引擎 `overlaps()` / `validateWorksite()` 对得上、预置路段都在 `network.json`、浏览器端客户端和退回预置）、`register.test.mjs`（假 storage 跑 Worker + DO：登记 → 查 → 改，**反向断言** token 和哈希不出现在任何 GET / PATCH 响应、库里不存 token 原文、别人的 token 改不了、预置改不了、被拒的改动不落库、库满 409、每日写入 429、DO 出错不透传报错）、`workerd.test.mjs` 多一节真 DO 冒烟。

AI 解读加的：`explain.test.mjs`（规范化、优缺点 / 谁最吃亏 / 风险 / 倾向、一套或缺数时不硬比、**反向断言**解读里每个数字都能追溯（中英文、真引擎结果都查）、外来解读编的数整句丢掉、删不掉规则版的风险、没有「替人选定」的字段、`/api/explain` 路由、浏览器端退回规则版；**真引擎一节**：Lonsdale 只写 ROADWORK AHEAD vs 加一帧 USE RUSSELL ST → `optionFromRun` → 规则解读，倾向加一帧那套）。关掉数字防线时这份会红（试过后还原）。

执行包加的：`pack.test.mjs`（设备 → 库存条目、对不上的不瞎配、`item` / `qty`；真库存 + 真路段长度：Lonsdale 报价逐项核对、超库存、长度不知道；三处施工 10-08 同时要 6 块 A 级 VMS 超库存；Little Bourke 全封的检查和通知；**反向断言**文字版一律写明假设值、通知只写角色不写机构 / 电话 / 网址、没有 token）。删掉假设值提示、关掉公交通知，这份会红（试过后还原）。

## 对外接口（→ docs/contract.md §路人读数、§HTTP API）

| 接口 | 说明 |
|---|---|
| `readSigns(请求, opts?) → Promise<读数>` | 引擎只调这个。顺序：`public/answers/demo.json` → `POST /api/read` → 关键词规则。同一句话同一类人一个会话只取一次（`resetReader()` 清掉）。请求不合规范**抛 `SignError`**（`.code` 是短码），不拿规则掩盖 |
| `checkSigns(请求) → { ok, error?, warnings[] }` | 给 T2 文案输入框用（`public/js/check.js`），不抛错。`error` = 超规范（接口会 400）；`warnings` = 没超但不好读：`many_lines`（> 3 行）、`long_line`（> 8 字符，整行是路名不算）、`frames_too_fast`（两帧轮一遍要 2 秒 / 帧、4 行 3 秒）、`short_read`（每词 1 秒读不完）、`odd_abbrev`。每条 `{ sign, code, msg }`，`msg` 是中文、`code` 可以拿去映射英文。出处：RPM VMS 产品页「理想 3 行 × 8 字符，每屏 2 秒 / 4 行 3 秒」 |
| `answerKey(请求) → Promise<string>` | 答案文件的键 = SHA-256(persona + 规范化 signs + 排序后的 roads)；kmh 不进键（read_s 已含车速） |
| `GET /api/health` | `{ ok, v, mock, llm: { mode, model, key, cache, prompt_v, provider, budget, per_day, per_min } }`；没配 MOCK 也算 `mock: true`，只有 `MOCK=0` 才关；`mode` = `llm` 只在 MOCK=0 且有 key；`key` 只说有没有，不给值；`cache` ∈ `kv / cache-api / memory`；`budget` = 每日计数绑上没有 |
| `GET / POST /api/worksites`、`GET / PATCH /api/worksites/<id>` | 施工登记表，见上面「施工登记表」一节 |
| `POST /api/explain` · `explainOptions()` · `optionFromRun()` | AI 解读，见上面「AI 解读」一节 |
| `POST /api/read` | 请求体同 `readSigns` → `{ ok: true, reading }`；`reading.src` ∈ `llm`（刚问的）/ `kv`（服务端缓存）/ `rule`（兜底时另带 `note` 短码）；不合规范 400 `{ ok:false, error:"<短码>", msg }`；> 8KB（按字节）413 |

`opts`：`{ fetch, apiBase, answersUrl, timeoutMs }`，默认同源、8 秒超时；测试里注入 `fetch`。

**屏上文字的规范**（超了直接拒）：`kind` ∈ `vms / sign / arrow`。VMS 最多 2 帧、每帧 4 行、每行 10 个字符、合计 8 个词；静态牌（`sign`）一句 ≤ 40 字符、≤ 8 个词；箭头板（`arrow`）同静态牌，但可以没有字（`text` 不传当空串）；只许大写字母、数字、空格和 `. , ' & : ! ? ( ) + / -`（小写会自动转大写）。一次最多 8 块标志、8 条路；路名和引擎 `cleanName()` 同一套字符。`read_s` 超过 120 秒按 120 算（引擎在 5 km/h 排队时会算出 100 多秒），负数或不是数才拒。

**给引擎（#20，已在 main）的约定**：引擎把 `readSigns()` 抛错当成「没人被说动」静默吞掉。两层守着：`tests/engine.test.mjs` 照引擎的请求形状造请求（5 种车速 × 4 类人、校准锚点、箭头板）；`tests/engine-real.test.mjs` 直接 import main 上的 `apps/engine` + T3 真路网跑 `prepare` / `evaluate`，要求 readSigns 抛错 0 次、`failed = 0`。引擎改了导出或请求形状，这两份会红：先对齐再合。

## 关键词规则（兜底，也是 MOCK 的答案；`public/js/rules.js`）

| 屏上出现 | 读数 |
|---|---|
| `USE / VIA / TAKE / TRY <路>`，可接 `OR <路>` | `advice[路] = "use"` |
| `AVOID <路>`、`<路> CLOSED / BLOCKED` | `advice[路] = "avoid"`；同一条路两种都有按 avoid |
| `SAVE(S) [UP TO] N MIN` | `saving_min = N` |
| `N MIN DELAY`、`DELAY(S) / DLY(S) N MIN`、`ALLOW [EXTRA] N MIN` | `delay_min = N`；`N-M` 取 M；多块都写取最大 |
| 只有 `ROADWORK AHEAD` 这类 | `advice` 为空 |
| 非标准缩写（`WKS AHD TFC CLSD RTE`…，或没有元音又不在标准表里的词） | `understand` 每个扣：游客 0.15、通勤 0.05、本地 / 货车 0.03，最多算 3 个 |

- 路名写法：`RUSSELL ST` / `RUSSELL STREET` / `RUSSELL`（不写后缀，`LA TROBE ST` 放不进一行）/ `LATROBE`；撇号和点不算（`A'BECKETT`）；长的先配（`LITTLE LONSDALE` 不会读成 `LONSDALE`）；同一个不带后缀的写法对上两条路（Flinders Street / Flinders Lane）就不认。`network.json` 用全称（`Russell Street`），`roads` 直接传全称就行
- `notice`：每块 `比值 = read_s ÷ (词数 × 1 秒 + 换帧 1 秒)`，`0.95 × 比值 ÷ (比值 + 0.5)`，多块按「至少注意到一块」合并，上限 0.95
- `understand` 基准 0.9；`trust` 0.7，写了具体分钟数 0.8。规则里 notice、trust 不按人区分：人设差别（信不信屏、熟不熟路）是引擎的参数，这里不重复算
- 数值常量都在 `rules.js` 顶部，改了同步改 `tests/rules.test.mjs`

## 外部 API

默认 DeepSeek `deepseek-flash`（D-0929-1718 的候选；「用哪家」仍待 lead 定），任何 OpenAI 兼容的 `POST {LLM_BASE_URL}/chat/completions` 都能换上（见「怎么接大模型」）。

- key 变量名：`LLM_API_KEY`（线上 `wrangler secret`，本地 `.dev.vars`）；预计算工具在 DeepSeek 时也认 `DEEPSEEK_API_KEY`
- 请求：`Authorization: Bearer <key>`；体 `{ model, messages, response_format: {type: json_object}, max_tokens: 300, stream: false }`，DeepSeek 另加 `thinking: {type: disabled}`（不加 `content` 是空串）
- 响应路径（DeepSeek 实测，见卡 §3）：回答文本 `choices[0].message.content`；用量 `usage.prompt_tokens` / `usage.completion_tokens`
- 花费：DeepSeek 高峰每百万 token 输入 ¥2、输出 ¥8；一次调用约 ¥0.0018，一句话 × 4 类人 × 3 次 ≈ ¥0.02
- **尚未实测**：从 Cloudflare Worker 连 DeepSeek（卡上写「没试」，有的网络会重置 `*.deepseek.com` 的连接）；T19 没有做任何真调用。第一次真调用前先在群里报调用次数和花费（D-09），花了记进 `docs/3-tasks.md` 额度台账

## 结构

| 文件 | 一句话 |
|---|---|
| `public/js/reader.js` | `readSigns()`：答案文件 → `/api/read` → 规则 |
| `public/js/rules.js` | 关键词规则，浏览器和 Worker 共用 |
| `public/js/check.js` | `checkSigns()`：文案输入框的规范检查 + 软警告 |
| `public/js/signs.js` | 屏上文字规范、请求规范化、读数校验（外来读数当不可信数据）、缓存键 |
| `public/answers/demo.json` | 演示提前问好的读数（`tools/precompute.mjs --run` 生成，现在是空的），断网也能演 |
| `fixtures/demo-signs.json` | 演示文案清单：封 La Trobe Street，8 句 × 4 类人 = 32 个请求；路名用 `network.json` 的写法 |
| `src/worker.js` | `GET /api/health`、`POST /api/read`（MOCK / 没 key → 规则，否则交给 `llm.js`）、`/api/worksites*` 交给 `register.js` |
| `src/register.js` | 施工登记表：Durable Object `WorksiteRegister` + `handleWorksites()`（token、预置只读、封顶） |
| `src/http.js` | 按字节限长读请求体、JSON 响应、§错误格式（两个接口共用） |
| `public/js/worksites.js` | 「施工」对象的规范化、时间重叠、引擎格式，加浏览器端客户端 |
| `public/js/worksites-seed.js` | 预置的 3 条演示施工 |
| `public/js/pack.js` | 执行包和设备租金：库存对应、报价、共用库存检查、配置检查、通知、文字版 |
| `public/js/explain.js` | AI 解读：请求规范化、规则版、数字追溯、外来解读清洗、`optionFromRun()`、浏览器端 `explainOptions()` |
| `src/llm.js` | 大模型那一层：配置、拼消息、调用（超时 6 秒）、3 次合成、内存 / KV / Cache API 缓存、限流、熔断 |
| `src/budget.js` | 全局每日调用计数：Durable Object `LlmBudget` + `takeBudget()`；拿不到额度就不调用 |
| `src/prompt.js` | ⚠️ 自动生成：`prompts.md` 的拷贝（Worker 不能 import .md），别手改 |
| `prompts.md` | 提示词只放这里（CLAUDE.md §9）；改完跑 `node apps/api/tools/gen-prompt.mjs` |
| `tools/gen-prompt.mjs` | `prompts.md` → `src/prompt.js`；`--check` 只查一致 |
| `tools/precompute.mjs` | 预计算演示读数 → `demo.json`；默认 dry-run，`--run` 才花钱，`--check` 校验 |
| `tools/jsonc.mjs` | 读 `wrangler.jsonc`（去注释） |
| `tests/` | `*.test.mjs` + `mini.mjs`（零依赖断言，抄自 starter）；`workerd.test.mjs` 要 `npm i` |

## 本模块固定模式

- 🔒 文件、KV、大模型回来的读数一律过 `sanitizeReading()`：字段不对整份作废改用规则；`advice` 只留请求里给过的路名；不往外传比例
- 🔒 `why` 在界面上用 `textContent` 显示，不用 `innerHTML`
- 🔒 屏上文字不许有 `< >`：提示词里用 `<sign>` 标签包屏上的字
- 🔒 提示词只改 `prompts.md`，改完跑 `gen-prompt.mjs` 并把 `prompt_v` 加 1（`prompt.test.mjs` 查两边一致）
- 🔒 登记表的 `edit_token` 只在 POST 响应里出现一次，库里只存 SHA-256；任何 GET / PATCH 响应都不带（`register.test.mjs` 反向断言）
- 🔒 登记表只收白名单字段；给人看的字（`title`、`reason`）挡掉 `< >`
- 🔒 执行包的租金一律标「假设值，以 RPM Hire 正式报价为准」；通知只写角色
- 🔒 AI 解读里的数字只能来自引擎给的数（`allowedNumbers()`），追溯不到的句子丢掉；只给倾向，不替人选定（`explain.test.mjs` 反向断言）
- 🔒 key 只在发请求那一刻从 `env.LLM_API_KEY` 读：不进配置对象、日志、报错、响应（`llm.test.mjs` 反向断言）；报错只带短码

## 已知问题

- 登记表没有登录：谁都能登记，改只凭 `edit_token`（丢了就改不了，只能重新登记）；市政 / 施工方两个视角还没做。每天 500 次写入、最多 200 条是防刷，不是权限
- 登记表只按时间找重叠（`overlapping()`）；两处施工在路网上会不会互相影响，由引擎 `conflict()` 算，登记表不判断远近
- 跨午夜的夜间施工要拆成两条（`hours` 和引擎同口径，`[开始, 结束)` 不能跨 0 点）
- 登记表线上尚未部署（要部署人 `deploy.sh api`）；Durable Object 只在本机 workerd 里测过
- 执行包的设备对应是按类型和牌上的字推的，库存里没有的牌（例 ROAD CLOSED）不算钱；护栏默认注水护栏、只按长度算节数，不管转角和渐变段；检查只看清单，不是标准合规审查
- AI 解读只有规则版；大模型版（提示词进 `prompts.md`、复用 `llm.js` 的 `askOnce` 和每日上限）还没做。规则版的倾向是分钟数直接相加，没按载客人数换算，也不看租金
- 规则认不出没写动词的建议（例 `RUSSELL ST` / `SAVE 8 MIN` 没有 USE），这类留给大模型
- T19 没做任何真调用：Worker → 服务商的连通、`response_format` 在百炼 / OpenAI 上的表现都**尚未实测**；Durable Object 每日计数只在本机 workerd 里测过，线上尚未部署过；答案文件还是空的
- 限流 `LLM_MAX_CALLS_PER_MIN` 是每个 Worker 实例一个计数器，**不是账单上限**；账单上限是全局的 `LLM_MAX_CALLS_PER_DAY` + 服务商余额。每日计数每次调用前要多走一趟 Durable Object（几十毫秒）
- 两个访客同时问同一句话会各问一次（没做进行中请求的合并）；浏览器端 `readSigns()` 自己会合并同一会话里的重复请求
- `apps/roads` 的 `equipment.json`（#14）VMS 写每行 12 个字符，RPM 官网原文是 10，已在 #14 留言；这里按 10
