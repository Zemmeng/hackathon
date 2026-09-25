#!/usr/bin/env bash
# deploy.sh —— 一条命令部署并自动线上冒烟。与技术栈无关：调各模块自己的 npm run deploy 或 deploy.sh。
#
# 🔒 只有 hackathon.conf 的 DEPLOYER 能跑（DEPLOYER 不在时 BACKUP_LEAD 可以备份部署，会打 ⚠️ 并在 deploy.log 标「备份部署」）；
#    AI 执行前必须先问人（.claude/settings.json 里是 ask）。
# 用途：前置检查全过才部署：
#   [1/6] git config hack.me 等于 DEPLOYER（或 BACKUP_LEAD → ⚠️ 备份部署）
#   [2/6] 工作区干净（没有未提交 / 未跟踪的文件）
#   [3/6] HEAD 在 main 或某个 tag 上，且与 origin 一致（没有远端只 ⚠️）
#   [4/6] 代码冻结期（按 hackathon.conf 算）只能从 demo-* tag 部署，除非 --hotfix
#   [5/6] bash scripts/check.sh 全量没有 ❌（--quick 在干净的 main 上几乎什么都不查）
#   [6/6] 逐个模块部署，打印 [i/N]：有 package.json 且含 deploy 脚本 → npm run deploy；否则有 deploy.sh → 执行；否则 ❌
#   依赖：有 package-lock.json 用 npm ci；没有用 npm install --no-package-lock（不生成未跟踪的 lockfile）
#   之后：DEMO_URL 非空就跑 check.sh --e2e；每个模块追加一行到 logs/deploy.log（时间 | 模块 | commit | 谁）；
#   失败时打印回滚命令（切到上一个 demo-* tag 重新部署）。
# 用法：bash scripts/deploy.sh <模块|all> [--hotfix]
#   all = hackathon.conf 的 DEPLOY_MODULES（空格分隔的 apps/ 下目录名）
# 退出码：0 = 部署和冒烟都通过；1 = 被拒绝或失败；2 = 用法错误 / 不在 git 仓库里
set -uo pipefail

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; }

TARGET=""; HOTFIX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --hotfix) HOTFIX=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "❌ 未知参数：$1" >&2; usage; exit 2 ;;
    *) [ -z "$TARGET" ] || { echo "❌ 一次只给一个模块（或 all）" >&2; exit 2; }; TARGET="$1" ;;
  esac
  shift
done
[ -n "$TARGET" ] || { usage; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "❌ 不在 git 仓库里" >&2; exit 2; }
cd "$ROOT" || exit 2
g() { git -c core.quotePath=false "$@"; }
conf_get() { grep -E "^$1=" hackathon.conf | cut -d= -f2- | sed 's/#.*//' | xargs 2>/dev/null; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

refuse() {  # refuse <原因> [修法]
  echo "🚫 拒绝部署：$1"
  [ -n "${2:-}" ] && echo "   修法：$2"
  exit 1
}

[ -f hackathon.conf ] || refuse "没有 hackathon.conf" "从模板仓库拿回来"
DEPLOYER=$(conf_get DEPLOYER); BACKUP_LEAD=$(conf_get BACKUP_LEAD); DEMO_URL=$(conf_get DEMO_URL); MODULES_ALL=$(conf_get DEPLOY_MODULES)
CONF_TZ=$(conf_get TZ); CONF_TZ=${CONF_TZ:-Australia/Melbourne}
ME=$(git config hack.me 2>/dev/null || true)

echo "🚀 deploy.sh $TARGET$([ "$HOTFIX" = 1 ] && echo ' --hotfix')"

# 回滚提示：上一个不在 HEAD 上的 demo-* tag
print_rollback() {
  local here prev t
  here=$(g tag --points-at HEAD 2>/dev/null | tr '\n' ' ')
  prev=""
  for t in $(g tag -l 'demo-*' --sort=-creatordate 2>/dev/null); do
    case " $here " in *" $t "*) continue ;; esac
    prev="$t"; break
  done
  echo ""
  echo "↩️  回滚（线上坏了就先恢复上一个能演示的版本，再慢慢修）："
  if [ -n "$prev" ]; then
    echo "    git switch --detach $prev && bash scripts/deploy.sh $TARGET"
  else
    echo "    还没有别的 demo-* tag。挑一个能用的 commit（git log --oneline -n 10），打 tag 再部署："
    echo "    git tag -a demo-rollback <commit> -m '回滚' && git push origin demo-rollback \\"
    echo "      && git switch --detach demo-rollback && bash scripts/deploy.sh $TARGET"
    echo "    （tag 要先推到 origin，否则 [3/6] 会拒绝）"
  fi
  echo "    修好后回到 main：git switch main"
}

# ---- [1/6] 身份 ----
[ -n "$DEPLOYER" ] || refuse "hackathon.conf 的 DEPLOYER 为空" "lead 在 hackathon.conf 填 DEPLOYER=<GitHub handle>"
[ -n "$ME" ] || refuse "没设 git config hack.me，不知道你是谁" "bash scripts/setup.sh（或 git config hack.me <你的 GitHub handle>）"
BACKUP_DEPLOY=0
if [ "$(lower "$ME")" = "$(lower "$DEPLOYER")" ]; then
  echo "[1/6] 身份 @$ME = DEPLOYER ✅"
elif [ -n "$BACKUP_LEAD" ] && [ "$(lower "$ME")" = "$(lower "$BACKUP_LEAD")" ]; then
  BACKUP_DEPLOY=1
  echo "[1/6] 身份 @$ME = BACKUP_LEAD ⚠️ 备份部署（DEPLOYER 是 @$DEPLOYER；确认过对方不在再继续，deploy.log 会标「备份部署」）"
else
  refuse "只有 DEPLOYER（@$DEPLOYER）${BACKUP_LEAD:+或 BACKUP_LEAD（@$BACKUP_LEAD）}能部署，你是 @$ME" "找 @$DEPLOYER 部署；要换部署人由 lead 改 hackathon.conf"
fi

# ---- [2/6] 工作区干净 ----
DIRTY=$(g status --porcelain 2>/dev/null)
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" | head -n 10 | sed 's/^/    /'
  refuse "工作区不干净（$(printf '%s\n' "$DIRTY" | grep -c .) 个文件没提交），部署的必须是某个 commit 的原样" \
         "git stash -u（或提交 / 丢弃这些改动）后再跑"
fi
echo "[2/6] 工作区干净 ✅"

# ---- [3/6] HEAD 在 main 或 tag 上，且与 origin 一致 ----
g rev-parse -q --verify HEAD >/dev/null 2>&1 || refuse "还没有任何提交"
COMMIT=$(g rev-parse --short HEAD)
BR=$(g symbolic-ref --short -q HEAD 2>/dev/null || true)
TAGS=$(g tag --points-at HEAD 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
if [ "$BR" != main ] && [ -z "$TAGS" ]; then
  refuse "HEAD（$COMMIT，${BR:-detached}）既不在 main 上也不在 tag 上" "git switch main && git pull；或 git switch --detach demo-v1"
fi
WHERE="${BR:+$BR }${TAGS:+tag $TAGS }@ $COMMIT"
if g remote get-url origin >/dev/null 2>&1; then
  if ! g fetch origin --tags --quiet 2>/dev/null; then
    echo "[3/6] $WHERE ⚠️ git fetch origin 失败（离线？），没法确认与 origin 一致"
  elif [ "$BR" = main ]; then
    ORIGIN_MAIN=$(g rev-parse -q --verify refs/remotes/origin/main 2>/dev/null || true)
    [ "$ORIGIN_MAIN" = "$(g rev-parse HEAD)" ] \
      || refuse "本地 main（$COMMIT）和 origin/main（${ORIGIN_MAIN:0:7}）不一致" "git pull（本地有没推的提交就先走 PR 合进 main）"
    echo "[3/6] $WHERE 与 origin/main 一致 ✅"
  else
    ok_tag=""
    for t in $TAGS; do
      remote_sha=$(g ls-remote --tags origin "refs/tags/$t" "refs/tags/$t^{}" 2>/dev/null | awk '{print $1}' | tail -n 1)
      [ "$remote_sha" = "$(g rev-parse HEAD)" ] && { ok_tag="$t"; break; }
    done
    [ -n "$ok_tag" ] || refuse "tag $TAGS 还没推到 origin（或 origin 上同名 tag 指向别的提交）" "git push origin <tag>"
    echo "[3/6] $WHERE 与 origin 上的 tag $ok_tag 一致 ✅"
  fi
else
  echo "[3/6] $WHERE ⚠️ 没有 origin 远端，没法确认与 origin 一致"
fi

# ---- [4/6] 冻结期规则 ----
PHASE=$(bash "$SELF_DIR/check.sh" --time-raw 2>/dev/null | sed -n 's/^PHASE=//p')
DEMO_TAG=$(printf '%s\n' $TAGS | grep '^demo-' | head -n 1)
case "$PHASE" in
  *代码冻结*|已截止)
    if [ -n "$DEMO_TAG" ]; then echo "[4/6] 阶段 $PHASE，HEAD 在 $DEMO_TAG 上 ✅"
    elif [ "$HOTFIX" = 1 ]; then echo "[4/6] 阶段 $PHASE ⚠️ --hotfix：不在 demo-* tag 上也部署（事后打 tag、在 decisions 记一条）"
    else refuse "阶段 $PHASE：代码冻结后只能从 demo-* tag 部署" "git tag -a demo-v2 -m '可演示版本' && git push origin demo-v2 && git switch --detach demo-v2；P0 紧急修复加 --hotfix"
    fi ;;
  *) echo "[4/6] 阶段 ${PHASE:-未知} ✅" ;;
esac

# ---- 模块清单 ----
if [ "$TARGET" = all ]; then
  MODULES="$MODULES_ALL"
  [ -n "$MODULES" ] || refuse "hackathon.conf 的 DEPLOY_MODULES 为空" "lead 在 conf 里写上要部署的模块（空格分隔），或指定单个模块"
else
  MODULES="$TARGET"
fi
for m in $MODULES; do
  [ -d "apps/$m" ] || refuse "apps/$m 不存在" "检查模块名 / DEPLOY_MODULES"
done

# ---- [5/6] 全量 check（--quick 只看相对 base 的改动，干净的 main 上等于没查）----
echo "[5/6] bash scripts/check.sh（全量，跑全部测试）…"
CHK=$(bash "$SELF_DIR/check.sh" 2>&1); CHK_RC=$?
printf '%s\n' "$CHK" | sed -n '/^======== 汇总/,$p' | sed 's/^/    /'
if [ "$CHK_RC" -ne 0 ] || ! printf '%s\n' "$CHK" | grep -q '^======== 汇总 0 ❌'; then
  refuse "check.sh 有 ❌（或没跑完）" "先修好再部署；完整输出在 logs/last-check.txt"
fi
echo "[5/6] check 全量没有 ❌ ✅"

# ---- [6/6] 部署 ----
now_str() {
  python3 -c 'import sys; from datetime import datetime; from zoneinfo import ZoneInfo; print(datetime.now(ZoneInfo(sys.argv[1])).strftime("%Y-%m-%d %H:%M %Z"))' "$CONF_TZ" 2>/dev/null \
    || date '+%Y-%m-%d %H:%M'
}
mkdir -p logs
log_line() {
  local who="@$ME"
  [ "$BACKUP_DEPLOY" = 1 ] && who="@$ME（备份部署）"
  printf '%s | %s | %s | %s\n' "$(now_str)" "$1" "$COMMIT${TAGS:+ ($TAGS)}" "$who" >>logs/deploy.log
}
has_deploy_script() {
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if (d.get("scripts") or {}).get("deploy") else 1)' "$1" 2>/dev/null
}

N=$(printf '%s\n' $MODULES | grep -c .)
i=0
for m in $MODULES; do
  i=$((i + 1))
  echo ""
  echo "[$i/$N] 部署 $m …"
  rc=0
  if [ -f "apps/$m/package.json" ] && has_deploy_script "apps/$m/package.json"; then
    if [ ! -d "apps/$m/node_modules" ]; then
      # 有锁文件就严格按锁装；没有就别顺手生成一个未跟踪的 package-lock.json（会弄脏工作区）
      if [ -f "apps/$m/package-lock.json" ]; then
        echo "      apps/$m 没装依赖，先装：npm ci"
        (cd "apps/$m" && npm ci --no-audit --no-fund) || rc=$?
      else
        echo "      apps/$m 没装依赖，先装：npm install --no-package-lock"
        (cd "apps/$m" && npm install --no-package-lock --no-audit --no-fund) || rc=$?
      fi
    fi
    [ "$rc" -eq 0 ] && { (cd "apps/$m" && npm run deploy); rc=$?; }
  elif [ -f "apps/$m/deploy.sh" ]; then
    (cd "apps/$m" && bash deploy.sh); rc=$?
  else
    echo "[$i/$N] $m ❌ 没有部署方式：package.json 里加 \"deploy\" 脚本，或写 apps/$m/deploy.sh"
    log_line "$m（失败：没有部署方式）"
    print_rollback; exit 1
  fi
  if [ "$rc" -ne 0 ]; then
    echo "[$i/$N] $m ❌ 部署失败（退出码 $rc）"
    log_line "$m（失败）"
    print_rollback; exit 1
  fi
  log_line "$m"
  echo "[$i/$N] $m ✅"
done

# ---- 线上冒烟 ----
echo ""
if [ -n "$DEMO_URL" ]; then
  echo "🌐 线上冒烟：bash scripts/check.sh --e2e $DEMO_URL"
  if ! bash "$SELF_DIR/check.sh" --e2e "$DEMO_URL"; then
    echo "❌ 部署成功但线上冒烟没过（完整输出 logs/last-e2e.txt）"
    print_rollback; exit 1
  fi
else
  echo "⚠️ hackathon.conf 的 DEMO_URL 为空，跳过线上冒烟（M1 部署打通后由 lead 填上，并写进 README 顶部）"
fi

echo ""
echo "✅ 部署完成：$MODULES"
echo "   URL：${DEMO_URL:-（DEMO_URL 未设置）}"
echo "   commit：$COMMIT${TAGS:+（tag $TAGS）} · 时间：$(now_str) · 部署人：@$ME$([ "$BACKUP_DEPLOY" = 1 ] && echo '（备份部署）')"
echo "   已追加到 logs/deploy.log"
echo "   提醒 lead：更新 docs/3-tasks.md 顶部「线上版本」（tag 或 commit + 部署时间）"
exit 0
