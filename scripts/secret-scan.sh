#!/usr/bin/env bash
# secret-scan.sh —— 秘密扫描（.githooks/pre-commit、scripts/check.sh [1]、/submit 共用这一份）
#
# 用途：找出仓库里疑似 key / token / 私钥的地方。只报位置，绝不打印匹配到的值。
# 用法：
#   bash scripts/secret-scan.sh                  等于 --all
#   bash scripts/secret-scan.sh --all            所有已跟踪文件 + 未跟踪但没被忽略的文件（读工作区）
#   bash scripts/secret-scan.sh --staged         只扫暂存区里将要提交的内容（pre-commit 用）
#   bash scripts/secret-scan.sh --history        全部 git 历史里「新增过」的行（仓库转 public 前必跑）
#   bash scripts/secret-scan.sh --files <路径>…  只扫给定的工作区文件（check.sh --quick 用）
# 输出：每处命中一行「文件:行号:模式名」；--history 是「提交号:文件:模式名」。说明文字走 stderr。
# 退出码：0 = 没命中；1 = 有命中；2 = 用法错误 / 不在 git 仓库里 / 没有 python3
#
# 覆盖的模式（改这里就改下面 PATTERNS）：AWS AKIA…、OpenAI 风格 sk-…、Anthropic sk-ant-…、
#   GitHub gh[pous]_… / github_pat_…、Google AIza…、Slack xox[bpa]-…、PEM 私钥头、火山方舟 ark-…、
#   Hugging Face hf_…、Groq gsk_…、xAI xai-…、Replicate r8_…、请求头里直接写值的 Bearer <≥20 位>（curl 示例最常见）、
#   api_key|token|secret|password|passwd 后面用 = 或 : 赋一个 ≥20 位的串，
#   以及 password|passwd|secret 用引号赋一个 ≥12 位的串（${…}、process.env、env. 这类引用不算）。
# 白名单按「命中的那一段」判断，不按整行（同一行有 <br/>、__CONFIG__ 也照样抓）：
#   命中的值含 xxx / your_，或被 <…> 整个包住（如 <sk-your-key>），或整段是 __NAME__ 这种占位 → 放行；
#   *.example 文件整个放行；本文件自身放行。
set -uo pipefail

usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; }

MODE="all"
case "${1:-}" in
  ""|--all) MODE="all" ;;
  --staged) MODE="staged" ;;
  --history) MODE="history" ;;
  --files) MODE="files"; shift ;;
  -h|--help) usage; exit 0 ;;
  *) echo "❌ 未知参数：$1（用 --help 看用法）" >&2; exit 2 ;;
esac
[ "$MODE" = "files" ] || { [ $# -gt 0 ] && shift; }
[ "$MODE" = "files" ] || [ $# -eq 0 ] || { echo "❌ 多余的参数：$*" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "❌ 不在 git 仓库里" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "❌ 需要 python3（≥3.9）" >&2; exit 2; }

# files 模式：把相对 cwd 的路径换成相对仓库根的路径
PREFIX=$(git rev-parse --show-prefix 2>/dev/null)
cd "$ROOT" || exit 2

scan() {
python3 - "$MODE" "$PREFIX" "$@" <<'PY'
import os, re, subprocess, sys

mode, prefix, args = sys.argv[1], sys.argv[2], sys.argv[3:]
SELF = 'scripts/secret-scan.sh'
MAX_BYTES = 5 * 1024 * 1024  # 超过 5MB 的文件不扫（大文件由 check [6] 管）

# (模式名, 正则, 值所在的分组号)。同一行命中多个模式时都会列出；sk-ant- 不会再被算成 sk-
PATTERNS = [
    ('aws_access_key', re.compile(r'(?<![0-9A-Z])AKIA[0-9A-Z]{16}(?![0-9A-Z])'), 0),
    ('anthropic_key', re.compile(r'(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{10,}'), 0),
    ('openai_style_key', re.compile(r'(?<![A-Za-z0-9_-])sk-(?!ant-)[A-Za-z0-9_-]{20,}'), 0),
    ('github_token', re.compile(r'(?<![A-Za-z0-9_])gh[pous]_[A-Za-z0-9]{30,}'), 0),
    ('github_pat', re.compile(r'(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{40,}'), 0),
    ('google_api_key', re.compile(r'(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{30,}'), 0),
    ('slack_token', re.compile(r'(?<![A-Za-z0-9])xox[bpa]-[A-Za-z0-9-]{10,}'), 0),
    ('private_key', re.compile(r'-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'), 0),
    ('ark_key', re.compile(r'(?<![A-Za-z0-9_-])ark-[0-9a-f-]{30,}'), 0),
    ('huggingface_token', re.compile(r'(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,}'), 0),
    ('groq_key', re.compile(r'(?<![A-Za-z0-9_])gsk_[A-Za-z0-9]{40,}'), 0),
    ('xai_key', re.compile(r'(?<![A-Za-z0-9_-])xai-[A-Za-z0-9]{40,}'), 0),
    ('replicate_token', re.compile(r'(?<![A-Za-z0-9_])r8_[A-Za-z0-9]{30,}'), 0),
    # 请求头里直接写的值：Bearer $VAR、Bearer ${…}、Bearer <你的key> 都不算（字符集里没有 $ { <）
    ('bearer_token', re.compile(r'(?i)(?<![A-Za-z0-9_])Bearer\s+([A-Za-z0-9._~+/=-]{20,})'), 1),
    # 通用赋值：KEY=…、"token": "…"、password: '…'；后面紧跟 ( 的是函数调用，不算
    ('generic_secret_assignment', re.compile(
        r'(?i)(?:api[_-]?key|secret|token|password|passwd)[\'"]?\s*[:=]\s*[\'"]?'
        r'([A-Za-z0-9_\-]{20,})(?![A-Za-z0-9_\-]*\()'), 1),
    # 密码类放宽：引号里任意 ≥12 个非空白非引号字符
    ('password_assignment', re.compile(
        r'(?i)(?:password|passwd|secret)[\'"]?\s*[:=]\s*([\'"])([^\s\'"]{12,})\1'), 2),
]

PLACEHOLDER_IN_VALUE = re.compile(r'(?i)xxx|your_')
DUNDER = re.compile(r'^__[A-Z_]+__$')
REFERENCE = re.compile(r'^\$\{|^\$[A-Z_]|process\.env|^env\.|os\.environ|import\.meta\.env')


def enclosed_in_angle(line, start, end):
    """命中片段被一对 <…> 整个包住，且 <…> 里没有空白 / = / 引号（<sk-your-key> 算；<img src="…key…"> 不算）。"""
    lt = line.rfind('<', 0, start)
    if lt < 0 or line.rfind('>', 0, start) > lt:
        return False
    gt = line.find('>', end)
    if gt < 0 or 0 <= line.find('<', end) < gt:
        return False
    inner = line[lt + 1:gt]
    return not re.search(r'[\s="\']', inner)


def whitelisted_match(line, m, grp):
    value = m.group(grp)
    if PLACEHOLDER_IN_VALUE.search(value) or DUNDER.match(value) or REFERENCE.search(value):
        return True
    return enclosed_in_angle(line, m.start(grp), m.end(grp))


def whitelisted_path(path):
    return path.endswith('.example') or path == SELF


def hits_in_line(line):
    names = []
    for name, rx, grp in PATTERNS:
        if any(not whitelisted_match(line, m, grp) for m in rx.finditer(line)):
            names.append(name)
    if 'generic_secret_assignment' in names and 'password_assignment' in names:
        names.remove('password_assignment')  # 同一个值别报两遍
    if 'bearer_token' in names and len(names) > 1:
        names.remove('bearer_token')  # Bearer sk-… 已经被具体模式报了
    return names


def git(*a):
    return subprocess.run(['git', '-c', 'core.quotePath=false'] + list(a),
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout


def zsplit(b):
    return [p.decode('utf-8', 'surrogateescape') for p in b.split(b'\0') if p]


found = 0


def report(loc, name):
    global found
    found += 1
    print('%s:%s' % (loc, name))


def scan_bytes(path, data):
    if whitelisted_path(path) or len(data) > MAX_BYTES or b'\0' in data[:8000]:
        return
    text = data.decode('utf-8', 'replace')
    for no, line in enumerate(text.splitlines(), 1):
        for name in hits_in_line(line):
            report('%s:%d' % (path, no), name)


def scan_worktree(paths):
    seen = set()
    for p in paths:
        p = os.path.normpath(p)
        if p in seen or p.startswith('..'):
            continue
        seen.add(p)
        if os.path.islink(p) or not os.path.isfile(p):
            continue
        try:
            with open(p, 'rb') as f:
                data = f.read(MAX_BYTES + 1)
        except OSError:
            continue
        scan_bytes(p, data)


if mode == 'all':
    paths = zsplit(git('ls-files', '-z')) + zsplit(git('ls-files', '-z', '--others', '--exclude-standard'))
    scan_worktree(sorted(set(paths)))
elif mode == 'files':
    scan_worktree([os.path.join(prefix, a) if prefix and not os.path.isabs(a) else a for a in args])
elif mode == 'staged':
    for p in zsplit(git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR')):
        scan_bytes(p, git('show', ':' + p))
elif mode == 'history':
    proc = subprocess.Popen(['git', '-c', 'core.quotePath=false', 'log', '--all', '-p', '--no-color',
                             '--no-ext-diff', '--no-textconv', '-U0', '--format=commit %H'],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    commit, path, in_hunk, seen = '?', None, False, set()
    for raw in proc.stdout:
        line = raw.decode('utf-8', 'replace').rstrip('\n')
        if line.startswith('commit ') and len(line) == 47:
            commit, path, in_hunk = line[7:19], None, False
        elif line.startswith('diff --git '):
            path, in_hunk = None, False
        elif not in_hunk and line.startswith('+++ '):
            path = line[6:] if line.startswith('+++ b/') else None
        elif line.startswith('@@'):
            in_hunk = True
        elif in_hunk and line.startswith('+') and path and not whitelisted_path(path):
            for name in hits_in_line(line[1:]):
                key = (commit, path, name)
                if key not in seen:
                    seen.add(key)
                    report('%s:%s' % (commit, path), name)
    proc.wait()

sys.exit(1 if found else 0)
PY
}

scan "$@"; rc=$?
if [ "$rc" -eq 0 ]; then
  [ "$MODE" = "history" ] && echo "✅ secret-scan --history：全部历史零命中" >&2
  exit 0
fi
[ "$rc" -ne 1 ] && { echo "❌ secret-scan 自己出错了（python 退出码 $rc）" >&2; exit 2; }
{
  echo "🔑 secret-scan（--$MODE）：上面每行是「位置:模式名」，只列位置，不打印值。"
  echo "   修法：把值从文件里删掉，改成读环境变量（本地放 .env / .dev.vars，线上用 wrangler secret put）。"
  [ "$MODE" = "staged" ] && echo "   暂存区的：改完重新 git add；秘密文件本身用 git rm --cached <文件>。"
  echo "   误报：改成占位写法（<KEY>、your_…），或找 lead 调整本脚本白名单。"
  echo "   🔒 key 进过历史（哪怕只 commit 没 push）就先轮换（人来做），再讨论清理历史。"
} >&2
exit 1
