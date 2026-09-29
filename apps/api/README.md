# api —— 大模型读懂屏上的字（第 ③ 步）：某一类路人看到这串标志后，看到没、看懂没、叫你走哪条、信不信
Owner: @jinmingq

任务 T5，要求全在 `docs/arch/T5-PRD.md`；决定 D-0929-1435（大模型只读懂，比例由引擎算）、D-0929-1436。
**只读懂，不算比例**：各条路走多少人归 T4 的引擎。

## 怎么跑

- 引擎里直接 import `apps/api/public/js/reader.js` 的 `readSigns`（上线后的网址由 T6 集成时定）
- 本地起 Worker（21:00 的目标，要先在本目录 `npm i`）：`cp .dev.vars.example .dev.vars` → `npx wrangler dev --port 8788`
  - Claude 会话里：等 lead 把 `api` 加进 `.claude/launch.json` 后用 preview 工具按名字起
  - 自检：`curl -s localhost:8788/api/health`，应回 `{"ok":true,"v":"0.1.0","mock":true}`（单测已测，`wrangler dev` 还没实际跑过）
- 现在**不管 MOCK 是多少都走规则**：大模型还没定（D-0929-1435），不会有任何付费调用

## 怎么测

`bash apps/api/test.sh`（只要 node ≥ 18，不用 `npm i`）—— 规则、规范校验、读数校验、取数顺序、Worker 路由，含 PRD 要求的 5 条（反向断言：AVOID 永远不读成 use、游客看缩写不比本地人懂得多、屏上写指令 advice 仍为空、超规范被拒；另有「MOCK 下外部请求 0 次」）。最后一行 `N passed, M failed`。

## 对外接口（→ docs/contract.md §路人读数、§HTTP API）

| 接口 | 说明 |
|---|---|
| `readSigns(请求, opts?) → Promise<读数>` | 引擎只调这个。顺序：`public/answers/demo.json` → `POST /api/read` → 关键词规则。同一句话同一类人一个会话只取一次（`resetReader()` 清掉）。请求不合规范**抛 `SignError`**（`.code` 是短码），不拿规则掩盖 |
| `answerKey(请求) → Promise<string>` | 答案文件的键 = SHA-256(persona + 规范化 signs + 排序后的 roads)；kmh 不进键（read_s 已含车速） |
| `GET /api/health` | `{ ok, v, mock }`；没配 MOCK 也算 `mock: true`，只有 `MOCK=0` 才关 |
| `POST /api/read` | 请求体同 `readSigns` → `{ ok: true, reading }`；不合规范 400 `{ ok:false, error:"<短码>", msg }`；> 8KB 413 |

`opts`：`{ fetch, apiBase, answersUrl, timeoutMs }`，默认同源、8 秒超时；测试里注入 `fetch`。

**屏上文字的规范**（超了直接拒）：VMS 最多 2 帧、每帧 4 行、每行 10 个字符、合计 8 个词；静态牌一句 ≤ 40 字符、≤ 8 个词；只许大写字母、数字、空格和 `. , ' & : ! ? ( ) + / -`（小写会自动转大写）。一次最多 8 块标志、8 条路。

## 关键词规则（兜底，也是 MOCK 的答案；`public/js/rules.js`）

| 屏上出现 | 读数 |
|---|---|
| `USE / VIA / TAKE / TRY <路>`，可接 `OR <路>` | `advice[路] = "use"` |
| `AVOID <路>`、`<路> CLOSED / BLOCKED` | `advice[路] = "avoid"`；同一条路两种都有按 avoid |
| `SAVE(S) [UP TO] N MIN` | `saving_min = N` |
| `N MIN DELAY`、`DELAY(S) / DLY(S) N MIN`、`ALLOW [EXTRA] N MIN` | `delay_min = N`；`N-M` 取 M；多块都写取最大 |
| 只有 `ROADWORK AHEAD` 这类 | `advice` 为空 |
| 非标准缩写（`WKS AHD TFC CLSD RTE`…，或没有元音又不在标准表里的词） | `understand` 每个扣：游客 0.15、通勤 0.05、本地 / 货车 0.03，最多算 3 个 |

- 路名写法：`RUSSELL ST` / `RUSSELL STREET` / `RUSSELL`（不写后缀，`LA TROBE ST` 放不进一行）/ `LATROBE`；同一个不带后缀的写法对上两条路（Flinders St / Flinders Ln）就不认
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
| `public/js/signs.js` | 屏上文字规范、请求规范化、读数校验（外来读数当不可信数据）、缓存键 |
| `public/answers/demo.json` | 演示文案提前问好的读数（大模型定了以后填），断网也能演 |
| `src/worker.js` | `GET /api/health`、`POST /api/read` |
| `prompts.md` | 提示词只放这里（CLAUDE.md §9） |
| `tests/` | `*.test.mjs` + `mini.mjs`（零依赖断言，抄自 starter） |

## 本模块固定模式

- 🔒 文件、KV、大模型回来的读数一律过 `sanitizeReading()`：字段不对整份作废改用规则；`advice` 只留请求里给过的路名；不往外传比例
- 🔒 `why` 在界面上用 `textContent` 显示，不用 `innerHTML`
- 🔒 屏上文字不许有 `< >`：提示词里用 `<sign>` 标签包屏上的字

## 已知问题

- 规则认不出没写动词的建议（例 `RUSSELL ST` / `SAVE 8 MIN` 没有 USE），这类留给大模型
- 答案文件还是空的；KV 缓存、问 3 次取区间、真调用都等大模型定了再做
