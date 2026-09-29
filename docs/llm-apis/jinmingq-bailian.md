# 阿里云百炼 · qwen3.8-max —— API 卡

> 作者 @jinmingq · 最后实测：还没真调过（09-29 14:56 只在控制台核对了额度和价格）· 🔒 只写变量名，不写 key 的值

## 1. 基本信息

| 项 | 填什么 |
|---|---|
| 服务商 / 模型 | 阿里云百炼（华北2 北京）/ `qwen3.8-max`。同一个 key 还能调别的千问和 `deepseek-v4-flash` 等第三方模型，见 §5 |
| 接口地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，OpenAI 兼容格式（文档写的，没实测）。文档推荐换成带业务空间 ID 的新域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，旧域名仍可用 |
| 鉴权方式 | 请求头 `Authorization: Bearer $DASHSCOPE_API_KEY` |
| 环境变量名 | `DASHSCOPE_API_KEY` |
| key 在谁手里 · 额度归谁 | @jinmingq · 百炼新人免费额度（09-29 已开通，key 还没生成） |
| 价格 | 输入 12 元 / 输出 36 元每百万 token（缓存命中输入 1.5 元）。免费额度 **1,000,000 token，2026-12-29 过期**，每个模型各算各的（09-29 控制台模型详情页看到） |
| 限速 | 没试 |
| 能不能从 Cloudflare Worker 调 | 没试（服务器在中国大陆，Worker 在海外） |
| 申请入口 | https://bailian.console.aliyun.com/ ，地域选「华北2（北京）」；领免费额度不用实名 |

## 2. 最小调用（key 用变量，不贴值）

```bash
curl -sS https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-max","messages":[{"role":"user","content":"ping"}]}'
```

## 3. 实测响应（照实际返回写，别照文档猜）

- 回答文本的路径：没试
- 用量的路径：没试
- 一次调用要多久：没试
- 能不能强制只返回 JSON：没试（控制台「模型能力」里标了「结构化输出」和 function calling）

## 4. 按我们的用法估一次演示要花多少

一条屏上文案 = 4 类路人 × 每类问 3 次 = 12 次调用（大模型只读懂屏上的字，比例由引擎算；次数以 `docs/arch/T5-PRD.md` 为准）。
每次约 400 输入 token + 120 输出 token（估的：提示词只给屏上原文、车速、能读几秒、候选路名，回一段 JSON）→ 一条文案约 6,240 token，按标价约 0.11 元；演示准备 10 条文案约 6.2 万 token、约 1.1 元。**全在 100 万免费额度内，实际花 0 元**；免费额度够跑约 160 条文案。

## 5. 坑 / 备注

- 免费额度只有华北2（北京）地域有；只抵扣实时调用，Batch、调优、部署不抵
- 没实名的账号强制开「免费额度用完即停」：额度用完返回 403 `AllocationQuota.FreeTierOnly`，不扣钱。09-29 模型详情页显示这个开关是开的
- 控制台「费用用量 → 免费额度」汇总页 09-29 显示"暂无数据"（左下角报"系统异常"），但模型详情页能看到额度；官方说新开通最多 2 小时生效
- 同一个 key 能调 `deepseek-v4-flash`：文档价输入 1 元 / 输出 2 元每百万 token，RPM 15,000；有没有免费额度文档没写，没实测。按上面的估法 10 条文案约 0.08 元
- `deepseek-v3`、`deepseek-v3.1`、`deepseek-v3.2`、`deepseek-r1` 在百炼 2026-10-10 下架，别选
- `qwen3.8-max` 是旗舰，只读一句屏上文案可能大材小用；更便宜的千问小模型（如 `qwen-plus`、`qwen-flash`）的额度和价格没去看
- 数据发往中国大陆服务器：正式给澳洲 council 用要考虑数据出境，可以换新加坡地域（国际站也有新人额度，但「用完即停」默认是关的，要自己打开）
