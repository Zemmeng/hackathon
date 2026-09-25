#!/usr/bin/env bash
# new-app.sh —— lead 从 starter 生成一个模块 apps/<模块名>，顺手分配端口、登记 launch.json，防止漏登记
#
# 用途：cp starters/<starter> → apps/<模块名>（跳过 node_modules / .wrangler / logs / out / .venv / .dev.vars / .env），
#       把所有文本文件里的 __NAME__ 换成模块名，按端口表分配下一个空闲端口，往 .claude/launch.json 追加一条
#       name=<模块名> 的配置，填模块 README 的 Owner: 行，最后打印要贴进 CODEOWNERS 和 apps/README 登记表的两行。
# 用法：bash scripts/new-app.sh <模块名> <web-worker|py-tool> [--owner <handle>] [--port N]
#   模块名只许 [a-z][a-z0-9-]*（它同时是目录名、commit 前缀、分支名里的模块段、wrangler 的 worker 名）
#   端口表：worker 8787 起、python 8000 起，自动取 .claude/launch.json 里没被占的下一个。
#   ⚠️ 静态页端口（4173 起）不自动分配：要纯静态预览就自己往 launch.json 加一条 python3 -m http.server。
#   launch.json 条目：web-worker 照抄预置的 starter-worker（改路径和端口，没有就用内置默认）；
#   py-tool 没有预置条目，直接用内置默认命令：python3 -m http.server <端口> -d apps/<名>/out（预览产物目录）。
# 🔒 只能在 lead/* 分支上跑（自测时可设 ALLOW_CROSS=1）。不会 git add / commit，生成后由 lead 检查再提交。
# 退出码：0 = 生成成功；1 = 被拒绝（分支不对 / 目录已存在 / 端口被占 / launch.json 坏了）；2 = 用法错误
set -uo pipefail

usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; }
die() { echo "❌ $1" >&2; [ -n "${2:-}" ] && echo "   修法：$2" >&2; exit 1; }

NAME=""; STARTER=""; OWNER=""; PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --owner) [ -n "${2:-}" ] || { usage; exit 2; }; OWNER="$2"; shift ;;
    --owner=*) OWNER="${1#--owner=}" ;;
    --port) [ -n "${2:-}" ] || { usage; exit 2; }; PORT="$2"; shift ;;
    --port=*) PORT="${1#--port=}" ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "❌ 未知参数：$1" >&2; usage; exit 2 ;;
    *) if [ -z "$NAME" ]; then NAME="$1"; elif [ -z "$STARTER" ]; then STARTER="$1"; else echo "❌ 多余的参数：$1" >&2; exit 2; fi ;;
  esac
  shift
done
[ -n "$NAME" ] && [ -n "$STARTER" ] || { usage; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "❌ 不在 git 仓库里" >&2; exit 2; }
cd "$ROOT" || exit 2
command -v python3 >/dev/null 2>&1 || die "需要 python3（≥3.9）" "bash scripts/setup.sh 会告诉你怎么装"

echo "🧩 new-app.sh $NAME $STARTER"

# [1/5] 只有 lead 分支能生成模块
BR=$(git symbolic-ref --short -q HEAD 2>/dev/null || true)
case "$BR" in
  lead/*) echo "[1/5] 分支 $BR ✅" ;;
  *) if [ "${ALLOW_CROSS:-}" = 1 ]; then echo "[1/5] 分支 ${BR:-（detached）} ⚠️ 不是 lead/*，ALLOW_CROSS=1 放行"
     else die "只能在 lead/* 分支上生成模块（当前：${BR:-detached}）" "git switch -c lead/new-$NAME origin/main（或 main），再跑一次"; fi ;;
esac

# [2/5] 参数校验
printf '%s' "$NAME" | grep -Eq '^[a-z][a-z0-9-]*$' || { echo "❌ 模块名只许 [a-z][a-z0-9-]*：$NAME" >&2; exit 2; }
[ "${#NAME}" -le 40 ] || { echo "❌ 模块名太长（≤40）：$NAME" >&2; exit 2; }
case "$NAME" in *-) echo "❌ 模块名不能以 - 结尾" >&2; exit 2 ;; shared) die "apps/shared 是共享代码区（视同契约），不从 starter 生成" ;; esac
case "$STARTER" in web-worker|py-tool) ;; *) echo "❌ starter 只能是 web-worker 或 py-tool：$STARTER" >&2; exit 2 ;; esac
[ -d "starters/$STARTER" ] || die "没有 starters/$STARTER" "从模板仓库拿回 starters/，或检查拼写"
[ -e "apps/$NAME" ] && die "apps/$NAME 已存在，不覆盖" "换个名字；或确认旧的不要了，由 lead 手动删掉再生成"
OWNER="${OWNER#@}"
if [ -n "$OWNER" ]; then
  printf '%s' "$OWNER" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9-]*$' || { echo "❌ --owner 要是 GitHub handle：$OWNER" >&2; exit 2; }
fi
if [ -n "$PORT" ]; then
  printf '%s' "$PORT" | grep -Eq '^[0-9]+$' && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] \
    || { echo "❌ --port 要是 1024–65535 的整数：$PORT" >&2; exit 2; }
fi
if [ -n "$OWNER" ]; then OWNER_SHOW="@$OWNER"; else OWNER_SHOW="（未指定，README 里留 @<填我>）"; fi
echo "[2/5] 参数 ✅ 模块 $NAME · starter $STARTER · owner $OWNER_SHOW"

# [3/5]–[5/5] 复制、替换、登记：全部交给 python，先校验 launch.json 和端口，再动文件；中途失败就删掉半成品
python3 - "$NAME" "$STARTER" "$OWNER" "$PORT" <<'PY'
import copy, json, os, re, shutil, sys

name, starter, owner, want_port = sys.argv[1:5]
src, dst = os.path.join('starters', starter), os.path.join('apps', name)
LAUNCH = os.path.join('.claude', 'launch.json')
BASE_PORT = {'web-worker': 8787, 'py-tool': 8000}[starter]
# 只有 web-worker 有预置条目可照抄；py-tool 用下面的内置默认命令
TEMPLATE = {'web-worker': 'starter-worker'}.get(starter)


def fail(msg, fix=''):
    print('❌ ' + msg, file=sys.stderr)
    if fix:
        print('   修法：' + fix, file=sys.stderr)
    sys.exit(1)


# ---- 读 launch.json（不存在就建最小结构），收集已用端口 ----
if os.path.exists(LAUNCH):
    try:
        with open(LAUNCH, encoding='utf-8') as f:
            data = json.load(f)
    except ValueError as e:
        fail('.claude/launch.json 不是合法 JSON：%s' % e, '先修好它（python3 -m json.tool .claude/launch.json）')
else:
    data = {'version': '0.0.1', 'configurations': []}
if not isinstance(data, dict) or not isinstance(data.get('configurations', []), list):
    fail('.claude/launch.json 结构不对（要有 configurations 数组）')
confs = data.setdefault('configurations', [])
if any(c.get('name') == name for c in confs if isinstance(c, dict)):
    fail('.claude/launch.json 里已经有 name=%s 的配置' % name, '换个模块名，或先删掉那条旧配置')

used = set()
PORT_RX = re.compile(r'(?:PORT:-|--port[ =]|http\.server\s+|localhost:)(\d{4,5})\b')
for c in confs:
    if not isinstance(c, dict):
        continue
    if isinstance(c.get('port'), int):
        used.add(c['port'])
    for m in PORT_RX.finditer(json.dumps(c)):
        used.add(int(m.group(1)))
if want_port:
    port = int(want_port)
    if port in used:
        fail('端口 %d 已被 .claude/launch.json 里的配置占用（已用：%s）' % (port, ' '.join(map(str, sorted(used)))),
             '去掉 --port 让脚本自动分配，或换一个')
else:
    port = BASE_PORT
    while port in used:
        port += 1

# ---- 复制（跳过依赖、缓存、产物和真秘密文件）----
IGNORE = shutil.ignore_patterns('node_modules', '.wrangler', 'logs', 'out', '.venv', '__pycache__', '*.pyc',
                                '.dev.vars', '.env', '.DS_Store')
try:
    shutil.copytree(src, dst, ignore=IGNORE)
except Exception as e:
    fail('复制 %s → %s 失败：%s' % (src, dst, e))

try:
    # ---- __NAME__ → 模块名；starter 默认端口 → 新端口 ----
    port_rx = re.compile(r'(--port[ =]|PORT:-|localhost:|127\.0\.0\.1:)%d\b' % BASE_PORT)
    replaced = 0
    for dirpath, dirnames, filenames in os.walk(dst, topdown=False):
        for fn in filenames:
            fp = os.path.join(dirpath, fn)
            if os.path.islink(fp):
                continue
            with open(fp, 'rb') as f:
                raw = f.read()
            if b'\0' in raw[:8000]:
                continue
            try:
                text = raw.decode('utf-8')
            except UnicodeDecodeError:
                continue
            new = text.replace('__NAME__', name)
            if port != BASE_PORT:
                new = port_rx.sub(lambda m: m.group(1) + str(port), new)
            if new != text:
                with open(fp, 'w', encoding='utf-8', newline='') as f:
                    f.write(new)
                if '__NAME__' in text:
                    replaced += 1
            if '__NAME__' in fn:
                os.rename(fp, os.path.join(dirpath, fn.replace('__NAME__', name)))
        for dn in dirnames:
            if '__NAME__' in dn:
                os.rename(os.path.join(dirpath, dn), os.path.join(dirpath, dn.replace('__NAME__', name)))
    print('[3/5] 复制 %s → %s ✅（__NAME__ 替换了 %d 个文件）' % (src, dst, replaced))

    # ---- wrangler 配置的 name 字段直接改成模块名（starter 里的 name 是合法占位，不靠 __NAME__）----
    for cfg, rx_name in (('wrangler.jsonc', r'("name"\s*:\s*")[^"]*(")'),
                         ('wrangler.json',  r'("name"\s*:\s*")[^"]*(")'),
                         ('wrangler.toml',  r'(^name\s*=\s*")[^"]*(")')):
        cp = os.path.join(dst, cfg)
        if os.path.isfile(cp):
            with open(cp, encoding='utf-8') as f:
                text = f.read()
            new = re.sub(rx_name, lambda m: m.group(1) + name + m.group(2), text, count=1, flags=re.M)
            if new != text:
                with open(cp, 'w', encoding='utf-8', newline='') as f:
                    f.write(new)
                print('      %s 的 name → %s ✅' % (cfg, name))

    # ---- 模块 README 的 Owner: 行 ----
    readme = os.path.join(dst, 'README.md')
    who = '@' + owner if owner else '@<填我>'
    if os.path.isfile(readme):
        with open(readme, encoding='utf-8') as f:
            text = f.read()
        rx = re.compile(r'^(.*?Owner:\**)[^\n]*$', re.M)
        if rx.search(text):
            text = rx.sub(lambda m: m.group(1) + ' ' + who, text, count=1)
        else:
            lines = text.split('\n')
            at = next((i + 1 for i, l in enumerate(lines) if l.startswith('# ')), 0)
            lines[at:at] = ['', 'Owner: ' + who]
            text = '\n'.join(lines)
    else:
        text = '# %s\n\nOwner: %s\n' % (name, who)
    with open(readme, 'w', encoding='utf-8') as f:
        f.write(text)
    tsh = os.path.join(dst, 'test.sh')
    if os.path.isfile(tsh):
        os.chmod(tsh, os.stat(tsh).st_mode | 0o111)

    # ---- launch.json 追加一条：有 starter 的预置条目就照抄改路径和端口，没有就用默认 ----
    tpl = next((c for c in confs if TEMPLATE and isinstance(c, dict) and c.get('name') == TEMPLATE), None)
    if tpl:
        s = json.dumps(tpl, ensure_ascii=False).replace('starters/%s' % starter, 'apps/%s' % name)
        tport = tpl.get('port') if isinstance(tpl.get('port'), int) else BASE_PORT
        s = re.sub(r'(PORT:-|--port[ =])%d\b' % tport, lambda m: m.group(1) + str(port), s)
        entry = json.loads(s)
    elif starter == 'web-worker':
        entry = {'runtimeExecutable': 'sh', 'runtimeArgs': [
            '-c', 'npx wrangler dev -c apps/%s/wrangler.jsonc --port ${PORT:-%d} --var MOCK:1' % (name, port)]}
    else:  # py-tool：内置默认 —— 用 http.server 预览 out/ 里的产物；要跑服务就自己改这条
        entry = {'runtimeExecutable': 'sh', 'runtimeArgs': [
            '-c', 'mkdir -p apps/%s/out && python3 -m http.server ${PORT:-%d} -d apps/%s/out' % (name, port, name)]}
    entry = dict([('name', name)] + [(k, v) for k, v in entry.items() if k != 'name'])
    entry['port'] = port
    entry['autoPort'] = True
    confs.append(entry)

    def dump(v, ind=0):
        pad, pad2 = '  ' * ind, '  ' * (ind + 1)
        if isinstance(v, dict):
            if not v:
                return '{}'
            return '{\n' + ',\n'.join('%s%s: %s' % (pad2, json.dumps(k, ensure_ascii=False), dump(x, ind + 1))
                                      for k, x in v.items()) + '\n' + pad + '}'
        if isinstance(v, list):
            if all(not isinstance(x, (dict, list)) for x in v):
                return json.dumps(v, ensure_ascii=False)
            return '[\n' + ',\n'.join(pad2 + dump(x, ind + 1) for x in v) + '\n' + pad + ']'
        return json.dumps(v, ensure_ascii=False)

    os.makedirs('.claude', exist_ok=True)
    out = dump(data) + '\n'
    json.loads(out)  # 写之前再验一遍
    with open(LAUNCH, 'w', encoding='utf-8') as f:
        f.write(out)
    print('[4/5] .claude/launch.json 追加 %s（port %d，autoPort）✅' % (name, port))
    print('[5/5] %s/README.md 的 Owner: %s %s' % (dst, who, '✅' if owner else '⚠️ 记得填'))

    base = 'python 8000 起' if starter == 'py-tool' else 'worker 8787 起'
    print('')
    print('✅ 已生成 %s（来自 starters/%s，端口 %d；端口表：%s）' % (dst, starter, port, base))
    print('   ℹ️ 静态页端口（4173 起）不自动分配：要纯静态预览，自己往 .claude/launch.json 加一条 http.server')
    print('')
    print('下一步（lead 手动，照贴）：')
    print('  1) .github/CODEOWNERS 追加：')
    print('       /apps/%s/ %s' % (name, who))
    print('  2) apps/README.md 模块登记表追加：')
    print('       | %s | %s | %s | %d | — |' % (name, who, starter, port))
    print('  3) 要上线的话，把 %s 加进 hackathon.conf 的 DEPLOY_MODULES' % name)
    print('  4) 验证：bash %s/test.sh && bash scripts/check.sh --quick' % dst)
    print('  5) 提交：git add %s .claude/launch.json && git commit -m "lead: 生成模块 %s —— <为什么>"' % (dst, name))
except Exception as e:
    shutil.rmtree(dst, ignore_errors=True)
    fail('生成中途失败，已删掉半成品 %s：%s' % (dst, e))
PY
exit $?
