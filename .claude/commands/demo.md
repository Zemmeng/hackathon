---
description: 演示就绪：冻结、全量检查、走查截图、试跑、兜底、打 demo-v1
---

# `/demo`

> 截止前约 8 小时起可以反复跑。**从现在起只修 bug 不加功能。这个会话只检查不修**，P0 开给对应负责人。

## 第零步

读 `hackathon.conf` 算倒计时和阶段。是 lead → 在 `docs/3-tasks.md` 顶部标 🧊 和时间；不是 lead → 只做第二、三步，结果写进交接单。

## 第一步：线上现状

```bash
git switch main && git pull
bash scripts/check.sh                       # 全量
bash scripts/check.sh --e2e                 # 地址读 conf 的 DEMO_URL；汇总贴出来
```

确认线上版本就是 main 或 demo tag。

## 第二步：走查

用 preview（或浏览器）按 `docs/4-demo.md` 的演示脚本逐步操作，每步截桌面和 375px 两张图，记录耗时。
检查：`?v=` 已更新 · 没有 `localhost` 链接 · console 无报错 · `MOCK` 状态符合预期。
和预期不一致的列表「步骤 | 预期 | 实际 | 严重度」。

## 第三步（可选，先问）：多角色试跑

用 `.claude/agents/tester.md`（opus）默认起 3 个角色：第一次用的评委 / 手机用户 / 乱点的用户。超过 10 个必须先问。
每个先落盘 `.claude/agent-out/demo-<角色>.md`，再汇总进 `4-demo` 的「试跑观察」：严重度、几人独立撞上、问题、状态。「经核查不成立」单列；失败的 agent 单独计数。

## 第四步：兜底

- 录屏存在且能播放（`out/demo.mp4`，链接写进 `4-demo` 和 conf 的 `VIDEO_URL`）
- `MOCK=1` 离线 / 本地 preview 能演示
- 演示账号和假数据备好（凭据不进仓库）

## 第五步：落账

- P0 / P1 写进 `3-tasks` 的「风险与 P0」并分给负责人
- `4-demo` 彩排记录追加一行
- pitch 和对外文案的改动先给人过目

## 第六步：代码冻结点

问过人后：

```bash
git tag -a demo-v1 -m "可演示版本 <时间>" && git push origin demo-v1
```

由 DEPLOYER 从 tag 部署。

## 🔒 不做的事

冻结后不加功能 · 不改契约 · 不 force push · 不改 demo 叙事（要改先给人看）· 结论只写一两句，附截图
