# web —— RippleTwin 网页面板：GIS 地图 + 极端天气 + 四步红队流程（中 / 英）
Owner: @unicornnnnnny

第 5 题（RPM Hire：临时交通设施数字工具）的展示网页。一个页面走完「方案 → 压力测试 → 涟漪追踪 → 修复」四步：地图上跑多类道路使用者仿真，切换六种天气（晴 / 雷暴 / 内涝 / 浓雾 / 高温 / 大风）看施工方案在哪种条件下失效，最后用滑动对比看 AI 修复方案。纯前端单文件，不需要后端，不花钱，所有数据是模拟的。

## 怎么跑

- 手动：`python3 -m http.server 4175 -d apps/web/public`，浏览器开 http://localhost:4175
- 也可以直接双击 `public/index.html`（单文件，不 fetch 任何数据）
- 改了 `src/` 之后：`python3 apps/web/build.py` 重新生成 `public/index.html`（测试会检查两者一致）

## 怎么测

`bash apps/web/test.sh` —— 不开浏览器的静态断言：打包产物与源码一致、体积 < 2MB、页面不向任何服务器发数据（只加载 Google Fonts）、没有 key、四步和六种天气配置齐全、修复方案在每种天气下都比原方案好、方案 v2 的几何和文案对得上（护栏西移 8 m 等）、中英文案成对。最后一行 `N passed, M failed`。

浏览器里人工验过：桌面 1440×900 和手机 375px、深 / 浅主题、中 / 英、六种天气、四步流程（第 2 步 C-17 × D-42 严重冲突会自动触发，TTC 约 0.6 s）。

## 对外接口

目前没有跨模块接口，引擎（`src/js/4-sim.js`）和 `apps/sim` 相互独立。以后接 `apps/roads` 的真实路网或 T4 的计算结果，走 `docs/contract.md`。

## 外部 API

无。字体来自 Google Fonts（Inter / JetBrains Mono / Space Grotesk / Noto Sans SC），加载不到时回退系统字体。

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
| `build.py` | 打包成 `public/index.html`（进仓库）和 `out/web-artifact.html`（不进仓库） |
| `tests/test_web.py` | 上面「怎么测」的断言 |

## 本模块固定模式

- 🔒 所有颜色走 CSS token；canvas 在主题切换时重读 token（`readTokens()`），浅色主题自动换成浅色矢量底图
- 🔒 新文案一律写成 `L('English','中文')`；静态 HTML 用 `data-zh` / `data-zh-aria-label` / `data-zh-data-tip`
- 🔒 改了 `src/` 必须跑 `build.py`，否则 `test.sh` 第 1 条会红

## 已知问题

- 数字（冲突数、安全分、延误）是模拟 / 预设值，页面上已标注「模拟结果」
- 路口几何是简化的正交网格，不是测绘数据；道路方向按澳洲靠左行驶（西行车流在 La Trobe St 南侧）
- 手机上隐藏了鼠标取值条，图例默认折叠
