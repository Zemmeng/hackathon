# starters/ —— 可选的起步骨架

只读。赛题和栈没定之前不用碰；所有改动都发生在 `apps/` 里的副本上。

## 选哪个

| starter | 适合什么 | 起步 | 部署 |
|---|---|---|---|
| [web-worker](web-worker/) | 网页、多人实时、房间制、API；也能当纯静态页跑 | `npm i && npm run dev` 或 `python3 -m http.server 4173 -d public` | `npm run deploy` |
| [py-tool](py-tool/) | 数据处理、批量调 API、生成素材 | `python3 tool.py --check` | 不部署，本地跑 |

## 用法

```bash
bash scripts/new-app.sh <模块名> web-worker --owner <handle>
```

## 原则

- 零构建、依赖最少（web-worker 只依赖 wrangler，py-tool 零依赖）
- 默认 `MOCK=1` / dry-run，不填 key 也能跑通
- 每个都自带一个能通过的 `test.sh`，`check.sh [5]` 会跑

## 不在这里的栈

想用 React / Vite / 任何打包器：先在 `docs/decisions.md` 写理由，lead 决定。理由通常不成立 —— 48 小时里构建链出问题的时间比它省下的多。

## ⚠️ 赛规禁止赛前代码时

二选一，记进 decisions，提交时披露：
1. 删掉本目录（`git rm -r starters && git commit`）
2. 用 `gh repo create <赛名> --template Zemmeng/hackathon` 另建一个历史干净的仓库（先在 GitHub 设置勾 Template repository）
