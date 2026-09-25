#!/usr/bin/env bash
# session-start.sh —— SessionStart hook：会话开场注入「导航层」
#
# 职责：
#   startup / resume / clear / compact 时往上下文塞一张 ≤3KB 的纯文本导航层：
#   ① 时间 · 离截止几小时 · 阶段   ② 我是谁、是不是 lead   ③ 分支 → 模块 → 可写路径
#   ④ 未提交文件数、落后 origin/main 几个提交   ⑤ 3-tasks 我那节的 🔨/⏸（外加 ⬜ 前 3 条，给开场菜单用）
#   ⑥ handoff/ 根目录待处理的单（本模块标 ★）   ⑦ decisions 最后 5 条   ⑧ 上次 check 汇总   ⑨ 开场怎么接话
#
# 为什么只给地图、不给全文：
#   学习项目 1.x 在这里无脑 cat 全文，一次注入 180KB，大半是已结清的历史 —— 根因是开场不知道
#   这个会话要干嘛，只好全给。这里倒过来：只给「现在在哪、去哪找」，细节由 /start /lead 等
#   按会话类型自己去读。🔒 不 cat 大文件、不 fetch、不联网（落后多少基于本地已有引用）。
#
# 失败策略（fail-open，但不许装作正常）：
#   · 任何一节出错 → 那一节只输出一行 ⚠️，其它节照常；
#   · 整体崩溃 → 只输出「⚠️ 导航层生成失败，请跑 bash scripts/sync.sh」；
#   · 永远 exit 0，永远输出合法 JSON（由 python3 json.dumps 生成，不手拼）；
#   · HACK_NO_GATE=1 只管 Stop 门禁，这里照样输出。
#
# subagent 模型：settings.json 的 env.CLAUDE_CODE_SUBAGENT_MODEL=opus 只是第一层（不同版本未必生效，赛前实测）；
#   真正的保险是 .claude/agents/*.md frontmatter 写死的 `model: opus`（check [6] 守）+ CLAUDE.md 规则（D-02）。
#
# 改完必须验证（两条都要过）：
#   bash .claude/hooks/session-start.sh | python3 -m json.tool
#   (cd /tmp && CLAUDE_PROJECT_DIR=<仓库绝对路径> bash <仓库绝对路径>/.claude/hooks/session-start.sh | python3 -m json.tool)
# 依赖：bash、git、python3 ≥3.9（zoneinfo）。不依赖 jq。退出码：永远 0。
set -uo pipefail

FALLBACK='⚠️ 导航层生成失败，请跑 bash scripts/sync.sh'

emit_fallback() {
  # 仍然用 python3 生成 JSON；连 python3 都没有时才退回一段写死的常量（不含任何变量）
  python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":sys.argv[1]}}))' "$1" 2>/dev/null \
    || printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"⚠️ 导航层生成失败，请跑 bash scripts/sync.sh"}}'
}

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"
fi
if [ -z "$ROOT" ] || ! cd "$ROOT" 2>/dev/null || ! command -v python3 >/dev/null 2>&1; then
  emit_fallback "$FALLBACK"
  exit 0
fi

OUT="$(python3 - "$ROOT" <<'PY' 2>/dev/null
import json, os, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone

ROOT = sys.argv[1]
LIMIT = 3000          # additionalContext 的 UTF-8 字节上限（≤3KB）
MAXLINE = 150         # 单行字符上限
WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']


def run(args, timeout=5):
    try:
        r = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return r.returncode, r.stdout.decode('utf-8', 'replace')
    except Exception:
        return 127, ''


def git(*args):
    return run(['git'] + list(args))


def readtext(rel, limit=None):
    p = os.path.join(ROOT, rel)
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read(limit) if limit else f.read()


def cut(s, n=MAXLINE):
    s = s.rstrip()          # 保留行首缩进
    return s if len(s) <= n else s[:n - 1] + '…'


def read_conf():
    conf = {}
    text = readtext('hackathon.conf')
    if text is None:
        return None
    for line in text.splitlines():
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
        if m and m.group(1) not in conf:
            conf[m.group(1)] = m.group(2).split('#', 1)[0].strip().strip('"').strip("'")
    return conf


CONF = read_conf() or {}


def fmt(dt_utc, tz):
    d = dt_utc.astimezone(tz)
    return d.strftime('%m-%d ') + WEEK[d.weekday()] + d.strftime(' %H:%M')


def sec_time():
    if not CONF:
        return ['⏰ 现在 ' + datetime.now().strftime('%Y-%m-%d %H:%M') + '（本机时间）｜⚠️ 读不到 hackathon.conf，倒计时 --，阶段 未设置']
    warn = []
    tzname = CONF.get('TZ', '')
    tz = None
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tzname) if tzname else None
        if tz is None:
            warn.append('hackathon.conf 没填 TZ')
    except Exception:
        warn.append('TZ=%s 用不了（不是 IANA 时区名，或 python3 < 3.9）' % tzname)
    if tz is None:
        tz = datetime.now().astimezone().tzinfo
        tzname = '本机时区'
    now = datetime.now(timezone.utc)

    def parse(key):
        s = CONF.get(key, '')
        if not s:
            return None
        try:
            # 按 TZ 的本地时间解释，再换成 UTC 做减法：跨夏令时（墨尔本 10-04）也按真实小时数算
            return datetime.strptime(s, '%Y-%m-%d %H:%M').replace(tzinfo=tz).astimezone(timezone.utc)
        except ValueError:
            warn.append('%s=%s 格式不对（应为 YYYY-MM-DD HH:MM）' % (key, s))
            return None

    def hours(key, default):
        try:
            return float(CONF.get(key) or default)
        except ValueError:
            warn.append('%s 不是数字，按 %s 算' % (key, default))
            return float(default)

    start, dl = parse('START'), parse('DEADLINE')
    ffh, cfh = hours('FEATURE_FREEZE_HOURS', 6), hours('CODE_FREEZE_HOURS', 2)
    local = now.astimezone(tz)
    head = '⏰ 现在 %s %s %s（%s %s）' % (local.strftime('%Y-%m-%d'), WEEK[local.weekday()], local.strftime('%H:%M'), tzname, local.strftime('%Z'))
    lines = []
    if dl is None:
        why = '（hackathon.conf 的 DEADLINE 为空）' if not CONF.get('DEADLINE') else '（DEADLINE 解析失败，见下）'
        lines.append(head + '｜离截止 --｜阶段 未设置' + why)
    else:
        ff, cf = dl - timedelta(hours=ffh), dl - timedelta(hours=cfh)
        if now >= dl:
            phase = '已截止'
        elif now >= cf:
            phase = '🔒代码冻结'
        elif now >= ff:
            phase = '🧊功能冻结'
        elif start is not None and now < start:
            phase = '赛前'
        else:
            phase = '开发'
        left = (dl - now).total_seconds() / 3600
        lt = ('离截止 %.1fh' % left) if left >= 0 else ('已过截止 %.1fh' % -left)
        lines.append('%s｜%s｜阶段 %s' % (head, lt, phase))
        extra = '   截止 %s · 🧊功能冻结 %s · 🔒代码冻结 %s' % (fmt(dl, tz), fmt(ff, tz), fmt(cf, tz))
        if start is not None and now < start:
            extra += ' · 开赛 %s（还有 %.1fh）' % (fmt(start, tz), (start - now).total_seconds() / 3600)
        lines.append(extra)
    for w in warn:
        lines.append('   ⚠️ ' + w)
    return lines


ME = git('config', 'hack.me')[1].strip()
LEAD = CONF.get('LEAD', '')
IS_LEAD = bool(ME) and ME.lower() == LEAD.lower()
MODULE = ''


def sec_me():
    if not ME:
        return ['👤 还不知道你是谁：⚠️ 先跑 bash scripts/setup.sh（或手动 git config hack.me <GitHub handle>）']
    s = '👤 我是 @%s' % ME
    if IS_LEAD:
        s += '（lead）'
    elif LEAD:
        s += '（队员；lead 是 @%s）' % LEAD
    else:
        s += '（⚠️ hackathon.conf 没填 LEAD）'
    if CONF.get('BACKUP_LEAD') and ME.lower() == CONF['BACKUP_LEAD'].lower():
        s += '（备用 lead）'
    if CONF.get('DEPLOYER') and ME.lower() == CONF['DEPLOYER'].lower():
        s += '，也是 DEPLOYER'
    return [s]


def sec_branch():
    global MODULE
    rc, br = git('symbolic-ref', '--short', '-q', 'HEAD')
    br = br.strip()
    if git('rev-parse', '--git-dir')[0] != 0:
        return ['🌿 ⚠️ 这里不是 git 仓库（CLAUDE_PROJECT_DIR 指错了？）']
    if not br:
        sha = git('rev-parse', '--short', 'HEAD')[1].strip() or '?'
        return ['🌿 detached HEAD（%s）⚠️ 先 git switch 到任务分支再改' % sha]
    if br in ('main', 'master'):
        return ['🌿 分支 %s ⚠️ 先开分支：git switch -c <handle>/<模块>/T<n>-<短名> origin/main（main 上不许改文件）' % br]
    if br.startswith('lead/'):
        MODULE = ''
        s = '🌿 分支 %s → lead 分支，可写全仓库（独占区只在 lead/* 上改）' % br
        return [s if IS_LEAD else s + ' ⚠️ 但你不是 lead']
    m = re.match(r'^([^/]+)/([^/]+)/(T\d+)(-.+)?$', br)
    if not m:
        return ['🌿 分支 %s ⚠️ 不符合 <handle>/<模块>/T<n>-<短名>，推不出模块（check [3] 会报）' % br]
    MODULE = m.group(2)
    lines = ['🌿 分支 %s → 模块 %s · 任务 %s' % (br, MODULE, m.group(3))]
    if ME and m.group(1).lower() != ME.lower():
        lines[0] += ' ⚠️ 分支前缀 @%s 不是你' % m.group(1)
    w = 'apps/%s/** · docs/3-tasks.md（只改自己那节）· decisions/pitfalls（只追加）· handoff/*.md（只新建）' % MODULE
    if MODULE == 'pitch':
        w += ' · docs/4-demo.md · docs/pitch-assets/**'
    lines.append('   可写：' + w)
    return lines


def sec_git():
    rc, st = git('status', '--porcelain')
    if rc != 0:
        return ['📦 ⚠️ git status 失败（不是 git 仓库？）']
    n = len([l for l in st.splitlines() if l.strip()])
    if git('rev-parse', '--verify', '-q', 'HEAD')[0] != 0:
        behind = '还没有任何提交'
    elif git('rev-parse', '--verify', '-q', 'refs/remotes/origin/main')[0] != 0:
        behind = '没有 origin/main 引用（没设 remote 或从没 fetch）'
    else:
        c = git('rev-list', '--count', 'HEAD..refs/remotes/origin/main')[1].strip() or '?'
        behind = '落后 origin/main %s 个提交' % c
        if c.isdigit() and int(c) > 20:
            behind += ' ⚠️ 先 git merge origin/main'
    if not behind.startswith('落后'):
        return ['📦 未提交 %d 个文件｜%s' % (n, behind)]
    fetched = '从没 fetch'
    p = git('rev-parse', '--git-path', 'FETCH_HEAD')[1].strip()
    if p:
        p = p if os.path.isabs(p) else os.path.join(ROOT, p)
        if os.path.isfile(p):
            fetched = '上次 fetch ' + time.strftime('%m-%d %H:%M', time.localtime(os.path.getmtime(p)))
    return ['📦 未提交 %d 个文件｜%s（基于本地引用，%s；要最新跑 bash scripts/sync.sh）' % (n, behind, fetched)]


def row(line, n=70):
    s = line.strip()
    if s.startswith('|'):
        s = ' · '.join(c.strip() for c in s.strip('|').split('|') if c.strip())
    s = re.sub(r'^[-*]\s+', '', s)
    return '   ' + cut(s, n)


def sec_tasks():
    text = readtext('docs/3-tasks.md')
    if text is None:
        return ['📋 docs/3-tasks.md 还没有（kickoff 前正常）']
    if not ME:
        return ['📋 不知道你是谁，跳过任务板']
    sec, inside = [], False
    for line in text.splitlines():
        if re.match(r'^##\s', line):
            inside = bool(re.match(r'^##\s*@' + re.escape(ME) + r'(\s|$)', line, re.I))
            continue
        if inside:
            sec.append(line)
    if not sec:
        return ['📋 3-tasks 里没有「## @%s」节 ⚠️ 找 lead 加' % ME]
    doing = [l for l in sec if '🔨' in l or '⏸' in l][:5]
    todo = [l for l in sec if '⬜' in l][:3]
    lines = ['📋 我的任务（docs/3-tasks.md ## @%s）：🔨/⏸ %d 条，⬜ 前 %d 条' % (ME, len(doing), len(todo))]
    lines += [row(l) for l in doing] + [row(l) for l in todo]
    if not doing and not todo:
        lines[0] = '📋 我名下没有 🔨/⏸/⬜ 的任务 → 去「未认领」挑一条'
    return lines


def sec_handoff():
    d = os.path.join(ROOT, 'handoff')
    if not os.path.isdir(d):
        return ['📨 handoff/ 还没有']
    files = sorted(f for f in os.listdir(d) if f.endswith('.md') and f != 'README.md' and os.path.isfile(os.path.join(d, f)))
    if not files:
        return ['📨 handoff/ 没有待处理的交接单']
    marked = []
    for f in files:
        star = ''
        if MODULE:
            body = readtext('handoff/' + f, 8192) or ''
            if ('/%s/' % MODULE) in body or ('apps/%s' % MODULE) in body:
                star = '★'
        marked.append(star + f)
    marked.sort(key=lambda x: not x.startswith('★'))
    s = '📨 handoff/ 待处理 %d 张（★=本模块）：' % len(files) + ' · '.join(marked[:6])
    if len(marked) > 6:
        s += ' …另 %d 张' % (len(marked) - 6)
    return [cut(s, 400)]


def sec_decisions():
    text = readtext('docs/decisions.md')
    if text is None:
        return ['📌 docs/decisions.md 还没有']
    rows = []
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith('|'):
            continue
        cells = [c.strip() for c in s.strip('|').split('|')]
        if len(cells) >= 2 and re.match(r'^\**D-[\w-]+', cells[0]):
            rows.append('   %s %s' % (cells[0].strip('*'), cut(cells[1].replace('**', ''), 45)))
    if not rows:
        return ['📌 decisions 里还没有 D- 编号的行']
    return ['📌 最近的决定（docs/decisions.md 最后 %d 条；别重新提议，冲突就说「和 D-xx 冲突」再问人）：' % len(rows[-5:])] + rows[-5:]


def sec_check():
    p = os.path.join(ROOT, 'logs', 'last-check.txt')
    if not os.path.isfile(p):
        return ['🩺 还没有 logs/last-check.txt → 开工前跑 bash scripts/check.sh --quick']
    text = readtext('logs/last-check.txt') or ''
    mt = os.path.getmtime(p)
    age = (time.time() - mt) / 3600
    when = time.strftime('%m-%d %H:%M', time.localtime(mt))
    sums = [l for l in text.splitlines() if re.match(r'^=+\s*汇总', l)]
    if not sums:
        return ['🩺 ⚠️ logs/last-check.txt（%s）里没有「======== 汇总」行 —— 上次 check 没跑完或崩了，别当全绿' % when]
    s = '🩺 上次 check（%s%s）：%s' % (when, '，%.0f 小时前，可能过期' % age if age > 12 else '', sums[-1].strip())
    fails = [l for l in text.splitlines() if re.match(r'^\[\d+\]', l) and '❌' in l][:3]
    return [s] + ['   ' + cut(l, 90) for l in fails]


MENU = '👉 用户没说要干什么，就用 AskUserQuestion 摆菜单（他名下 ⬜/⏸ 前 3 条 + 认领新任务 + 收工）；点名了就直接开工，不许让人背命令。'


def build():
    plan = [('①时间', sec_time), ('②身份', sec_me), ('③分支', sec_branch), ('④git', sec_git),
            ('⑤任务', sec_tasks), ('⑥交接单', sec_handoff), ('⑦决定', sec_decisions), ('⑧check', sec_check)]
    secs = []
    for name, fn in plan:
        try:
            out = [cut(l, 400) for l in fn() if l is not None]
        except Exception as e:
            out = ['⚠️ %s 这一节生成失败（%s），跳过' % (name, type(e).__name__)]
        secs.append(out)
    tail = [MENU + ('（你是 lead：菜单再加「集成 /lead」）' if IS_LEAD else '')]
    headline = ['🧭 导航层 —— 这是地图，不是全部状态；细节按会话类型自己去取。']
    trimmable = [4, 5, 6, 7]
    note = '   …（超 3KB 已截断，全貌跑 bash scripts/sync.sh）'

    def render(extra=None):
        lines = headline + [l for s in secs for l in s] + (extra or []) + tail
        return '\n'.join(lines)

    text = render()
    trimmed = False
    while len(text.encode('utf-8')) > LIMIT:
        cand = [i for i in trimmable if len(secs[i]) > 1]
        if not cand:
            break
        i = max(cand, key=lambda k: len(secs[k]))
        secs[i].pop()
        trimmed = True
        text = render([note])
    if len(text.encode('utf-8')) > LIMIT:
        b = text.encode('utf-8')[:LIMIT - 200].decode('utf-8', 'ignore')
        text = b.rsplit('\n', 1)[0] + '\n' + note.strip() + '\n' + tail[0]
    return text


try:
    ctx = build()
except Exception:
    ctx = '⚠️ 导航层生成失败，请跑 bash scripts/sync.sh'
payload = {'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': ctx}}
sys.stdout.buffer.write((json.dumps(payload, ensure_ascii=False) + '\n').encode('utf-8'))
PY
)"

# 只有「是合法 JSON 且带 additionalContext」才原样输出，否则退回失败提示
if [ -n "$OUT" ] && printf '%s' "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["hookSpecificOutput"]["additionalContext"]' >/dev/null 2>&1; then
  printf '%s\n' "$OUT"
else
  emit_fallback "$FALLBACK"
fi
exit 0
