# T14 网页改液态玻璃 —— 交接

## 1. 事实
- 做了什么：
  - 桌面（≥ 821px）地图铺满整个窗口；顶栏、图层栏、分析面板、时间轴都改成浮在地图上的玻璃块。`.app` 上的 `--safe-t/b/l/r` 记录玻璃挡住了多少地图，`js/7-glass.js` 的 `readInsets()` 读这几个值，`flyTo` / 比例尺 / 经纬网注记 / 告警卡 / 第 4 步分割线都只在剩下的地图范围里摆。
  - 真折射只挂在分析面板和顶栏两块上（PRD：1–2 块）。做法改写自 liquid-glass.js（Deepika Rao，github.com/sven1577/liquid-glass，MIT，署名写在 `7-glass.js` 文件头）：canvas 画位移图，经 `backdrop-filter:url(#lg-n)` 跑三次错位的 `feDisplacementMap`。只在 Chromium 桌面上挂；Safari / Firefox / 手机 / 减少透明度时只用 CSS 磨砂。
  - 右侧面板精简：
    - 默认「简洁」：藏起 `p.muted` 说明文字，次要分节折叠在标题后面（点标题或按 Enter 展开）。数字、输入框、方案卡默认展开。
    - 「详细」一键全开。
    - 右上角按钮可以收起整个面板；收起后右边缘出现竖排的「分析面板」按钮，点它恢复。选择记在 localStorage 的 `rt-panel` / `rt-pmin`。
  - 道路比建筑清楚（09-29 需求）：`emphasizeRoads()` 在 `renderBase()` 里每次视图变化跑一次（不是每帧），把屋顶压向地面色调，给车行道提亮并描路沿。建筑和引擎数据没动。
  - 配色：主操作色换成 Codex 那版的橙色（`--sun`），用在当前步骤、图层按钮和底图按钮上；玻璃底色不透明度 ≥ 0.72。
  - 新增 `tests/test_glass.py`，22 条，覆盖：降级、署名、折射块数、`--safe-*`、中英文、键盘操作、`emphasizeRoads` 不在每帧里跑。
- 停在哪（09-29 19:05）：功能做完，等 review。
- 分支 / PR：`unicornnnnnny/web/T14-liquid-glass`（PR 待开）
- 验证：
  - `bash apps/web/test.sh` → `143 passed, 0 failed`
  - `bash scripts/check.sh --quick` → `======== 汇总 0 ❌ 0 ⚠️`
  - 浏览器里看过：1440×900 深色 / 浅色 × 第 1、2、3、4 步；375×812 深色，无横向滚动；中英切换；面板收起 / 展开。
- 尚未验证：
  - 第 2 步的真实帧率：预览窗口被隐藏时 rAF 不跑，量不了。JS 每帧约 0.3 ms，道路强调每次重画底图约 0.5 ms，但玻璃合成的 GPU 开销得在可见的浏览器里看。
  - Safari / Firefox 实机没看，按设计应该走磨砂。
  - 375 浅色和第 3、4 步手机版没截图。
- 本次花了多少钱：0

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| — | — | 无 |

## 3. 留给 lead
- 已定（09-29 19:15，@unicornnnnnny）：
  - 操作色统一成橙色 `--sun`：主按钮、播放键、选中的 chips / 倍速 / 语言 / 主题、进度条、面板分节标题都改了。青绿只留在「更好 / 修复后」的数字、安全分、v2 标签和地图叠加层上。浅色主题下橙色文字用更深的 `--sun-ink`（#A35A00），保证对比度。
  - 玻璃改得更透，像 Apple 那样（09-29 19:40，@unicornnnnnny 要求）：
    - 常规玻璃底色不透明度约 0.40（PRD 建议是 ≥ 0.72，这里偏离了；PRD 的硬要求「对比度 ≥ 4.5」仍满足）。
    - 文字清晰靠 `--glass-tone`：深色主题把背后地图压暗到 0.5 倍，浅色主题提亮。
    - 随背景自适应：浅色主题叠在影像 / 近红外底图或高温图层上时，玻璃变成 0.72 的奶白色并加强提亮；深色主题遇到浓雾压到 0.33 倍。
    - `<html>` 上的 `data-bm` / `data-wx` 由 `5-app.js` 的 `updateBasemapUI()` / `setWeather()` 写入。
    - 实测方法：把地图各层 canvas 合成后，按模糊半径取块均值，再套上压暗 / 提亮、底色、高光、卡片。测了 3 种底图 × 6 种天气 × 深浅两套，最小字 `--fg-3` 的最坏值：深色 4.50，浅色 4.57。
- 需要拍板：
  - 面板默认「简洁」，@unicornnnnnny 先看效果再定。
  - 浅色主题 + 影像底图时玻璃比较白（为了保住对比度）。如果嫌不透，只能把小字调大或加粗，不能再降不透明度。
- 风险：
  - `backdrop-filter:url()` 在低端集显上可能掉帧。真掉帧的话，把 `7-glass.js` 的 `applyGlass()` 里顶栏那块去掉，只留面板。
- 需要别人配合：无
- 中途想到的别的事：Codex 那份 `rippletwin-liquid-glass.html` 是旧的独立版（没接引擎）。这次在仓库最新的 `apps/web` 上改，没在它上面改。

## 4. 下一步
- 下一个人要敲的第一条命令：`python apps/web/build.py && bash apps/web/test.sh`
- dev server 的名字（launch.json）：`site`（wrangler dev，8790，看 `/web/public/`）
