# <服务商> · <模型名> —— API 卡

> 作者 @<handle> · 最后实测 MM-DD HH:MM · 🔒 只写变量名，不写 key 的值
> 复制本文件为 `docs/llm-apis/<handle>-<服务商>.md` 再填；不会填的格写「没试」。

## 1. 基本信息

| 项 | 填什么 |
|---|---|
| 服务商 / 模型 | 例：DeepSeek / deepseek-chat |
| 接口地址 | 例：`https://api.deepseek.com/chat/completions`；是不是 OpenAI 兼容格式 |
| 鉴权方式 | 例：请求头 `Authorization: Bearer $DEEPSEEK_API_KEY` |
| 环境变量名 | 例：`DEEPSEEK_API_KEY`（全大写 ASCII） |
| key 在谁手里 · 额度归谁 | 例：@jinmingq · 注册送的额度 |
| 价格 | 输入 / 输出每百万 token 多少钱；免费额度多少、什么时候过期 |
| 限速 | 每分钟多少次请求 / 多少 token |
| 能不能从 Cloudflare Worker 调 | 能 / 不能 / 没试（有的服务商限地区） |
| 申请入口 | 网址 |

## 2. 最小调用（key 用变量，不贴值）

```bash
curl -sS https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer $EXAMPLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"<模型名>","messages":[{"role":"user","content":"ping"}]}'
```

## 3. 实测响应（照实际返回写，别照文档猜）

- 回答文本的路径：例 `choices[0].message.content`
- 用量的路径：例 `usage.prompt_tokens`、`usage.completion_tokens`
- 一次调用要多久：例 1.2 秒（MM-DD 实测）
- 能不能强制只返回 JSON：能 / 不能（参数怎么写）

## 4. 按我们的用法估一次演示要花多少

一条屏上文案 = 4 类路人 × 每类问 3 次 = 12 次调用（大模型只读懂屏上的字，比例由引擎算；次数以 `docs/arch/T5-PRD.md` 为准）。
每次约 ___ 输入 token + ___ 输出 token → 一条文案约 ___；演示准备 10 条文案约 ___。

## 5. 坑 / 备注

- 
