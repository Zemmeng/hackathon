# web —— RippleTwin 网页面板：GIS 地图 + 极端天气 + 四步红队流程（中 / 英）
Owner: @unicornnnnnny

第 5 题（RPM Hire：临时交通设施数字工具）的展示网页。一个页面走完「方案 → 压力测试 → 涟漪追踪 → 修复」四步：

- **主路径（T13 起接引擎）**：在 CBD 真路网上放封道、写 VMS / 标志牌文字、选时段 → 引擎（`apps/engine` 的 `backend.js`）现算排队、分流、每类人的延误和理由 → 规则顾问给改法、引擎重算前后对比。第 1、3、4 步的这些数字都是引擎算的
- **第二层**：La Trobe × Swanston 路口的微观仿真 + 六种天气（晴 / 雷暴 / 内涝 / 浓雾 / 高温 / 大风）压力测试、冲突因果链、护栏改法的滑动对比。冲突数、安全分等仍是模拟 / 预设值，页面标「模拟结果」
- 引擎连不上（双击打开、只起了本模块的静态服务器、离线）时页面照常能用，显示预设数字并注明「引擎未连接」

## 怎么跑

- 带引擎（推荐）：preview 工具起 `site`（全站同源，8790），开 http://localhost:8790/web/public/ ；或手动 `python3 -m http.server 8000 -d apps`，开 http://localhost:8000/web/public/ （从 `apps/` 起，路径和线上一样）
- 只看页面：`python3 -m http.server 4175 -d apps/web/public`（launch.json 的 `web`）或双击 `public/index.html`，引擎连不上，显示预设数字
- 改了 `src/` 之后：`python3 apps/web/build.py` 重新生成 `public/index.html`（测试会检查两者一致；Mac 自带 python3 3.9 能跑）

## 怎么部署

线上由部署外壳 `apps/site`（T10）把各模块的 `public/` 挂到同一个网址，本页在 `<网址>/web/public/`，首页 `/` 会跳过来。只走 `bash scripts/deploy.sh all`（`DEPLOY_MODULES=site`），步骤见 `apps/site/README.md`。

- 本模块自己的 `wrangler.jsonc`（纯静态 assets）留着给单独发一份备用：`bash scripts/deploy.sh web`，但那份拿不到引擎，只有预设数字
- 本地核对配置不用登录：`cd apps/web && npm ci && npx wrangler deploy --dry-run`

## 怎么测

`bash apps/web/test.sh` —— 不开浏览器，两个文件：

- `tests/test_engine.py`（调 `node tests/engine_glue.mjs`，要 node ≥ 18）：`6-engine.js` 里 `pure:begin…pure:end` 那段纯函数——真路网坐标换到页面方格（主干路口误差 ≤ 3 m）、点街选路段（靠左行驶，点哪侧选哪个方向）、拼方案（契约 §施工方案，空 VMS 不发）——再把页面拼的方案交给真的 `backend.js` 跑：默认方案排队 > 0、加一帧 USE / RUSSELL ST 排队变短、超长的行被 check 拦下、全封、非施工时段、顾问给出更好的改法
- `tests/test_web.py`：静态断言：打包产物与源码一致、体积 < 2MB、`import()` / `fetch()` 只用同源固定路径（`/engine/ /roads/ /params/ /api/`）、外部地址只有 Google Fonts、引擎连不上走 `BE.err` 并保留预设数字、T5 / 顾问的 `why` 只用 `textContent`、路名和报错进 HTML 前过 `esc()`、没有 key、四步和六种天气配置齐全、修复方案在每种天气下都比原方案好、方案 v2 的几何和文案对得上（护栏西移 8 m 等）、中英文案成对。最后一行 `N passed, M failed`。

浏览器里人工验过：桌面 1440×900 和手机 375px、深 / 浅主题、中 / 英、六种天气、四步流程（第 2 步 C-17 × D-42 严重冲突会自动触发，TTC 约 0.6 s）。

## 对外接口

只调 lead 的后端接线层（`docs/arch/T13-web-wiring-PRD.md`，契约 §施工方案 §evaluate），全部同源：

| 用到什么 | 怎么用 |
|---|---|
| `/engine/public/js/backend.js` | `import()` 后 `connect()` → `run / compare / advise / check / demo`；它自己再取 `/roads/public/cbd/network.json`、`flows.json`、`/params/public/params.json`，并加载 T5 的 `/api/public/js/reader.js`、`check.js` |
| `/engine/public/js/index.js` | 只用 `affected()` + `capFactors()` 取绕行路线经过的路段，画在地图上（和 `run()` 内部是同一个函数） |
| `/params/public/params.json` | 只读路人占比的区间和置信度，结果旁标「假设值」+ 区间（D-0929-1536） |

页面拼的方案：施工 id `W-1`，一个路段、`closes.lanes` = 1 或该路段车道数、工期 2026-10-05 → 10-09 每天 7–19 点，设备 VMS-1 / S-1 / A-1 / B-1。T5 读屏会 `POST /api/read`：api Worker 没接上时 site 回 503，读屏自动退回关键词规则（`flags.reading_src = 'rule'`，页面标「读屏 · 规则估算」）。

## 外部 API

无（只有同源的上面几个文件）。字体来自 Google Fonts（Inter / JetBrains Mono / Space Grotesk / Noto Sans SC），加载不到时回退系统字体。

## 结构

| 文件 | 一句话 |
|---|---|
| `src/head.html` `src/body.html` `src/styles.css` | 页面骨架、深浅两套颜色 token；静态文案的中文写在 `data-zh` 属性里 |
| `src/js/0-i18n.js` | `L(英, 中)` 取当前语言的文案 |
| `src/js/1-world.js` | 路口一带的世界模型（米，x 向东 y 向北）：街道、建筑、地标，2 m 地表分类 / 阴影 / 风影栅格 |
| `src/js/2-basemap.js` | 底图：正射影像（RGB / 近红外假彩色）预渲染，矢量街道图分浅色 / 深色 |
| `src/js/3-weather.js` | 天气图层：雷达 dBZ、SAR 淹没深度、雾、地表温度、风场；等值线、粒子流、闪电、鼠标取值 |
| `src/js/4-sim.js` | 多智能体仿真：IDM 跟驰、信号相位、行人放行、TTC 冲突检测、脚本化的 C-17 / D-42 / Bus 250 事件 |
| `src/js/5-app.js` | 视图、渲染管线、四步面板、图例、时间轴、主题和语言切换 |
| `src/js/6-engine.js` | 接引擎（T13）：连 `backend.js`、第 1 步方案表单、第 3 步路网涟漪、第 4 步顾问 + 前后对比、地图上的施工区 / 排队 / 绕行 / 变慢路段；开头 `pure:begin…pure:end` 是测试要跑的纯函数（坐标换算、选路段、拼方案） |
| `build.py` | 打包成 `public/index.html`（进仓库）和 `out/web-artifact.html`（不进仓库） |
| `tests/test_web.py` `tests/test_engine.py` `tests/engine_glue.mjs` | 上面「怎么测」的断言 |

## 本模块固定模式

- 🔒 所有颜色走 CSS token；canvas 在主题切换时重读 token（`readTokens()`），浅色主题自动换成浅色矢量底图
- 🔒 新文案一律写成 `L('English','中文')`；静态 HTML 用 `data-zh` / `data-zh-aria-label` / `data-zh-data-tip`
- 🔒 改了 `src/` 必须跑 `build.py`，否则 `test.sh` 第 1 条会红

## 已知问题

- 冲突数、急刹、TTC、公交、应急通道、安全分仍是微观仿真 / 预设值（引擎不算这些），页面标「模拟结果」；排队、延误、分流、顾问改法是引擎算的
- 真路网画在页面的理想化方格上：Queen…Exhibition × Bourke…La Trobe 之间误差 ≤ 1.4 m；La Trobe 以北页面把街区画高了（Little La Trobe 真实 55 m 画在 100、A'Beckett 109 m 画在 200），按分段线性拉伸
- 排队线按「施工起点往上游直线」画（CBD 方格路是直的），超出画面范围的用「→」标出
- 读屏现在是关键词规则（大模型读屏待 T5 接），参数里路人占比等是 T12 的低置信假设值，页面都标出来了
- 路口几何是简化的正交网格，不是测绘数据；道路方向按澳洲靠左行驶（西行车流在 La Trobe St 南侧）
- 手机上隐藏了鼠标取值条，图例默认折叠
