# T13 网页接后端 PRD：RippleTwin 的数字从预设换成引擎真算的

> 负责人：@unicornnnnnny（高h）· 模块：`apps/web/` · 分支：`unicornnnnnny/web/T13-wiring` · 写于 2026-09-29 16:00（lead）
> 依据：D-0929-1445（主路径接回 6 步流程）、D-0929-1435（大模型只读懂，引擎来算）、D-0929-1540（后端由 lead 接好，网页只接 `backend.js`）、contract v3.1 §施工方案 §evaluate

## 1. 为什么

页面现在的数字（冲突数、延误、安全分……）全是写死的预设，评审一问「这数哪来的」就答不上。后端 lead 已经接好：路网、车流、参数、T5 读屏、引擎都装在一个文件 `backend.js` 里，网页调一个函数就拿回能直接显示的数字。这一单只做**页面这一侧**。

## 2. 交付物

| 做什么 | 验收 |
|---|---|
| 新建 `src/js/6-engine.js`，加载 `backend.js` | 本地第 4 节方式打开，第 1、3、4 步显示的是引擎的数；加载失败时保留预设数字，页面不白屏 |
| 第 1 步：选路段、摆设备、改屏上的字 → 生成「方案」 | 改一行字或挪一下 VMS，数字跟着变（每次改动调一次 `run`，别每帧调） |
| 第 3 步：各路线分流、排队、每类人、地图高亮、「为什么」 | 字段照第 5 节的表 |
| 第 4 步：修复前后对比 + 顾问改法 | 用 `compare` / `advise`，字段照第 5 节 |
| 数字来源标注 | `flags.ok` 为 false 时标黄；`reading_src === 'rule'` 标「估算」；`params === 'default'` 标「参数为假设值」 |
| `tests/test_web.py` 改反向断言 | 见第 6 节 |

## 3. 要贴的代码

页面是 `build.py` 拼成的普通 `<script>`（不是 module），用动态 `import()`；不能用顶层 `await`。`build.py` 按文件名顺序拼 `src/js/*.js`，所以新文件叫 `6-engine.js`：

```js
// 6-engine.js —— 接后端（docs/arch/T13-web-wiring-PRD.md）。加载失败就保留预设数字
const BE = { api: null, err: null };
BE.ready = import('/engine/public/js/backend.js')
  .then(m => m.connect())                        // 路网 + 车流 + 参数 + T5 读屏 + 引擎，一次装好（约 1 秒）
  .then(api => { BE.api = api; console.info('后端就绪', api.status()); })
  .catch(e => { BE.err = e; console.warn('后端没连上，保留预设数字', e); });

async function beRun(plan) { await BE.ready; return BE.api ? BE.api.run(plan) : null; }
async function beCompare(before, after) { await BE.ready; return BE.api ? BE.api.compare(before, after) : null; }
async function beAdvise(plan) { await BE.ready; return BE.api ? BE.api.advise(plan) : null; }
function beCheck(plan) { return BE.api ? BE.api.check(plan) : []; }   // 输入框改字时即时检查，同步
```

先用演示方案跑通，再换成用户在页面上摆的：

```js
const plan = BE.api.demo('lonsdale');                                        // 主演示
const s = await beRun(plan);                                                   // → 第 5 节的 summary
const c = await beCompare(BE.api.demo('lonsdale', { frames: [['ROADWORK', 'AHEAD']] }), plan);   // 只改一行字的前后对比
```

`demo(名, { frames, at_m, hour })`：`lonsdale` = Lonsdale St 西行早 8 点（离 La Trobe / Swanston 路口一个街区，封一条就排队，主演示）；`latrobe` = 页面现在的场景 La Trobe St 西行 17 点（车少，几乎不堵）。用哪个当主线、地图怎么摆，和 lead 商量。

**方案**的格式（自己拼时照这个；`links` 是 `network.json` 里的路段 id，`at_m` = 在施工起点上游多少米）：

```js
{
  when: { date: '2026-10-06', hour: 8 },
  worksites: [{
    id: 'B-12', links: ['l595594354_9756035316'], closes: { lanes: 1 },
    time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
    equipment: [
      { id: 'VMS-1', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] },
      { id: 'S-1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' },
      { id: 'A-1', type: 'arrow', at_m: 60 },                  // 箭头板（T5 #29 起读得懂）
      { id: 'B-1', type: 'barrier', at_m: 0 },                 // 护栏只画，不进读数
    ],
  }],
}
```

屏上文字：≤ 2 帧 × ≤ 4 行 × 每行 ≤ 10 个字符、大写。输入框里改字时调 `beCheck(plan)`：`ok: false` 的不要交给 `run`；`warnings` 只提醒（`msg` 是中文，`code` 可以映射英文）。设备类型：`vms`（写 `frames`）、`sign`（写 `text`）、`arrow`（箭头板，`text` 可省）、`barrier`（护栏，只画不读）。

## 4. 本地怎么跑

```bash
python3 -m http.server 8000 -d apps      # 从 apps/ 起，路径和线上一样
# 打开 http://localhost:8000/web/public/
```

这时没有 `POST /api/read`，T5 读屏自动退回关键词规则（`flags.reading_src = 'rule'`），不影响接线。双击 `index.html`（file://）加载不了后端：保留预设数字。线上由部署外壳 `apps/site`（T10）把各模块挂到同一个网址。

## 5. 页面上的数字换成什么

`s` = `beRun(plan)` 的结果（summary）：

| 页面位置 | 现在 | 换成 |
|---|---|---|
| 第 1 步 方案 | 预设几何 | 用户选的路段 → `links`；摆的设备 → `equipment` |
| 第 2 步 压力测试 | 天气预设 `RESULTS` | **不动**（天气是第二层，引擎不管天气） |
| 第 3 步 哪段路 | 预设 | `s.street`（主路段 = 延误最大的那段；多个施工时其余的在 `s.approaches[]`，主路段是 `s.approaches[s.main]`） |
| 第 3 步 各路线分流 | 预设 | `s.routes[]`：`name`、`share`（0–1）、`now_min`、`usual_min`；`id === 'stay'` 是原路；`s.detour_share` = 绕行比例 |
| 第 3 步 排队 | 预设 | `s.queue_m`（米） |
| 第 3 步 受影响的车 | 预设 | `s.vehicles`（辆 / 小时）、`s.mean_delay_s`（平均每辆多几秒） |
| 第 3 步 每类人 | 预设 | `s.by_type[类型].per_capita_min`（人均多几分钟）；类型 = commuter / local / tourist / delivery |
| 第 3 步 「为什么」 | 预设文案 | `s.why[类型]`（主路段上 T5 给的一句理由；**用 `textContent`**，别用 `innerHTML`） |
| 第 3 步 地图高亮 | — | `s.hot[]`：最堵的 ≤ 5 段 `{ id, name, extra_min, v, cap, queue_m }`；全部路段在 `s.raw.links[]`；几何按 `id` 从 `/roads/public/cbd/network.json` 的 `links[].geometry` 取 |
| 第 4 步 小汽车平均延误 | `R.car` | `c.before.mean_delay_s` → `c.after.mean_delay_s`（`c` = `beCompare` 的结果；`c.delta.*` 负数 = 变好） |
| 第 4 步 排队 / 绕行 | — | `c.delta.queue_m`、`c.delta.detour_share`：按**改之前的主路段**（`c.delta.street`）前后对比同一段路；`c.delta.main_changed = true` 时改完以后最堵的换成了别的路，界面提示一句 |
| 第 4 步 AI 改法 | 预设 Δ1–Δ4 | `beAdvise(plan)` → `options[]`：`kind`（text 改字 / move 挪设备 / shift 错开日期）、`why`、`frames` / `at_m` / `days`、`delta_min`（负 = 变好，整个施工期加总）、`better`、`plan`（改完的方案，可以直接 `beRun` 画出来） |
| 第 4 步 冲突、急刹、TTC、公交、应急通道、安全分 | 微观仿真 + 预设 | **不动**（引擎不算这些），保留「模拟结果」标注 |

数字来源（评审问「哪来的」时用），在 `s.flags`：

- `ok`：false = 有读数没拿到 / 校准没命中 / 屏上文字不合规范 / 有车全封又无路可绕 → 标黄，别当真数字
- `blocked_vph`：> 0 = 全封又无路可绕、卡住的车（veh/h），不算进延误，要单独显示
- `inactive`：true = 方案里的施工这个小时都不在做（数字全是 0），提示「此时段不施工」
- 顾问 `beAdvise` 的结果也有 `flags.ok`（有读数没拿到时 `delta_min` / `better` 不可信）；施工没写日期时只比这一个小时（`window.single_hour`）
- `reading_src`：`rule` = 关键词规则估算；换成大模型后是模型名
- `params`：`params` = 有出处（T12）；`default` = 假设值
- `sign_errors[]` / `sign_warnings[]`：屏上文字的问题（`msg` 中文）

## 6. 测试要跟着改

`apps/web/tests/test_web.py` 第 3 条反向断言现在是「JS 里没有 fetch」。接线后改成：

- 只许加载同源相对路径（`/engine/`、`/roads/`、`/params/`、`/api/`），JS 里不许出现别的 `http(s)://` 域名（Google Fonts 除外）—— 原来的域名检查保留
- 加一条：后端加载失败的分支存在（`BE.err`），页面仍显示预设数字

## 7. 规矩

- 只写 `apps/web/`；`backend.js` 和引擎归 lead，要改接口写进交接单第 2 节
- 改了 `src/` 跑 `python3 apps/web/build.py`
- 做完：`bash apps/web/test.sh` 绿、`bash scripts/check.sh --quick` 无 ❌；按第 4 节本地打开，桌面和 375px 各截一张图（第 3 步排队米数、第 4 步前后对比是引擎的数）；开 PR

## 8. 时间盒

2h。先做「第 3 步排队 + 分流 + 第 4 步只改一行字的前后对比」（最能演示），再做地图高亮和顾问改法。
