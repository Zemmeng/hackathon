# params —— 引擎选择模型参数（带出处）
Owner: @Unzzip

T12 交付物。给 `apps/engine`（T9）的每类人选择模型提供**有出处**的参数；找不到写 `null`，不编。

## 怎么跑

静态 JSON，无运行时：

```bash
# 引擎 / 网页侧（部署后）
# fetch('/params/public/params.json')

# 本地看一眼
python3 -m json.tool apps/params/public/params.json >/dev/null && echo ok
```

## 怎么测

```bash
bash apps/params/test.sh
# 期望最后一行：N passed, M failed，失败数为 0
```

校验：每个非派生叶子参数都有 `source` + `confidence`；比例类在 0–1；`mix` 四类加总 = 1；键名 ASCII。

## 对外接口（→ docs/contract.md §evaluate / 引擎内部）

| 消费方 | 用途 | 路径 |
|---|---|---|
| `apps/engine` | 按 persona 选参数算各条路比例 | `apps/params/public/params.json` |
| `apps/web` | 界面上展示「这个数哪来的」 | 同上（只读） |

字段含义见 `docs/arch/T12-params-PRD.md` 第 4 节；本 README 给的是**每个数一行的出处表**。

## 参数出处表

| 键 | 值 | 区间 | 置信 | 出处 | 怎么来的 |
|---|---|---|---|---|---|
| `mix.commuter` | 0.50 | 0.40–0.60 | low | ABS Census 2016（Huda 2025 转述 CBD 通勤）+ VISTA | CBD 车行以通勤为主的工作假设 |
| `mix.local` | 0.25 | 0.15–0.35 | low | VISTA trip purpose | 本地办事/购物 |
| `mix.tourist` | 0.10 | 0.05–0.20 | low | City of Melbourne 访客经济（定性） | 游客车行占比偏低 |
| `mix.delivery` | 0.15 | 0.08–0.22 | low | ABS SMVU 车队构成；O'Fallon 城配研究 | 商用车 10–20% 量级 |
| `anchors.generic_warning_divert` | 0.03 | 0.01–0.06 | **low** | 工作假设（D-0929-1435 两点校准）；Bonsall 1999 / Wardman 1996 给出广域 | 纯「前方施工」实测缺失 |
| `anchors.named_route_divert` | 0.20 | 0.10–0.30 | **high** | **Erke, Sagberg & Hagman 2007**, *Effects of route guidance VMS on driver behaviour*, TR Part F | 实地试验：约 1/5 车辆按推荐改道 |
| `anchors.stated_to_actual` | 0.20 | 0.10–0.35 | **high** | **Chatterjee 2002**, *Driver response to VMS information in London*, TR Part A | 问卷说会改道的人里只有 1/5 真改 |
| `persona.*.sign_trust` | null | — | **none** | Ermagun 2021 定性（信任↑遵从↑） | 无按四类人的信任率 |
| `persona.*.route_familiarity` | 0.25–0.80 | 见 JSON | low | 定性 | P1 工作假设 |
| `vms.legibility_index_m_per_mm` | 25 | 20–28 | medium | NSW TSI-SP-008（700×字高）；MUTCD/Access Board 35–40 ft/inch；AS 4852 | 可读距离 ≈ 25 m × 字高 mm |
| `vms.reading_rate_wps` | 2.5 | 1.5–4.0 | low | Austroads GTM Pt 10；Dudek 2001 NJDOT | 无单一澳洲强制值 |
| `value_of_time.private_car_occupant_aud_ph` | 14.99 | 14–16 | medium | **ATAP** Travel Time（40% AWE） | 人·小时 |
| `value_of_time.business_car_occupant_aud_ph` | 48.63 | 45–52 | medium | ATAP（129.8% AWE） | |
| `value_of_time.commercial_occupant_aud_ph` | 26.5 | 25.41–28.45 | medium | ATAP courier→A-triple 区间 | 取中 |
| `value_of_time.car_occupancy` | 1.09 | 1.05–1.20 | **high** | City of Melbourne VISTA：1.09 人/车 | |
| `value_of_time.private_vehicle_hour_aud` | 16.34 | 15–18 | medium | 派生 14.99×1.09 | 车辆小时 |

### 最没把握的数（给 lead / 评审看）

1. **`mix` 四类占比** — 没有「墨尔本 CBD 车行出行目的四分」的直接公开表；0.50/0.25/0.10/0.15 是把 VISTA、ABS、CBD 岗位结构拼出来的**工作假设**，置信 `low`。
2. **`generic_warning_divert` = 0.03** — 纯警告不带推荐路的改道率，文献只有广域（5%–80% 总改道）；0.03 来自 lead 的校准锚点，不是实测。
3. **`sign_trust` 按 persona** — 明确 `null`。四类人信任率没有干净公开数；引擎若要用，只能先用统一 trust 或读数里的 `trust` 字段（contract §路人读数），不要假装有出处。

### 可以硬用的数（评审问「哪来的」）

- **20% 推荐路改道**：Erke 2007 实地试验，原话 “about every fifth vehicle”。
- **问卷→实际 ×0.2**：Chatterjee 2002 伦敦 VMS，原话 “only one-fifth … diverted compared to that expected”。
- **载客 1.09**：City of Melbourne VISTA 明文。
- **时间价值**：ATAP 国家导则参数值（私人 $14.99 / 人·时，公务 $48.63）。

## 结构

| 文件 | 一句话 |
|---|---|
| `public/params.json` | 参数本体（引擎只读这一个文件） |
| `README.md` | 本文件：出处表 + 怎么测 |
| `test.sh` | 校验 JSON 契约与占比 |

## 本模块固定模式

- 只加字段不删字段；改值必须同时改 `source` / `confidence` / `note`
- 派生量（如 `private_vehicle_hour_aud`）在 `note` 里写明公式
- 禁止把「找来的引用」改成「我们发现」；二手转述要在 source 里写原作者

## 已知问题

- `sign_trust` 为空，引擎不要硬编码 0.5 充数
- P1 的 `reading_rate_wps`、`route_familiarity` 置信低，演示时要会说「区间」
- P2（时段 mix、风险偏好）未交付
