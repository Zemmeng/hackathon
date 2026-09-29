# DeepSeek · deepseek-chat（别名，实际是 deepseek-flash）—— API 卡

> 作者 @louisxie316-dotcom · 最后实测 09-29 16:04 · 🔒 只写变量名，不写 key 的值
> 同一家已有 @jinmingq 的卡 `jinmingq-deepseek.md`（价格、强制 JSON、思考模式的坑都在那张）。本卡只写**第二把 key** 和**两张卡对不上的实测**，不重复抄。

## 1. 基本信息

| 项 | 填什么 |
|---|---|
| 服务商 / 模型 | DeepSeek 官方 / 请求 `deepseek-chat`，响应里 `model` 是 `deepseek-flash`（09-29 实测，见 §5） |
| 接口地址 | `https://api.deepseek.com/chat/completions`，OpenAI 兼容格式（实测） |
| 鉴权方式 | 请求头 `Authorization: Bearer $DEEPSEEK_API_KEY` |
| 环境变量名 | `DEEPSEEK_API_KEY` |
| key 在谁手里 · 额度归谁 | @louisxie316-dotcom · 自己账户的余额（余额多少没看） |
| 价格 | 同 `jinmingq-deepseek.md` §1，没另外核对 |
| 限速 | 没试 |
| 能不能从 Cloudflare Worker 调 | 没试 |
| 申请入口 | https://platform.deepseek.com/ |

## 2. 最小调用（key 用变量，不贴值）

```bash
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
```

## 3. 实测响应（照实际返回写，别照文档猜）

09-29 16:04 实测 1 次（HTTP 200，回答 `pong`）：

- 回答文本的路径：`choices[0].message.content`；`finish_reason` 是 `stop`
- 用量的路径：`usage.prompt_tokens`（10）、`usage.completion_tokens`（2）、`usage.total_tokens`（12）；另有 `usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens`
- 一次调用要多久：1.3 秒
- 能不能强制只返回 JSON：没试（@jinmingq 实测能，见他的卡 §3）

## 4. 按我们的用法估一次演示要花多少

同 `jinmingq-deepseek.md` §4（同一个服务、同一套价格），不重复估。本次实测只花了 12 个 token。

## 5. 坑 / 备注（和 `jinmingq-deepseek.md` 对不上的地方）

- **旧名 `deepseek-chat` 09-29 还能用**：请求 `deepseek-chat` 返回 HTTP 200，响应 `model` 字段是 `deepseek-flash`，像是别名。@jinmingq 的卡写「已于 2026-07-24 下线」，至少 09-29 这天没下线。只测了 1 次；正式代码仍建议照他的卡写 `deepseek-flash`，免得别名哪天真撤了
- **用别名时没看到思考**：这次没传 `thinking`，响应里没有 `reasoning_content`，`completion_tokens` 只有 2、`content` 正常。和他的卡「思考模式默认开、会把 `max_tokens` 用光」对不上——可能别名默认不思考，也可能是没设 `max_tokens`。只测了 1 次，没有对照组，**写代码仍照他的卡带上 `"thinking":{"type":"disabled"}`**
- **别把 DeepSeek 的 key 发到百炼地址**：两家 key 都是 `sk-` + 32 位，长得一样。09-29 调试时误发到 `dashscope.aliyuncs.com`，回 401 `invalid_api_key`，看着像 key 坏了，其实是地址不对。`.env` 里用两个不同的变量名（`DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY`）
- 本机网络能直连 `api.deepseek.com`（09-29 实测）；Worker 能不能连通没试
