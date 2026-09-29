# T28 + T26 + T27：引擎 extra_min + T20 收尾 + 地图放下整个 CBD（PRD）

> 负责人：@unicornnnnnny（高h）· 三单全归你 · 写于 2026-09-29 23:54，09-30 00:05 改（lead：T28 也给你），09-30 00:15 改（AI 面板已合 #76、已部署；第 2、4 节不用再等）
> 顺序和分支：
> 1. **T28** `unicornnnnnny/engine/T28-extra-min`（约 1h，第 0 节）：只改 `apps/engine`，先做它
> 2. **T26** `unicornnnnnny/web/T26-t20-tail`（约 1.5h，第 2 节）
> 3. **T27** `unicornnnnnny/web/T27-full-cbd`（阶段 1 约 5h，第 3 节，时间盒 09-30 22:00）
>
> 每单从最新的 `origin/main` 开，上一单合了再开下一单；T26、T27 都改 `apps/web`，**不要并行**
> 合并顺序：**#72（署名，✅ 已合）→ #76（AI 路人面板，✅ 09-30 00:0x 已合并已部署）→ T28 → T26 → T27**；T28 不碰 `apps/web`，随时可以合，但 T27 合并前 T28 必须已在 main。开工前先读第 4 节「和 lead 并行的改动」。另外 #73（T23 接入 AI 方案解读）也已合，改了 `8-compare.js`
> 依据：lead 原话「高h把我的评审意见都改完了吗」→ 核对结果见第 1 节；「我感觉可以放整个city」「不用你做 给高h写pr就可以」「结合上面的问题 然后汇总 push 上去」「直接把prd给高h吧 让他全部做完」。决定见 `docs/decisions.md` D-0929-2354、D-0930-0005
> 冻结：功能冻结 10-01 06:00。T27 只合做完的「阶段 1」，到 09-30 22:00 还没绿就不合、走兜底（第 3.4 节），别留半成品

## 0. T28 · 引擎给每条路段多给一个 `extra_min`（约 1h，最先做）

**为什么**：页面的「变慢路段」这一层现在是拿**自由流**比（`apps/engine/public/js/pipeline.js:213` 的 `delay_s = t − t0_s`；页面 `apps/web/src/js/6-engine.js:465-466` 按 `v·delay_s/60` 筛），不是拿**同一小时不施工**比。Flinders / King St 早 8 点本来就排 3,952 m，这段路在每个方案里都会被当成「施工造成的涟漪」画成红线。现在因为它在地图窗口外才没人看见；T27 把地图扩到整个 CBD 以后就会露出来。

**做法**：
- 分支：`git fetch origin && git switch -c unicornnnnnny/engine/T28-extra-min origin/main`（模块段写 `engine`，`check [3]` 才放你写 `apps/engine`）
- `apps/engine/public/js/pipeline.js` 约 212–215 行：`links.push({...})` 里多给 `extra_min: round1((x.v * x.t - bx.v * bx.t) / 60)`，就是下一行 `hot` 已经在算的那个数（车·分钟，和同一小时不施工时比）。负数照实给，不截成 0，页面自己决定怎么画
- 别的字段一个都不改、不删（`delay_s` 还有别处在用）
- 测试加在 `apps/engine/tests/`，照那里现有测试的写法：
  - 反向断言：Lonsdale 西行 08:00 封 1 道时，Flinders St / King St 那几段 `delay_s` 很大，但 `extra_min < 2`
  - 施工路段本身 `extra_min > 0`
  - 每条 `raw.links` 都有数值型的 `extra_min`
- **页面那侧不在 T28 里改**：`6-engine.js:466` 改用 `extra_min` 来筛，放在 T27 里做（第 3.2 节）
- 契约：`docs/contract.md` 是 lead 的独占区。你在 PR 的「要改的共享文件」里写「§引擎原始结果 raw.links 加 `extra_min`（车·分钟，和同一小时不施工时比，可 < 0）」，lead 落实
- `apps/engine/` 的代码归 lead（CODEOWNERS），**PR 由 lead 审过再合**，你不要自己合
- 验收：`bash apps/engine/test.sh` 全绿、`bash scripts/check.sh --quick` 无 ❌，贴汇总行

## 1. T20 核对结果（09-29 23:30，线上 = main `f3d4d95` 构建）

T20（#60）基本改完了：10 条里 7 条完全做到，3 条做了一半；后面的 #61、#62 没有把 T20 冲掉；`bash apps/web/test.sh` → `222 passed, 0 failed`。

| 条目 | 结论 |
|---|---|
| B1 安全分 / 查表结果表 · B2 假进度 / 变体 · B3「AI 红队」字样 · B4 天气标示意 · B5 默认晴天 | ✅ |
| 补充 ① 地图对准 Lonsdale | 🟡 桌面达标；375 px 和「回到施工区」按钮没达标 |
| 补充 ② 引擎数字默认展开 | 🟡 已展开；1440×900 下 VMS 输入框要滚动才能改 |
| 补充 ③ 单位 | ✅ |
| 补充 ④ 一个施工、一个时间 | ✅ 地图只剩一个施工区；顶栏场景名漏了 |
| 补充 ⑤ 假设亮出来 | 🟡 需求 vs 通行能力做了；「53%」说法不对、没有区间 |

T20 在 `docs/3-tasks.md` 你那节还是「🔨 待 review」：review 就是这份，T26 开工时顺手改成 ✅（#60）。
逐条证据（文件:行号）：lead 本机 `.claude/agent-out/t20-*.md`（没进 git，要看找 lead）。

**背景变了：大模型已经接上线**（D-0929-2307，#70 读屏、#71 AI 解读）。读屏和 AI 解读现在都是真的 DeepSeek，不再是关键词规则。所以：
- 下文引用的 918 m、14% → 61%、53% 是 09-29 23:30 规则读屏下的线上数。换成大模型读数后（lead 09-29 23:25 用 `connect()` 实测）：Lonsdale 8 点只写 ROADWORK AHEAD 仍是 918 m / 10,493 车·分；加 USE RUSSELL ST 是 538 m / 5,629（−46%）；公交乘客 18,693 → 10,991（−41%）；引导方案 79 m / 937。**截图验收一律以页面当时的数为准**，别把本文的数写死进文案或测试
- 读屏角标 / 图例已经由 AI 路人面板（#76）改成友好名字（LLM · precomputed / cached / live，Rules · fallback），按这套方案 4 类路人的实际读数汇总（`9-ai.js` 的 `aiPlanSrc()`）。T26 改徽章、图例旁边的字时保留 `aiPlanSrc` / `aiSrcLabel` 这两个调用

## 2. T26 · T20 收尾（约 1.5h，先做）

每条都有验收。行号是 main `954842a` 上的；AI 面板（#76）合进来以后已经变了，按函数名找。

**开工顺序**：AI 面板已在 main（#76），2.1–2.7 全部可以做，不用再分组等。

### 2.1 顶栏场景名还写着 La Trobe
- 现象：1440 宽（演示投影的宽度）下，Lonsdale 方案的顶栏写「场景 Swanston St × La Trobe St · 墨尔本 CBD」
- 位置：`src/body.html:7` 写死；canvas 的 `aria-label`（`body.html:34`）也写死
- 改法：`microOn()` 为真时照旧；否则显示当前施工的街名（`EP.street` + 方向 + 小时），例如「Lonsdale St 西行 · 08:00 · 墨尔本 CBD」。中英都要
- 验收：1440×900 第 1、3、4 步截图里没有「La Trobe」字样（第 3 步「路口回放」页签除外；引擎算出来的变慢路段标签如「LA TROBE ST +15 车·分钟」是真结果，保留）

### 2.2「回到施工区」按钮飞回 La Trobe
- 现象：`#zoomHome`（`aria-label` 是「回到施工区」）点下去飞到 `HOME={cx:-22,cy:-6,s:3.6}`，就是 La Trobe × Swanston 路口
- 位置：`src/js/5-app.js:458`、`:45`
- 改法：`microOn()` 为假时调 `engFly()`，为真时才飞 `HOME`
- 验收：第 1、3、4 步把地图拖走，点这个按钮，回到 Lonsdale 施工区和排队线

### 2.3 1440×900 第 1 步改 VMS 字要滚动
- 现象：简洁视图第 1 步，面板可视区到 876 px，VMS 输入框在 827–923 px，只露出上面约 50 px（线上实测）。你交接单写的「不用滚动」和实测对不上
- 改法（二选一）：把 VMS 输入框挪到引擎数字上面紧贴；或者压缩引擎那一节（`6-engine.js` 的 `engWhy` / `engImpacts` / `engBadges`，约 `:237`），例如假设灰字在简洁视图收成一行、点开看全文
- 验收：1440×900，中英文各一次，简洁视图第 1 步不滚动就能同时看到 4 个大数字和完整的 VMS 输入框；改一个字，数字当场跳

### 2.4 手机 375 px 取景
- 现象：第 3 步施工区贴在天气图例上沿，标签「W-1 · LONSDALE ST 西行 · 封 1 道」被图例盖住一半；≥ 5% 的绕行（Russell）有一截落在底部图例带里
- 原因：`setView()`（`5-app.js:40-42`）按 WORLD 边界夹中心，不认 `engFit()`（`6-engine.js:417-428`）给手机留的上 96 / 下 104 px；Lonsdale 离 WORLD 南缘太近，夹完就贴底了。桌面上 `engFit()` 也没给左下图例（默认展开、带 `glass`）留位置
- 改法：**T27 把 WORLD 扩到整个 CBD 后，Lonsdale 不再贴边，这条大部分会自己消失**。所以 T26 里只做：图例在引擎步骤默认折起（手机和桌面都是），`engFit()` 把图例高度算进下边留白。T27 做完再复测一次
- 验收：375×812 第 3 步，施工区标签完整可见；1440×900 第 3 步，绕行线不压在图例下

### 2.5 假设那两行说清楚（补充 ⑤ 的后半）
- 「约 53% 的司机读懂并照标志 / 屏走」说错了：53% 是 `engInformed()`（`6-engine.js:203`）算的**读懂屏的比例**，不是照做的比例。屏上只写 ROADWORK AHEAD、根本没叫人绕行时也是 53%；评委会追问「53% 照做，为什么只有 14% 绕行」
  - 改成：「约 53% 的司机读懂屏上的字；改不改道由路线选择模型按各类司机的参数算，这次 14% 绕行」（`6-engine.js:207`，中英都改）
- 遵从假设没有出处：T12 的 `sign_trust` 是 `null`、`confidence: none`。按 D-0929-1536，这个数旁边标「假设值」，不要写「按 T12 参数算」；`params.json` 取不到时（`flags.params==='default'`）也不能写「T12 参数」
- 第 4 步「绕行的车 14% → 61%」固定标绿（`6-engine.js:370` 的 `row(...,true)`）：改成中性色，它是假设带来的变化，不是已证实的收益
- 同一块面板上「每车多等 · 513 辆/时」和「施工段 1,072 辆/时」并排、没说口径：给 513 那个加上是谁的车（主进口道），或者只留一个
- （可选，有时间再做）区间：「如果只有一半的人照做：绕行约 X%、排队约 Y m」。要引擎能调遵从率，先问 lead 引擎有没有这个参数，没有就不做，别在页面里自己算
- 验收：中英文第 1、3、4 步都不再出现「照标志 / 屏走」「act on the signs」；「绕行的车」一行不是绿色；全封（`EP.all`）时也有一行说明排队从哪来（现在 `cap=0` 时整行被守卫去掉，`6-engine.js:206`）

### 2.6 剩下几处名不副实的字（评委稿里提过）
| 位置 | 现在 | 改成 |
|---|---|---|
| `body.html:10-12` 步骤条 | 02 压力测试 / 03 涟漪追踪 / 04 修复（Stress test / Ripple trace / Repair） | 02 路口仿真 / 03 影响 / 04 改进（Junction sim / Impact / Improve）；第 2 步面板标题你已经改叫「路口微观仿真」，步骤条没跟上 |
| `5-app.js:310` 路口回放页签的按钮 | 生成更安全的方案 → | 看改过的布局 →（v2 是预设布局，不是生成的） |
| `5-app.js:306`、`:379` | 涉及的智能体 / 对智能体的影响 | 涉及的道路使用者 / 对道路使用者的影响（「智能体」会让人以为用了 AI） |

### 2.7 测试
- `tests/test_t20.py` 的 B3 反向断言加上 `seed 4218`、`随机种子`、`行为变体`、`behaviour variations`
- 新增 `tests/test_t26.py`，每条上面的约束至少一条断言，其中反向断言：`body.html` 的 `.scene-name` 不能写死 La Trobe；`#zoomHome` 的点击不能只飞 `HOME`；文案里不能有「照标志 / 屏走」；「绕行的车」那一行不能传 `better=true`
- 验收：`bash apps/web/test.sh` 全绿、`bash scripts/check.sh --quick` 无 ❌，贴汇总行；1440×900 和 375 px 截图自己看过

## 3. T27 · 地图放下整个 CBD（阶段 1 约 5h，T26 合完再做）

### 3.1 现在是什么样，为什么
- **数据是全的**：`apps/roads/public/cbd/` 的 `network.json`（805 节点 / 1,513 路段）、`buildings.json`（2,508 栋）、`walk` / `peds` / `transit` 都覆盖 lat −37.8235..−37.806、lon 144.948..144.976，也就是整个 Hoddle Grid（Spencer–Spring × Flinders–La Trobe）再往外 300–600 m。方格网里按 200 m 分格，没有一格是 0 栋楼
- **页面只截了一小块**：`WORLD={x0:-320,x1:320,y0:-300,y1:300}`（`src/js/1-world.js:61`），约占数据范围的 8%，所以只显示 395 栋。`setView` / `flyTo` / `zoomAt` 把视图夹在 WORLD 里，缩放下限写死 1.1（`5-app.js:40`、`:43`、`:474`）
- **这让引擎的结果画不全**（lead 用 node 在真路网上实测，默认方案 Lonsdale 西行 08:00 封 1 道）：
  - 排队 918 m 只画了 184 m（`engWorldReach()`，`6-engine.js:498`）
  - 绕行线 2,626 m 里 37% 在窗外；La Trobe 17:00 方案 70% 在外；全封时受影响的公交电车线 82% 在外
  - 窗外的绕行标签、最堵路段标签直接不画（`6-engine.js:493-494`）
  - 能点来挪施工区的路段只有 227 / 1,513 条（`engCands()`，`6-engine.js:120`）
  - T20 补充 ① 的验收「排队线、绕行线完整可见」做不到，根子就在这里
- **页面单位不是米**：`geoToWorld()`（`6-engine.js:13`）把真实 1 m 画成约 0.863 个页面单位，比例尺（`5-app.js:165-170`）偏了约 14%。缩到全城以后评委可能会拿比例尺量

### 3.2 做法：精细窗口不动，外面加一层全城
**不动**：`WORLD` 本身、`geoToWorld()`、`buildWorldReal()`、天气网格、路口微观仿真、正射影像画布。它们还是只管原来那块。原因：
- 把 WORLD 直接改大，影像画布要 110–119 Mpx（iOS 建不出来），天气网格每次重算的开销变成 19 倍（雷暴那一帧约 31 ms），合成的 8 条街和地块会把 Bourke、Collins 等真街盖住。这个方案估 14–22 h，冻结前做不完
- 让窗口跟着施工走也不行：要先做上一条的「按路网生成街道」，每换一次路段都要重建网格

**范围**：只到 Hoddle Grid 往外约 150 m（页面坐标约 x −1150..750、y −950..350，是 lead 算的，动手前自己用 `geoToWorld()` 复核一遍）。不要用整个数据 bbox：
- `geoToWorld()` 在 La Trobe 以北按 1.85 倍拉伸（`6-engine.js:13-14`），往北画太远形状会歪
- bbox 边上 Crown、St Patrick's 一带的楼被整栋丢了（`apps/roads/tools/fetch_buildings.py:205`），画进来会看到空洞

新加一个常量 `CITY` 表示这个范围，只管三件事：能拖到哪、能缩到多小、引擎线画到哪。

**阶段 1（必做，约 5h）**

1. **全城层**：新文件 `src/js/6c-city.js`（`build.py` 按文件名排序，会排在 `6-engine.js` 后面）。把全城**预渲染到一张离屏画布**，明暗主题各一张：
   - `network.json` 路段描成灰色路面，跳过步道。有 411 对路段首尾互反（同一条双向街的中线），描之前先两两配对去重
   - `buildings.json` 画平的轮廓，不挤出、不描边
   - 预渲染是必须的：线上实测全城整张重画一次 46 ms，拖动时每帧都会重画（`renderBase`，`5-app.js:69-70`）；贴一次缓存图只要 1.7 ms
2. **底图叠法**：`renderBase` 先贴全城层，再画原来的精细窗口（裁进 WORLD）。两层之间会有一道接缝，默认 Lonsdale 取景里就看得到（Exhibition St、Spring St 都在窗外）。接缝怎么处理（渐隐、描边或别的）**你定**，定了在 PR 里放截图
3. **放开视图**：`setView` / `flyTo` / `zoomAt` 三处的缩放下限 1.1 改成「刚好装下 CITY」（桌面约 0.35–0.5），平移范围夹到 CITY。缩放小于 1 时：
   - 隐藏天气、微观仿真的小人和事件、经纬网、度分秒刻度、经纬度探针。`toLL()` 本来就偏了 120–229 m（`1-world.js:62-64`），缩小了只会更显眼
   - 禁止点地图挪施工区：点选容差 `max(9,14/V.s)`（`6-engine.js:517`）在 s=0.2 时是 70 个单位，一定点错
4. **引擎线画全**：`6-engine.js` 里引擎叠加层用的 `WORLD` 换成 `CITY`，包括 `engCands`（:120）、`engFit`（:418、:425 的缩放下限）、标签剔除（:493-494）、`engWorldReach` / `engVisible`（:498-501）。`engFit` 的缩放下限跟着放开，占比 ≥ 5% 的绕行都要框进来
5. **排队线沿真路画**：现在 `engUp()`（`6-engine.js:435`）是沿施工路段方向直线往回推，放开以后会推出路网（Lonsdale 往东推到 x≈1054，路网最东的 Spring St 在 x≈892）。改成从施工路段往上游找同名路段、按 `len_m` 累加，到路网边上或者长度够了就停。
   - 注意：引擎的排队是施工那一段上的点排队（`apps/engine/public/js/assign.js:43`），不会往上游路口传。默认方案施工点以东到 Spring St 只有约 544 m，放不下 918 m
   - **线画到哪算哪，不许拉长编出来**；标签照写引擎的数（「排队 918 m」），再加一句说明，例如「画到 Spring St 为止」
   - `tests/test_t20.py:69` 钉死了 `engUp(Math.min(s.queue_m,engWorldReach()))` 这段原文，改完要同步改这条断言
6. **比例尺**：按 1 m ≈ 0.863 页面单位修正（`5-app.js:165-170`），全城和路口两种缩放下都对

7. **变慢路段改用 `extra_min` 筛**（引擎那侧你在 T28 里已经做了）：`6-engine.js:465-466` 现在按 `(l.v||0)*(l.delay_s||0)/60` 筛，改成按 `l.extra_min`（≥ 2 才画，红 / 黄的阈值照旧）。**同时去掉两处 `queue_m>0`**：筛选条件里的 `!(l.queue_m>0)` 和红色判断 `sev = l.queue_m>0 ? 2 …` 都要换成看 `extra_min`——`queue_m` 是绝对值，Flinders / King St 平时就有约 3,950 m 排队、`extra_min` 为 0，只换 `ex` 不去掉这两处，它们仍会被画红（09-30 审查 #79 实测）；施工路段自己的排队线另外画，不受影响。这样 Flinders / King St 本来就有的排队不会在每个方案里被画成施工涟漪。**T28 没进 main 之前，T27 不合**

**阶段 2（可选，阶段 1 合了还有时间再做）**
- 全城层上给约 15 条主街写街名（`drawLabels` 现在只画楼名，`2-basemap.js:199` 起）
- 全城视图里在 La Trobe × Swanston 放一个「路口微观仿真」标记，点了飞到 `HOME`
- 叠加冲突（T21）两处施工一起跑时的变慢路段（92–95% 在窗外，现在页面没画）

**不做**：直接把 WORLD 改大；窗口跟着施工走；扩到 Docklands / Southbank / Carlton（数据要重拉，`walk.json` / `peds.json` 已经贴着 2 MB 上限）；City of Melbourne 全区。后两样写进 pitch 的「下一步」。

### 3.3 验收
- 1440×900 第 1 步和第 3 步，默认 Lonsdale 方案：地图框住施工区、排队线，以及 Russell / Exhibition / Spring 三条绕行，全部在玻璃面板外，没有一条被截在窗口边上
- 缩到最小能看到整个 Hoddle Grid 和 1,400 栋以上的楼；拖动全城时 DevTools Performance ≥ 50 fps
- 375×812：同上两条都成立，不横向滚动；缩放小于 1 时点地图，施工区不动
- 六种天气各点一遍：只出现在原来那块窗口里，缩小时隐藏，不报错
- 切到 La Trobe 17:00 方案、全封方案、T21 叠加各看一次，绕行线和受影响公交线都画全
- 反向断言（新建 `tests/test_t27.py`）：
  - Lonsdale 方案下不画 Flinders / King St 的背景排队（用 T28 的 `extra_min`）
  - 排队线的长度不超过它经过的真实路段长度之和
  - 缩放小于 1 时 `engCands` 不接受点选
  - 天气、微观仿真的网格仍按 `WORLD` 建，不按 `CITY`
- `bash apps/web/test.sh` 全绿、`bash scripts/check.sh --quick` 无 ❌ 并贴汇总行；桌面和 375 px 截图放进 PR

### 3.4 时间盒和兜底
- 时间盒：**09-30 22:00 前 PR 要绿**（check 无 ❌，两张截图过了），给冻结前留出修 bug 和部署的时间
- 到点没绿，T27 不合；兜底是 lead 用 node 离线画一张「全 CBD 影响」静态图，放进 pitch。T28 不管 T27 合不合都要合
- 阶段 1 超过 5h 还没做完，先停下来找 lead，不要自己砍验收

## 4. 和 lead 并行的改动（先合谁、别动哪里）

### 4.1 AI 路人面板已经合进 main（#76，09-30 00:0x，已部署）
改了这些（T26、T27 在这些地方旁边改字可以，别删别挪）：

| 文件 | 改了什么 |
|---|---|
| `apps/web/src/js/9-ai.js`（新） | 第 3 步「AI road users · what each one read」：4 张路人卡片 + 可展开的「AI call log」+ 下载 JSON；`aiPlanSrc()` / `aiSrcLabel()` 给读屏角标用 |
| `apps/web/src/js/5-app.js` | 第 3 步渲染里那一行 `clashMount();aiMount();` |
| `apps/web/src/js/6-engine.js` | `engBadges(f,s)` 的读屏角标和第 3 步图例改用 `aiPlanSrc` / `aiSrcLabel` |
| `apps/engine/public/js/backend.js` | `be.aiLog()` / `be.onAiLog()` / `be.readingsOf()` / `be.lastReadings()` |

第 4 步方案卡片下面的 AI 解读是 T23（#73，`8-compare.js`），不是 AI 面板。

### 4.2 合并顺序
**#72 ✅ → #76 ✅ → T28 → T26 → T27**，每一步都等上一步进了 main 再开下一个分支。

T26 开工：
```bash
git fetch origin && git switch -c unicornnnnnny/web/T26-t20-tail origin/main
```
T27 开工同理：T26 合完、从最新的 `origin/main` 开 `unicornnnnnny/web/T27-full-cbd`。

### 4.3 别动哪里
- **不要重排第 3 步面板的结构，也不要重排第 4 步的方案卡片**（`8-compare.js`）：AI 路人卡片和 AI 解读挂在这两处。改按钮、标题的字可以（例如 2.6 那几行），挪区块、改 DOM 层级不行
- T27 改地图取景和绘制时，保留 `5-app.js` 里 `clashMount();aiMount();` 那一行，不要删也不要挪出第 3 步的渲染分支（`apps/web/tests/test_ai.py` 会查）
- `6-engine.js` 里读屏角标 / 图例用 `aiPlanSrc` / `aiSrcLabel`，T26、T27 保留这两个调用

### 4.4 冲突了怎么办
- `apps/web/public/index.html` **不手改、不手动解冲突**：`git merge origin/main` 以后直接跑 `python3 apps/web/build.py` 重新生成，再 `git add apps/web/public/index.html`
- `apps/web/tests/test_web.py` 两边都加了断言时，**两边的都保留**，不删任何一条
- `src/` 里的冲突按函数看：AI 面板加的调用和你的改动都留；拿不准就停下来找 lead

### 4.5 部署
部署人是你（D-0929-1322）。AI 面板、#72、#73 已由 lead 在 09-30 00:1x 备份部署上线（b4bc2c6）。**T28 和 T26 都进了 main 以后，一次** `bash scripts/deploy.sh all`，别每合一个部署一次。T27 合完再部署一次。部署完跑 `bash scripts/check.sh --e2e`，把汇总行贴进交接单。
