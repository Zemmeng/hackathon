# api —— 路人 agent（第 ③ 步）和规划顾问（第 ⑦ 步）的 Cloudflare Worker，加施工清单
Owner: @Zemmeng（lead 暂管；T5 认领后改成认领人）

流程见 `docs/arch/4-ai-flow.md`：引擎造好场景卡 → 本模块问 4 类路人（通勤、本地、游客、送货）各自怎么走 → 引擎校准、算数字。大模型用哪家还没定（D-0929-1333），现在所有回答都是关键词规则估算，**不花钱**。

## 怎么跑

- Claude 会话里：preview 工具启动 `api`（`.claude/launch.json`，端口 8788）
- 手动：`cd apps/api && npm ci && npx wrangler dev --port 8788 --var MOCK:1`（等于 `npm run dev`）
- 看活着没：`curl localhost:8788/api/health` → `{ ok, v, mock: true, llm: null, prompt_v }`
- 浏览器 / node 直接用：`import { askPersonas } from '/api/public/js/persona.js'`（Worker 不通会自动退回规则，见下）
- 🔒 只支持同源部署：网页、`/engine/public/`、`/api/public/`、`/api/*` 挂在同一个域名下，本地开发也一样（契约「谁调谁」）。Worker 故意不开 CORS：施工清单没有鉴权、`/api/persona` 会用掉当天的真调用额度，开了等于任何网站都能改清单、烧额度。`persona.js` 默认 `base: '/api'` 就是按同源写的

## 怎么测

`bash apps/api/test.sh` —— node 跑，不开 Worker、不联网、不花钱；最后一行 `N passed, M failed`（2026-09-29 实跑：136 passed, 0 failed）。

| 文件 | 测什么 |
|---|---|
| `tests/vms.test.mjs` | 屏上文字规范：超 2 帧 / 4 行 / 10 字符拒，接近上限提醒，尖括号进不来 |
| `tests/rules.test.mjs` | 规则兜底格式对、同卡同答案、方向对（点名路线 > 只写施工）；**反向**：货车不上禁货车的路 · 屏上写 IGNORE / RULES 不改格式不增绕行 · 游客看缩写 ≤ 本地人 |
| `tests/behavior.test.mjs` | 文献里的规律（`5-llm-api-detail.pdf` 第 2 页）：读 `answers.json` 的缓存答案，规则只测设计上该过的几条，有大模型答案时全部要过 |
| `tests/persona.test.mjs` | 兜底链 答案文件 → Worker → 规则：任一环坏了都回合格答案，`src` 如实标 |
| `tests/worker.test.mjs` | health、MOCK 永不调大模型、输入校验、KV 缓存、D1 花钱保险丝（用假 D1 模拟原子计数；没绑 D1 → `no_db` 不真调）、失败兜底、施工清单；**反向**：假 key 不出现在任何响应（含报错）· 大模型层货车也不上禁货车的路 |
| `tests/tools.test.mjs` | `prewarm.mjs` 默认 dry-run 不联网、`--check` 通过；不认识的参数退出码 2 |

## 对外接口（→ docs/contract.md「HTTP API」「路人 agent」「施工方案」「规划顾问」）

HTTP（错误格式照契约 `{ ok: false, error, msg }`，场景卡 / 施工方案不合规回 400 带 `issues[]`，请求体 ≤ 8 KB）：

| 方法 + 路径 | 请求 → 响应 |
|---|---|
| `GET /api/health` | → `{ ok, v, mock, llm, prompt_v }` |
| `POST /api/persona` | `{ type, card }` → `{ ok, src: kv\|llm\|rule, type, answer, model, prompt_v, fallback? }` |
| `POST /api/advisor` | `{ summary }` → `{ ok, src: llm\|kv\|rule, suggestions[≤3], model?, fallback? }`；摘要外形不对 → 400 `bad_summary` |
| `GET / POST / DELETE /api/worksites` | 施工清单；`persist` 说明存进 D1 没有；POST 只存认识的字段（`pickWorksite()`），满 200 条回 409 `too_many` |

- 场景卡路线可带 `turn_m`（只有绕行路线，0–3000，施工起点上游多少米拐出去；引擎取自 `diverge_m`）：`stay` 写了或超范围 → issue `bad_turn_m`；`cardKey` 按 50 米一档；提示词里写成「turn off about N m before the works」
- 路名（`trip.on` / `trip.to` / 路线 `name` / 施工 `name`）首尾不能有空白、不能有连续空白（`isName()`）
- `/api/advisor`：KV 缓存（`src: kv`，键 = `a:` + SHA-256(`prompt_v|模型|` + 键排好序的摘要)）；丢掉 `worksite` / `equipment` id 不合 `[A-Za-z0-9_-]{1,40}` 的建议，也丢掉 `worksite` 不在 `summary.worksites` 里的（大模型、KV、规则版都过这一道）；全被丢光 → 规则版 + `llm_empty`
- 施工清单的 200 条上限在 D1 上用一条带条件的语句判断（覆盖已有 id 不算新增），并发 POST 也不会超

浏览器 / Worker / node 共用的 JS（`public/js/`，同源部署挂在 `/api/public/js/`）：

| 导出 | 用法 |
|---|---|
| `askPersonas(card, opts?)` | 第 ③ 步唯一入口。回 `{ src, by_type, raw, mix, model, prompt_v }` |
| `askAdvisor(summary, opts?)` | 第 ⑦ 步。回 `{ src, suggestions, fallback? }`，失败退回规则版 |
| `checkVms(frames, { read_s })` / `checkSignText(text)` | T2 文案输入框和 Worker 400 用同一份规范 |
| `cardKey(card, 前缀)` | 缓存键 = SHA-256(前缀 \| 规范化场景卡) |

- ⚠️ **和 `5-llm-api-detail.pdf` 第 3 页草案不一样**：草案里 askPersonas 回一个校准后的 `share`；现在它只回**校准前**的 `by_type`（每类人的表态）、`raw`（按 `mix` 车流占比加权的全体比例）和 `mix`。两点校准是第 ④ 步，归引擎（`4-ai-flow.md` 那张表），用引擎的 `calibrate()` 出校准后的 `share`
- `opts`：`fetch`（传 `null` = 不联网）、`base`（默认 `/api`）、`timeoutMs`（默认 25000：Worker 等大模型 20 秒，多留 5 秒，免得 Worker 已经付钱问到的答案在浏览器这边丢掉）、`force: 'rule'`（只要规则）、`mix`、`answersUrl`
- 查答案顺序：随网页发布的 `answers.json`（`src: file`）→ Worker（先查 KV `kv`，没有才问大模型 `llm`）→ 关键词规则（`rule`）。顶层 `src` 取 4 类里最「估算」的那一类，界面据此标「估算」
  - 答案文件 5 秒拉不到就当没有；只缓存「拿到了」和「确定没有（404）」，网络错误、超时、5xx 下次调用再试；没有 `crypto.subtle`（非 https 的局域网地址）算不了键，直接跳过答案文件
  - 有的类是规则、有的不是 → 顶层 `model: "mixed"`（引擎的锚点对不上，校准退回 `ratio`）
  - 送货那类不管从哪来（答案文件、Worker）都再过一遍 `truckSafe()`：`truck: false` 的绕行清零、按比例补回
- `askAdvisor`：超时中止请求；回的不是 JSON → `bad_json`；规则版的建议也过 `checkSuggestion()`；Worker 回的 `fallback` 原样透传
- `fallback` 短码：`mock` `no_provider` `no_db` `cap` `fuse_error` `timeout` `llm_failed` `llm_error` `unknown_provider` `llm_empty`（Worker 端，`llm_empty` 只有顾问）；`network` `http_<状态码>` `bad_json` `bad_response` `timeout` `no_fetch`（浏览器端）
- 理由 `why` 显示用 `textContent`，不用 `innerHTML`

## 外部 API

**大模型：用哪家、谁的 key 待定（D-0929-1333）。** 定了以后只改 `src/llm.js`，不动 `persona.js` 和引擎。

| 变量 | 放哪 | 说明 |
|---|---|---|
| `MOCK` | `wrangler.jsonc` vars | 默认 `"1"`；不是 `"0"` 就永远不调 |
| `LLM_DAILY_CAP` | 同上 | 每天（UTC）最多真调用次数，默认 300；`"0"` = 一次都不调；填的不是非负整数按 300 |
| `LLM_PROVIDER` / `LLM_MODEL` | 同上 | 选厂商分支、选模型；没填 = `no_provider` |
| key（变量名和厂商一起定） | Worker secret；本地 `apps/api/.dev.vars` | `wrangler secret put <变量名>` 会立刻部署新版本，**只有 DEPLOYER 执行**（D-0929-1322） |

- `callModel` 约定：`{ system, user, schema, maxTokens, signal }` → `{ json, usage }`，`json` 用结构化输出按 schema 解析好；失败抛 `LlmError`，`code` 是 ASCII 短码
- **实测的响应路径：还没真调过。** 第一次真调用后把实际路径、`usage`、延迟写回这一节
- 🔒 D-09：真调用前先报调用次数和花费、经 lead 同意。次数这样算：一类人一次请求 = 3 次调用（打乱路线顺序），一张新场景卡 × 4 类 = 12 次；第 2 轮 `queue_m` 换档算新卡；两块标准屏锚点每个模型另 24 次；顾问 1 次
- 额度先占后调：`reserve()` 先在 D1 记上这次的次数（persona 3、advisor 1）再调大模型，调用失败占掉的不退
- `tools/prewarm.mjs`：默认只列演示场景卡、打印调用次数和估算花费；`--cards <文件>` 加上引擎演示用的卡（`node apps/engine/tools/demo.mjs --cards <文件>` 生成）；`--check` 只校验卡、不联网；`--run --url <Worker 地址>` 才花钱，只收 `src` = llm / kv 的回答，4 类齐了才写进 `public/answers/answers.json`（规则答案不写）

花费估算（`5-llm-api-detail.pdf` 第 4 页，**［待核］**，第一次真调用后用返回的 `usage` 回填）：

| 项 | 估算 |
|---|---|
| 一次调用 | 输入约 1.2k、输出约 0.7k token；若用 Claude Opus 5.5 约 2 美分 |
| 一张新场景卡（12 次） | 约 0.2 美元 |
| 演示预热约 30 个场景 | 约 7 美元（加 12 人理由素材约再 4 美元） |

**Cloudflare**（部署做法见 `docs/deploy-cloudflare.md`；不绑也能跑）：

| 资源 | 创建（DEPLOYER 执行，把输出的 id 填进 `wrangler.jsonc` 注释掉的那行） | 不绑会怎样 |
|---|---|---|
| D1 `DB` | `npx wrangler d1 create worksites`，再 `npx wrangler d1 execute worksites --remote --file schema.sql`（建 `worksites` 和 `quota` 两张表；以前建过的也要重跑一次才有 `quota`） | 施工清单存实例内存，`persist: false`；**而且永远不真调大模型**（`no_db`：当天计数在 D1） |
| KV `PERSONA_KV` | `npx wrangler kv namespace create PERSONA_KV` | 可选。没有问答缓存，照样能真调，只是同一张卡每次都花钱 |

- 花钱保险丝在 D1 的 `quota(day, n)` 表：一条 `INSERT … ON CONFLICT(day) DO UPDATE SET n = n + excluded.n WHERE n + excluded.n <= 上限 RETURNING n`，没回行 = 超限（`cap`），并发也不会超；D1 出错（比如没建 `quota` 表）一律当超限 → `fuse_error`，不调、回规则
- 计数不放 KV：KV 只能先读再写，并发请求会一起越过上限，同一个键每秒也只能写 1 次；施工清单也放 D1：KV 写完别处 60 秒以上才看得到，也没有事务
- 免费版限额：KV 每天 10 万次读、1000 次写（一次真调用的请求写 1 次缓存）；Workers 每次请求 10 毫秒 CPU（D-0929-1310，等大模型回话不算 CPU）

## 结构

| 文件 | 一句话 |
|---|---|
| `src/worker.js` | Worker 入口：把 `prompts.md` 当文本打进来，交给 `app.js` |
| `src/app.js` | 路由、输入校验（`validateCard` `validateWorksite` `validateSummary`）、KV 问答缓存、D1 花钱保险丝（`reserve()`）、失败兜底、施工清单（`pickWorksite()`）；node 测试直接 import |
| `src/prompts.js` | 解析 `prompts.md`，把场景卡填进模板（含每条绕行的拐口距离）；结构化输出的 schema |
| `src/llm.js` | 大模型调用唯一出口；现在只抛 `no_provider` / `unknown_provider` |
| `prompts.md` | 全部提示词 + `prompt_v` |
| `public/js/persona.js` | `askPersonas` / `askAdvisor`：答案文件 → Worker → 规则 |
| `public/js/rules.js` | 关键词规则兜底、4 类人占比 `MIX`、规则版顾问、`checkSuggestion` `truckSafe` |
| `public/js/vms.js` | 屏上文字规范（RPM 屏 4 行 × 10 字符、最多 2 帧、≤ 8 个词） |
| `public/js/cardkey.js` | 场景卡规范化 + SHA-256 缓存键（Web Crypto，不用 npm 包） |
| `public/answers/answers.json` | 演示预热答案，随网页发布；现在是空的 |
| `schema.sql` | D1 两张表：施工清单 `worksites`、当天真调用计数 `quota` |
| `wrangler.jsonc` | Worker 配置；KV / D1 绑定先注释着 |
| `package.json` | 只有 wrangler（钉死版本） |
| `tests/*.test.mjs` · `tests/_t.mjs` | 见「怎么测」；`_t.mjs` 是断言小工具和参考场景卡 |
| `tools/prewarm.mjs` | 演示答案预热，默认 dry run |
| `tools/demo-cards.mjs` | 要预热的固定场景卡：两块校准标准屏 + 行为测试的卡（和引擎 `REF_CARD` 同一个参考场景） |
| `test.sh` | 跑全部测试，最后一行 `N passed, M failed` |

## 本模块固定模式

- 🔒 提示词只放 `prompts.md`；改了任何一句就把 `prompt_v` 加 1（Worker KV 的缓存键带它，旧答案自动作废；`answers.json` 不会自动作废，必须重跑 `prewarm.mjs --run`，版本对不上时 `prewarm --check` 和 `behavior.test.mjs` 会报错）
- 🔒 MOCK 默认开：`MOCK` 不是 `"0"`、没填厂商、没绑 D1、当天到 `LLM_DAILY_CAP`、D1 计数出错，任何一条都只回规则估算，响应里用 `fallback` 说明是哪条
- 🔒 屏上文字字符集只许大写字母、数字、空格和 `.,'&/:+-`，路名也不许尖括号：屏上的字包在 `<sign>…</sign>` 里交给大模型当数据，进不来就逃不出去
- 🔒 key 只从 env 读、只在 `llm.js` 用；任何响应（含报错）不回显 env 的值和异常原文。`worker.test.mjs` 有反向断言
- 规则是纯函数、确定性：同一张卡永远同一个答案；浏览器、Worker、node 共用同一份 `rules.js`
- 规则里标志要在那条路的拐口之前（`sign.m ≥ turn_m`）才算点名了这条路：摆在拐口之后，司机看到时已经拐不过去（`namedRoute()`）
- 规则版顾问：只有最快的绕行现在比原路至少快 1 分钟（四舍五入）才建议改屏上的字（全封没有原路时照样建议）；一样快取拐口最近的（`diverge_m` 小的）
- `persona.js` 是第 ③ 步唯一入口：引擎只调 `askPersonas(card)`；换大模型只改 `llm.js`
- 货车永远不上 `truck: false` 的路：大模型层（`parseRun`）清零一次，浏览器拿到任何来源的回答再过一遍 `truckSafe()`，规则本身也不给
- 每类人问 3 次（原顺序、倒序、轮转一位），至少 2 次有效才算，取平均并给区间 `lo` / `hi`

## 已知问题

- 大模型还没接：`llm.js` 只抛 `no_provider`（没填厂商）/ `unknown_provider`（填了也没实现），全部走规则估算
- 规则参数（`rules.js` 的 `P` 表：注意到、看懂、各种倾向）和 `MIX`（通勤 50% / 本地 25% / 游客 10% / 送货 15%）是工程假设 **［待核］**，T5 找数据校准
- 两点校准的锚点（只写施工 ≈ 3%、写推荐路线 ≈ 20%）**［待核］**，在引擎 `calibrate.js`
- 施工清单没有鉴权：GET / POST / DELETE 谁都能调（不开 CORS 只挡住别的网站的网页，用 curl 照样能加、能删，上限 200 条）；没绑 D1 时存在 Worker 实例内存，重启就丢，不同实例看到的不一样
- KV 问答缓存是最终一致的：刚写进去的答案别的地方可能 60 秒后才读得到，这期间同一张卡可能再真调一次（多花一次钱，但 D1 计数照记，不会超上限）
- `answers.json` 是空的，等大模型定了跑 `prewarm.mjs --run`；在那之前 `behavior.test.mjs` 只测规则那几条
