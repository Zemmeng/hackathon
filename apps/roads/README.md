# roads —— CBD 真实路网和真实车流，整理成路网引擎能直接读的 JSON
Owner: @louisxie316-dotcom

任务 T3。**先读 `PRD.md`**：要交什么、文件格式、数据从哪来、验收标准、时间盒都在里面。

## 怎么跑

第一次：`python3 -m venv apps/roads/.venv && apps/roads/.venv/bin/pip install -r apps/roads/requirements.txt`（`.venv/` 已 gitignore）

```bash
python3 apps/roads/tools/fetch_scats.py --sites                  # 站点表 → raw/
apps/roads/.venv/bin/python apps/roads/tools/fetch_osm.py        # OSM 路网 + 电车轨道 → raw/（约 30 秒）
apps/roads/.venv/bin/python apps/roads/tools/build_network.py    # → public/cbd/network.json、signals.json（约 2 秒）
```

换街区：三条都加同一个 `--bbox 南,西,北,东`，`build_network.py` 再加 `--area <名>`。

- 先看数据长什么样：`python3 apps/roads/tools/fetch_scats.py --day 2026-09-22`（远程只抽一天 CBD 的 SCATS 数据，约 4.6 MB，存到 `apps/roads/raw/`）
- 站点表：`python3 apps/roads/tools/fetch_scats.py --sites`
- 某个路口的检测器配置表：`python3 apps/roads/tools/fetch_scats.py --sheet 2921`

## 怎么测

`bash apps/roads/test.sh`。`public/cbd/` 下的文件还没生成时只做骨架检查；文件一出现，PRD 第 7 节的校验自动生效。

## 对外接口

静态文件，格式见 `docs/contract.md`「路网数据文件」一节（和 `PRD.md` 第 5 节一致）。线上和本地都从 `/roads/public/cbd/<文件>` 读。

## 外部 API

不调接口，全是提前下载的公开数据，来源和坑见 `PRD.md` 第 6 节。不需要任何 key。

## 结构

| 文件 | 一句话 |
|---|---|
| `PRD.md` | T3 的需求说明 |
| `public/cbd/` | 生成的 `network.json`、`flows.json`、`signals.json` |
| `tools/fetch_scats.py` | 远程抽 SCATS 一天 / 站点表 / 单个路口配置表 |
| `tools/fetch_osm.py` | 拉 OSM 机动车路网（不简化）和电车轨道到 `raw/` |
| `tools/build_network.py` | 生成 `network.json` + `signals.json` |
| `requirements.txt` | 只有 osmnx（带 networkx、geopandas、shapely） |
| `tests/test_roads.py` | 三个文件的校验 |
| `raw/` | 原始数据（已 gitignore，不提交） |

## 本模块固定模式

- 区域用 `--bbox` 参数传，不写死
- 路段 id 从 OSM id 派生，重跑时保持稳定
- 目录别叫 `data/`（仓库 `.gitignore` 忽略所有 `data/`）

- OSMnx 2.x 的 bbox 是 `(西, 南, 东, 北)`，本仓库 `--bbox` 是 `南,西,北,东`，脚本里转换
- OSMnx 默认把 Overpass 缓存写到**当前目录**的 `cache/`，在仓库根跑会越界（`check [3]` ❌）→ `fetch_osm.py` 已固定到 `raw/osm_cache/`
- 车道、自行车道在**不简化**的图上逐段算好再简化（简化后标签会混成列表）；澳洲靠左，双向路正向看 `cycleway:left`、反向看 `cycleway:right`

## 已知问题

- 只保留最大强连通块：CBD 默认 bbox 简化后 904 个节点，裁掉 99 个 bbox 边上开不出去的（09-29 13:50）
- `speed_kmh` 是路段内多个限速按时间加权的等效速度（`len_m / t0_s`），不一定是整数
- 路段车道数取沿途最小值（瓶颈）；约 190 条路段没有街名（多是转弯匝道）
- 151 个信号灯站点里 27 个在 30 米内没有节点（17 个行人灯 POS、5 个闪黄灯、5 个路口 INT），`node` 为 `null`
- `flows.json` 还没做（下一步 `tools/build_flows.py`）
