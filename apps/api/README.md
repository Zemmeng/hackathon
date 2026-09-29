# api —— 大模型读懂屏上的字（第 ③ 步）：某一类路人看到这串标志后，看到没、看懂没、叫你走哪条、信不信
Owner: @jinmingq

任务 T5，要求全在 `docs/arch/T5-PRD.md`；决定 D-0929-1435（大模型只读懂，比例由引擎算）、D-0929-1436。
**只读懂，不算比例**：各条路走多少人归 T4 的引擎。

## 怎么跑

- 引擎里直接 import `apps/api/public/js/reader.js` 的 `readSigns`（上线后的网址由 T6 集成时定）
- 本地起 Worker（先在本目录 `npm i`）：`cp .dev.vars.example .dev.vars` → `npx wrangler dev --port 8788`
  - Claude 会话里：等 lead 把 `api` 加进 `.claude/launch.json` 后用 preview 工具按名字起
  - 自检：`curl -s localhost:8788/api/health` → `{"ok":true,"v":"0.1.0","mock":true}`
  - 已在 workerd（真 Workers 运行时）里跑通：`node tests/workerd.test.mjs`（wrangler 的 `unstable_dev`，按 `wrangler.jsonc` 起，查 health / read / 400 / 静态资源）
- 现在**不管 MOCK 是多少都走规则**：大模型还没定（D-0929-1435），不会有任何付费调用

## 怎么测

`bash apps/api/test.sh`（只要 node ≥ 18；`tests/workerd.test.mjs` 要先 `npm i`，没装 wrangler 就自动跳过）—— 规则、规范校验、读数校验、取数顺序、Worker 路由，含 PRD 要求的 5 条（反向断言：AVOID 永远不读成 use、游客看缩写不比本地人懂得多、屏上写指令 advice 仍为空、超规范被拒；另有「MOCK 下外部请求 0 次」）。最后一行 `N passed, M failed`。

## 对外接口（→ docs/contract.md §路人读数、§HTTP API）

| 接口 | 说明 |
|---|---|
| `readSigns(请求, opts?) → Promise<读数>` | 引擎只调这个。顺序：`public/answers/demo.json` → `POST /api/read` → 关键词规则。同一句话同一类人一个会话只取一次（`resetReader()` 清掉）。请求不合规范**抛 `SignError`**（`.code` 是短码），不拿规则掩盖 |
| `checkSigns(请求) → { ok, error?, warnings[] }` | 给 T2 文案输入框用（`public/js/check.js`），不抛错。`error` = 超规范（接口会 400）；`warnings` = 没超但不好读：`many_lines`（> 3 行）、`long_line`（> 8 字符，整行是路名不算）、`frames_too_fast`（两帧轮一遍要 2 秒 / 帧、4 行 3 秒）、`short_read`（每词 1 秒读不完）、`odd_abbrev`。每条 `{ sign, code, msg }`，`msg` 是中文、`code` 可以拿去映射英文。出处：RPM VMS 产品页「理想 3 行 × 8 字符，每屏 2 秒 / 4 行 3 秒」 |
| `answerKey(请求) → Promise<string>` | 答案文件的键 = SHA-256(persona + 规范化 signs + 排序后的 roads)；kmh 不进键（read_s 已含车速） |
| `GET /api/health` | `{ ok, v, mock }`；没配 MOCK 也算 `mock: true`，只有 `MOCK=0` 才关 |
| `POST /api/read` | 请求体同 `readSigns` → `{ ok: true, reading }`；不合规范 400 `{ ok:false, error:"<短码>", msg }`；> 8KB 413 |

`opts`：`{ fetch, apiBase, answersUrl, timeoutMs }`，默认同源、8 秒超时；测试里注入 `fetch`。

**屏上文字的规范**（超了直接拒）：`kind` ∈ `vms / sign / arrow`。VMS 最多 2 帧、每帧 4 行、每行 10 个字符、合计 8 个词；静态牌（`sign`）一句 ≤ 40 字符、≤ 8 个词；箭头板（`arrow`）同静态牌，但可以没有字（`text` 不传当空串）；只许大写字母、数字、空格和 `. , ' & : ! ? ( ) + / -`（小写会自动转大写）。一次最多 8 块标志、8 条路；路名和引擎 `cleanName()` 同一套字符。`read_s` 超过 120 秒按 120 算（引擎在 5 km/h 排队时会算出 100 多秒），负数或不是数才拒。

**给引擎（#20）的约定**：引擎把 `readSigns()` 抛错当成「没人被说动」静默吞掉，所以引擎会发的请求形状都在 `tests/engine.test.mjs` 里测着（照 #20 09-29 15:20 的 `reading.js` 抄）；引擎改了请求形状要同步改这份测试。

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

大模型还没定（D-0929-1435）。定了以后：模型名放 Worker 变量 `LLM_MODEL`，key 的变量名写进这里和 `.env.example`，**实测的响应路径**写进这一节。第一次真调用前先在群里报调用次数和花费。

## 结构

| 文件 | 一句话 |
|---|---|
| `public/js/reader.js` | `readSigns()`：答案文件 → `/api/read` → 规则 |
| `public/js/rules.js` | 关键词规则，浏览器和 Worker 共用 |
| `public/js/check.js` | `checkSigns()`：文案输入框的规范检查 + 软警告 |
| `public/js/signs.js` | 屏上文字规范、请求规范化、读数校验（外来读数当不可信数据）、缓存键 |
| `public/answers/demo.json` | 演示文案提前问好的读数（大模型定了以后填），断网也能演 |
| `fixtures/demo-signs.json` | 演示文案清单：封 La Trobe Street，8 句 × 4 类人 = 32 个请求；路名用 `network.json` 的写法 |
| `src/worker.js` | `GET /api/health`、`POST /api/read` |
| `prompts.md` | 提示词只放这里（CLAUDE.md §9） |
| `tests/` | `*.test.mjs` + `mini.mjs`（零依赖断言，抄自 starter）；`workerd.test.mjs` 要 `npm i` |

## 本模块固定模式

- 🔒 文件、KV、大模型回来的读数一律过 `sanitizeReading()`：字段不对整份作废改用规则；`advice` 只留请求里给过的路名；不往外传比例
- 🔒 `why` 在界面上用 `textContent` 显示，不用 `innerHTML`
- 🔒 屏上文字不许有 `< >`：提示词里用 `<sign>` 标签包屏上的字

## 已知问题

- 规则认不出没写动词的建议（例 `RUSSELL ST` / `SAVE 8 MIN` 没有 USE），这类留给大模型
- 答案文件还是空的；KV 缓存、问 3 次取区间、真调用都等大模型定了再做。到时候从 #20 收：D1 花钱保险丝（每天原子计数）、`llm.js` 可替换调用层、`prompts.md` 按 Text 打包进 Worker、prewarm 工具
- `apps/roads` 的 `equipment.json`（#14）VMS 写每行 12 个字符，RPM 官网原文是 10，已在 #14 留言；这里按 10
