#!/usr/bin/env bash
# stop-gate.sh —— Stop hook：收尾门禁
#
# 职责：
#   回合结束前，只要本回合动过东西（工作区有改动，或 HEAD 离开了回合起点），就跑一遍 bash scripts/check.sh --quick：
#   · 汇总 0 ❌ → 放行（exit 0）
#   · 有 ❌ → exit 2，把 ❌ 行写到 stderr 打回给模型：本回合把检查弄红了，就不许结束回合
#   · 例外：❌ 全在 [5] 模块测试，且失败的模块本回合没碰过 → 放行，提示「不是本会话造成的，回复里说一句」
#   结果由 check.sh 自己写进 logs/last-check.txt；check.sh 崩溃 / 超时时由本脚本在那里写一份标记，
#   免得留着上一次的绿结果骗过下一个会话的导航层。
#
# 判断顺序（别随手调换）：
#   ① HACK_NO_GATE=1（人手动逃生：HACK_NO_GATE=1 claude）或 HACK_IN_GATE=1（递归标记）→ 放行
#   ② stdin 的 stop_hook_active=true → 放行（上一次已经拦过一回；修不掉的由模型在回复里写明，防死循环）
#   ③ 本回合没动东西 → 放行。三个条件同时成立才算「没动」：
#        git status --porcelain 为空 且 logs/.turn-head 存在 且 当前 HEAD == logs/.turn-head
#      logs/.turn-head 由 every-prompt.sh 在每条用户消息时写入（本回合起点的 HEAD，没有提交时是 none）。
#      只看工作区的话，AI「先 commit 再收工」就能绕过门禁（D-11 允许 AI 在自己分支上 commit）。
#   ④ scripts/check.sh 不存在 → ⚠️ 放行
#   ⑤ HACK_IN_GATE=1 CHECK_TEST_TIMEOUT=$((LIMIT-20)) bash scripts/check.sh --quick，整体限时 LIMIT=90 秒
#      （macOS 没有 timeout：后台运行 + kill -0 轮询；超时连同子进程组一起杀掉，⚠️ 放行）
#      单个 test.sh 限时比门禁短 20 秒：死循环的测试先被 check 判成 [5] ❌，而不是拖到门禁超时被放行。
#   ⑥ 输出里没有「======== 汇总」→ 当失败
#   ⑦ 汇总有 ❌ → 按上面的规则放行或 exit 2
#
# 为什么不自动 commit（decisions D-04）：
#   学习项目里 Stop hook 每回合 git add -A && commit；放到团队仓库会把半成品、别人的文件、甚至秘密
#   一起提交进 main 或别人的分支，提交粒度也该由人和 PR 决定。🔒 这里只检查，不写 git，不 push。
#
# 🔴 两处关键修复，别改回去：
#   1) 判断仓库用 [ -e .git ]，不用 [ -d .git ]。（2026-08-17，学习项目踩坑）
#      git worktree 里 .git 是一个「文件」（内容是 gitdir: …），-d 恒假 → 整段门禁在所有 worktree 里被静默跳过。
#      本仓库同机并行就靠 worktree（../hackathon-T<n>），所以必须是 -e。
#   2) 输出里找不到「======== 汇总」就当失败。（2026-09-03，学习项目踩坑）
#      检查脚本自己崩了时，输出里既没有 ❌ 也没有 ⚠️，按「没 ❌ 就放行」会把崩溃伪装成全绿。
#      「有没有汇总行」才是「check 跑完了没有」的判据；❌ 的数量看汇总行，类别只看汇总行之前 [N] 开头的行，不数全文
#      （check.sh 在汇总行之后会把 ❌/⚠️ 项目行再列一遍，不截断就会重复计数）。
#
# [5] 例外怎么判「失败的模块」：只认汇总行之前、[5] 段里以「    ❌ 」开头的明细行里的 apps/<m>、starters/<s>，
#   加上 [5] 项目行「失败：」后面的列表。✅ 明细行、日志文件名、段里顺带出现的目录名都不算。
#   「本回合碰过的模块」= git status 里的路径 ∪ logs/.turn-head..HEAD 之间提交改过的路径。
#   回合起点未知（没有 .turn-head）或认不出失败模块 → 不给例外，照常拦。
#
# 用法（手动测）：
#   echo '{"stop_hook_active":false}' | bash .claude/hooks/stop-gate.sh; echo rc=$?
#   echo '{"stop_hook_active":true}'  | bash .claude/hooks/stop-gate.sh; echo rc=$?    # 应 rc=0
#   echo '{}' | HACK_NO_GATE=1 bash .claude/hooks/stop-gate.sh; echo rc=$?             # 应 rc=0
#   HACK_GATE_TIMEOUT=<秒> 可临时改整体限时（只给测试用）。
# 退出码：0 放行；2 拦下（stderr 会回给模型）。其它异常一律 fail-open 为 0。
# 放行但有话要说时，同时往 stdout 打 {"systemMessage": …}，让人在界面上看得到（exit 0 时 stderr 模型看不到）。
set -uo pipefail

LIMIT="${HACK_GATE_TIMEOUT:-90}"
TEST_LIMIT=$((LIMIT - 20)); [ "$TEST_LIMIT" -lt 5 ] && TEST_LIMIT=5
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904   # git 的空树，回合起点还没有提交时拿它当起点

# ① 逃生开关 / 递归标记
[ "${HACK_NO_GATE:-}" = "1" ] && exit 0
[ "${HACK_IN_GATE:-}" = "1" ] && exit 0

# 放行但留一句话：stderr（给日志）+ systemMessage（给人看）
pass_with() {
  printf '%s\n' "$1" >&2
  python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$1" 2>/dev/null
  exit 0
}

# ② stop_hook_active：上一次已经拦过，这次放行
INPUT=""
if [ ! -t 0 ]; then INPUT="$(cat 2>/dev/null || true)"; fi
ACTIVE="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    print("1" if json.load(sys.stdin).get("stop_hook_active") is True else "0")
except Exception:
    print("0")
' 2>/dev/null)"
if [ -z "$ACTIVE" ] && printf '%s' "$INPUT" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  ACTIVE=1   # 没有 python3 时的退路
fi
[ "$ACTIVE" = "1" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"
fi
[ -n "$ROOT" ] && cd "$ROOT" 2>/dev/null || exit 0
# 🔴 别改回 -d：worktree 里 .git 是文件
{ [ -e .git ] && command -v git >/dev/null 2>&1; } || exit 0

# ③ 本回合没动东西 → 放行（工作区干净 且 有回合起点 且 HEAD 没动）
CHANGED="$(git status --porcelain 2>/dev/null)" || exit 0
HEAD_NOW="$(git rev-parse -q --verify HEAD 2>/dev/null || echo none)"
TURN_HEAD=""
[ -f logs/.turn-head ] && TURN_HEAD="$(head -n 1 logs/.turn-head 2>/dev/null | tr -d '[:space:]')"
if [ -z "$CHANGED" ] && [ -n "$TURN_HEAD" ] && [ "$HEAD_NOW" = "$TURN_HEAD" ]; then
  exit 0
fi

# ④ check.sh 还没有 → ⚠️ 放行
if [ ! -f scripts/check.sh ]; then
  pass_with "⚠️ 收尾门禁：scripts/check.sh 不存在，这回合没做检查就放行了（找 lead 补上 check.sh）。"
fi

# ⑤ 限时跑 check.sh --quick
TMP="$(mktemp "${TMPDIR:-/tmp}/hack-stop-gate.XXXXXX" 2>/dev/null)" || pass_with "⚠️ 收尾门禁：mktemp 失败，跳过检查放行。"
trap 'rm -f "$TMP"' EXIT
mkdir -p logs 2>/dev/null

set -m   # 让后台的 check.sh 自成进程组，超时能连同 test.sh 等子进程一起杀掉
HACK_IN_GATE=1 CHECK_TEST_TIMEOUT="$TEST_LIMIT" bash scripts/check.sh --quick >"$TMP" 2>&1 </dev/null &
PID=$!
set +m
T0=$SECONDS
while kill -0 "$PID" 2>/dev/null; do
  if [ $((SECONDS - T0)) -ge "$LIMIT" ]; then
    {  # 整组重定向：连 bash 自己打的「Terminated」作业通知一起吞掉
      kill -TERM -- "-$PID" || kill -TERM "$PID"
      sleep 1
      kill -KILL -- "-$PID" || kill -KILL "$PID"
      wait "$PID"
    } 2>/dev/null
    { echo "# stop-gate $(date '+%F %H:%M')：check.sh --quick 超过 ${LIMIT} 秒被中止，下面不是完整结果（没有汇总行 = 不能当全绿）"
      cat "$TMP"; } > logs/last-check.txt 2>/dev/null
    pass_with "⚠️ 收尾门禁：check.sh --quick 超过 ${LIMIT} 秒没跑完，已中止并放行。手动跑 bash scripts/check.sh --quick 看结果。"
  fi
  sleep 0.2 2>/dev/null || sleep 1
done
wait "$PID" 2>/dev/null
RC=$?
OUT="$(cat "$TMP" 2>/dev/null)"

# ⑥ 没有汇总行 = check 没跑完（崩溃不许伪装成全绿）
SUMMARY="$(printf '%s\n' "$OUT" | grep -E '^=+ *汇总' | head -n 1)"
if [ -z "$SUMMARY" ]; then
  { echo "# stop-gate $(date '+%F %H:%M')：check.sh --quick 输出里没有「======== 汇总」行（退出码 $RC），按失败处理"
    printf '%s\n' "$OUT"; } > logs/last-check.txt 2>/dev/null
  {
    echo "🔒 收尾门禁：scripts/check.sh --quick 的输出里没有「======== 汇总」行（退出码 $RC）—— check 自己没跑完，崩溃不能当全绿。"
    echo "   先让 check 能跑完再结束回合；修不了（比如 check.sh 归 lead 管）就在回复里写明原因，下一次会放行。输出最后几行："
    printf '%s\n' "$OUT" | tail -n 12 | sed 's/^/   | /'
  } >&2
  exit 2
fi

# 只解析汇总行之前的部分：check.sh 在汇总行之后会把 ❌/⚠️ 项目行再列一遍
BODY="$(printf '%s\n' "$OUT" | awk '/^=+ *汇总/{exit} {print}')"

# ⑦ 看汇总行的 ❌ 数
NFAIL="$(printf '%s\n' "$SUMMARY" | sed 's/^=* *汇总//' | grep -oE '[0-9]+' | head -n 1)"
NFAIL="${NFAIL:-0}"
if [ "$NFAIL" = "0" ]; then
  [ "$RC" -eq 0 ] && exit 0
  {
    echo "🔒 收尾门禁：check.sh --quick 汇总 0 ❌ 但退出码是 $RC —— 自相矛盾，按失败处理（check.sh 可能中途出错）。"
    printf '%s\n' "$OUT" | tail -n 8 | sed 's/^/   | /'
    echo "   修不了就在回复里写明原因，下一次会放行。"
  } >&2
  exit 2
fi

FAIL_LINES="$(printf '%s\n' "$BODY" | grep -E '^\[[0-9]+\].*❌' | awk '!seen[$0]++')"
[ -z "$FAIL_LINES" ] && FAIL_LINES="$(printf '%s\n' "$BODY" | grep '❌' | awk '!seen[$0]++')"
FAIL_IDS="$(printf '%s\n' "$FAIL_LINES" | grep -oE '^\[[0-9]+\]' | sort -u | tr '\n' ' ')"

# 只有 [5] 红：看失败的模块本回合碰没碰过
if [ "$FAIL_IDS" = "[5] " ] && [ -n "$TURN_HEAD" ]; then
  # [5] 段 = [5] 项目行 + 它下面到下一个 [N] 之前的明细行（只在汇总行之前找）
  BLOCK5="$(printf '%s\n' "$BODY" | awk '/^\[[0-9]+\]/{in5=($0 ~ /^\[5\]/)} in5')"
  FAILED="$( {
      # 明细行：「    ❌ apps/beta/test.sh → …」（✅ 明细行、日志路径都不算）
      printf '%s\n' "$BLOCK5" | grep -E '^    ❌ ' | sed 's/^    ❌ //' | awk '{print $1}'
      # 项目行：「[5] 模块测试 ❌ 1/2 个 test.sh 失败：apps/beta, apps/gamma」
      printf '%s\n' "$BLOCK5" | grep -E '^\[5\].*失败：' | sed 's/^.*失败：//' | tr ',，、' '\n\n\n'
    } | sed 's/^[[:space:]]*//' | grep -oE '^(apps|starters)/[A-Za-z0-9._-]+' | sort -u )"
  # 本回合碰过的路径：工作区改动（-uall 展开未跟踪目录，改名两边都算）∪ 回合起点..HEAD 的提交
  FROM="$TURN_HEAD"; [ "$FROM" = "none" ] && FROM="$EMPTY_TREE"
  TOUCHED="$( {
      git status --porcelain -uall 2>/dev/null | cut -c4- | awk '{n=split($0,a," -> "); for(i=1;i<=n;i++) print a[i]}'
      [ "$HEAD_NOW" != "none" ] && git diff --name-only "$FROM" HEAD 2>/dev/null
    } | tr -d '"' | grep -oE '^(apps|starters)/[A-Za-z0-9._-]+' | sort -u )"
  if [ -n "$FAILED" ]; then
    MINE=""
    for f in $FAILED; do
      printf '%s\n' "$TOUCHED" | grep -qx -- "$f" && MINE="$MINE $f"
    done
    if [ -z "$MINE" ]; then
      FL="$(echo $FAILED)"
      pass_with "$(printf '⚠️ 收尾门禁：❌ 只在 [5] 模块测试，失败的是 %s，本回合没碰过 —— 不是本会话造成的，放行。回复里说一句「门禁红的是 %s 的测试，不是本会话造成的」。\n%s\n%s' \
        "$FL" "$FL" "$FAIL_LINES" "$SUMMARY")"
    fi
  fi
fi

{
  echo "🔒 收尾门禁（stop-gate.sh）：check.sh --quick 有 ❌，本回合不能就这样结束 —— 先修。"
  echo "   修不了的（缺文件、要人拍板、别人模块的问题）在回复里写明原因，下一次会放行。"
  printf '%s\n' "$FAIL_LINES" | head -n 20 | sed 's/^/   /'
  echo "   $SUMMARY"
  echo "   完整输出：logs/last-check.txt"
} >&2
exit 2
