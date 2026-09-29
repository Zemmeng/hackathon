# api —— 大模型读懂屏上的字（第 ③ 步）：某一类路人看到这串标志后，看到没、看懂没、叫你走哪条、信不信
Owner: @jinmingq

任务 T5，要求全在 `docs/arch/T5-PRD.md`；决定 D-0929-1435（大模型只读懂，比例由引擎算）、D-0929-1436。
**只读懂，不算比例**：各条路走多少人归 T4 的引擎。

## 怎么跑

- 引擎里直接 import `apps/api/public/js/reader.js` 的 `readSigns`（上线后的网址由 T6 集成时定）
- 本地起 Worker（先在本目录 `npm i`）：`cp .dev.vars.example .dev.vars` → `npx wrangler dev --port 8788`
  - Claude 会话里：等 lead 把 `api` 加进 `.claude/launch.json` 后用 preview 工具按名字起
  - 自检：`curl -s localhost:8788/api/health` → `{"ok":true,"v":"0.2.0","mock":true,"llm":{"mode":"rules","model":"deepseek-flash","key":false,"cache":"cache-api","prompt_v":"r2","provider":"deepseek"}}`
  - 已在 workerd（真 Workers 运行时）里跑通：`node tests/workerd.test.mjs`（wrangler 的 `unstable_dev`，按 `wrangler.jsonc` 起，查 health / read / 400 / 静态资源）。T19 的大模型那一层只在 node 里用假 fetch 测过，**尚未在 workerd 里跑**
- 默认（`MOCK` 不是 `"0"`，或没有 `LLM_API_KEY`）**只走规则，不会有任何付费调用**，和 T19 以前一模一样。打开大模型见下一节

## 怎么接大模型（T19；lead 只做两步）

代码都在了（`src/llm.js`：问 3 次合成、缓存、限流、熔断、任何一步出错回规则），线上只差 key 和开关。
**前提**：T19 已合进 main 并 `bash scripts/deploy.sh all` 部署过（`DEPLOY_MODULES=api site`，先 api 后 site）。这时 `<DEMO_URL>/api/health` 是上面那串（`mode: "rules"`），`/api/read` 不再 503。

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
curl -s https://hackathon-site.zemmmeng.workers.dev/api/health   # llm.mode 变成 "llm"（网址 = hackathon.conf 的 DEMO_URL）
```

**验证**：换一句 `demo.json` 里没有的屏上文字，读数的 `src` 是 `llm`，同一句再问一次是 `kv`（缓存命中，不再花钱）：

```bash
curl -s -X POST https://hackathon-site.zemmmeng.workers.dev/api/read -H 'content-type: application/json' \
  -d '{"persona":"tourist","kmh":40,"signs":[{"kind":"vms","frames":[["USE","RUSSELL ST"]],"read_s":9}],"roads":["La Trobe Street","Russell Street"]}'
```

回的是 `src: "rule"` 带 `note` 时看短码：`http_401` key 不对 · `http_402` 余额不够 · `timeout` 连不上或太慢 · `bad_json` / `invalid` 模型没按格式回 · `llm_paused` 连续失败后暂停 1 分钟 · `llm_rate_limited` 超了每分钟上限。

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

**可选 · KV 缓存**（跨实例、跨访客共享；不做也能用）：`cd apps/api && npx wrangler kv namespace create READINGS`，把打印的 id 填进 `wrangler.jsonc` 末尾注释掉的 `kv_namespaces` 并取消注释，提交后 `deploy.sh api`。没有 KV 时：每个实例内存缓存 500 条 + Workers 自带的 Cache API（Cache API 在 `*.workers.dev` 上可能不生效，尚未实测）。

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
| `LLM_MAX_CALLS_PER_MIN` | vars | `240` | 每实例每分钟，尽力而为，不是账单上限 |
| `LLM_TIMEOUT_MS` | vars（可不设） | `6000` | 每次调用；浏览器等 8 秒 |
| `READINGS` | KV 绑定（可选） | 无 | 读数缓存 30 天 |

## 怎么测

`bash apps/api/test.sh`（只要 node ≥ 18；`tests/workerd.test.mjs` 要先 `npm i`，没装 wrangler 就自动跳过）—— 规则、规范校验、读数校验、取数顺序、Worker 路由，含 PRD 要求的 5 条（反向断言：AVOID 永远不读成 use、游客看缩写不比本地人懂得多、屏上写指令 advice 仍为空、超规范被拒；另有「MOCK 下外部请求 0 次」）。最后一行 `N passed, M failed`。

T19 加的（全用假 fetch，一次真调用都没有）：`llm.test.mjs`（默认不花钱、3 次合成、兜底、缓存、限流熔断、DeepSeek 参数、key 不出现在任何响应 / 报错里）、`prompt.test.mjs`（`src/prompt.js` 和 `prompts.md` 一致、消息逐行对模板）、`precompute.test.mjs`（dry-run 不调用、`--run` 写文件、`--check`、写出的文件 `readSigns()` 真能用）、`config.test.mjs`（Worker 名、vars 里没有 key、锁文件）。

## 对外接口（→ docs/contract.md §路人读数、§HTTP API）

| 接口 | 说明 |
|---|---|
| `readSigns(请求, opts?) → Promise<读数>` | 引擎只调这个。顺序：`public/answers/demo.json` → `POST /api/read` → 关键词规则。同一句话同一类人一个会话只取一次（`resetReader()` 清掉）。请求不合规范**抛 `SignError`**（`.code` 是短码），不拿规则掩盖 |
| `checkSigns(请求) → { ok, error?, warnings[] }` | 给 T2 文案输入框用（`public/js/check.js`），不抛错。`error` = 超规范（接口会 400）；`warnings` = 没超但不好读：`many_lines`（> 3 行）、`long_line`（> 8 字符，整行是路名不算）、`frames_too_fast`（两帧轮一遍要 2 秒 / 帧、4 行 3 秒）、`short_read`（每词 1 秒读不完）、`odd_abbrev`。每条 `{ sign, code, msg }`，`msg` 是中文、`code` 可以拿去映射英文。出处：RPM VMS 产品页「理想 3 行 × 8 字符，每屏 2 秒 / 4 行 3 秒」 |
| `answerKey(请求) → Promise<string>` | 答案文件的键 = SHA-256(persona + 规范化 signs + 排序后的 roads)；kmh 不进键（read_s 已含车速） |
| `GET /api/health` | `{ ok, v, mock, llm: { mode, model, key, cache, prompt_v, provider } }`；没配 MOCK 也算 `mock: true`，只有 `MOCK=0` 才关；`mode` = `llm` 只在 MOCK=0 且有 key；`key` 只说有没有，不给值；`cache` ∈ `kv / cache-api / none` |
| `POST /api/read` | 请求体同 `readSigns` → `{ ok: true, reading }`；`reading.src` ∈ `llm`（刚问的）/ `kv`（服务端缓存）/ `rule`（兜底时另带 `note` 短码）；不合规范 400 `{ ok:false, error:"<短码>", msg }`；> 8KB 413 |

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
| `src/worker.js` | `GET /api/health`、`POST /api/read`（MOCK / 没 key → 规则，否则交给 `llm.js`） |
| `src/llm.js` | 大模型那一层：配置、拼消息、调用（超时 6 秒）、3 次合成、内存 / KV / Cache API 缓存、限流、熔断 |
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
- 🔒 key 只在发请求那一刻从 `env.LLM_API_KEY` 读：不进配置对象、日志、报错、响应（`llm.test.mjs` 反向断言）；报错只带短码

## 已知问题

- 规则认不出没写动词的建议（例 `RUSSELL ST` / `SAVE 8 MIN` 没有 USE），这类留给大模型
- T19 没做任何真调用：Worker → 服务商的连通、`response_format` 在百炼 / OpenAI 上的表现、Cache API 在 `*.workers.dev` 上生不生效，都**尚未实测**；答案文件还是空的
- 限流 `LLM_MAX_CALLS_PER_MIN` 是每个 Worker 实例一个计数器，Cloudflare 会同时开多个实例，所以**不是账单上限**；真要封顶去服务商后台设额度或少充值。没做 D1 每日保险丝
- 两个访客同时问同一句话会各问一次（没做进行中请求的合并）；浏览器端 `readSigns()` 自己会合并同一会话里的重复请求
- `apps/roads` 的 `equipment.json`（#14）VMS 写每行 12 个字符，RPM 官网原文是 10，已在 #14 留言；这里按 10
