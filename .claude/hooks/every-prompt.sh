#!/usr/bin/env bash
# every-prompt.sh —— UserPromptSubmit hook：每条消息都注入「时间 + 最容易被忘的硬规则」
#
# 为什么用 hook 而不是只写在 CLAUDE.md：
#   SessionStart 只响一次；只写在 CLAUDE.md 里的规则隔十几轮就沉底了（学习项目实测：
#   开场读到的要求，两个半小时后已经被忘）。每条消息都响的 hook 是唯一验证过「隔多久都不失效」的机制。
#   代价是每条消息都占上下文 → 🔒 常态最多 4 行，规则最多 4 条；只在异常时多 1 行（多个异常合并成这 1 行）。
#
# 输出（stdout 纯文本，≤5 行，exit 0）：
#   1 当前时间 · 离截止几小时 · 阶段（说时间就用这个，别猜）
#   2 当前分支 · 模块
#   3 RULES 块压成一行 —— 运行时从 CONTRIBUTING.md 的 <!-- RULES:BEGIN -->…<!-- RULES:END --> 读，
#     每条取第一句。规则只有一个出处，这里不抄正文；CONTRIBUTING.md 不存在就跳过这行。
#   4 固定：🔒 subagent 用 opus、禁 fable；数量不限（D-0929-1429）
#   5 仅异常时：在 main 上且有改动 / 落后 origin/main >20 个提交 / 冻结期只修 P0
#
# subagent 模型：settings.json 的 env.CLAUDE_CODE_SUBAGENT_MODEL=opus 只是第一层（不同版本未必生效，赛前实测）；
#   真正的保险是 .claude/agents/*.md frontmatter 写死的 `model: opus`（check [6] 守）+ CLAUDE.md 规则（D-02）。
#   第 4 行就是把这条每回合再提一次。
#
# 时间按 hackathon.conf 的 TZ 用 python3 zoneinfo 现算（不写死 UTC 偏移，墨尔本 10-04 进夏令时）；
# DEADLINE 为空 → 倒计时 --、阶段「未设置」，不报错。
# 副作用（唯一一处写文件）：每条消息把 `git rev-parse HEAD` 写进 logs/.turn-head（还没有提交就写 none）。
#   这是「本回合起点」：stop-gate.sh 拿它和收工时的 HEAD 比，AI「先 commit 再收工」也照样跑检查。
#   logs/ 已 gitignore，不会弄脏 git status；每个 worktree 各有一份。
# 手动测：bash .claude/hooks/every-prompt.sh; cat logs/.turn-head   （输出 ≤5 行）
# 依赖：bash、git、python3 ≥3.9。任何失败都只少输出，不报错；退出码永远 0。hook 限时 5 秒，git 调用各限 1.5 秒。
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"
fi
SUBAGENT_LINE='🔒 subagent 用 opus、禁 fable；数量不限，求快（D-0929-1429）'

fallback() {
  printf '%s\n' "⏰ 现在 $(date '+%Y-%m-%d %H:%M')（本机时间；⚠️ every-prompt.sh 生成失败，倒计时看 hackathon.conf）"
  printf '%s\n' "$SUBAGENT_LINE"
  exit 0
}

[ -n "$ROOT" ] && cd "$ROOT" 2>/dev/null || fallback

# 记下本回合起点（给 stop-gate.sh 用）。[ -e .git ]：worktree 里 .git 是文件
if [ -e .git ] && command -v git >/dev/null 2>&1 && mkdir -p logs 2>/dev/null; then
  { git rev-parse -q --verify HEAD 2>/dev/null || echo none; } > logs/.turn-head 2>/dev/null
fi

command -v python3 >/dev/null 2>&1 || fallback

OUT="$(python3 - "$ROOT" "$SUBAGENT_LINE" <<'PY' 2>/dev/null
import os, re, subprocess, sys
from datetime import datetime, timedelta, timezone

ROOT, SUBAGENT_LINE = sys.argv[1], sys.argv[2]
WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
NUM = '①②③④'


def git(*args):
    try:
        r = subprocess.run(['git'] + list(args), cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1.5)
        return r.returncode, r.stdout.decode('utf-8', 'replace')
    except Exception:
        return 127, ''


def read(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read()


conf = {}
for line in (read('hackathon.conf') or '').splitlines():
    m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
    if m and m.group(1) not in conf:
        conf[m.group(1)] = m.group(2).split('#', 1)[0].strip().strip('"').strip("'")

lines, alerts = [], []

# ---- 1 时间 · 倒计时 · 阶段 ----
phase = '未设置'
try:
    tzname = conf.get('TZ', '')
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tzname)
    except Exception:
        tz, tzname = datetime.now().astimezone().tzinfo, '本机时区⚠️'
    now = datetime.now(timezone.utc)

    def parse(key):
        try:
            return datetime.strptime(conf.get(key, ''), '%Y-%m-%d %H:%M').replace(tzinfo=tz).astimezone(timezone.utc)
        except ValueError:
            return None

    def hours(key, default):
        try:
            return float(conf.get(key) or default)
        except ValueError:
            return float(default)

    start, dl = parse('START'), parse('DEADLINE')
    local = now.astimezone(tz)
    left = '--'
    if dl is not None:
        ff, cf = dl - timedelta(hours=hours('FEATURE_FREEZE_HOURS', 6)), dl - timedelta(hours=hours('CODE_FREEZE_HOURS', 2))
        phase = ('已截止' if now >= dl else '🔒代码冻结' if now >= cf else '🧊功能冻结' if now >= ff
                 else '赛前' if (start is not None and now < start) else '开发')
        h = (dl - now).total_seconds() / 3600
        left = ('%.1fh' % h) if h >= 0 else ('已过 %.1fh' % -h)
    lines.append('⏰ 现在 %s %s %s（%s）｜离截止 %s｜阶段 %s —— 说时间就用这个，别猜'
                 % (local.strftime('%Y-%m-%d'), WEEK[local.weekday()], local.strftime('%H:%M'), tzname, left, phase))
except Exception:
    lines.append('⏰ 现在 %s（⚠️ 倒计时算不出来，看 hackathon.conf）' % datetime.now().strftime('%Y-%m-%d %H:%M'))

# ---- 2 分支 · 模块 ----
try:
    br = git('symbolic-ref', '--short', '-q', 'HEAD')[1].strip()
    if not br:
        lines.append('🌿 detached HEAD ⚠️ 先切到任务分支' if git('rev-parse', '--git-dir')[0] == 0 else '🌿 ⚠️ 这里不是 git 仓库')
    elif br in ('main', 'master'):
        lines.append('🌿 分支 %s｜模块 —（在 main 上：先开分支再改）' % br)
        st = git('status', '--porcelain')[1]
        n = len([l for l in st.splitlines() if l.strip()])
        if n:
            alerts.append('⚠️ 在 %s 上有 %d 个改动：先 git switch -c <handle>/<模块>/T<n>-<短名> 把改动带过去' % (br, n))
    elif br.startswith('lead/'):
        lines.append('🌿 分支 %s｜lead 分支（全仓库）' % br)
    else:
        m = re.match(r'^[^/]+/([^/]+)/T\d+', br)
        lines.append('🌿 分支 %s｜模块 %s' % (br, m.group(1) if m else '？（分支名不合规，推不出模块）'))
    if git('rev-parse', '--verify', '-q', 'refs/remotes/origin/main')[0] == 0 and git('rev-parse', '--verify', '-q', 'HEAD')[0] == 0:
        c = git('rev-list', '--count', 'HEAD..refs/remotes/origin/main')[1].strip()
        if c.isdigit() and int(c) > 20:
            alerts.append('⚠️ 落后 origin/main %s 个提交：先 git merge origin/main' % c)
except Exception:
    pass

# ---- 3 RULES 块压成一行（单一出处：CONTRIBUTING.md）----
try:
    text = read('CONTRIBUTING.md')
    m = re.search(r'<!--\s*RULES:BEGIN\s*-->(.*?)<!--\s*RULES:END\s*-->', text or '', re.S)
    if m:
        raw = [l.strip() for l in m.group(1).splitlines()]
        raw = [l for l in raw if l and not l.startswith(('#', '<!--')) and not re.match(r'^\|?[\s:|-]+\|?$', l)]
        items = [l for l in raw if re.match(r'^(🔒|[-*]\s|\d+[.)、]\s*|>\s*🔒)', l)] or raw
        firsts = []
        for l in items[:4]:
            l = re.sub(r'^[>|\s]*', '', l)
            l = re.sub(r'^🔒\s*', '', l)
            b = re.match(r'^\*\*(.+?)\*\*', l)
            s = b.group(1) if b else l.replace('**', '')
            s = re.sub(r'^([-*]|\d+[.)、])\s*', '', s).replace('`', '')
            parts = re.split(r'[。！？；]', s, 1)          # 中文句末优先
            s = parts[0] if len(parts) > 1 else re.split(r' / |\.\s|\.$', s, 1)[0]
            s = s.strip(' ：:，,')
            if s:
                firsts.append(NUM[len(firsts)] + (s if len(s) <= 40 else s[:39] + '…'))
        if firsts:
            lines.append('📜 规矩（CONTRIBUTING.md）：' + ' '.join(firsts))
except Exception:
    pass

# ---- 4 固定 ----
lines.append(SUBAGENT_LINE)

# ---- 5 只在异常时：合并成一行 ----
if phase in ('🧊功能冻结', '🔒代码冻结'):
    alerts.append('%s期：只修 P0，新功能写进 pitch 的『下一步』' % phase)
if alerts:
    lines.append(' ｜ '.join(alerts))

sys.stdout.buffer.write(('\n'.join(lines[:5]) + '\n').encode('utf-8'))
PY
)"

if [ -n "$OUT" ]; then
  printf '%s\n' "$OUT"
else
  fallback
fi
exit 0
