---
description: 收工：跑检查、写交接单、更新任务板、提交，问过再推
---

# `/handoff`

> 收工、换人、睡前、context 快满时用。**只存在于对话里的东西，等于不存在** —— 把它们落到文件。

## 第一步：自己收集事实，不问人

```bash
git status
git log origin/main..HEAD --oneline
bash scripts/check.sh --quick        # 汇总行原样贴出来
```

当前 dev server 的名字（launch.json 里的）也记下。
有 ❌ 先修；修不掉就写进交接单第 1 节「尚未验证」，并写明是谁的模块。

## 第二步：新建交接单

`handoff/<handle>-T<n>-<MMDD-HHMM>.md`，**不改旧单**。四节照 `handoff/README.md`：

1. **事实**：做了什么、停在哪（带时间）、分支 / PR、验证命令 + 汇总行、尚未验证的、本次花了多少钱
2. **要改的共享文件**：文件、哪一行、改成什么 —— 自己不改
3. **留给 lead**：要拍板的、风险、要别人配合的、中途想到的别的事
4. **下一步**：下一个人要敲的第一条命令 + dev server 名字

🔒 不写 key、密码、账号、邮箱、学号。

## 第三步：更新任务板

`docs/3-tasks.md` 我那节：✅（已开 PR）/ ⏸（指向交接单）/ ❌（写一句原因）。

## 第四步：坑与纠正

本会话新踩的坑、用户对 AI 的纠正 → 各追加一行到 `docs/pitfalls.md`。

## 第五步：提交

```bash
git add <具体路径>        # 不用 git add . ；不用 -f
git commit -m "<模块>: 做了什么 —— 为什么"
```

正文写验证方式和未完成项，保留 `Co-Authored-By`。

## 第六步：问一句再推

问「push 并开 / 更新 PR 吗？」。同意后：

```bash
git fetch origin && git merge origin/main
bash scripts/check.sh --quick
git push -u origin HEAD
gh pr create --fill          # 已有 PR 就跳过
```

把 PR 链接写回 `docs/3-tasks.md`。
context 快满时告诉用户：**新会话第一句说「接着做 T<n>，先读 handoff/<文件>」**。

## 收尾暗号

以上全做完才说「**收工**」。回复只要两句：交接单路径 + 下一步第一条命令，外加 PR 链接。

## 🔒 不做的事

不合并 PR · 不改或删别人的交接单 · 不把交接单 mv 到 `done/` · 检查还红着不说「收工」
