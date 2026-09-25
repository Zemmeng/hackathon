#!/usr/bin/env bash
# sync.sh —— 零 token 的一手实况对齐（lead 每次发言前跑；Codex / 不用 AI 的人开场也跑）
#
# 用途：git fetch 后分节打印「现在真实发生了什么」：
#   [分支] 最近 N 小时各分支的提交   [PR] 开着的 PR、CI、是否 cross-module
#   [交接单] main 和各远端分支上还没落账的 handoff/*.md   [任务] 3-tasks 里所有 🔨 行
#   [main] 最近 5 条提交和最近一次 CI   [时间] 倒计时和阶段（与 check.sh 同一套算法）
#   🔒 docs/3-tasks.md 是二手账：它和这里冲突时，以这里（git / PR 实况）为准，再回填 3-tasks。
# 用法：bash scripts/sync.sh [小时数，默认 6]
# 退出码：0 = 打印完成（某节拿不到数据只 ⚠️ 不失败）；2 = 用法错误 / 不在 git 仓库里
set -uo pipefail

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOURS="${1:-6}"
case "$HOURS" in -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; exit 0 ;; esac
printf '%s' "$HOURS" | grep -Eq '^[0-9]+$' || { echo "❌ 小时数要是正整数：$HOURS" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null) \
  || { echo "❌ 不在 git 仓库里" >&2; exit 2; }
cd "$ROOT" || exit 2
g() { git -c core.quotePath=false "$@"; }

conf_get() { [ -f hackathon.conf ] && grep -E "^$1=" hackathon.conf | cut -d= -f2- | sed 's/#.*//' | xargs 2>/dev/null; }
CONF_TZ=$(conf_get TZ); CONF_TZ=${CONF_TZ:-Australia/Melbourne}
HAS_GH=0
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && g remote get-url origin >/dev/null 2>&1 && HAS_GH=1

echo "🔄 sync.sh · $(basename "$ROOT") · 最近 ${HOURS} 小时 · 时间按 $CONF_TZ"
echo "   （3-tasks 是二手账；和下面冲突时以下面为准，再回填 3-tasks）"

# ---------------------------------------------------------------- fetch
if g remote | grep -q .; then
  if g fetch --all --prune --quiet 2>/dev/null; then echo "   git fetch --all --prune ✅"
  else echo "   git fetch ⚠️ 失败（离线？），下面用本地已有的引用"; fi
else
  echo "   ⚠️ 没有远端，只看本地分支"
fi

HAS_HEAD=0; g rev-parse -q --verify HEAD >/dev/null 2>&1 && HAS_HEAD=1

# 分支列表（完整 refname）：先 main，再远端分支，再本地分支（按最近提交排序）
list_refs() {
  local r
  for r in refs/remotes/origin/main refs/heads/main; do
    g rev-parse -q --verify "$r" >/dev/null 2>&1 && echo "$r"
  done
  g for-each-ref --sort=-committerdate --format='%(refname)' refs/remotes/ 2>/dev/null | grep -v '/HEAD$'
  g for-each-ref --sort=-committerdate --format='%(refname)' refs/heads/ 2>/dev/null
}
short() { printf '%s' "$1" | sed -e 's|^refs/remotes/||' -e 's|^refs/heads/||'; }
REFS=$(list_refs | awk '!seen[$0]++')

# ---------------------------------------------------------------- [分支]
echo ""
echo "[分支] 最近 ${HOURS} 小时的提交（分支 | 作者 | 时间 | 标题；同一提交只在第一个包含它的分支下列一次）"
if [ "$HAS_HEAD" -eq 0 ] && [ -z "$REFS" ]; then
  echo "   （还没有任何提交）"
else
  SEEN=$(mktemp "${TMPDIR:-/tmp}/sync-seen.XXXXXX"); trap 'rm -f "$SEEN"' EXIT
  any=0
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    lines=$(TZ="$CONF_TZ" g log "$ref" --since="$HOURS hours ago" --date=format-local:'%m-%d %H:%M' \
              --format='%h%x09%an%x09%ad%x09%s' -n 50 2>/dev/null)
    [ -n "$lines" ] || continue
    shown=0
    while IFS="$(printf '\t')" read -r h an ad s; do
      grep -qx "$h" "$SEEN" && continue
      echo "$h" >>"$SEEN"
      [ "$shown" -lt 10 ] && printf '   %s | %s | %s | %s\n' "$(short "$ref")" "$an" "$ad" "$(printf '%s' "$s" | cut -c 1-80)"
      shown=$((shown + 1)); any=1
    done <<<"$lines"
    [ "$shown" -gt 10 ] && echo "   $(short "$ref") | …另有 $((shown - 10)) 条"
  done <<<"$REFS"
  [ "$any" -eq 1 ] || echo "   （最近 ${HOURS} 小时没有新提交）"
fi

# ---------------------------------------------------------------- [PR]
echo ""
echo "[PR] 开着的 PR（编号 | 作者 | draft | 分支 | CI | 标签）"
if [ "$HAS_GH" -eq 0 ]; then
  echo "   ⚠️ 跳过：gh 没装 / 没登录（gh auth login）/ 没有 origin 远端"
else
  pr_json=$(gh pr list --state open --limit 50 --json number,author,isDraft,headRefName,statusCheckRollup,labels 2>/dev/null)
  if [ -z "$pr_json" ]; then
    echo "   ⚠️ gh pr list 失败（远端不是 GitHub？网络？）"
  else
    printf '%s' "$pr_json" | python3 -c '
import json, sys
prs = json.load(sys.stdin)
if not prs:
    print("   （没有开着的 PR）")
for p in prs:
    checks = p.get("statusCheckRollup") or []
    states = []
    for c in checks:
        states.append((c.get("conclusion") or c.get("state") or c.get("status") or "").upper())
    if not checks:
        ci = "—"
    elif any(s in ("FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE") for s in states):
        ci = "❌"
    elif any(s in ("", "PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED") for s in states):
        ci = "⏳"
    else:
        ci = "✅"
    labels = [l.get("name", "") for l in p.get("labels") or []]
    cross = "⚠️cross-module" if "cross-module" in labels else ""
    other = ",".join(l for l in labels if l != "cross-module")
    print("   #%s | @%s | %s | %s | CI %s | %s" % (p["number"], (p.get("author") or {}).get("login", "?"),
          "draft" if p.get("isDraft") else "ready", p.get("headRefName", "?"), ci, " ".join(x for x in (cross, other) if x) or "—"))
' || echo "   ⚠️ 解析 gh 输出失败"
  fi
fi

# ---------------------------------------------------------------- [交接单]
echo ""
echo "[交接单] 还没落账的 handoff/*.md（不含 done/；main 和各远端分支上）"
HO=$(mktemp "${TMPDIR:-/tmp}/sync-ho.XXXXXX")
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  case "$ref" in refs/remotes/*|refs/heads/main) ;; *) continue ;; esac   # 本地功能分支别人看不到，不算
  g ls-tree -r --name-only "$ref" handoff/ 2>/dev/null | grep -E '^handoff/[^/]+\.md$' | grep -v '^handoff/README\.md$' |
    while IFS= read -r f; do printf '%s\t%s\n' "$f" "$(short "$ref")"; done
done <<<"$REFS" >"$HO"
if [ -s "$HO" ]; then
  # 同一张单可能出现在多个分支上：每张单一行，列出前 3 个分支
  sort -t "$(printf '\t')" -k1,1 -s "$HO" | awk -F '\t' '
    $1 != last { if (last != "") print "   " last "  （在 " refs (n > 3 ? " 等 " n " 个分支" : "") "）"; last = $1; refs = $2; n = 1; next }
    { n++; if (n <= 3) refs = refs ", " $2 }
    END { if (last != "") print "   " last "  （在 " refs (n > 3 ? " 等 " n " 个分支" : "") "）" }'
else
  echo "   （没有待处理的交接单）"
fi
rm -f "$HO"

# ---------------------------------------------------------------- [任务]
echo ""
echo "[任务] docs/3-tasks.md 里所有 🔨 行（前面是所在的节）"
if [ -f docs/3-tasks.md ]; then
  python3 - "$CONF_TZ" <<'PY'
import re, sys
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(sys.argv[1])
except Exception:
    tz = datetime.now().astimezone().tzinfo
now = datetime.now(timezone.utc)
sec, n = '', 0
for line in open('docs/3-tasks.md', encoding='utf-8', errors='replace'):
    line = line.rstrip('\n')
    if line.startswith('## '):
        sec = line[3:].strip()
    if not line.lstrip().startswith('|') or '🔨' not in line:
        continue
    n += 1
    since = ''
    m = re.search(r'(?:(\d{4})-)?(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})', line)
    if m:
        y = int(m.group(1) or now.astimezone(tz).year)
        try:
            at = datetime(y, int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), tzinfo=tz).astimezone(timezone.utc)
            if not m.group(1) and at > now + timedelta(days=1):
                at = at.replace(year=y - 1)
            h = (now - at).total_seconds() / 3600
            since = '  ← 已开始 %.1fh%s' % (h, '（超过 2h 的时间盒，问一下卡在哪）' if h > 2 else '') if h >= 0 else ''
        except ValueError:
            pass
    print('   [%s] %s%s' % (sec or '?', ' '.join(line.split())[:140], since))
if n == 0:
    print('   （没有 🔨 进行中的任务）')
PY
else
  echo "   ⚠️ 没有 docs/3-tasks.md"
fi

# ---------------------------------------------------------------- [main]
echo ""
MAIN_REF=""
for r in origin/main main; do g rev-parse -q --verify "$r^{commit}" >/dev/null 2>&1 && { MAIN_REF=$r; break; }; done
echo "[main] 最近 5 条提交（${MAIN_REF:-没有 main}）"
if [ -n "$MAIN_REF" ]; then
  TZ="$CONF_TZ" g log "$MAIN_REF" -n 5 --date=format-local:'%m-%d %H:%M' --format='   %h | %an | %ad | %s' 2>/dev/null
  if [ "$HAS_GH" -eq 1 ]; then
    if run=$(gh run list --branch main --limit 1 --json conclusion,status,displayTitle,createdAt \
          --jq 'if length == 0 then "（还没有记录）" else .[0] | "\(.status) \(.conclusion // "") | \(.displayTitle) | \(.createdAt)" end' 2>/dev/null); then
      echo "   最近一次 CI：$run"
    else
      echo "   最近一次 CI：⚠️ 查不到（远端不是 GitHub？网络？）"
    fi
  else
    echo "   最近一次 CI：⚠️ gh 不可用，跳过"
  fi
else
  echo "   （还没有任何提交）"
fi

# ---------------------------------------------------------------- [时间]
echo ""
echo "[时间]"
if [ -f "$SELF_DIR/check.sh" ]; then bash "$SELF_DIR/check.sh" --time | sed 's/^/   /'
else echo "   ⚠️ 没有 scripts/check.sh，算不了倒计时"; fi
exit 0
