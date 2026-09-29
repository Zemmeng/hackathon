#!/usr/bin/env bash
# new-app.sh —— 已停用：它只会从 starters/ 复制骨架，而 starters/ 已按 D-0929-1311 删掉
#
# 为什么：starters/ 是赛前写的通用骨架代码，比赛规则 3 禁止开赛前做任何开发，所以删了；模块代码全部开赛后手写。
# 现在怎么加模块（只能 lead 在 lead/* 分支上做）：
#   1. 手工建 apps/<模块名>/，至少有 README.md（含 Owner: @handle 一行）和可执行的 test.sh（check [4][5] 查）
#   2. apps/README.md 登记表加一行；.github/CODEOWNERS 加 /apps/<模块名>/ @<handle>
#   3. 要本地预览就往 .claude/launch.json 加一条（照 sim / web 那几条，端口别和已有的撞）
# 退出码：固定 1（保留这个文件，是为了让照旧文档跑它的人看到这段说明，而不是「找不到文件」）
set -uo pipefail
awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0" >&2
exit 1
