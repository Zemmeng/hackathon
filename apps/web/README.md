# web —— RippleTwin 网页面板：GIS 地图 + 极端天气 + 四步红队流程（中 / 英）
Owner: @unicornnnnnny

第 5 题（RPM Hire：临时交通设施数字工具）的展示网页。一个页面走完「方案 → 压力测试 → 涟漪追踪 → 修复」四步：

- **主路径（T13 起接引擎）**：在 CBD 真路网上放封道、写 VMS / 标志牌文字、选时段 → 引擎（`apps/engine` 的 `backend.js`）现算排队、分流、每类人的延误和理由 → 规则顾问给改法、引擎重算前后对比。第 1、3、4 步的这些数字都是引擎算的
- **第二层**：La Trobe × Swanston 路口的微观仿真 + 六种天气（晴 / 雷暴 / 内涝 / 浓雾 / 高温 / 大风）压力测试、冲突因果链、护栏改法的滑动对比。冲突数、安全分等仍是模拟 / 预设值，页面标「模拟结果」
- 引擎连不上（双击打开、只起了本模块的静态服务器、离线）时页面照常能用，显示预设数字并注明「引擎未连接」
- **地图上的楼是真的（T15）**：`/roads/public/cbd/buildings.json`（OSM + 墨尔本市政 2018 楼宇轮廓，约 395 栋落在画面里）换到页面方格上画，影像 / 近红外 / 矢量三种底图、楼影、高温和大风图层都按真轮廓算，大楼标真名；取不到这个文件时退回程序生成的随机街区，页面不会空白

## 怎么跑

- 带引擎（推荐）：起 `site`（全站同源，8790），开 http://localhost:8790/web/public/ ；或手动 `python3 -m http.server 8000 -d apps`，开 http://localhost:8000/web/public/ （从 `apps/` 起，路径和线上一样）
- 只看页面：`python3 -m http.server 4175 -d apps/web/public`，或双击 `public/index.html`，引擎连不上，显示预设数字
- 改了 `src/` 之后：`python3 apps/web/build.py` 重新生成 `public/index.html`（测试会检查两者一致；Mac 自带 python3 3.9 能跑）

## 怎么部署

线上由部署外壳 `apps/site`（T10）把各模块的 `public/` 挂到同一个网址，本页在 `<网址>/web/public/`，首页 `/` 会跳过来。只走 `bash scripts/deploy.sh all`（`DEPLOY_MODULES=site`），步骤见 `apps/site/README.md`。

- 本模块自己的 `wrangler.jsonc`（纯静态 assets）留着给单独发一份备用：`bash scripts/deploy.sh web`，但那份拿不到引擎，只有预设数字
- 本地核对配置不用登录：`cd apps/web && npm ci && npx wrangler deploy --dry-run`

## 怎么测

`bash apps/web/test.sh` —— 不开浏览器，三个文件：

- `tests/test_engine.py`（调 `node tests/engine_glue.mjs`，要 node ≥ 18）：`6-engine.js` 里 `pure:begin…pure:end` 那段纯函数——真路网坐标换到页面方格（主干路口误差 ≤ 3 m）、点街选路段（靠左行驶，点哪侧选哪个方向）、拼方案（契约 §施工方案，空 VMS 不发）——再把页面拼的方案交给真的 `backend.js` 跑：默认方案排队 > 0、加一帧 USE / RUSSELL ST 排队变短、超长的行被 check 拦下、全封、非施工时段、顾问给出更好的改法
- `tests/test_world.py`（调 `node tests/world_real.mjs`，要 node ≥ 18）：真建筑——U 形楼被街切成两块不留连桥、压进人行道的楼切到街边外 0.05 m（格心正好在街边线上的那格留给人行道）、整块在路面上的丢掉、切剩 < 1.5 m 宽的细条丢掉；Little La Trobe / A'Beckett 只在真路网有的那段切（`STREET_SPAN` 和 network.json 对得上），Swanston 以东 RMIT 那几栋不再被页面上多画的街切开（反向断言）；真数据落进画面 > 150 栋、La Trobe × Swanston 路口和 8 条街上（含边界线）没有楼也没有屋顶格、Little Lonsdale 北侧那排人行道格没被屋顶盖掉（反向断言）、人行道有楼影、楼后有风影、影子朝东南；州立图书馆 / Melbourne Central 用真名注记且落在楼上、不出「BUILDING 8」这种编号名、Melbourne Central 外框不按 211 m 画；坏数据不抛错一栋不画、程序生成的城市照旧
- `tests/test_web.py`：静态断言：打包产物与源码一致、体积 < 2MB、`import()` / `fetch()` 只用同源固定路径（`/engine/ /roads/ /params/ /api/`）、外部地址只有 Google Fonts、引擎连不上走 `BE.err` 并保留预设数字、T5 / 顾问的 `why` 只用 `textContent`、路名和报错进 HTML 前过 `esc()`、没有 key、四步和六种天气配置齐全、修复方案在每种天气下都比原方案好、方案 v2 的几何和文案对得上（护栏西移 8 m 等）、中英文案成对、兜底城市先同步建好再异步取 `buildings.json`（`catch` + `REAL_MIN`，最多等 1.2 s）、`geoToWorld` 只在异步回调里用、楼名只画在 canvas 上不进 HTML。最后一行 `N passed, M failed`。

浏览器里人工验过：桌面 1440×900 和手机 375px、深 / 浅主题、中 / 英、六种天气、四步流程（第 2 步 C-17 × D-42 严重冲突会自动触发，TTC 约 0.6 s）。

## 对外接口

只调 lead 的后端接线层（`docs/arch/T13-web-wiring-PRD.md`，契约 §施工方案 §evaluate），全部同源：

| 用到什么 | 怎么用 |
|---|---|
| `/engine/public/js/backend.js` | `import()` 后 `connect()` → `run / compare / advise / check / demo`；它自己再取 `/roads/public/cbd/network.json`、`flows.json`、`/params/public/params.json`，并加载 T5 的 `/api/public/js/reader.js`、`check.js` |
| `/engine/public/js/index.js` | 只用 `affected()` + `capFactors()` 取绕行路线经过的路段，画在地图上（和 `run()` 内部是同一个函数） |
| `/params/public/params.json` | 只读路人占比的区间和置信度，结果旁标「假设值」+ 区间（D-0929-1536） |
| `/roads/public/cbd/buildings.json` | T15：启动时 `fetch` 一次，`buildings[].footprint`（`[lat, lon]` 环）用 `geoToWorld` 换到页面方格，`height_m` 当楼高，`use` 定屋顶色调，`name` 做注记；左上角「建筑」一栏显示画出的栋数和出处（OSM · 墨尔本市政，ODbL / CC BY 要求署名）。失败 / 少于 `REAL_MIN`（50）栋 → 留着程序生成的城市 |

页面拼的方案：施工 id `W-1`，一个路段、`closes.lanes` = 1 或该路段车道数、工期 2026-10-05 → 10-09 每天 7–19 点，设备 VMS-1 / S-1 / A-1 / B-1。T5 读屏会 `POST /api/read`：api Worker 没接上时 site 回 503，读屏自动退回关键词规则（`flags.reading_src = 'rule'`，页面标「读屏 · 规则估算」）。

## 外部 API

无（只有同源的上面几个文件）。`buildings.json` 实测结构（2026-09-29）：顶层 `{version, area, bbox, generated, sources[3], assumptions, buildings[2508]}`，每栋 `{id, name|null, use, height_m, levels, height_src: com|default|osm_levels|osm_height, footprint: [[lat, lon], …], frontage}`；`assumptions.default_height_m` = 12 是没有高度时的缺省。字体来自 Google Fonts（Inter / JetBrains Mono / Space Grotesk / Noto Sans SC），加载不到时回退系统字体。

## 结构

| 文件 | 一句话 |
|---|---|
| `src/head.html` `src/body.html` `src/styles.css` | 页面骨架、深浅两套颜色 token；静态文案的中文写在 `data-zh` 属性里 |
| `src/js/0-i18n.js` | `L(英, 中)` 取当前语言的文案 |
| `src/js/1-world.js` | 路口一带的世界模型（米，x 向东 y 向北）：街道、建筑、地标，2 m 地表分类 / 阴影 / 风影栅格。`buildWorld()` 是程序生成的兜底城市（矩形楼）；`buildWorldReal(data, geoToWorld)` 把真轮廓换成多边形楼（`pts` + 包围盒 + 楼内标注点 `cx, cy`），`clipStreets()` 切掉压在街上的部分（切在街边外 `CLIP_EPS` = 0.05 m；Little La Trobe / A'Beckett 只切 `STREET_SPAN` 那段；丢掉 < `MIN_PIECE_W` 宽的细条）；`buildGrids()` 对多边形用扫描线栅格化、沿太阳 / 风向扫出楼影和风影 |
| `src/js/2-basemap.js` | 底图：正射影像（RGB / 近红外假彩色）预渲染，矢量街道图分浅色 / 深色。真楼按用途 + 高度着色（`roofRgb` / `vecRgb`），楼影是轮廓沿太阳方向拉伸后的并集（`extrudePath`）；楼名注记按面积排、互相压住的跳过 |
| `src/js/3-weather.js` | 天气图层：雷达 dBZ、SAR 淹没深度、雾、地表温度、风场；等值线、粒子流、闪电、鼠标取值 |
| `src/js/4-sim.js` | 多智能体仿真：IDM 跟驰、信号相位、行人放行、TTC 冲突检测、脚本化的 C-17 / D-42 / Bus 250 事件 |
| `src/js/5-app.js` | 视图、渲染管线、四步面板、图例、时间轴、主题和语言切换。`loadBuildings()` 取真建筑，分几个 task 先建好轮廓、栅格、当前底图的影像，最后 `rebuildWorld(nw, g, imgs)` 在一帧里换掉 `W / G / IMG`（`WX.rebind()` 重建天气栅格）；存下来的天气（如高温）的栅格只在 `start()` 里建一次 |
| `src/js/6-engine.js` | 接引擎（T13）：连 `backend.js`、第 1 步方案表单、第 3 步路网涟漪、第 4 步顾问 + 前后对比、地图上的施工区 / 排队 / 绕行 / 变慢路段；开头 `pure:begin…pure:end` 是测试要跑的纯函数（坐标换算、选路段、拼方案） |
| `src/js/8-compare.js` | T23（@jinmingq，D-0929-2011 ④）：第 4 步顾问下面的「方案对比 · 选一套」——T22 的 `be.options()` 按 RPM 库存配的 3 套（最省 / 标准 / 引导，引擎算好延误、租金、库存检查；拿不到时退回「现在的方案 + 顾问的改法」逐套 `run()`），并排比车延误 / 电车公交 / 行人 / 租金，标「最少」，库存不够、此时段不施工另起一行提示；选定 + 施工方 / 市政 + 理由，导出一页执行包（T5 的 `/api/public/js/pack.js`，打印 / 存 PDF / 复制）。开头 `pure:begin…pure:end` 是测试要跑的纯函数 |
| `src/js/9-ai.js` | AI 面板（lead，D-0929-2307）：第 3 步「AI 路人 · 各自读到了什么」——主路段上 4 类人各自看到的屏（按经过顺序，VMS 各帧用 ▸ 连）、看到 / 看懂 / 相信的条和区间、路线建议、一句理由（textContent）、来源（大模型 · 预先算好 / 缓存 / 现场 + 毫秒，规则 · 兜底）；下面可展开的「AI 调用日志（N）」列出这次打开页面以来每次读屏调用，可在浏览器里导出 JSON（不上传）。第 4 步方案卡片的 AI 解读归 T23（`8-compare.js`，#73），本文件不管。数据只来自 `backend.js` 的 `aiLog()` / `onAiLog()` / `readingsOf()`。开头 `pure:begin…pure:end` 是测试要跑的纯函数；`6-engine.js` 的读屏 pill / 图例也用这里的 `aiSrcLabel()` |
| `build.py` | 打包成 `public/index.html`（进仓库）和 `out/web-artifact.html`（不进仓库） |
| `tests/test_web.py` `tests/test_engine.py` `tests/engine_glue.mjs` | 上面「怎么测」的断言 |
| `tests/test_compare.py` `tests/compare_glue.mjs` | T23：`8-compare.js` 的纯函数（选哪几套、三个数、「最少」）+ 真 `backend.js` 顾问的改法逐套 `run()` + 真 `pack.js` 执行包（选了谁、理由、租金标假设值） |
| `tests/test_ai.py` `tests/ai_glue.mjs` | AI 面板：来源标签（中英）、屏上文字 / 建议 / 百分比、卡片和日志行全部转义（反向：why 不进 HTML、`<img>` 进不去）、下载的 JSON 只放白名单字段（反向：token / header 不进文件）、接真 `backend.js`（假读屏 file / llm / kv / 规则兜底）出 4 张卡片；静态：挂载钩子、不发请求、解读只用 textContent、签名守卫 |

## 本模块固定模式

- 🔒 所有颜色走 CSS token；canvas 在主题切换时重读 token（`readTokens()`），浅色主题自动换成浅色矢量底图
- 🔒 新文案一律写成 `L('English','中文')`；静态 HTML 用 `data-zh` / `data-zh-aria-label` / `data-zh-data-tip`
- 🔒 改了 `src/` 必须跑 `build.py`，否则 `test.sh` 第 1 条会红

## 已知问题

- T23 方案对比：对比的是 T22 `be.options()` 的 3 套；它出错（例如库存没加载上）才退回「现在的方案 + 顾问的改法」，错开日期那种改法不进对比（它按整个施工期算、不是这一小时）。车、电车公交、行人是这一小时的数，租金是整个工期（假设日租价）；T22 的租金和 `pack.js` 报价逐套一致（`compare_glue.mjs` 查）。理由只存在页面里（没接施工登记表，D-0929-2011 定了冻结前不接）
- 冲突数、急刹、TTC、公交、应急通道、安全分仍是微观仿真 / 预设值（引擎不算这些），页面标「模拟结果」；排队、延误、分流、顾问改法是引擎算的
- 真路网画在页面的理想化方格上：Queen…Exhibition × Bourke…La Trobe 之间误差 ≤ 1.4 m；La Trobe 以北页面把街区画高了（Little La Trobe 真实 55 m 画在 100、A'Beckett 109 m 画在 200），按分段线性拉伸
- 排队线按「施工起点往上游直线」画（CBD 方格路是直的），超出画面范围的用「→」标出
- 读屏现在是关键词规则（大模型读屏待 T5 接），参数里路人占比等是 T12 的低置信假设值，页面都标出来了
- 路口几何是简化的正交网格，不是测绘数据；道路方向按澳洲靠左行驶（西行车流在 La Trobe St 南侧）
- 手机上隐藏了鼠标取值条，图例默认折叠
- 真建筑（T15）：La Trobe 以北页面把街区拉高了，楼跟着拉长，Little La Trobe / A'Beckett 两边会空出几米到十几米的地；页面方格上没有的小巷和院子画成平铺地面（地表分类算「空地」）
- 页面方格把 Little La Trobe 和 A'Beckett 画满全宽，真路网里 Little La Trobe 只在 Elizabeth–Swanston 之间、A'Beckett 只在 Swanston 以西：真楼在多出来的那几段上照原样画（盖住路面），那几段不标街名，但楼缝里仍露出页面画的路面、地表分类里算路面 / 人行道。不画这几段是另一项活（要改 `STREETS` 和底图，不在 T15 里）
- 切楼的细条阈值 1.5 m（`MIN_PIECE_W`）是假设值
- 真建筑的屋顶反照率、屋顶设备、「历史建筑」归类（按名字里有 Library Victoria / Church / Cathedral / Gaol / Watch House）都是假设值，数据里没有；高温图层的「冷屋顶」标注因此只是示意
- 数据里有 4 个「外框」把一整片楼圈起来（如 Melbourne Central 外框带着 211 m 塔楼的高度）：里面的楼占外框 ≥ 30% 时外框改用里面楼高的中位数，塔楼本身不动
- 州立图书馆的穹顶、Melbourne Central 的玻璃锥和制弹塔仍是页面手摆的位置，只在落进对应真楼时保留；门前草坪按原样保留（楼画在上面）

## T23 AI 解读（#71 接口）

每套方案评分后调用 `explainOptions({lang, options})`，options 来自 `optionFromRun()` 并带引擎租金和天数。卡片显示 summary / pros / cons，下面显示 lean 与服务端固定 decide；全部用 textContent。切换语言重新解读，过期响应丢弃；读数不变的重绘不重复请求。接口断线或超时由 explain.js 回规则解读，页面标「规则兜底」。解读不阻塞选定、理由和导出。
