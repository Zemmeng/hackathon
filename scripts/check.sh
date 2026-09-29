#!/usr/bin/env bash
# check.sh —— 唯一的检查 / 测试入口。本地、Claude Stop hook、.githooks/pre-push、GitHub Actions CI 都调它。
#
# 用途：9 项固定编号的检查，分 ❌（必须修）/ ⚠️（提醒）两级，末尾固定输出汇总节。
#   [1] 秘密扫描   [2] 秘密文件被跟踪   [3] 分支与越界   [4] 模块结构   [5] 模块测试
#   [6] 仓库卫生   [7] RULES 块一致     [8] 交接单格式   [9] hackathon.conf 可解析
# 用法：
#   bash scripts/check.sh                  全量：扫全部文件，跑 apps/* 的全部 test.sh
#   bash scripts/check.sh --quick          快速：秘密扫描和测试只覆盖相对 base 改动过的文件 / 模块
#   bash scripts/check.sh --base <ref>     对比基准（默认 origin/main → main；都没有就跳过 diff 类检查并 ⚠️）
#   bash scripts/check.sh --e2e [URL]      只做线上冒烟（不给 URL 就读 hackathon.conf 的 DEMO_URL）：
#                                          GET / 200 且含 data-smoke；/api/health 含 "ok":true；HTML 里没有 localhost；
#                                          每个请求 ≤3 秒。结果写 logs/last-e2e.txt
#   bash scripts/check.sh --selftest       在临时仓库里造 8 种场景（含直推 main / 假 key / 越界 / 测试崩溃 /
#                                          不打计数 / 分支名不合约定 / RULES 标记缺失），确认门禁该红就红
#   bash scripts/check.sh --time           只打印现在时间、离截止多久、阶段（setup / sync / deploy 复用）
#   bash scripts/check.sh --time-raw       同上，KEY=VALUE 格式，给脚本解析（PHASE= 是阶段）
# 输出：每项一行「[N] 名称 ✅」/「[N] 名称 ❌ 原因」/「[N] 名称 ⚠️ 原因」，缩进行是细节。
#   末尾是汇总节：先一行「======== 汇总 X ❌ Y ⚠️」，后面把所有 ❌/⚠️ 行原样再列一遍
#   （Stop hook / pre-push / CI 只看这一节判类别，别拿全文 grep ❌ 计数）。
#   整段同时写入 logs/last-check.txt（目录不在就建）。
# 退出码：0 = 没有 ❌（可以有 ⚠️）；1 = 有 ❌；2 = 用法错误 / 不在 git 仓库里
# 环境变量：
#   ALLOW_CROSS=1  [3] 越界文件、分支名不合约定降为 ⚠️（CI 在 PR 带 cross-module 标签时设；队员经 lead 同意后 push 时设）
#   ALLOW_MAIN=1   [3]「在 main 上有改动」降为 ⚠️（lead 小改动直推 main 时用）
#   BRANCH=<名>    覆盖分支名（CI 的 PR checkout 是 detached merge commit，workflow 里设 github.head_ref）
#   GITHUB_ACTOR   CI 里用它核 lead/* 分支的身份（本地用 git config hack.me）
#   CHECK_TEST_TIMEOUT=<秒>  单个 test.sh 限时，默认 120（门禁会传更小的值）
# 兼容 macOS 自带 bash 3.2（不用 mapfile / declare -A / ${var,,}）和 ubuntu；时间一律用 python3 zoneinfo 算。
set -uo pipefail

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SELF="$SELF_DIR/$(basename "${BASH_SOURCE[0]}")"
TEST_TIMEOUT="${CHECK_TEST_TIMEOUT:-120}"
TIMEOUT_NOTE=""
if ! printf '%s' "$TEST_TIMEOUT" | grep -Eq '^[1-9][0-9]*$'; then
  TIMEOUT_NOTE="CHECK_TEST_TIMEOUT=$TEST_TIMEOUT 不是正整数，按 120 秒算"; TEST_TIMEOUT=120
fi
TMPBASE="${TMPDIR:-/tmp}"; TMPBASE="${TMPBASE%/}"
DETAIL_MAX=20

usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$SELF"; }

MODE="full"; BASE_ARG=""; E2E_URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) MODE="quick" ;;
    --base) [ -n "${2:-}" ] || { echo "❌ --base 后面要跟一个 ref" >&2; exit 2; }; BASE_ARG="$2"; shift ;;
    --base=*) BASE_ARG="${1#--base=}" ;;
    --e2e)  # URL 可省略（省略或空串 → 读 conf 的 DEMO_URL）
      MODE="e2e"
      if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then E2E_URL="$2"; shift; fi ;;
    --e2e=*) E2E_URL="${1#--e2e=}"; MODE="e2e" ;;
    --selftest) MODE="selftest" ;;
    --time) MODE="time" ;;
    --time-raw) MODE="timeraw" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "❌ 未知参数：$1（用 --help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

g() { git -c core.quotePath=false "$@"; }

# =====================================================================
# python 助手：[6][7][8][9] 和时间计算。输出协议：E:<❌原因> / W:<⚠️原因> / D:<细节> / OK:<全绿说明>
# 时间：conf 里的时间按 TZ 的本地时间解释，再换成 UTC 做加减 ——
#   同一个 ZoneInfo 的两个 aware datetime 相减会忽略偏移，跨 10-04 夏令时会差一小时。
# =====================================================================
pyhelp() {
python3 - "$@" <<'PY'
import os, re, subprocess, sys
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
KEYS = ['EVENT_NAME', 'EVENT_URL', 'TZ', 'START', 'DEADLINE', 'FEATURE_FREEZE_HOURS', 'CODE_FREEZE_HOURS',
        'LEAD', 'BACKUP_LEAD', 'DEPLOYER', 'DEMO_URL', 'VIDEO_URL', 'DEPLOY_MODULES']
sub, root = sys.argv[1], sys.argv[2]


def emit(kind, msg):
    print('%s:%s' % (kind, msg))


def read_text(rel):
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read().replace('\r\n', '\n')


def read_conf():
    """与 bash 读法（grep '^KEY=' | cut -d= -f2- | sed 's/#.*//' | xargs）对齐：去注释、去首尾空白和引号。"""
    text = read_text('hackathon.conf')
    if text is None:
        return None, [], []
    conf, bad, dups = {}, [], []
    for no, line in enumerate(text.split('\n'), 1):
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
        if not m:
            bad.append(no)
            continue
        k, v = m.group(1), m.group(2).split('#', 1)[0].strip().strip('"').strip("'")
        if k in conf:
            dups.append(k)
            continue
        conf[k] = v
    return conf, bad, dups


def fmt(t, tz):
    d = t.astimezone(tz)
    return d.strftime('%m-%d ') + WEEK[d.weekday()] + d.strftime(' %H:%M')


def timeinfo(conf):
    r = {'err': [], 'warn': [], 'phase': '未设置', 'left': '--', 'tzlabel': '', 'now': '', 'marks': '',
         'start': None, 'dl': None, 'tz': None}
    tzname = conf.get('TZ', '')
    tz = None
    try:
        from zoneinfo import ZoneInfo
        if tzname:
            try:
                tz = ZoneInfo(tzname)
            except Exception:
                r['err'].append('TZ=%s 不是有效的 IANA 时区名（例：Australia/Melbourne）' % tzname)
        else:
            r['warn'].append('TZ 为空（先按本机时区算）')
    except ImportError:
        r['err'].append('python3 < 3.9，没有 zoneinfo，算不了时区')
    if tz is None:
        tz, r['tzlabel'] = datetime.now().astimezone().tzinfo, '本机时区'
    else:
        r['tzlabel'] = tzname
    r['tz'] = tz
    now = datetime.now(UTC)
    local = now.astimezone(tz)
    r['now'] = local.strftime('%Y-%m-%d ') + WEEK[local.weekday()] + local.strftime(' %H:%M')

    def parse(key):
        s = conf.get(key, '')
        if not s:
            return None
        try:
            naive = datetime.strptime(s, '%Y-%m-%d %H:%M')
        except ValueError:
            r['err'].append('%s=%s 格式不对（要 YYYY-MM-DD HH:MM，TZ 的本地时间）' % (key, s))
            return None
        aware = naive.replace(tzinfo=tz)
        if aware.astimezone(UTC).astimezone(tz).replace(tzinfo=None) != naive:
            r['warn'].append('%s=%s 落在夏令时跳过的那一小时里，这个本地时间不存在' % (key, s))
        return aware.astimezone(UTC)

    def hours(key, default):
        v = conf.get(key, '')
        if v == '':
            return float(default)
        try:
            h = float(v)
            if h < 0:
                raise ValueError
            return h
        except ValueError:
            r['err'].append('%s=%s 不是非负数字（按 %s 算）' % (key, v, default))
            return float(default)

    start, dl = parse('START'), parse('DEADLINE')
    ffh, cfh = hours('FEATURE_FREEZE_HOURS', 6), hours('CODE_FREEZE_HOURS', 2)
    r['start'], r['dl'] = start, dl
    if dl is not None:
        ff, cf = dl - timedelta(hours=ffh), dl - timedelta(hours=cfh)
        if now >= dl:
            r['phase'] = '已截止'
        elif now >= cf:
            r['phase'] = '🔒代码冻结'
        elif now >= ff:
            r['phase'] = '🧊功能冻结'
        elif start is not None and now < start:
            r['phase'] = '赛前'
        else:
            r['phase'] = '开发'
        h = (dl - now).total_seconds() / 3600
        r['left'] = ('%.1fh' % h) if h >= 0 else ('已过 %.1fh' % -h)
        r['marks'] = '截止 %s · 🧊功能冻结 %s · 🔒代码冻结 %s' % (fmt(dl, tz), fmt(ff, tz), fmt(cf, tz))
        if start is not None and now < start:
            r['marks'] += ' · 开赛 %s（还有 %.1fh）' % (fmt(start, tz), (start - now).total_seconds() / 3600)
    return r


def git(*a):
    return subprocess.run(['git', '-c', 'core.quotePath=false'] + list(a), cwd=root,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout


def zsplit(b):
    return [p.decode('utf-8', 'surrogateescape') for p in b.split(b'\0') if p]


# ---------------------------------------------------------------- time
if sub in ('time', 'timeraw'):
    conf, _, _ = read_conf()
    if conf is None:
        conf = {}
    t = timeinfo(conf)
    notes = t['err'] + t['warn']
    if not conf:
        notes.insert(0, '读不到 hackathon.conf')
    if sub == 'timeraw':
        print('PHASE=%s' % t['phase'])
        print('NOW=%s' % t['now'])
        print('TZ=%s' % t['tzlabel'])
        print('LEFT=%s' % t['left'])
        print('MARKS=%s' % t['marks'])
        print('NOTE=%s' % '；'.join(notes))
    else:
        print('⏰ 现在 %s（%s）｜离截止 %s｜阶段 %s' % (t['now'], t['tzlabel'], t['left'], t['phase']))
        if t['marks']:
            print('   ' + t['marks'])
        for n in notes:
            print('   ⚠️ ' + n)
        if t['phase'] == '未设置':
            print('   （hackathon.conf 的 DEADLINE 为空；kickoff 时 lead 填）')

# ---------------------------------------------------------------- [9] conf
elif sub == 'conf':
    conf, bad, dups = read_conf()
    if conf is None:
        emit('E', '没有 hackathon.conf（从模板仓库拿回来，别自己新建）')
        sys.exit(0)
    for no in bad:
        emit('E', 'hackathon.conf 第 %d 行不是 KEY=VALUE（行首不能有空格）' % no)
    for k in sorted(set(dups)):
        emit('W', '%s 写了不止一次（脚本只认第一次）' % k)
    missing = [k for k in KEYS if k not in conf]
    if missing:
        emit('W', 'hackathon.conf 缺 key：%s' % ' '.join(missing))
    t = timeinfo(conf)
    for e in t['err']:
        emit('E', e)
    for w in t['warn']:
        emit('W', w)
    if not conf.get('DEADLINE'):
        emit('W', 'DEADLINE 未设置（倒计时显示 --；kickoff 时 lead 填）')
    if t['start'] and t['dl'] and t['start'] >= t['dl']:
        emit('E', 'START 不早于 DEADLINE')
    for k in ('LEAD', 'DEPLOYER'):
        if k in conf and not conf[k]:
            emit('W', '%s 为空' % k)
    demo = conf.get('DEMO_URL', '')
    if demo:
        readme = read_text('README.md')
        if readme is None:
            emit('W', 'DEMO_URL 已设置，但没有 README.md')
        elif demo.rstrip('/') not in readme:
            emit('W', 'README.md 里找不到 DEMO_URL（%s）：README 顶部 Demo 链接必须与 conf 一致' % demo)
    for m in conf.get('DEPLOY_MODULES', '').split():
        if not os.path.isdir(os.path.join(root, 'apps', m)):
            emit('W', 'DEPLOY_MODULES 里的 %s 在 apps/ 下不存在' % m)
    emit('OK', '阶段 %s · 离截止 %s' % (t['phase'], t['left']))

# ---------------------------------------------------------------- [6] 卫生
elif sub == 'hygiene':
    MB = 1024 * 1024
    # apps/<模块>/public/ 下的 .json 数据文件上限 2MB、不报 500KB 提醒（PRD「每个文件 < 2 MB」，D-0929-1430）；其余 1MB
    DATA_RE = re.compile(r'apps/[^/]+/public/.+\.json$')
    # docs/pitch-assets/ 下的 .pdf（初筛 / 决赛要交的 PDF）上限 10MB、不报 500KB 提醒（D-0930-0116）
    PDF_RE = re.compile(r'docs/pitch-assets/.+\.pdf$')

    def is_data(p):
        return DATA_RE.match(p) is not None
    tracked = {}
    for rec in git('ls-files', '-s', '-z').split(b'\0'):
        if b'\t' not in rec:
            continue
        meta, path = rec.split(b'\t', 1)
        tracked[path.decode('utf-8', 'surrogateescape')] = meta.split()[0].decode()
    untracked = zsplit(git('ls-files', '-z', '--others', '--exclude-standard'))

    def fpath(p):
        return os.path.join(root, p)

    for p in sorted(tracked):
        fp = fpath(p)
        if tracked[p] == '160000' or os.path.islink(fp) or not os.path.isfile(fp):
            continue
        sz = os.path.getsize(fp)
        if is_data(p):
            if sz > 2 * MB:
                emit('E', '%s %.1fMB > 2MB（数据文件上限；抽稀、省字段或拆文件）' % (p, sz / MB))
        elif PDF_RE.match(p):
            if sz > 10 * MB:
                emit('E', '%s %.1fMB > 10MB（pitch PDF 上限；导出时降图片分辨率）' % (p, sz / MB))
        elif sz > MB:
            emit('E', '%s %.1fMB > 1MB（压缩或放网盘；git rm --cached %s）' % (p, sz / MB, p))
        elif sz > 500 * 1024:
            emit('W', '%s %dKB > 500KB（能压就压）' % (p, sz // 1024))
    for p in sorted(untracked):
        fp = fpath(p)
        lim = 2 * MB if is_data(p) else 10 * MB if PDF_RE.match(p) else MB
        if os.path.isfile(fp) and not os.path.islink(fp) and os.path.getsize(fp) > lim:
            emit('W', '%s（未跟踪）%.1fMB > %dMB：别 git add，放 out/ 或网盘' % (p, os.path.getsize(fp) / MB, lim // MB))
    shells = [p for p in list(tracked) + untracked if p.endswith('.sh') or p.startswith('.githooks/')]
    # $var 后面紧跟非 ASCII（例：$mod 后面直接接全角逗号）：macOS 的 bash 会把全角字符的首字节当成变量名的一部分，set -u 下报 unbound variable → 写成 ${var}
    VAR_NONASCII = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7f])')
    for p in sorted(set(shells)):
        fp = fpath(p)
        if os.path.islink(fp) or not os.path.isfile(fp):
            continue
        hits = [i for i, l in enumerate((read_text(p) or '').split('\n'), 1) if VAR_NONASCII.search(l)]
        if hits:
            emit('W', '%s:%d 等 %d 行 $变量 后面紧跟中文 / 全角字符（macOS 上会崩），改成 ${变量}' % (p, hits[0], len(hits)))
    for p in sorted(set(shells)):
        fp = fpath(p)
        if os.path.islink(fp) or not os.path.isfile(fp) or p.endswith('.md'):
            continue
        if p in tracked:
            if tracked[p] != '100755':
                emit('W', '%s 在 git 里没有可执行位（git update-index --chmod=+x %s）' % (p, p))
        elif not os.access(fp, os.X_OK):
            emit('W', '%s 没有可执行位（chmod +x %s）' % (p, p))
        with open(fp, 'rb') as f:
            if b'\r\n' in f.read():
                emit('W', '%s 是 CRLF 换行（会报 bad interpreter；转成 LF）' % p)
    adir = os.path.join(root, '.claude', 'agents')
    nagents = 0
    if os.path.isdir(adir):
        for name in sorted(os.listdir(adir)):
            if not name.endswith('.md'):
                continue
            nagents += 1
            rel = '.claude/agents/%s' % name
            txt = read_text(os.path.join('.claude', 'agents', name)) or ''
            if re.search(r'fable', txt, re.I):
                emit('E', '%s 里出现 fable（禁用）' % rel)
            # 只认文件开头第一对 --- 之间的 frontmatter；正文里写的 model: 不算
            lines = txt.split('\n')
            if not lines or lines[0].strip() != '---':
                emit('E', '%s 没有 frontmatter（第一行要是 ---，里面写 model: opus）' % rel)
                continue
            end = next((i for i in range(1, len(lines)) if lines[i].strip() == '---'), None)
            if end is None:
                emit('E', '%s 的 frontmatter 没有结束的 ---' % rel)
                continue
            models = [l for l in lines[1:end] if re.match(r'^model\s*:', l)]
            if len(models) != 1:
                emit('E', '%s 的 frontmatter 里 model: 有 %d 行（要恰好 1 行 model: opus）' % (rel, len(models)))
                continue
            val = models[0].split(':', 1)[1].split('#', 1)[0].strip().strip('"\'')
            if val != 'opus':
                emit('E', '%s 的 frontmatter 是 model: %s（subagent 一律 opus）' % (rel, val or '（空）'))
    emit('OK', '%d 个跟踪文件%s' % (len(tracked), '，%d 个 agent 定义' % nagents if nagents else '（没有 .claude/agents/，跳过 agent 检查）'))

# ---------------------------------------------------------------- [7] RULES
elif sub == 'rules':
    FILES = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'KICKOFF.md']
    BEGIN, END = re.compile(r'<!--\s*RULES:BEGIN\s*-->'), re.compile(r'<!--\s*RULES:END\s*-->')
    blocks = {}
    for f in FILES:
        t = read_text(f)
        if t is None:
            emit('W', '%s 不存在' % f)
            continue
        nb, ne = len(BEGIN.findall(t)), len(END.findall(t))
        if nb == 0 or ne == 0:
            miss = ' 和 '.join(x for x, n in (('<!-- RULES:BEGIN -->', nb), ('<!-- RULES:END -->', ne)) if n == 0)
            emit('E', '%s 缺 %s 标记（从 README.md 复制整块，四处逐字相同）' % (f, miss))
            continue
        if nb > 1 or ne > 1:
            emit('E', '%s 里有 %d 个 BEGIN、%d 个 END（每个文件恰好一对）' % (f, nb, ne))
            continue
        b = BEGIN.search(t)
        e = END.search(t, b.end())
        if not e:
            emit('E', '%s 的 RULES:END 在 BEGIN 前面' % f)
            continue
        lines = t[b.end():e.start()].split('\n')
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        blocks[f] = lines
    names = [f for f in FILES if f in blocks]
    if names:
        ref = names[0]
        for f in names[1:]:
            a, b = blocks[ref], blocks[f]
            if a != b:
                n = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
                emit('E', '%s 的 RULES 块与 %s 不一致（块内第 %d 行起；改完四处同步）' % (f, ref, n + 1))
    emit('OK', '%d 处 RULES 块逐字一致' % len(names))

# ---------------------------------------------------------------- [8] 交接单
elif sub == 'handoff':
    d = os.path.join(root, 'handoff')
    if not os.path.isdir(d):
        emit('OK', '没有 handoff/ 目录')
        sys.exit(0)
    conf, _, _ = read_conf()
    t = timeinfo(conf or {})
    tz = t['tz']
    now = datetime.now(UTC)
    NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]*-T[0-9]+-(\d{2})(\d{2})-(\d{2})(\d{2})\.md$')
    HEADS = [('## 1. 事实', r'^##\s*1\.\s*事实'), ('## 2. 要改的共享文件', r'^##\s*2\.\s*要改的共享文件'),
             ('## 3. 留给 lead', r'^##\s*3\.\s*留给\s*lead'), ('## 4. 下一步', r'^##\s*4\.\s*下一步')]
    n = 0
    for f in sorted(os.listdir(d)):
        fp = os.path.join(d, f)
        if not os.path.isfile(fp) or f in ('README.md', '.gitkeep', '.DS_Store'):
            continue
        n += 1
        m = NAME.match(f)
        if not m:
            emit('W', 'handoff/%s 文件名不符合 <handle>-T<n>-<MMDD-HHMM>.md' % f)
        txt = read_text(os.path.join('handoff', f)) or ''
        miss = [h for h, rx in HEADS if not re.search(rx, txt, re.M)]
        if miss:
            emit('W', 'handoff/%s 缺节：%s' % (f, ' / '.join(miss)))
        if m:
            mo, dd, hh, mi = (int(x) for x in m.groups())
            year = now.astimezone(tz).year
            try:
                at = datetime(year, mo, dd, hh, mi, tzinfo=tz).astimezone(UTC)
                if at > now + timedelta(days=1):
                    at = datetime(year - 1, mo, dd, hh, mi, tzinfo=tz).astimezone(UTC)
                age = (now - at).total_seconds() / 3600
                if age > 12:
                    emit('W', 'handoff/%s 已 %.0f 小时没处理（lead 落账后 git mv 到 handoff/done/）' % (f, age))
            except ValueError:
                emit('W', 'handoff/%s 文件名里的日期不合法' % f)
    emit('OK', '%d 张待处理交接单' % n if n else '根目录没有待处理的交接单')
else:
    print('E:未知子命令 %s' % sub)
PY
}

# ---------------------------------------------------------------------------
# 仓库根：以 cwd 所在仓库为准（这样能在任意仓库里跑，包括自测的临时仓库）
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
CONF_ROOT="${ROOT:-$(cd "$SELF_DIR/.." && pwd)}"
case "$MODE" in
  time|timeraw)
    command -v python3 >/dev/null 2>&1 || { echo "⏰ 现在 $(date '+%Y-%m-%d %H:%M')（本机时间）｜⚠️ 没有 python3，算不了倒计时"; exit 0; }
    if [ "$MODE" = time ]; then pyhelp time "$CONF_ROOT"; else pyhelp timeraw "$CONF_ROOT"; fi
    exit 0 ;;
esac

# 契约里的读法：grep '^KEY=' | cut -d= -f2- | sed 's/#.*//' | xargs
conf_get() { [ -f "$CONF_ROOT/hackathon.conf" ] && grep -E "^$1=" "$CONF_ROOT/hackathon.conf" | cut -d= -f2- | sed 's/#.*//' | xargs 2>/dev/null; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ---------------------------------------------------------------------------
# 临时文件全放在一个目录里，退出时整个删掉
WORK=$(mktemp -d "$TMPBASE/check.XXXXXX") || { echo "❌ mktemp 失败" >&2; exit 2; }
OUT_BUF="$WORK/out.txt"; : >"$OUT_BUF"
CUR_TEST_PID=""
cleanup() { rm -rf "$WORK"; }
on_signal() {  # 被 pre-push / Stop hook 超时杀掉时，连带杀掉正在跑的 test.sh 整个进程组（它在别的进程组里）
  if [ -n "$CUR_TEST_PID" ]; then
    kill -TERM -- "-$CUR_TEST_PID" 2>/dev/null || kill_tree "$CUR_TEST_PID" TERM
    sleep 0.2
    kill -KILL -- "-$CUR_TEST_PID" 2>/dev/null
  fi
  exit "$1"
}
trap cleanup EXIT
trap 'on_signal 143' TERM
trap 'on_signal 130' INT
trap 'on_signal 129' HUP

say() { printf '%s\n' "$*"; printf '%s\n' "$*" >>"$OUT_BUF"; }
progress() { [ -t 2 ] && printf '  … %s\n' "$*" >&2; return 0; }

N_ERR=0; N_WARN=0; SUMMARY=""
item() {  # item <编号> <名称> <ok|err|warn> [原因]
  local line
  case "$3" in
    ok) line="[$1] $2 ✅${4:+ $4}" ;;
    err) line="[$1] $2 ❌ ${4:-}"; N_ERR=$((N_ERR + 1)); SUMMARY="$SUMMARY$line"$'\n' ;;
    *) line="[$1] $2 ⚠️ ${4:-}"; N_WARN=$((N_WARN + 1)); SUMMARY="$SUMMARY$line"$'\n' ;;
  esac
  say "$line"
}

# 一个检查项内部累积：第一条原因进项目行，全部进细节行
reset_item() { IE=""; IW=""; IE_N=0; IW_N=0; ID=""; ID_N=0; ID_HIDDEN=0; ID_EXTRA=0; }
_add_detail() {
  if [ "$ID_N" -lt "$DETAIL_MAX" ]; then ID="$ID    $1"$'\n'; ID_N=$((ID_N + 1)); else ID_HIDDEN=$((ID_HIDDEN + 1)); fi
}
add_e() { IE_N=$((IE_N + 1)); [ -z "$IE" ] && IE="$1"; _add_detail "❌ $1"; }
add_w() { IW_N=$((IW_N + 1)); [ -z "$IW" ] && IW="$1"; _add_detail "⚠️ $1"; }
add_d() { ID_EXTRA=$((ID_EXTRA + 1)); _add_detail "$1"; }
finish_item() {  # finish_item <编号> <名称> [全绿时的说明]
  local reason
  if [ "$IE_N" -gt 0 ]; then
    reason="$IE"; [ "$IE_N" -gt 1 ] && reason="${reason}（共 $IE_N 处 ❌）"
    [ "$IW_N" -gt 0 ] && reason="${reason}；另有 $IW_N 处 ⚠️"
    item "$1" "$2" err "$reason"
  elif [ "$IW_N" -gt 0 ]; then
    reason="$IW"; [ "$IW_N" -gt 1 ] && reason="${reason}（共 $IW_N 处 ⚠️）"
    item "$1" "$2" warn "$reason"
  else
    item "$1" "$2" ok "${3:-}"
  fi
  # 只有一条原因、没有额外细节时，项目行已经说全了，不重复
  if [ "$ID_EXTRA" -gt 0 ] || [ $((IE_N + IW_N)) -gt 1 ]; then
    printf '%s' "$ID"; printf '%s' "$ID" >>"$OUT_BUF"
  fi
  [ "$ID_HIDDEN" -gt 0 ] && say "    …另有 $ID_HIDDEN 条没列出"
  return 0
}

finish_output() {  # finish_output <日志文件名>
  say "======== 汇总 $N_ERR ❌ $N_WARN ⚠️"
  if [ -n "$SUMMARY" ]; then printf '%s' "$SUMMARY"; printf '%s' "$SUMMARY" >>"$OUT_BUF"; fi
  if [ -n "${ROOT:-}" ] && mkdir -p "$ROOT/logs" 2>/dev/null; then cp "$OUT_BUF" "$ROOT/logs/$1" 2>/dev/null; fi
  [ "$N_ERR" -gt 0 ] && exit 1
  exit 0
}

# 把 python 助手的输出折算成一个检查项
py_item() {  # py_item <编号> <名称> <子命令>
  local out rc line okmsg=""
  reset_item
  out=$(pyhelp "$3" "$ROOT" 2>&1); rc=$?
  while IFS= read -r line; do
    case "$line" in
      E:*) add_e "${line#E:}" ;;
      W:*) add_w "${line#W:}" ;;
      D:*) add_d "${line#D:}" ;;
      OK:*) okmsg="${line#OK:}" ;;
      *) [ "$rc" -ne 0 ] && [ -n "$line" ] && add_d "$line" ;;
    esac
  done <<<"$out"
  [ "$rc" -ne 0 ] && add_e "检查脚本自身出错（python 退出码 ${rc}）——这是 check.sh 的 bug，找 lead"
  finish_item "$1" "$2" "$okmsg"
}

kill_tree() {  # kill_tree <pid> <信号>：进程组杀不到时的兜底
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c" "$2"; done
  kill "-$2" "$1" 2>/dev/null
}

# =====================================================================
# --e2e：线上冒烟
# =====================================================================
run_e2e() {
  local url tmp="$WORK/e2e" code rc body n got_index=0
  mkdir -p "$tmp"
  [ -n "$E2E_URL" ] || E2E_URL=$(conf_get DEMO_URL)
  url="${E2E_URL%/}"
  say "🌐 check.sh --e2e ${url:-（无 URL）}  ·  $(date '+%Y-%m-%d %H:%M')"
  if [ -z "$url" ]; then
    item E0 "DEMO_URL" err "conf 的 DEMO_URL 未填（lead 部署打通后写进 hackathon.conf 和 README 顶部；临时测别的地址用 --e2e <URL>）"
    finish_output last-e2e.txt
  fi
  if ! command -v curl >/dev/null 2>&1; then
    item E0 "curl" err "没有 curl，冒烟做不了"; finish_output last-e2e.txt
  fi
  fetch() {  # fetch <路径> <输出文件> → 设置 code rc
    code=$(curl -sS -m 3 -o "$2" -w '%{http_code}' "$url$1" 2>"$tmp/err"); rc=$?
  }
  why_curl() { [ "$rc" = 28 ] && echo "超过 3 秒没返回" || echo "请求失败（curl 退出码 ${rc}：$(head -n 1 "$tmp/err")）"; }

  fetch "/" "$tmp/index.html"
  if [ "$rc" -ne 0 ]; then item E1 "首页 GET /" err "$(why_curl)"
  elif [ "$code" != 200 ]; then item E1 "首页 GET /" err "HTTP ${code}（要 200）"
  elif ! grep -q 'data-smoke' "$tmp/index.html"; then item E1 "首页 GET /" err "200，但页面里没有 data-smoke 标记（部署的不是这个站？）"; got_index=1
  else item E1 "首页 GET /" ok "200，含 data-smoke"; got_index=1
  fi

  fetch "/api/health" "$tmp/health"
  body=$(head -c 160 "$tmp/health" 2>/dev/null | tr -d '\r\n')
  if [ "$rc" -ne 0 ]; then item E2 "健康检查 GET /api/health" err "$(why_curl)"
  elif grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$tmp/health"; then item E2 "健康检查 GET /api/health" ok "$body"
  else item E2 "健康检查 GET /api/health" err "HTTP ${code}，响应里没有 \"ok\":true（开头：${body:-空}）"
  fi

  if [ "$got_index" -eq 1 ]; then
    n=$(grep -Eic 'localhost|127\.0\.0\.1' "$tmp/index.html")
    if [ "${n:-0}" -gt 0 ]; then
      item E3 "HTML 无 localhost" err "首页有 $n 行引用 localhost / 127.0.0.1（第 $(grep -Ein 'localhost|127\.0\.0\.1' "$tmp/index.html" | head -n 3 | cut -d: -f1 | tr '\n' ' ')行）"
    else
      item E3 "HTML 无 localhost" ok
    fi
  else
    item E3 "HTML 无 localhost" err "首页没拿到，没法检查"
  fi
  finish_output last-e2e.txt
}

# =====================================================================
# --selftest：门禁本身也要被验证
# =====================================================================
run_selftest() {
  local T="$WORK/selftest" i=0 total=21 out rc q v
  mkdir -p "$T"
  say "🧪 check.sh --selftest（临时目录 ${T}，结束后删除）"
  gq() { git -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false \
             -c core.hooksPath=/dev/null -c init.defaultBranch=main "$@"; }
  mkrepo() {  # mkrepo <目录>：main 上一个干净、全绿的最小仓库
    local f
    mkdir -p "$1" && cd "$1" || return 1
    gq init -q . && gq symbolic-ref HEAD refs/heads/main
    mkdir -p scripts apps/demo
    cp "$SELF" scripts/check.sh && cp "$SELF_DIR/secret-scan.sh" scripts/secret-scan.sh
    printf 'logs/\n' >.gitignore
    printf 'TZ=Australia/Melbourne\nSTART=\nDEADLINE=\nFEATURE_FREEZE_HOURS=6\nCODE_FREEZE_HOURS=2\nLEAD=lead\nDEPLOYER=lead\nDEMO_URL=\nDEPLOY_MODULES=\n' >hackathon.conf
    printf '# demo\n\nOwner: @alice\n' >apps/demo/README.md
    printf '#!/usr/bin/env bash\necho "1 passed, 0 failed"\n' >apps/demo/test.sh
    chmod +x apps/demo/test.sh
    for f in README.md CONTRIBUTING.md AGENTS.md KICKOFF.md; do
      printf '# %s\n\n<!-- RULES:BEGIN -->\n1. 规则一\n2. 规则二\n<!-- RULES:END -->\n' "$f" >"$f"
    done
    gq add -A && gq commit -qm init
  }
  run_case() {  # run_case <说明> <期望：green 或汇总节里要出现的前缀，如 "[3] 分支与越界 ❌"> <仓库目录>
    i=$((i + 1))
    out=$(cd "$3" && env -u ALLOW_CROSS -u ALLOW_MAIN -u BRANCH bash scripts/check.sh --quick 2>&1); rc=$?
    local ok=0 why=""
    if ! printf '%s\n' "$out" | grep -q '^======== 汇总 '; then why="输出里没有汇总行"
    elif [ "${2#warn:}" != "$2" ]; then   # warn:<文字>：不能有 ❌，汇总节里要看到这段 ⚠️
      if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | sed -n '/^======== 汇总/,$p' | grep -qF "${2#warn:}"; then ok=1
      else why="应该无 ❌ 且汇总节里看到「${2#warn:}」，实际退出码 ${rc}"; fi
    elif [ "$2" = green ]; then
      [ "$rc" -eq 0 ] && ok=1 || why="应该无 ❌，实际退出码 ${rc}：$(printf '%s\n' "$out" | grep -E '^\[[0-9]\] .*❌' | head -n 1)"
    else
      if [ "$rc" -eq 1 ] && printf '%s\n' "$out" | sed -n '/^======== 汇总/,$p' | grep -qF "$2"; then ok=1
      else why="应该在汇总节里看到「$2」，实际退出码 $rc"; fi
    fi
    if [ -n "${FAKE_KEY:-}" ] && { printf '%s\n' "$out" | grep -qF "$FAKE_KEY" || grep -qF "$FAKE_KEY" "$3/logs/last-check.txt" 2>/dev/null; }; then
      ok=0; why="输出或 logs/last-check.txt 里出现了 key 的值！"
    fi
    if [ "$ok" -eq 1 ]; then item "S$i" "$1" ok
    else item "S$i" "$1" err "$why"; printf '%s\n' "$out" | sed 's/^/      │ /' | tail -n 25
    fi
  }
  FAKE_KEY=""
  ( mkrepo "$T/green" && gq checkout -q -b alice/demo/T1-ok && echo "x" >>apps/demo/README.md ) >/dev/null 2>&1
  run_case "基线：模块分支只改自己模块 → 应全绿" green "$T/green"

  ( mkrepo "$T/main" && echo "x" >>apps/demo/README.md ) >/dev/null 2>&1
  run_case "直推 main：main 上有改动 → [3] ❌" "[3] 分支与越界 ❌ 在 main 上有" "$T/main"

  # 假 key 在运行时拼出来，本文件里不出现完整的串（否则全量扫描会扫到自己）
  FAKE_KEY="AKIA""$(printf 'Z%.0s' 1 2 3 4 5 6 7 8)SELFTEST"
  ( mkrepo "$T/key" && gq checkout -q -b alice/demo/T2-key && printf 'const k = "%s";\n' "$FAKE_KEY" >apps/demo/config.js ) >/dev/null 2>&1
  run_case "假 key：模块里写了 AKIA… → [1] ❌ 且不回显值" "[1] 秘密扫描 ❌ 命中" "$T/key"
  FAKE_KEY=""

  ( mkrepo "$T/cross" && gq checkout -q -b alice/demo/T3-cross && mkdir -p apps/other && echo x >apps/other/x.txt &&
    gq add -A && gq commit -qm cross ) >/dev/null 2>&1
  run_case "越界：demo 分支改了 apps/other/ → [3] ❌" "[3] 分支与越界 ❌ 1 个文件超出模块 demo" "$T/cross"

  ( mkrepo "$T/crash" && gq checkout -q -b alice/demo/T4-crash &&
    printf '#!/usr/bin/env bash\necho "3 passed, 0 failed"\nexit 3\n' >apps/demo/test.sh ) >/dev/null 2>&1
  run_case "测试崩溃：打了全绿计数但退出码 3 → [5] ❌" "[5] 模块测试 ❌ 1/1 个 test.sh 失败：apps/demo" "$T/crash"

  ( mkrepo "$T/nocount" && gq checkout -q -b alice/demo/T5-nocount &&
    printf '#!/usr/bin/env bash\necho "looks fine"\n' >apps/demo/test.sh ) >/dev/null 2>&1
  run_case "不打计数：退出码 0 但没有 N passed, M failed → [5] ❌" "[5] 模块测试 ❌ 1/1 个 test.sh 失败：apps/demo" "$T/nocount"

  ( mkrepo "$T/badname" && gq checkout -q -b fix-readme && echo "x" >>apps/demo/README.md ) >/dev/null 2>&1
  run_case "分支名不合约定：fix-readme 上有改动 → [3] ❌" "[3] 分支与越界 ❌ 分支名 fix-readme 不符合" "$T/badname"

  ( mkrepo "$T/rules" && gq checkout -q -b lead/rules &&
    printf '# AGENTS.md\n\n1. 规则一\n2. 规则二\n' >AGENTS.md ) >/dev/null 2>&1
  run_case "RULES 标记缺失：AGENTS.md 删了 BEGIN/END → [7] ❌" "[7] RULES 块一致 ❌ AGENTS.md 缺" "$T/rules"

  # docs/llm-apis/：每人只建 / 改自己的卡（文件名以「分支 handle-」开头），卡里不许有 key 的值
  ( mkrepo "$T/card" && gq checkout -q -b alice/demo/T6-card && mkdir -p docs/llm-apis &&
    printf '# alice 的卡\n\n变量名 `DEMO_API_KEY`，key 在 @alice 手里\n' >docs/llm-apis/alice-demo.md ) >/dev/null 2>&1
  run_case "API 卡：新建自己的 docs/llm-apis/alice-demo.md → 应全绿" green "$T/card"

  ( mkrepo "$T/card-other" && mkdir -p docs/llm-apis && printf '# bob 的卡\n' >docs/llm-apis/bob-demo.md &&
    gq add -A && gq commit -qm bob-card && gq checkout -q -b alice/demo/T7-card && echo "x" >>docs/llm-apis/bob-demo.md ) >/dev/null 2>&1
  run_case "API 卡：改了别人的 docs/llm-apis/bob-demo.md → [3] ❌" "[3] 分支与越界 ❌ 改了别人的 API 卡" "$T/card-other"

  ( mkrepo "$T/card-name" && gq checkout -q -b alice/demo/T8-card && mkdir -p docs/llm-apis &&
    printf '# 卡\n' >docs/llm-apis/demo.md ) >/dev/null 2>&1
  run_case "API 卡：新建的卡没以自己的 handle 开头 → [3] ❌" "[3] 分支与越界 ❌ 新建的 API 卡" "$T/card-name"

  # 五种写法各一行：Bearer 直接写值、hf_、gsk_、xai-、r8_；值在运行时拼，本文件里不出现完整的串
  q=$(printf 'Q%.0s' $(seq 1 44)); FAKE_KEY="selftest$q"
  ( mkrepo "$T/card-key" && gq checkout -q -b alice/demo/T9-card && mkdir -p docs/llm-apis &&
    printf 'curl -H "Authorization: Bearer %s" https://api.example.com\nhf: %s\ngroq: %s\nxai: %s\nreplicate: %s\n' \
      "$FAKE_KEY" "hf_$q" "gsk_$q" "xai-$q" "r8_$q" >docs/llm-apis/alice-demo.md ) >/dev/null 2>&1
  run_case "API 卡里贴了 key（Bearer / hf_ / gsk_ / xai- / r8_）→ [1] ❌ 命中 5 处且不回显值" "[1] 秘密扫描 ❌ 命中 5 处" "$T/card-key"
  FAKE_KEY=""

  # 反向：只写变量名 / 占位的 Bearer 不误报；handle 大小写不同、文件名带点也算自己的卡
  ( mkrepo "$T/card-case" && gq checkout -q -b Alice/demo/T13-card && mkdir -p docs/llm-apis &&
    printf 'curl -H "Authorization: Bearer CLOUDFLARE_API_TOKEN"\ncurl -H "Authorization: Bearer YOUR-OPENROUTER-API-KEY"\ncurl -H "Authorization: Bearer $DEEPSEEK_API_KEY"\napi_key: CLOUDFLARE_API_TOKEN\n' \
      >docs/llm-apis/alice-qwen2.5.md ) >/dev/null 2>&1
  run_case "API 卡：分支 Alice/ 建 alice-qwen2.5.md，只写变量名的 Bearer → 应全绿" green "$T/card-case"

  ( mkrepo "$T/card-rm" && mkdir -p docs/llm-apis && printf '# bob 的卡\n' >docs/llm-apis/bob-demo.md &&
    gq add -A && gq commit -qm bob-card && gq checkout -q -b alice/demo/T14-card &&
    gq rm -q docs/llm-apis/bob-demo.md && gq commit -qm rm ) >/dev/null 2>&1
  run_case "API 卡：删了别人的 docs/llm-apis/bob-demo.md → [3] ❌" "[3] 分支与越界 ❌ 删了别人的 API 卡" "$T/card-rm"

  ( mkrepo "$T/card-sub" && gq checkout -q -b alice/demo/T15-card && mkdir -p docs/llm-apis/sub &&
    printf '# 卡\n' >docs/llm-apis/sub/alice-x.md ) >/dev/null 2>&1
  run_case "API 卡：建子目录 docs/llm-apis/sub/ → [3] ❌" "[3] 分支与越界 ❌ 1 个文件超出模块 demo" "$T/card-sub"

  ( mkrepo "$T/card-cn" && gq checkout -q -b alice/demo/T16-card && mkdir -p docs/llm-apis &&
    printf '# 卡\n' >"docs/llm-apis/alice-通义.md" ) >/dev/null 2>&1
  run_case "API 卡：中文文件名 alice-通义.md → [3] ❌" "[3] 分支与越界 ❌ API 卡" "$T/card-cn"

  # 没有固定前缀的 key 写在标签后面（全角冒号、…_SECRET_KEY=），以及 pplx- 和 JWT：各一行
  v=$(printf 'Ab3%.0s' $(seq 1 11)); FAKE_KEY="$v"
  ( mkrepo "$T/card-key2" && gq checkout -q -b alice/demo/T17-card && mkdir -p docs/llm-apis &&
    printf -- '- API Key：%s\nQIANFAN_SECRET_KEY=%s\npplx: %s\njwt: %s\n' "$v" "$v" "pplx-$q" "eyJ$v.eyJ$v.$v" \
      >docs/llm-apis/alice-demo.md ) >/dev/null 2>&1
  run_case "API 卡：API Key：… / …_SECRET_KEY= / pplx- / JWT → [1] ❌ 命中 4 处且不回显值" "[1] 秘密扫描 ❌ 命中 4 处" "$T/card-key2"
  FAKE_KEY=""

  # 大小上限：apps/<模块>/public/ 下的 .json 数据文件 2MB，其余 1MB（D-0929-1430）
  ( mkrepo "$T/data" && gq checkout -q -b alice/demo/T6-data && mkdir -p apps/demo/public &&
    head -c 1572864 /dev/zero | tr '\0' '1' >apps/demo/public/big.json && gq add apps/demo/public/big.json ) >/dev/null 2>&1
  run_case "数据文件：apps/demo/public/big.json 1.5MB → 应全绿（上限 2MB）" green "$T/data"

  ( mkrepo "$T/big" && gq checkout -q -b alice/demo/T7-big &&
    head -c 1572864 /dev/zero | tr '\0' '1' >apps/demo/big.txt && gq add apps/demo/big.txt ) >/dev/null 2>&1
  run_case "大文件：apps/demo/big.txt 1.5MB → [6] ❌（非数据文件上限 1MB）" "[6] 仓库卫生 ❌" "$T/big"

  # pitch PDF：docs/pitch-assets/ 下的 .pdf 上限 10MB（D-0930-0116）
  ( mkrepo "$T/pdf" && gq checkout -q -b alice/pitch/T9-pdf && mkdir -p docs/pitch-assets &&
    head -c 3145728 /dev/zero | tr '\0' '1' >docs/pitch-assets/deck.pdf && gq add docs/pitch-assets/deck.pdf ) >/dev/null 2>&1
  run_case "pitch PDF：docs/pitch-assets/deck.pdf 3MB → 应全绿（上限 10MB）" green "$T/pdf"

  # $var 紧跟全角字符：macOS bash 会崩（$mod 后面直接接全角逗号，会读成变量 mod\xEF），check [6] 要提醒；全角逗号用 %s 传进去，本文件里不出现这种写法
  ( mkrepo "$T/utf8var" && gq checkout -q -b alice/demo/T8-utf8 &&
    printf '#!/usr/bin/env bash\nx=1\necho "值 $x%s好"\necho "1 passed, 0 failed"\n' '，' >apps/demo/test.sh ) >/dev/null 2>&1
  run_case "shell 里 \$变量 后紧跟全角字符 → [6] ⚠️ 提醒改成 \${变量}" "warn:[6] 仓库卫生 ⚠️ apps/demo/test.sh:3" "$T/utf8var"

  [ "$i" -eq "$total" ] || item S0 "场景数" err "跑了 $i 个场景，应为 $total"
  ROOT=""   # 自测不覆盖真仓库的 logs/last-check.txt
  finish_output last-check.txt
}

case "$MODE" in
  selftest) run_selftest ;;
  e2e) run_e2e ;;
esac

if [ -z "$ROOT" ]; then
  say "[0] 仓库 ❌ 当前目录不在 git 仓库里（cd 到仓库里再跑）"
  say "======== 汇总 1 ❌ 0 ⚠️"
  say "[0] 仓库 ❌ 当前目录不在 git 仓库里"
  exit 2
fi
cd "$ROOT" || exit 2
if ! command -v python3 >/dev/null 2>&1; then
  say "[0] 环境 ❌ 没有 python3（需要 ≥3.9；bash scripts/setup.sh 会告诉你怎么装）"
  say "======== 汇总 1 ❌ 0 ⚠️"
  say "[0] 环境 ❌ 没有 python3"
  exit 1
fi

# =====================================================================
# 公共状态：分支、base、改动文件集合
# =====================================================================
HAS_HEAD=0; g rev-parse -q --verify HEAD >/dev/null 2>&1 && HAS_HEAD=1
BRANCH_NAME="${BRANCH:-}"
[ -n "$BRANCH_NAME" ] || BRANCH_NAME=$(g symbolic-ref --short -q HEAD 2>/dev/null || true)
# Claude Code 云端会话推的分支带 claude/ 前缀（claude/<handle>/<模块>/T<n>-<slug>），去掉前缀再判
BRANCH_NAME="${BRANCH_NAME#claude/}"

BASE=""; BASE_NOTE=""
if [ -n "$BASE_ARG" ]; then
  if g rev-parse -q --verify "$BASE_ARG^{commit}" >/dev/null 2>&1; then BASE="$BASE_ARG"
  else BASE_NOTE="--base $BASE_ARG 不存在"; fi
else
  if g rev-parse -q --verify "refs/remotes/origin/main^{commit}" >/dev/null 2>&1; then BASE="origin/main"
  elif g rev-parse -q --verify "refs/heads/main^{commit}" >/dev/null 2>&1; then BASE="main"
  else BASE_NOTE="没有 origin/main 也没有 main"; fi
fi
MB=""
if [ -n "$BASE" ] && [ "$HAS_HEAD" -eq 1 ]; then
  MB=$(g merge-base "$BASE" HEAD 2>/dev/null || true)
  [ -n "$MB" ] || BASE_NOTE="$BASE 和 HEAD 没有共同祖先"
elif [ "$HAS_HEAD" -eq 0 ]; then
  BASE_NOTE="还没有任何提交"
fi

CHANGED_FILE="$WORK/changed.txt"
{
  [ -n "$MB" ] && g diff --name-only --no-renames "$MB" HEAD
  if [ "$HAS_HEAD" -eq 1 ]; then g diff --name-only --no-renames HEAD; else g ls-files; fi
  g ls-files --others --exclude-standard
} 2>/dev/null | sed '/^$/d' | sort -u >"$CHANGED_FILE"
N_CHANGED=$(wc -l <"$CHANGED_FILE" | tr -d ' ')

if [ -n "$MB" ]; then BASE_SHOW="$BASE"; else BASE_SHOW="无（${BASE_NOTE}）"; fi
say "🔍 check.sh（$([ "$MODE" = quick ] && echo 快速 --quick || echo 全量)）· $(basename "$ROOT") · 分支 ${BRANCH_NAME:-（detached）} · base $BASE_SHOW · 改动 $N_CHANGED 个文件 · $(date '+%Y-%m-%d %H:%M')"

# =====================================================================
# [1] 秘密扫描
# =====================================================================
check_1() {
  local scan="$SELF_DIR/secret-scan.sh" out rc n f
  reset_item
  if [ ! -f "$scan" ]; then add_e "没找到 $scan"; finish_item 1 "秘密扫描"; return; fi
  if [ "$MODE" = quick ]; then
    set --
    while IFS= read -r f; do [ -f "$f" ] && set -- "$@" "$f"; done <"$CHANGED_FILE"
    if [ $# -eq 0 ]; then finish_item 1 "秘密扫描" "没有改动的文件要扫（--quick）"; return; fi
    out=$(bash "$scan" --files "$@" 2>/dev/null); rc=$?
  else
    out=$(bash "$scan" --all 2>/dev/null); rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    finish_item 1 "秘密扫描" "$([ "$MODE" = quick ] && echo "扫了 $# 个改动文件" || echo "全部文件")"
  elif [ "$rc" -eq 1 ]; then
    n=$(printf '%s\n' "$out" | grep -c .)
    IE="命中 $n 处（只列位置，不打印值）：把值挪进 .env / .dev.vars；key 进过历史就先轮换（人来做），再讨论清理"; IE_N=1
    while IFS= read -r f; do [ -n "$f" ] && add_d "$f"; done <<<"$out"
    finish_item 1 "秘密扫描"
  else
    add_e "secret-scan.sh 自身出错（退出码 ${rc}）"; finish_item 1 "秘密扫描"
  fi
}

# =====================================================================
# [2] 秘密文件被跟踪
# =====================================================================
check_2() {
  local f base
  reset_item
  while IFS= read -r f; do
    base=${f##*/}
    case "$base" in
      *.example) ;;
      .env|.env.*|.dev.vars|.dev.vars.*|settings.local.json|keys.json|credentials*.json|*.pem|*.key)
        add_e "$f 被 git 跟踪（git rm --cached '$f'；确认 .gitignore 覆盖它；值进过历史就先轮换）" ;;
    esac
  done < <(g ls-files 2>/dev/null)
  finish_item 2 "秘密文件被跟踪"
}

# =====================================================================
# [3] 分支与越界
# =====================================================================
check_3() {
  local name="分支与越界" re='^([A-Za-z0-9][A-Za-z0-9-]*)/([a-z][a-z0-9-]*)/T([0-9]+)-.+$'
  local handle mod f ref ref_short del prefix out_n=0 out_list="" me lead backup example
  reset_item
  if [ "$HAS_HEAD" -eq 0 ]; then
    add_w "还没有任何提交，跳过越界判定（首个提交由 lead 在 main 上做）"; finish_item 3 "$name"; return
  fi
  if [ -z "$BRANCH_NAME" ]; then
    add_w "detached HEAD（没有分支名），跳过越界判定；CI 里请在 workflow 设 BRANCH"; finish_item 3 "$name"; return
  fi
  me="${GITHUB_ACTOR:-$(git config hack.me 2>/dev/null || true)}"
  case "$BRANCH_NAME" in
    main|master)
      if [ "$N_CHANGED" -gt 0 ]; then
        if [ "${ALLOW_MAIN:-}" = 1 ]; then add_w "在 $BRANCH_NAME 上有 $N_CHANGED 个改动（ALLOW_MAIN=1 放行；commit 里写原因）"
        else add_e "在 $BRANCH_NAME 上有 $N_CHANGED 个改动：先开分支 git switch -c <handle>/<模块>/T<n>-<slug>（lead 用 lead/<slug>）"; fi
        while IFS= read -r f; do add_d "$f"; done <"$CHANGED_FILE"
      fi
      [ -z "$MB" ] && add_w "没有 base（${BASE_NOTE}），只看了工作区改动"
      finish_item 3 "$name" "在 $BRANCH_NAME 上，没有改动"; return ;;
    lead/*)
      # 只提醒不拦：CI 里 GITHUB_ACTOR 可能是机器人，拦了会误伤
      lead=$(conf_get LEAD); backup=$(conf_get BACKUP_LEAD)
      if [ -z "$lead" ]; then add_w "hackathon.conf 的 LEAD 为空，核不了 lead/* 分支的身份"
      elif [ -z "$me" ]; then add_w "lead/* 只给 lead 用：认不出你是谁（git config hack.me 为空），LEAD=@$lead"
      elif [ "$(lower "$me")" != "$(lower "$lead")" ] && { [ -z "$backup" ] || [ "$(lower "$me")" != "$(lower "$backup")" ]; }; then
        add_w "lead/* 只给 lead 用：你是 @${me}，LEAD=@$lead${backup:+，BACKUP_LEAD=@$backup}（队员请用 <handle>/<模块>/T<n>-<slug>）"
      fi
      finish_item 3 "$name" "$BRANCH_NAME 是 lead 分支（@${me}），全仓库可写"; return ;;
  esac
  if [[ ! "$BRANCH_NAME" =~ $re ]]; then
    example="git branch -m ${me:-<handle>}/<模块>/T<n>-<slug>（例：git branch -m ${me:-alice}/web/T3-login）"
    if [ "$N_CHANGED" -eq 0 ]; then
      add_w "分支名 $BRANCH_NAME 不符合 <handle>/<模块>/T<n>-<slug>（还没有改动）；改名：$example"
    elif [ "${ALLOW_CROSS:-}" = 1 ]; then
      add_w "分支名 $BRANCH_NAME 不符合 <handle>/<模块>/T<n>-<slug>，ALLOW_CROSS=1 放行（$N_CHANGED 个改动没做越界判定）"
    else
      add_e "分支名 $BRANCH_NAME 不符合 <handle>/<模块>/T<n>-<slug>，推断不出模块，$N_CHANGED 个改动没法判越界：$example"
    fi
    finish_item 3 "$name"; return
  fi
  handle="${BASH_REMATCH[1]}"; mod="${BASH_REMATCH[2]}"
  [ -z "$MB" ] && add_w "没有 base（${BASE_NOTE}），只检查了工作区改动"
  ref="${MB:-HEAD}"; ref_short=$(g rev-parse --short "$ref" 2>/dev/null || echo "$ref")
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      apps/"$mod"/*|docs/3-tasks.md) ;;
      docs/decisions.md|docs/pitfalls.md)
        del=$(g diff --numstat "$ref" -- "$f" 2>/dev/null | awk '{ if ($2 ~ /^[0-9]+$/) s += $2 } END { print s + 0 }')
        [ "$del" -gt 0 ] && add_e "$f 删了 $del 行（只追加：git diff $ref_short -- $f 看是哪几行，改回去）" ;;
      handoff/*/*|handoff/README.md) out_n=$((out_n + 1)); out_list="$out_list$f"$'\n' ;;
      handoff/*.md)
        # 交接单只新建自己的：文件名 -T 之前的前缀必须是本分支的 handle（不区分大小写）
        prefix=$(basename "$f" | sed -E 's/-T[0-9]+-.*$//')
        if g cat-file -e "$ref:$f" 2>/dev/null; then
          if [ ! -e "$f" ]; then add_e "删了交接单 ${f}（交接单只由 lead git mv 到 handoff/done/）"
          elif [ "$(lower "$prefix")" != "$(lower "$handle")" ]; then add_e "改了别人的交接单 ${f}（交接单只新建，不改旧单）"; fi
        elif [ "$(lower "$prefix")" != "$(lower "$handle")" ]; then
          add_e "新建的交接单 $f 前缀是「${prefix}」，不是本分支的 handle「${handle}」（命名 $handle-T<n>-<MMDD-HHMM>.md；替别人写的内容放自己那张单里）"
        fi ;;
      docs/4-demo.md|docs/pitch-assets/*)
        [ "$mod" = pitch ] || { out_n=$((out_n + 1)); out_list="$out_list$f"$'\n'; } ;;
      docs/llm-apis/README.md|docs/llm-apis/TEMPLATE.md|docs/llm-apis/*/*) out_n=$((out_n + 1)); out_list="$out_list$f"$'\n' ;;
      docs/llm-apis/*)
        # API 卡只动自己的：文件名以「本分支 handle-」开头（不区分大小写）；别人的卡不改不删
        case "$(lower "$(basename "$f")")" in
          "$(lower "$handle")"-?*)
            # 自己的卡：文件名全 ASCII（D-05），后缀 .md 或 .json（-response.json）
            if [ -e "$f" ] && ! printf '%s' "$(lower "$(basename "$f")")" | LC_ALL=C grep -Eq '^[a-z0-9._-]+\.(md|json)$'; then
              add_e "API 卡 ${f} 的文件名只能用小写字母、数字、. _ -，后缀 .md 或 .json（例：docs/llm-apis/${handle}-deepseek.md）"
            fi ;;
          *)
            if g cat-file -e "$ref:$f" 2>/dev/null; then
              if [ -e "$f" ]; then add_e "改了别人的 API 卡 ${f}（只能改文件名以 ${handle}- 开头的卡）"
              else add_e "删了别人的 API 卡 ${f}（只能删自己的）"; fi
            else
              add_e "新建的 API 卡 ${f} 要以本分支的 handle 开头：docs/llm-apis/${handle}-<服务商>.md"
            fi ;;
        esac ;;
      *) out_n=$((out_n + 1)); out_list="$out_list$f"$'\n' ;;
    esac
  done <"$CHANGED_FILE"
  if [ "$out_n" -gt 0 ]; then
    if [ "${ALLOW_CROSS:-}" = 1 ]; then
      add_w "ALLOW_CROSS=1 放行 $out_n 个越界文件（模块 $mod 的范围外）"
    else
      add_e "$out_n 个文件超出模块 $mod 的可写范围（apps/$mod/ + 3-tasks / decisions / pitfalls 只追加 / 自己的新交接单 / 自己的 API 卡 docs/llm-apis/${handle}-*$([ "$mod" = pitch ] && echo ' / 4-demo / pitch-assets')）：挪回自己模块，或写进交接单第 2 节交给 lead；lead 同意跨模块后用 ALLOW_CROSS=1 git push，PR 打 cross-module 标签"
    fi
    while IFS= read -r f; do [ -n "$f" ] && add_d "越界：$f"; done <<<"$out_list"
  fi
  finish_item 3 "$name" "$BRANCH_NAME → 模块 ${mod}，$N_CHANGED 个改动都在范围内"
}

# =====================================================================
# [4] 模块结构（pitch 模块只写 docs，没有 apps/pitch 也不算错）
# =====================================================================
is_exec() {  # 跟踪的看 git 里的模式，未跟踪的看文件系统
  local mode
  mode=$(g ls-files -s -- "$1" 2>/dev/null | awk '{print $1}' | head -n 1)
  if [ -n "$mode" ]; then [ "$mode" = 100755 ]; else [ -x "$1" ]; fi
}
check_4() {
  local d m n=0 owner
  reset_item
  for d in apps/*/; do
    [ -d "$d" ] || continue
    m=${d%/}; n=$((n + 1))
    if [ ! -f "$m/README.md" ]; then add_e "$m 缺 README.md（照 apps/README.md 的模板写，含 Owner: @handle）"
    else
      owner=$(grep -m 1 'Owner:' "$m/README.md" 2>/dev/null || true)
      if [ -z "$owner" ]; then add_e "$m/README.md 缺 Owner: 行"
      elif printf '%s' "$owner" | grep -Eq '<填我>|<handle>|Owner:[*[:space:]]*$'; then add_w "$m/README.md 的 Owner 还没填"; fi
    fi
    if [ ! -f "$m/test.sh" ]; then add_e "$m 缺 test.sh（最后一行打印 N passed, M failed）"
    elif ! is_exec "$m/test.sh"; then add_e "$m/test.sh 没有可执行位（chmod +x $m/test.sh && git add $m/test.sh）"; fi
  done
  finish_item 4 "模块结构" "$([ "$n" -gt 0 ] && echo "apps/ 下 $n 个模块结构齐全" || echo "apps/ 下还没有模块")"
}

# =====================================================================
# [5] 模块测试（单个限时；退出码非 0 或最后一行没有计数都算 ❌）
# =====================================================================
run_test() {  # run_test <path/test.sh> → 设置 T_OK T_LAST T_WHY T_P T_LOG T_LEFTOVER
  local t="$1" log pid ticks=0 limit rc timed_out=0 f
  log="logs/test-$(printf '%s' "${t%/test.sh}" | tr '/' '-').txt"
  mkdir -p logs 2>/dev/null
  progress "运行 ${t}（限时 ${TEST_TIMEOUT}s）"
  set -m   # 让 test.sh 自成一个进程组：超时 / 被信号打断时整组杀掉，连它起的 node、后台进程一起
  MOCK="${MOCK:-1}" bash "$t" >"$log" 2>&1 </dev/null &
  pid=$!
  set +m
  CUR_TEST_PID=$pid
  limit=$((TEST_TIMEOUT * 5))
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -ge "$limit" ]; then
      timed_out=1
      kill -TERM -- "-$pid" 2>/dev/null || kill_tree "$pid" TERM
      sleep 1
      kill -KILL -- "-$pid" 2>/dev/null || kill_tree "$pid" KILL
      break
    fi
    sleep 0.2; ticks=$((ticks + 1))
  done
  wait "$pid" 2>/dev/null; rc=$?
  # 无条件清一次进程组：test.sh 自己退出了，但留在后台的进程（没 wait 的 &）还在这个组里
  T_LEFTOVER=0
  if kill -TERM -- "-$pid" 2>/dev/null; then
    T_LEFTOVER=1; sleep 0.2; kill -KILL -- "-$pid" 2>/dev/null
  fi
  CUR_TEST_PID=""
  T_LAST=$(sed '/^[[:space:]]*$/d' "$log" | tail -n 1 | tr -d '\r' | cut -c 1-300)
  T_OK=0; T_P=0; T_WHY=""
  if [ "$timed_out" -eq 1 ]; then T_WHY="超时（>${TEST_TIMEOUT}s，已杀掉整个进程组）"
  elif ! printf '%s\n' "$T_LAST" | grep -Eq '[0-9]+ passed, [0-9]+ failed'; then T_WHY="最后一行没有「N passed, M failed」（退出码 ${rc}，多半是崩了）"
  else
    T_P=$(printf '%s\n' "$T_LAST" | grep -oE '[0-9]+ passed' | head -n 1 | grep -oE '[0-9]+')
    f=$(printf '%s\n' "$T_LAST" | grep -oE '[0-9]+ failed' | head -n 1 | grep -oE '[0-9]+')
    if [ "$rc" -ne 0 ]; then T_WHY="退出码 $rc"
    elif [ "${f:-0}" -gt 0 ]; then T_WHY="有 $f 个失败但退出码是 0（test.sh 违反约定）"
    else T_OK=1; fi
  fi
  T_LOG="$log"
}
check_5() {
  local t m all="" run="" n_all=0 n_run=0 n_fail=0 total_p=0 failed_mods=""
  reset_item
  [ -n "$TIMEOUT_NOTE" ] && add_w "$TIMEOUT_NOTE"
  for t in apps/*/test.sh; do
    [ -f "$t" ] || continue
    all="$all$t"$'\n'; n_all=$((n_all + 1))
  done
  if [ "$n_all" -eq 0 ]; then add_w "没有任何 apps/*/test.sh"; finish_item 5 "模块测试"; return; fi
  if [ "$MODE" = quick ] && [ -n "$MB" ]; then
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      m="${t%/test.sh}/"
      grep -q "^$m" "$CHANGED_FILE" && run="$run$t"$'\n'
    done <<<"$all"
  else
    run="$all"
  fi
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    n_run=$((n_run + 1))
    run_test "$t"
    if [ "$T_OK" -eq 1 ]; then
      total_p=$((total_p + ${T_P:-0}))
      add_d "✅ $t → $T_LAST"
    else
      n_fail=$((n_fail + 1)); failed_mods="$failed_mods${failed_mods:+, }${t%/test.sh}"
      add_d "❌ $t → ${T_LAST:-（没有任何输出）}"
      add_d "   $T_WHY · 全文 $T_LOG"
    fi
    [ "$T_LEFTOVER" -eq 1 ] && add_w "${t%/test.sh}/test.sh 留了后台进程，已清理（test.sh 里起的 & 要 wait 或 kill）"
  done <<<"$run"
  if [ "$n_run" -eq 0 ]; then
    finish_item 5 "模块测试" "相对 $BASE 没有改动过的模块，跳过（全量跑：bash scripts/check.sh）"; return
  fi
  if [ "$n_fail" -gt 0 ]; then
    IE="$n_fail/$n_run 个 test.sh 失败：$failed_mods"; IE_N=1
  fi
  finish_item 5 "模块测试" "$n_run 个 test.sh 全过（共 $total_p passed，单个限时 ${TEST_TIMEOUT}s）$([ "$n_run" -lt "$n_all" ] && echo "，--quick 跳过 $((n_all - n_run)) 个没改动的")"
}

# =====================================================================
check_1
check_2
check_3
check_4
check_5
py_item 6 "仓库卫生" hygiene
py_item 7 "RULES 块一致" rules
py_item 8 "交接单格式" handoff
py_item 9 "hackathon.conf" conf
finish_output last-check.txt
