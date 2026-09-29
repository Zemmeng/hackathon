# T12 引擎参数找依据 PRD：给 4 类路人的选择模型配上有出处的数

> 负责人：@Unzzip · 模块：`apps/params/`（新建）· 分支：`Unzzip/params/T12-evidence` · 写于 2026-09-29 15:15（lead）
> 用的人：引擎（`apps/engine`，lead 的「AI流程基础架构」会话在写，任务号 T9）。决定依据：D-0929-1435（比例由引擎按每类人的参数算）、D-0929-1515（本任务）。

## 1. 为什么

D-0929-1435 定了：大模型只负责「读懂屏上的字」，**各条路走多少人由引擎按每类人的参数算**。这些参数现在全是拍脑袋写的，引擎代码和文档里都标着［待核］。评审一问「这个数哪来的」就答不上。这一单把它们换成有出处的数，拿不准的给出区间。

## 2. 交付物

| 文件 | 内容 |
|---|---|
| `apps/params/public/params.json` | 参数本身，每个数都带出处（格式见第 4 节） |
| `apps/params/README.md` | 每个参数一行：数值、区间、出处（作者 年份 + 链接）、怎么从原文换算过来的、置信度 |
| `apps/params/test.sh` | 校验：每个值都有 `source` 和 `confidence`；比例在 0–1 之间；4 类人占比加起来 = 1；键名全 ASCII；最后一行打印 `N passed, M failed` |

## 3. 要找的参数

**P0（17:00 集成点先交有出处的一半，21:00 交齐）**

| 参数 | 现在的假设 | 找什么 |
|---|---|---|
| 4 类人占比 `mix`：通勤 / 本地 / 游客 / 送货 | 50 / 25 / 10 / 15 | 墨尔本 CBD 高峰时段的出行目的构成（VISTA 出行调查、ABS 通勤数据、商用车比例） |
| 只写「前方施工」时的绕行比例 | 约 3% | VMS / 施工提示对改道的实测效果 |
| 写推荐路线（USE X ST）时的绕行比例 | 约 20%（Erke 2007，二手转述） | 找原文核对，或者找别的实测 |
| 问卷里「会绕行」和实际绕行的比例 | 约 1/5（Chatterjee 2002） | 找原文核对 |
| 信不信屏（照着屏上说的走的比例），按 4 类人分 | 没有 | 驾驶员对 VMS 的信任 / 遵从率研究 |

**P1**

| 参数 | 找什么 |
|---|---|
| 赶不赶时间：时间价值（澳元 / 小时），分私家车和货车；每车平均载客数 | ATAP PV2 · Travel time（`apps/roads/PRD-2.md` 第 4 节 E 条原本给 louis，现在归这一单） |
| 熟不熟路：本地人 / 通勤者 / 游客对替代路线的了解程度 | 路线熟悉度对改道的影响研究 |
| 屏上文字多远能看清、多久能读完 | VMS 字高和可读距离的换算、每秒能读几个词（澳洲 / 美国标准：AS 4852、MUTCD） |

**P2**

- 4 类人占比按时段变化（早高峰、午间、晚高峰、周末）
- 怕不怕堵：对排队 / 不确定性的风险偏好

## 4. 格式（草案；键名全 ASCII，D-05）

```json
{
  "version": 1,
  "mix": {
    "commuter": { "value": 0.5, "range": [0.4, 0.6], "unit": "share", "source": "作者 年份, 链接", "confidence": "low", "note": "怎么换算来的" }
  },
  "anchors": {
    "generic_warning_divert": { "value": 0.03, "range": [0.01, 0.06], "unit": "share", "source": "…", "confidence": "low" },
    "named_route_divert":     { "value": 0.20, "range": [0.10, 0.30], "unit": "share", "source": "…", "confidence": "low" },
    "stated_to_actual":       { "value": 0.20, "range": [0.10, 0.35], "unit": "ratio", "source": "…", "confidence": "low" }
  },
  "persona": {
    "commuter": { "sign_trust": { "value": null, "source": null, "confidence": "none", "note": "没找到可靠数据" } }
  },
  "vms": {},
  "value_of_time": {}
}
```

- `confidence` 用 `high` / `medium` / `low` / `none`
- **找不到就写 `null` 加一句说明，别编**；二手转述的标出来，写上原文是谁
- 字段名以后如果引擎需要改，以引擎为准，lead 会转告

## 5. 规矩

- 只写 `apps/params/`；`apps/README.md` 登记表和 CODEOWNERS 已由 lead 登记
- 不花钱：用公开论文、政府报告、开放数据；用大模型帮忙搜可以，但每个数都要能点开出处核对
- 先处理 #5：按 lead 在 PR 里的留言拆完，或者直接关掉（赛题内容已经在 `docs/1-brief.md` 里了）
- 做完开 PR，在 PR 里说明哪几个数最没把握
