# T2 接线说明：RippleTwin 网页 → 引擎 + 读屏 + 参数

> 给 @unicornnnnnny（高h）· 写于 2026-09-29 15:40（lead 的引擎会话，T9）· 依据：D-0929-1445（主路径接回 6 步流程）、D-0929-1435（大模型只读懂，引擎来算）、contract v3 §施工方案 §evaluate
> 目标：页面第 1、3、4 步的数字从**预设值**换成**引擎真算的**；天气（第 2 步）照旧是第二层压力测试，不动。

## 0. 前提（按顺序）

| # | 什么 | 状态（15:40） |
|---|---|---|
| 1 | 引擎进 main | PR #20，CI 绿，等 lead 合 |
| 2 | T5 读屏接得住引擎的请求（箭头板、长读屏秒数） | PR #29，等合。没合之前页面里有箭头板时，那几类人的读数会失败，按「没人被说动」算，数字悄悄变差（已实测：总延误 5727 → 10527） |
| 3 | T12 参数 | PR #31，可选；没有也能跑，用假设值 |
| 4 | 同一个网址 | 网页、引擎、路网数据、读屏必须同源：线上靠部署外壳 `apps/site`（T10）；本地见第 1 节 |

## 1. 本地怎么跑

```bash
python3 -m http.server 8000 -d apps      # 从 apps/ 起，路径就和线上一样
# 打开 http://localhost:8000/web/public/
```

`/engine/public/…`、`/roads/public/cbd/…`、`/api/public/js/reader.js`、`/params/public/params.json` 都能取到。这时没有 `POST /api/read`，读屏会自动退回关键词规则（`src: "rule"`），不影响接线。
双击 `index.html`（file://）加载不了引擎：保留预设数字当兜底，别让页面白屏。

## 2. 要贴的代码

页面是 `build.py` 拼成的普通 `<script>`（不是 module），用动态 `import()`；不能用顶层 `await`。新建 `src/js/6-engine.js`（build.py 按文件名顺序拼进去）：

```js
// 6-engine.js —— 接 T4 引擎 + T5 读屏 + T12 参数（docs/arch/T2-engine-wiring.md）。加载失败就保留预设数字
const ENG = { engine: null, err: null, mod: null, check: null };
ENG.ready = (async () => {
  const [mod, reader, check] = await Promise.all([
    import('/engine/public/js/index.js'),
    import('/api/public/js/reader.js'),
    import('/api/public/js/check.js'),
  ]);
  const [network, flows] = await Promise.all(['network', 'flows'].map(f => fetch(`/roads/public/cbd/${f}.json`).then(r => r.json())));
  const params = await mod.loadParams();                    // 读不到 params.json 就用假设值，不抛错
  ENG.mod = mod; ENG.check = check;
  ENG.engine = mod.createEngine({ network, flows, readSigns: reader.readSigns, params });
})().catch(e => { ENG.err = e; console.warn('引擎没加载上，保留预设数字', e); });

// 方案变了（换路段 / 改屏上的字 / 挪设备）才调；同一个方案别每帧调
async function engineRun(plan) {
  await ENG.ready;
  if (!ENG.engine) return null;
  const prep = await ENG.engine.prepare(plan);              // 异步：问读数（同一句话每类人只问一次，有缓存）
  const res = ENG.engine.evaluate(plan);                     // 同步，约 7 毫秒
  return { res, failed: prep.failed };
}
async function engineAdvise(plan) {                           // 第 4 步：改法 + 每个都重算
  await ENG.ready;
  if (!ENG.engine) return null;
  return ENG.mod.advise(ENG.engine, plan, { askAdvisor: ENG.mod.mockAdvise });
}
```

## 3. 方案长什么样（已在真路网上实测）

```js
const PLAN = {
  when: { date: '2026-10-06', hour: 8 },                     // 周二早 8 点；hour 是 flows.json 的下标
  worksites: [{
    id: 'B-12', name: 'Lonsdale St westbound lane closure',
    links: ['l595594354_9756035316'],                         // 真路网路段 id（network.json）
    closes: { lanes: 1 },                                     // 封几条车道；≥ 车道数 = 全封
    time: { from: '2026-10-05', to: '2026-10-09', hours: [7, 19] },
    equipment: [                                              // at_m = 在施工起点上游多少米
      { id: 'VMS-1', type: 'vms', at_m: 300, frames: [['ROADWORK', 'AHEAD'], ['USE', 'RUSSELL ST']] },
      { id: 'S-1', type: 'sign', at_m: 100, text: 'RIGHT LANE CLOSED' },
      { id: 'A-1', type: 'arrow', at_m: 60 },                 // 箭头板（要 #29 合了才读得懂）
      { id: 'B-1', type: 'barrier', at_m: 0 },                // 护栏不进读数，只画
    ],
  }],
};
```

屏上文字：≤ 2 帧 × ≤ 4 行 × 每行 ≤ 10 个字符、大写。用户在输入框里改字时先用 `ENG.check.checkSigns(…)` 挡住不合规范的，别交给引擎（T5 #26 的 `checkSigns()`，用法见 `apps/api/README.md`）。

**实测数字**（2026-09-29，规则读数 + 假设参数，只看方向）：

| 场景 | 屏上写什么 | 总延误（车·分钟） | 排队 | 走 Russell St |
|---|---|---|---|---|
| Lonsdale St 西行 8 点，封 1 条（建议当主演示） | ROADWORK / AHEAD | 10527 | 921 米 | 4.8% |
| 同上 | 再加一帧 USE / RUSSELL ST | 5727 | 546 米 | 29.2% |
| La Trobe St 西行、Swanston 路口西边 `l2187770692_2190483583`，17 点（页面现在的场景） | 任意 | 13–33 | 0 米 | — |

页面现在的场景（La Trobe 西行）这段路车少，封一条道剩下的通行能力就够，引擎算出来每辆车只多 3–4 秒。这本身可以讲（「这个方案对车流影响小」），但演示「改一行字能少排 375 米」要用 Lonsdale 这段（离 La Trobe / Swanston 路口一个街区）。用哪段、地图怎么摆，高h 和 lead 定。

## 4. 页面上的数字换成什么

| 页面位置 | 现在 | 换成（`res` = `engineRun` 的结果） |
|---|---|---|
| 第 1 步 方案 | 预设几何 | 用户选的路段 → `links`；摆的设备 → `equipment`（`at_m` 按离施工起点的距离算） |
| 第 2 步 压力测试 | 天气预设 `RESULTS` | **不动**（天气是第二层，引擎不管天气） |
| 第 3 步 各路线分流 | 预设 | `res.approaches[0].routes[]`：`name`、`share`（0–1）、`now_min`；`id: "stay"` 是原路 |
| 第 3 步 排队 | 预设 | `res.approaches[0].queue_m`（米） |
| 第 3 步 地图高亮 | — | `res.hot[]`：最堵的 ≤ 5 段 `{ id, name, extra_min, v, cap, queue_m }`；全部路段在 `res.links[]`（`id v cap delay_s queue_m`）；几何按 `id` 从 `network.json` 的 `links[].geometry` 取 |
| 第 3 步 每类人 | 预设 | `res.by_type[类型].per_capita_min`（人均多几分钟），类型 = commuter / local / tourist / delivery |
| 第 3 步 「为什么」 | 预设文案 | `res.approaches[0].by_type[类型].reading.why`（T5 给的一句理由；用 `textContent`，别用 `innerHTML`） |
| 第 4 步 小汽车平均延误 | `R.car` | `res.delay_min / Σ res.by_type[*].vehicles × 60`（秒 / 辆） |
| 第 4 步 修复前后 | `R.*[0]` → `R.*[1]` | `engineAdvise(PLAN)` → `options[]`：`suggestion.kind`（text 改字 / move 挪设备 / shift 错开日期）、`suggestion.why`、`delta_min`（负 = 变好）、`better`；前 = `before.delay_min`，后 = `options[i].delay_min` |
| 第 4 步 冲突、急刹、TTC、公交、应急通道 | 微观仿真 + 预设 | **不动**（引擎不算这些），保留「模拟结果」标注 |

另外要显示的状态（评审问「数字哪来的」时用）：

- `res.calib.src === 'rule'` → 标「估算（规则读数）」；换成大模型后是模型名
- `ENG.engine.params.src` → `params`（有出处）或 `default`（假设值）
- `res.missing > 0` 或 `failed > 0` → 有读数没拿到，标黄，别当真数字

## 5. 测试要跟着改

`apps/web/tests/test_web.py` 第 3 条反向断言现在是「JS 里没有 fetch」。接线后改成：

- 只许请求同源相对路径（`/engine/`、`/roads/`、`/params/`、`/api/`），JS 里不许出现别的 `http(s)://` 域名（Google Fonts 除外）—— 原来的域名检查保留
- 加一条：引擎加载失败时页面仍显示预设数字（可以只做静态断言：`ENG.err` 分支存在）

## 6. 做完怎么验

1. `python3 apps/web/build.py && bash apps/web/test.sh`
2. 按第 1 节本地起，桌面和 375px 各截一张图：第 3 步的排队米数、第 4 步的前后对比是引擎的数（和第 3 节表格对得上）
3. 断网或双击 file:// 打开：页面不白屏，显示预设数字
