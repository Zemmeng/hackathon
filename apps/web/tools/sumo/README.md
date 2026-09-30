# 四路口 SUMO 后端

用户最终确认范围：**2×2 四路口；不能修改前端**。本目录提供原生 SUMO 计算、HTTP 接口、完整轨迹与诊断，不改 `src/`、`public/` 或现有 CBD 引擎契约。前端尚未接线，原网页行为保持原状。

## 启动

从仓库根目录执行；Python ≥3.9。SUMO 依赖固定为 1.27.1，本机已在 macOS arm64 / Python 3.14 验证。

```bash
python3 -m venv /tmp/rippletwin-sumo-venv
/tmp/rippletwin-sumo-venv/bin/python -m pip install -r apps/web/tools/sumo/requirements.txt
/tmp/rippletwin-sumo-venv/bin/python apps/web/tools/sumo/serve.py \
  --data-dir /tmp/rippletwin-sumo-jobs --port 8021 \
  --allow-origin http://127.0.0.1:8001
```

本机默认只监听 `127.0.0.1`。按实际前端地址设置 `--allow-origin`，可重复传入，带 `Origin` 头但不在名单里的请求一律 `403`。无需修改前端即可启动和测试后端。

**云端（T37，D-0930-1700）**：同一份 `serve.py` 跑在 Cloudflare Container 里（`HOST=0.0.0.0 PORT=8080 SUMO_DATA_DIR=/data SUMO_KEEP_RUNS=20`，`ALLOW_ORIGINS` 留空），前面是 Worker `hackathon-sumo`（`apps/sumo`，只开 1 个实例，不开自己的 `workers.dev` 网址）。公网只能经网站的 `/api/sumo/v1/*` 进来：site 经服务绑定 `SUMO` 转给 `hackathon-sumo`，它只放行 §接口 v1 表里的路径，去掉 `Origin` / `Cookie` / `Authorization`，每个 IP 每分钟最多 3 次 POST，容器里同时 ≥ 2 个任务就回 `429`，再转进容器的 `/sumo/v1/*`。所以容器不开自己的 IP 限流（它看到的来源地址都是代理）。容器会休眠、重启，磁盘不持久：重启后旧的运行 id 一律 `404`，页面要回退到预先跑好的结果（`apps/sumo/public/baked/`，必须标「预先跑好」）。

| 环境变量 | 命令行 | 默认 | 说明 |
|---|---|---|---|
| `HOST` | `--host` | `127.0.0.1` | 容器里是 `0.0.0.0` |
| `PORT` | `--port` | `8021` | 容器里是 `8080` |
| `SUMO_DATA_DIR` | `--data-dir` | 必填 | 容器里是 `/data` |
| `ALLOW_ORIGINS` | `--allow-origin`（可重复） | 空 | 逗号分隔；命令行的追加在环境变量之后 |
| `SUMO_KEEP_RUNS` | `--keep-runs` | `20` | 只留最新 N 次完成或失败的运行（默认一次约 21 MB 回放），启动时和每次运行结束后清理 |
| `SUMO_POSTS_PER_MIN` | `--posts-per-min` | `0`（不限） | 每个来源 IP 每分钟最多几次 POST，超了 `429 sumo_rate`；只在服务直接对外时用 |
| `SUMO_API_KEY` | 无（只认环境变量） | 空（不检查） | 设了以后除 `/health` 外都要带请求头 `X-Sumo-Key`，否则 `401`；此时 IP 限流改认调用方给的 `X-Client-IP`。云端方案不用它 |

容器平台用 `SIGTERM` 停服务：不再接新请求，排队的任务丢掉（下次启动标成失败），正在跑的那次跑完再退出。单个请求读写超过 30 秒没动静就断开。`sumo --version` 在不支持的 locale（例如 `LANG=xx_YY.UTF-8`）下第一行是 `Warning: Could not set locale`，版本检查按 `Eclipse SUMO` 开头的那一行认。

离线批量运行（输出目录与审计目录必须为空）：

```bash
/tmp/rippletwin-sumo-venv/bin/python apps/web/tools/sumo/build_demo.py \
  --seed 42 --output /tmp/sumo-output-42 --work-dir /tmp/sumo-raw-42
```

## 接口 v1

| 方法与路径 | 用途 |
|---|---|
| `GET /sumo/v1/health` | 已验证的 SUMO 版本、队列状态（`active_jobs` = 排队 + 正在跑）；不需要 `X-Sumo-Key` |
| `POST /sumo/v1/runs` | 新建一次原生仿真，返回 `202` 和 `id` |
| `GET /sumo/v1/runs/{id}` | `queued → running → complete / failed` |
| `GET /sumo/v1/runs/{id}/index.json` | 全部情景的指标、参数与数据路径 |
| `GET /sumo/v1/runs/{id}/{scenario}/manifest.json` | 路网几何、信号映射、主体目录、指标与分块索引 |
| `GET /sumo/v1/runs/{id}/{scenario}/frames-NNN.json` | 完整的压缩轨迹分块，适合前端缓存回放 |
| `GET /sumo/v1/runs/{id}/frame?scenario=closure&t=118.9` | 已转换为米和米/秒的快照，直接供界面使用 |

请求示例：

```bash
curl http://127.0.0.1:8021/sumo/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{"seed":42,"scenarios":["baseline","closure","guided","footpath"],"demand_duration_s":600,"clearance_s":1200,"demand_scale":1,"diversion_share":0.45}'
```

字段全部可省略，默认如上；只接受白名单字段。`seed` 为 0–2147483647 整数；出行生成窗口为 10–600 秒整数；清空窗口为 600–2400 秒整数；流量倍率 0.1–1.2；绕行服从比例 0–1。上限按实测收紧（seed 42）：流量倍率 1.5 起每次都失败（碰撞或清不空），出行窗口 60 秒配清空 300 秒时行人清不空、配 600 秒就通过。`baseline` 自动加入，保证有对照。每个任务重跑 SUMO，浏览器没有自己计算交通运动。最多四个未完成任务、串行运行；超出返回 `429`。所有 GET 接口都支持 `HEAD`（只回响应头）。

轮询约每秒一次即可。运行失败不发布结果，读取未完成结果返回 `409`。`failed.error` 给出原因。运行成功后删掉 `data-dir/{id}/raw/`（默认一次约 300 MB 的 SUMO XML），只留 `output/`；失败时删掉 `output/` 和 `raw/` 里超过 1 MB 的 XML，保留日志、实际命令与同一批需求供排查。只保留最新 `SUMO_KEEP_RUNS` 次（默认 20）完成或失败的运行，更早的整个目录删除，再读返回 `404`。同一服务重启后可继续读取还留着的完成结果，未完成任务标记失败。大流量未能清空时，增加 `clearance_s` 后创建新任务，不能把未到达的人车当作消失。

错误一律 `{ "ok": false, "error": "<短码>", "msg": "<中文说明>" }`（`docs/contract.md` §错误格式，Worker 原样转出）：`400 bad_request / bad_config / bad_json`、`401 bad_key`、`403 bad_origin`、`404 not_found`、`409 not_ready`、`413 too_big`、`415 bad_type`、`429 sumo_busy`（排队满）/ `sumo_rate`（IP 限流）、`500 sumo_error`。Worker 自己的 `sumo_off / sumo_down / sumo_starting` 等见 `docs/contract.md` §HTTP API。

## 前端对接数据

推荐先取 `manifest.json` 建立场景，再加载轨迹分块；也可按需请求 `/frame`。接口独立于 DOM、Canvas 或其他渲染库。

- `/frame` 返回 `time_s`（实际采样时刻）、`requested_time_s`、`done`、`agents[]`、`signals`、`queues[]` 和 `counts`。118.9 秒返回 118 秒快照，不编造中间位置。结束后 `done=true`、主体为空。
- 主体包含 `id / kind / x_m / y_m / angle_deg / speed_mps / length_m / width_m / lane_id`。种类为 `car / bus / ped`。坐标为局部米制，x 向东、y 向北；角度从正北顺时针。不是经纬度。**已将车辆前保险杠坐标转换成车身中心，前端不能再减半个车长**。
- 四路口中心为 A(140,300)、B(340,300)、C(140,140)、D(340,140)，以 `geometry.junctions` 实际返回为准。`geometry.lanes` 包含 SUMO 折线、车道宽度、长度、种类、封闭状态；内部连接、斑马线、步行区域一并提供。
- `signals` 为 SUMO 原始信号字符串。使用 `geometry.signals[].junction/index/lane` 映射到车道；`G/g` 允许通行（优先级不同）、`y` 黄灯、`r` 红灯。不要在前端另起配时。
- `queues[]` 为每条车道的检测器最大连续排队长度，不是整条道路队列之和。`counts.running/waiting/ended/halting` 是机动车统计；行人从 `agents` 的 `kind` 区分。
- 分块 `a` 每行为 `[agentIndex, x厘米, y厘米, 航向角, 速度厘米每秒, laneIndex]`；索引指向 manifest 的 `agents` 和 `geometry.lanes`；`-1` 为未知车道。`q` 是 `[laneIndex, 排队米]`。字段顺序也在 `agent_columns` 中提供。每个块都有 SHA-256，可检验完整性。
- 几何、位置、尺寸使用同一比例；不要放大车身却保留原车距，也不要用直线插值穿过弯道。当前采样 1 秒，原生物理步长 0.2 秒；精确轨迹保留 SUMO 的规则，显示插值不能用来重新判定碰撞。

`metrics.mean_journey_s` 包含车辆进入路网前的等待；`mean_extra_journey_s` 与无施工的同一批完整行程比较。`mean_ped_journey_s` 为行走行程时间；`sidewalk_users` 是整次运行中使用该通道的去重人数，**不是瞬时密度**。所有车辆、行人都完成后才发布指标。

## 情景与假设

四种情景共用期望出发时刻、主体 ID、车型和目的地：

- `baseline`：无施工。
- `closure`：A → B 关闭内侧车道，保留另一车道。
- `guided`：同样封道；符合条件的汽车按固定种子和 `diversion_share` 预先选择 A → C → D → B。公交保持直行。不是动态优化或 AI 预测。
- `footpath`：同样封道，再关闭 A → B 人行道，由 SUMO 重新选择可步行路径。关闭人行道时重新构建步行网络，不能只改生成后的通行权限，否则 SUMO 的 walkingarea 连接会失效。

街区尺寸 200×160 米、外接路段 140 米、每方向两条 3.2 米车道、人行道 2.4 米、40 km/h 限速、自动生成固定配时，均为**模型假设**。默认车流主方向 1150 辆/小时，其他方向 300–580 辆/小时；公交 60 秒一班；行人三组 720/500/360 人/小时。泊松生成汽车和行人需求；默认 seed 42 实际生成 483 辆车和 276 位行人。没有引用实测车流，不能把结果称为墨尔本现实预测。

本次接入包括跟驰、车道选择、路权、信号、有限车道空间造成的排队与回溢、行人对向交互和合法绕行。没有接入自行车、电车、天气、VMS 文本理解或现场校准。默认 `Krauss` 跟驰及 `striping` 行人模型；车辆瞬移关闭，行人强行脱困时间远大于运行窗口，启用路口碰撞检查。碰撞、瞬移、急停、紧急制动、行人卡死或未清空都会使任务失败，错误保留在审计日志，不伪造成功结果。零碰撞只说明本次模型检查通过。

原理和输出依据：[SUMO 安全检查](https://sumo.dlr.de/docs/Simulation/Safety.html)、[路口与路权](https://sumo.dlr.de/docs/Simulation/Intersections.html)、[行人模型](https://sumo.dlr.de/docs/Simulation/Pedestrians.html)、[FCD 轨迹坐标](https://sumo.dlr.de/docs/Simulation/Output/FCDOutput.html)、[行程指标](https://sumo.dlr.de/docs/Simulation/Output/TripInfo.html)、[E2 排队检测](https://sumo.dlr.de/docs/Simulation/Output/Lanearea_Detectors_%28E2%29.html)。

## 验证

```bash
python3 apps/web/tests/test_sumo_backend.py
# 服务启动后：提交真实任务并检验所有轨迹块和接口
python3 apps/web/tools/sumo/smoke.py
# 也可验证已有任务，避免重复计算
python3 apps/web/tools/sumo/smoke.py --run-id RUN_ID
# 云端：经网站同一条路径验证（Worker 限流，一分钟内别连跑 3 次以上）
python3 apps/web/tools/sumo/smoke.py --base https://<站点>/api/sumo/v1
```

`examples/` 是从真实 API 导出的指标与一帧数据样本，不是供接口兜底的预设结果。每次 POST 都运行原生 SUMO。前端接线需由前端负责人完成；本任务没有更改页面。
