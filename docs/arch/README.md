# 架构图（2026-09-29，lead 出，待全队确认）

按顺序看：

| 文件 | 看什么 |
|---|---|
| `1-system-flow.pdf` | 一页纸：系统 6 步怎么运转、每一步接哪个外部服务（不懂技术先看这个） |
| `2-agent-integration.pdf` | 创新点：大模型扮演的 4 类路人怎么接进来，T4 和 T5 怎么交接 |
| `3-architecture-v1.pdf` | 完整版：模块分工、演示三幕、接口草案、已定和待定 |
| `4-ai-flow.pdf` / `.png` / `.md` | 一页流程图：从施工方案到结果，哪几步引擎算、哪两步问大模型（前端不在图里）；按 D-0929-1435「大模型只读懂，引擎来选」；`.md` 是文字版 |
| `6-architecture-v2-en.pdf` / `-zh.pdf`（+ `.png`、源文件 `.html`） | 产品架构图，给评审看、放初筛 3 页 PDF 第 3 页：真实数据 → 数字孪生引擎 → AI 路人 / AI 顾问 → 规划员 5 步流程，设计原则和内置关卡。只讲产品，不写任务号和分工。`.html` 浏览器打开是中文版，加 `?lang=en` 是英文版；打印成 A4 横向、边距「无」就是 PDF |
| `5-llm-api-detail.pdf` | 细节参考：缓存和兜底、偏差防护、屏上文字规范、花费估算仍适用；③ 的输出和校准位置是按旧方案（D-0929-1333，大模型直接给比例）写的，以 `4-ai-flow` 和 contract §路人读数为准 |
| `T5-PRD.md` | 给 @jinmingq 的 T5 任务说明：交什么、规则兜底、怎么问大模型、缓存、测试、时间盒 |
| `T13-web-wiring-PRD.md` | 给 @unicornnnnnny 的 T13 任务说明：RippleTwin 页面只接 lead 做好的 `backend.js`，方案怎么拼（真路网实测过）、每个预设数字换成哪个字段、测试怎么改 |
| `T12-params-PRD.md` | 给 @Unzzip 的 T12 任务说明：4 类路人的选择模型参数找出处，交 `apps/params/public/params.json` |

文字版在 `docs/2-plan.md`；决定在 `docs/decisions.md`（D-0929-1310 起）。
