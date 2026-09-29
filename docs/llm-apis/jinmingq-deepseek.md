# DeepSeek · deepseek-flash —— API 卡

> 作者 @jinmingq · 最后实测 09-29 15:47 · 🔒 只写变量名，不写 key 的值

## 1. 基本信息

| 项 | 填什么 |
|---|---|
| 服务商 / 模型 | DeepSeek 官方 / `deepseek-flash`（DeepSeek-V4.1-Flash）。旧名 `deepseek-chat`、`deepseek-reasoner` 已于 2026-07-24 下线，旧教程里的模型名别用 |
| 接口地址 | `https://api.deepseek.com/chat/completions`，OpenAI 兼容格式（实测） |
| 鉴权方式 | 请求头 `Authorization: Bearer $DEEPSEEK_API_KEY` |
| 环境变量名 | `DEEPSEEK_API_KEY` |
| key 在谁手里 · 额度归谁 | @jinmingq · 自费充值 ¥10（没有免费额度） |
| 价格 | 每百万 token：输入（缓存未命中）高峰 ¥2 / 空闲 ¥1；输入（缓存命中）高峰 ¥0.04 / 空闲 ¥0.02；输出 高峰 ¥8 / 空闲 ¥4。高峰 = 北京时间工作日 9:00–12:00、14:00–18:00，其余时段半价；调休上班的周末、中国法定节假日全天按空闲。官方文档没提新用户赠送 |
| 限速 | 官方文档写并发上限 2500；没压测 |
| 能不能从 Cloudflare Worker 调 | 没试 |
| 申请入口 | https://platform.deepseek.com/ （能用 Google 账号登录；先充值，再到「API keys」页创建，key 只在创建时显示一次） |

## 2. 最小调用（key 用变量，不贴值）

```bash
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","thinking":{"type":"disabled"},"messages":[{"role":"user","content":"ping"}]}'
```

`"thinking":{"type":"disabled"}` 一定要带，原因见 §5。

## 3. 实测响应（照实际返回写，别照文档猜）

- 回答文本的路径：`choices[0].message.content`；开着思考模式时，思考过程在 `choices[0].message.reasoning_content`
- 用量的路径：`usage.prompt_tokens`、`usage.completion_tokens`、`usage.total_tokens`
- 一次调用要多久：约 1.2 秒（09-29 实测 4 次，1.2–1.4 秒）
- 能不能强制只返回 JSON：能。请求体加 `"response_format": {"type": "json_object"}`，提示词里带上 json 字样。实测读 `RUSSELL ST CLOSED / USE SWANSTON ST`，返回 `{"notice": true, "advice": {"Russell St": "avoid", "Swanston St": "use"}}`，能直接 `JSON.parse`，`finish_reason` 是 `stop`

## 4. 按我们的用法估一次演示要花多少

一条屏上文案 = 4 类路人 × 每类问 3 次 = 12 次调用（大模型只读懂屏上的字，比例由引擎算；次数以 `docs/arch/T5-PRD.md` 为准）。
实测的最小 JSON 提示是 90 输入 + 26 输出 token；正式提示词要带车速、能读几秒、候选路名，按每次约 400 输入 + 120 输出 token 估 → 一条文案约 ¥0.02（高峰价），演示准备 10 条文案约 ¥0.2（空闲时段约 ¥0.1）。¥10 余额按高峰价够约 470 条文案。

## 5. 坑 / 备注

- **思考模式默认是开的**：不传 `"thinking":{"type":"disabled"}` 时，`max_tokens` 会先被思考用光，`content` 返回空字符串。09-29 实测 `max_tokens` 20 和 200 都被用满，`content` 为 `""`，照样计费
- **有的网络屏蔽 DeepSeek**：09-29 我平时用的网络在 TLS 握手时把所有 `*.deepseek.com` 的连接重置（注册、文档、API 都打不开），换手机热点就正常。本地调试注意换网络；线上是 Worker 发请求，不经过本地网络，但 Worker 能不能连通还没试
- 没有免费额度，要先充值；余额和调用次数在 platform 的「用量信息」页看，数据约有 5 分钟延迟
- 澳洲联邦政府 2025 年起禁止在政府设备上用 DeepSeek，面向 council 交付时可能要换供应商；调用层按 T5-PRD 写成可替换的（模型名放 `LLM_MODEL`），pitch 里可以提一句
