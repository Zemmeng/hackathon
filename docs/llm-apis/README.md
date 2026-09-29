# 大模型 API 候选卡

> 每人把自己手里能用的大模型 API 写成一张卡放在这里，T5 和 lead 看卡定用哪家（D-0929-1333「大模型的api到时候再定」）。
> 🔒 **卡上只写变量名，不写 key 的值。** key 只放自己的 `.env`，上线时由部署人放进 Cloudflare（D-0929-1310）。卡里贴了 key，pre-commit 和 `check [1]` 会拦下，推不上去。

## 规矩（`check [3]` 自动查）

| 能做 | 不能做 |
|---|---|
| 新建自己的卡 `docs/llm-apis/<你的handle>-<服务商>.md` | 改或删别人的卡 |
| 随时改、删自己的卡 | 建子目录；改 `README.md` `TEMPLATE.md`（归 lead） |
| 附实测响应 `<你的handle>-<服务商>-response.json`（先删掉里面的 id、账号信息） | 在任何文件里写 key 的值、账号、邮箱 |

- 「自己的」= 文件名以 `<分支里的 handle>-` 开头，不区分大小写；文件名全 ASCII，服务商名小写：`jinmingq-deepseek.md`、`unzzip-gemini.md`
- 同一家两个人都有 key：各写各的卡，别改别人的
- 卡的格式照 `TEMPLATE.md`，不会填的格写「没试」，别空着，也别照文档猜

## 怎么传一张卡

```bash
git fetch origin && git switch -c <handle>/api/T5-llm-card origin/main   # 已经在自己的任务分支上就跳过，直接在那个分支上加
cp docs/llm-apis/TEMPLATE.md docs/llm-apis/<handle>-<服务商>.md          # 照模板填
bash scripts/check.sh --quick                                             # 汇总行无 ❌ 再提交
git add docs/llm-apis/<handle>-<服务商>.md
git commit -m "llm-apis: 加 <服务商> 卡 —— <一句话：免费额度多少 / 为什么值得考虑>"
git push -u origin HEAD && gh pr create --fill                            # 只动了自己的卡、CI 绿 → 自己 squash 合
```

## key 怎么在队里共享（不进仓库）

- 卡上只写：环境变量名（全大写 ASCII，例 `DEEPSEEK_API_KEY`）、key 在谁手里、额度归谁
- 本地：有 key 的人填自己的 `.env`（Worker 模块本地开发填模块目录的 `.dev.vars`，见 pitfalls「wrangler dev 里 env.XXX 是 undefined」）；没 key 的人用 `MOCK=1`
- 要借别人的 key：当面或用密码管理器传，**不发群聊，不贴 PR、issue、交接单**
- 上线：定了用哪家后，key 主人把 key 交给部署人 @unicornnnnnny，由他 `npx wrangler secret put <变量名>`（D-0929-1322），不写进任何文件
- 真去调用之前，先报调用次数和花费（D-09），花了就记进 `docs/3-tasks.md` 的额度台账
- 怀疑 key 进过 git 或群聊：马上去服务商后台作废、重新生成，再告诉 lead

## 定下来之后

lead 把选中的那家写进 `.env.example`（只写变量名）和 `apps/api/README.md` 的「外部 API」节，并追加一条 decision。没选中的卡留着当备选。

现在有哪些卡：`ls docs/llm-apis/`（不设总表，免得大家同时改一张表起冲突）。
