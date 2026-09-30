# T31 真实天气回测 —— 交接

## 1. 事实
- 做了什么：阶段 1 完成。`tools/fetch_weather.py`（Open-Meteo `ecmwf_ifs` 逐小时 → `public/cbd/weather_hourly.json`，1,392 小时 = 58 天 × 24）、`tools/backtest_weather.py`（→ `public/cbd/weather_backtest.json`）、`tests/test_weather.py`（22 条，含 PRD §6 全部反向断言）、README「天气回测」一节
- 停在哪（09-30 10:28）：阶段 1 交完；阶段 2（拉长到 2025 年补高温 / 大风 / 大雨）没开始
- 分支 / PR：`louisxie316-dotcom/roads/T31-weather-backtest`（PR 待开）
- 验证：`bash apps/roads/test.sh` → `78 passed, 0 failed`；`bash scripts/check.sh --quick` → `======== 汇总 0 ❌ 1 ⚠️`（⚠️ 是别人的交接单超过 19 小时没落账）
- 尚未验证：Open-Meteo「T 的降水是前一小时累计」只按文档用；拿自行车雨天效应核，T = h / h+1 / h+2 差别在区间内，核不出来
- 本次花了多少钱：0（Open-Meteo 免费、不要 key；BoM 两个 CSV 由 @louisxie316-dotcom 用浏览器手动下，放 `raw/`，没提交）

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| `apps/web/src/js/4-sim.js` | `WXP.storm.rate`（:16，现 .9，车 / 自行车 / 行人共用） | 建议按交通方式拆开：车 1.0（实测 0.998 [0.985, 1.015]）、自行车约 0.95（实测 0.924–0.965，方法对自行车偏低约 3%）、行人约 0.85（小雨 0.875 [0.813, 0.933]），大雨行人 0.7（≥ 1 mm/h 0.681 [0.50, 0.91]）。拆不开就维持 .9 并保留「示意」 |
| 同上 | `WXP.storm.T`（:16，现 1.4 → 通行能力 ×0.71） | 实测饱和进口早高峰最大 15 分钟流量 ×0.979 [0.971, 0.986]（上限）→ T 约 1.02；文献信号灯饱和流率 −2..−21%，取 1.1 也说得过去；1.4 太强 |
| 同上 | `WXP.fog.rate`（:18，现 .85） | 8 周里没看到雾天流量下降（车 1.03，仅模型能见度，多在无风晴冷的早上），建议维持并标「示意 / 仅模型」 |
| 同上 | `WXP.flood` / `heat` / `wind` | 这 8 周没有样本（≥ 4 mm/h 只有半夜 2 小时；最高 28.5 °C；BoM 最大阵风 59 km/h），不改，保留「示意」；阶段 2 拉长窗口才能测 |
| 页面上的「示意」标注（D-0929-2012） | 雨天那一档 | 如果按上面改了 storm 的 rate / T，可以改成「车流、行人按 2026 年 8–9 月实测校准（Open-Meteo + BoM + SCATS）」；其余天气继续「示意」 |

## 3. 留给 lead
- 需要拍板：冻结前改不改页面 `WXP`（上表）；阶段 2 做不做
- 风险：只有 8 周、13 个 BoM 核过的雨天、4 个 ≥ 1 mm/h 的雨天；自行车只有 2921 一个路口；安慰剂对自行车区间覆盖 80%（车 96%、行人 92%）
- 需要别人配合：无
- 中途想到的别的事：PRD 写 1,344 行，实际 08-01..09-27 是 58 天 = 1,392 小时；08-25 的 15.8 mm 是 08-25 早上 9 点前下的，下午模型报的雨 BoM 只有 0.8 mm

## 4. 下一步
- 下一个人要敲的第一条命令：`python3 apps/roads/tools/backtest_weather.py && bash apps/roads/test.sh`（前置见 README「天气回测」）
- dev server 的名字（launch.json）：无
