# T27 地图放下整个 CBD（+ T28 / T26 收尾）—— 交接

## 1. 事实
- 做了什么：
  - **T28**（#79，lead 合）：引擎 `raw.links` 每条多给 `extra_min`（车·分钟，和同一小时不施工比，可 < 0）；`apps/engine/tests/extra.test.mjs` 7 条。
  - **T26**（#80，lead 合）：T20 收尾 7 条，见 PR 说明。
  - **T27 阶段 1**（#85，lead 合）：
    - 新文件 `apps/web/src/js/6c-city.js`：全城路网 + 建筑预渲染到离屏画布（明暗各一张），垫在精细窗口（`WORLD`）下面，接缝用细虚线框。
    - `CITY={x0:-1150,x1:750,y0:-950,y1:450}`：拖动、缩放下限（`cityMinS()`）、引擎线都按它。缩放 < 1 时天气、微观小人、经纬网、探针都隐藏，点地图不挪施工区。
    - 排队线沿同名路段按 `len_m` 画，街没了就停（默认方案画 544 m 到 Spring St），标签照写引擎的「排队 918 m · 画到 Spring St 为止」。
    - 比例尺按 `K_UPM=0.862`（1 m ≈ 0.862 页面单位）。
    - 变慢路段的筛选和红 / 黄只看 `extra_min`（#82）；地图上最堵路段标签的红色也改成看 `extra_min`。
    - 引擎标签避让（`5-app.js` `tagSpot` / `tagFlush`）：避开玻璃控件、施工段和彼此。375 px 第 3 步原来施工标签压在缩放按钮下、半截出屏。
    - 顺带 T26 审查两处：参数角标「T12（信任度是假设值）」；第 3 步小标题「影响 · 路网」，和步骤条一致。
    - 测试：新增 `apps/web/tests/test_t27.py`（39 条，其中 13 条是 `t27_glue.mjs` 在真路网、真引擎上跑的）。
- 停在哪（09-30 02:02）：T27 已合（`bad055d`）并部署上线，阶段 1 做完。
- 分支 / PR：#79、#80、#85 都已合并；这张交接单走 `unicornnnnnny/web/T27-handoff`。
- 部署（PRD 第 5 节）：
  - T28 + T26 那次由 lead 部署。
  - T27 这次由我部署：`bash scripts/deploy.sh all`，commit `bad055d`，2026-09-30 01:59 AEST，api + site。
  - 部署完的线上冒烟：
    ```
    $ bash scripts/check.sh --e2e https://hackathon-site.zemmmeng.workers.dev
    [E1] 首页 GET / ✅ 200，含 data-smoke
    [E2] 健康检查 GET /api/health ✅ {"ok":true,"v":"0.3.0","mock":false,"llm":{"mode":"llm","model":"deepseek-flash","key":true,...
    [E3] HTML 无 localhost ✅
    ======== 汇总 0 ❌ 0 ⚠️
    ```
- 验证：
  - 合并前：`bash apps/web/test.sh` → `356 passed, 0 failed`；`bash scripts/check.sh --quick` 无 ❌；#85 CI 绿。
  - 浏览器实测（数字见 #85 说明）：1440×900 和 375×812 取景；缩到最小画出 `CITY` 内 1,833 栋楼；六种天气；La Trobe 17:00、全封、T21 叠加各看一次。
  - 线上：`CITY`、全城层、实时引擎、「03 影响」、排队标签、T12 角标都在新版里。
- 尚未验证：
  - 帧率 ≥ 50 fps 还没在 Chrome DevTools 里测。应用内浏览器里：T27 拖动 44.5 fps，线上旧版 40.7 fps；关掉 `backdrop-filter` 后拖动全城 120 fps，每帧 JS 0.7–1.6 ms。所以上限来自玻璃合成，不是 T27。
  - Safari。
- 本次花了多少钱：0

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| `docs/3-tasks.md` | 顶部「线上版本」 | commit `bad055d`（#85 T27 地图放下整个 CBD）· 09-30 01:59 由 @unicornnnnnny 部署；线上冒烟 0 ❌；`/api/health` = `llm.mode llm`（deepseek-flash） |

## 3. 留给 lead
- 需要拍板（#85 里和 PRD 不一样的三处，已合，觉得不对我再改）：
  - `CITY` 北边 y 450（Franklin St），不是 350：La Trobe 17:00 的绕行走到 y 390–420。
  - `engFit` 框进占比 ≥ 1% 的绕行，不是 ≥ 5%：接上大模型读屏后，默认方案三条绕行只占 4.4–4.8%。
  - 全封时受影响公交线全画了，但不进取景（默认取景里能看到 63%，缩小一级全看到）。
- 风险：
  - 帧率：如果 Chrome 里也卡在 50 以下，要动的是 T14 的玻璃层（例如拖动时暂停折射），不在 T27。
- 需要别人配合：无
- 中途想到的别的事：
  - PRD 阶段 2（主街街名、全城视图里的「路口微观仿真」标记、T21 两处施工一起跑时的变慢路段）没做。冻结前还有时间的话可以派。
  - `apps/api/tests/workerd.test.mjs` 在 Windows 上路径出错（`.pathname` 带盘符），我每次部署都要临时挪开 `apps/api/node_modules`。修法两行（`fileURLToPath`），本地验过 28 passed，跨模块，等你同意再开 PR。

## 4. 下一步
- 下一个人要敲的第一条命令：`git switch main && git pull && bash apps/web/test.sh`
- dev server 的名字（launch.json）：`site`（wrangler dev，8790，看 `/web/public/`）
