# roads —— CBD 真实路网和真实车流，整理成路网引擎能直接读的 JSON
Owner: @louisxie316-dotcom

任务 T3。**先读 `PRD.md`**：要交什么、文件格式、数据从哪来、验收标准、时间盒都在里面。

## 怎么跑

（T3 完成后补：一条命令从原始数据重新生成 `public/cbd/` 下的三个文件）

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
| `tests/test_roads.py` | 三个文件的校验 |
| `raw/` | 原始数据（已 gitignore，不提交） |

## 本模块固定模式

- 区域用 `--bbox` 参数传，不写死
- 路段 id 从 OSM id 派生，重跑时保持稳定
- 目录别叫 `data/`（仓库 `.gitignore` 忽略所有 `data/`）

## 已知问题

（T3 进行中补）
