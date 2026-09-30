#!/usr/bin/env bash
# setup.sh —— clone 后跑一次（可以重复跑，幂等）：一次把新队员的本机环境配好。
#
# 用途：[1/7] 检查工具（git、gh、node ≥20、python3 ≥3.9 必需；wrangler、uv 可选），缺什么打印安装命令，不中断
#       [2/7] gh 登录状态
#       [3/7] 启用仓库自带的 git hooks（core.hooksPath=.githooks）并补可执行位
#       [4/7] 没有 .env 就从 .env.example 复制（不覆盖已有的）；建 logs/ out/ scratch/
#       [5/7] 身份：hack.me = GitHub handle；user.email 为空或是 *.local 主机名邮箱时只打印建议命令，不替你改
#       [6/7] docs/3-tasks.md 里有没有你的「## @handle」节；hackathon.conf 倒计时
#       [7/7] bash scripts/check.sh --quick，打印汇总
#   🔒 不碰任何 key 的值；不 commit、不 push。
# 用法：bash scripts/setup.sh
# 退出码：0 = 跑完（有 ⚠️ 也是 0，照提示补上再跑一次）；2 = 不在 git 仓库里
set -uo pipefail

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case "${1:-}" in -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; exit 0 ;; esac
ROOT=$(git -C "$SELF_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null) \
  || { echo "❌ 不在 git 仓库里：先 git clone，再在仓库里跑 bash scripts/setup.sh" >&2; exit 2; }
cd "$ROOT" || exit 2

OS=$(uname -s)
WARN=0
ok() { echo "      ✅ $*"; }
warn() { echo "      ⚠️ $*"; WARN=$((WARN + 1)); }
fix() { echo "         → $*"; }
install_hint() {  # install_hint <mac 命令> <linux 命令>
  if [ "$OS" = Darwin ]; then fix "$1"; else fix "$2"; fi
}
ver_ge() {  # ver_ge <实际版本> <最低版本>：按点分数字比较
  python3 -c 'import sys
a = [int(x) for x in sys.argv[1].split(".")[:3] if x.isdigit()]
b = [int(x) for x in sys.argv[2].split(".")[:3]]
sys.exit(0 if a >= b else 1)' "$1" "$2" 2>/dev/null
}

echo "🛠  setup.sh · $(basename "$ROOT")（可以重复跑）"

# ---------------------------------------------------------------- [1/7] 工具
echo "[1/7] 检查工具"
if command -v git >/dev/null 2>&1; then ok "git $(git --version | awk '{print $3}')"; else warn "没有 git"; install_hint "xcode-select --install" "sudo apt install -y git"; fi
HAS_PY=0
if command -v python3 >/dev/null 2>&1; then
  PYV=$(python3 -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')
  if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then ok "python3 $PYV"; HAS_PY=1
  else warn "python3 $PYV < 3.9（脚本要用 zoneinfo 算倒计时）"; install_hint "brew install python@3.12" "sudo apt install -y python3"; fi
else
  warn "没有 python3（≥3.9）"; install_hint "brew install python@3.12" "sudo apt install -y python3"
fi
if command -v node >/dev/null 2>&1; then
  NV=$(node -v 2>/dev/null | sed 's/^v//')
  if [ "$HAS_PY" = 1 ] && ver_ge "$NV" 20; then ok "node $NV"
  elif [ "$HAS_PY" = 1 ]; then warn "node $NV < 20"; install_hint "brew install node@20（或 nvm install 20）" "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs（或 nvm install 20）"
  else ok "node ${NV}（没法比版本，需要 ≥20）"; fi
else
  warn "没有 node（≥20）"; install_hint "brew install node@20（或 nvm install 20）" "nvm install 20（或 nodesource 的 setup_20.x）"
fi
HAS_GH=0
if command -v gh >/dev/null 2>&1; then ok "gh $(gh --version 2>/dev/null | head -n 1 | awk '{print $3}')"; HAS_GH=1
else warn "没有 gh（GitHub CLI：开 PR、查 CI、自动识别你的 handle 都靠它）"; install_hint "brew install gh" "sudo apt install -y gh（或见 https://cli.github.com）"; fi
if command -v wrangler >/dev/null 2>&1; then ok "wrangler（可选）已装"
else echo "      · wrangler 可选：web-worker 模块里 npm i 后用 npx wrangler，不用全局装"; fi
if command -v uv >/dev/null 2>&1; then ok "uv（可选）已装"
else echo "      · uv 可选：py-tool 要装依赖时再装（$([ "$OS" = Darwin ] && echo 'brew install uv' || echo 'curl -LsSf https://astral.sh/uv/install.sh | sh')）"; fi

# ---------------------------------------------------------------- [2/7] gh 登录
echo "[2/7] gh 登录"
GH_OK=0
if [ "$HAS_GH" = 1 ]; then
  if gh auth status >/dev/null 2>&1; then ok "gh 已登录"; GH_OK=1
  else warn "gh 没登录"; fix "gh auth login   （选 GitHub.com → HTTPS → 浏览器登录；token 只存在 gh 自己的钥匙串里）"; fi
else
  warn "没有 gh，跳过"
fi

# ---------------------------------------------------------------- [3/7] hooks
echo "[3/7] 启用 git hooks"
if [ -d .githooks ]; then
  git config core.hooksPath .githooks && ok "git config core.hooksPath .githooks"
  chmod +x .githooks/* 2>/dev/null
  chmod +x scripts/*.sh 2>/dev/null
  ok "chmod +x .githooks/* scripts/*.sh（commit 前扫秘密，push 前跑 check --quick）"
else
  warn "没有 .githooks/ 目录（模板不完整？找 lead）"
fi

# ---------------------------------------------------------------- [4/7] .env 与本地目录
echo "[4/7] .env 与本地目录"
if [ -f .env ]; then ok ".env 已存在，不覆盖"
elif [ -f .env.example ]; then cp .env.example .env && ok "已从 .env.example 复制出 .env —— 值自己填，🔒 别发群、别贴 issue / PR / 交接单"
else warn "没有 .env.example，跳过"; fi
mkdir -p logs out scratch && ok "logs/ out/ scratch/ 已就绪（都在 .gitignore 里）"

# ---------------------------------------------------------------- [5/7] 身份
echo "[5/7] 身份"
ME=$(git config hack.me 2>/dev/null || true)
if [ "$GH_OK" = 1 ]; then
  LOGIN=$(gh api user --jq .login 2>/dev/null || true)
  if [ -n "$LOGIN" ]; then
    git config hack.me "$LOGIN" && ME="$LOGIN" && ok "git config hack.me ${LOGIN}（从 gh api user 读的）"
  else
    warn "gh api user 没拿到 handle（网络？）"
  fi
fi
if [ -z "$ME" ]; then
  warn "不知道你的 GitHub handle"
  fix "git config hack.me <你的 GitHub handle>   （不带 @；hooks 和 check 靠它认人）"
elif [ "$GH_OK" != 1 ]; then
  ok "hack.me = ${ME}（沿用已有设置；gh 登录后重跑会自动校正）"
fi
EMAIL=$(git config user.email 2>/dev/null || true)
case "$EMAIL" in
  "") warn "git 的 user.email 为空" ;;
  *.local) warn "git 的 user.email 是本机主机名邮箱（*.local），GitHub 认不出是你" ;;
  *) ok "user.email 已设置（不显示具体值）"; EMAIL="set" ;;
esac
if [ "$EMAIL" != set ]; then
  fix "建议（自己决定要不要跑；脚本不替你改）：git config user.email ${ME:-<handle>}@users.noreply.github.com"
  fix "以 GitHub → Settings → Emails 里显示的 noreply 地址为准（新账号是 <数字ID>+<handle>@users.noreply.github.com）"
fi
[ -n "$(git config user.name 2>/dev/null)" ] || { warn "git 的 user.name 为空"; fix "git config user.name \"<你的名字或 handle>\""; }

# ---------------------------------------------------------------- [6/7] 任务板与倒计时
echo "[6/7] 任务板与倒计时"
if [ ! -f docs/3-tasks.md ]; then
  warn "没有 docs/3-tasks.md（模板不完整？找 lead）"
elif [ -z "$ME" ]; then
  warn "先设 hack.me，才能找你在 3-tasks 里的节"
elif grep -qiE "^## @${ME}[[:space:]]*$" docs/3-tasks.md; then
  ok "docs/3-tasks.md 里有你的节「## @${ME}」"
else
  warn "docs/3-tasks.md 里还没有「## @${ME}」节 —— 去找 lead 加（每人一节，只改自己那节）"
fi
if [ -f scripts/check.sh ]; then bash scripts/check.sh --time | sed 's/^/      /'
else warn "没有 scripts/check.sh，算不了倒计时"; fi

# ---------------------------------------------------------------- [7/7] check --quick
echo "[7/7] bash scripts/check.sh --quick"
if [ -f scripts/check.sh ]; then
  CHK=$(bash scripts/check.sh --quick 2>&1); CHK_RC=$?
  SUM=$(printf '%s\n' "$CHK" | sed -n '/^======== 汇总/,$p')
  if [ -n "$SUM" ]; then printf '%s\n' "$SUM" | sed 's/^/      /'
  else warn "check.sh 没有输出汇总行（退出码 ${CHK_RC}），看 logs/last-check.txt"; fi
  [ "$CHK_RC" -eq 0 ] || fix "有 ❌：完整输出在 logs/last-check.txt；是别人留下的就告诉 lead"
else
  warn "没有 scripts/check.sh"
fi

echo ""
if [ "$WARN" -gt 0 ]; then echo "setup 跑完：$WARN 处 ⚠️，照上面的 → 补上后可以再跑一次（幂等）"
else echo "setup 跑完：环境齐了 ✅"; fi
echo "下一步：看 README ④"
exit 0
