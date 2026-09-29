#!/usr/bin/env bash
# 用途：把 public/index.html 和 public/js/*.js 里所有 ?v=N 加 1，逼浏览器重新拉 CSS/JS/数据（改完前端必跑）
# 用法：bash apps/sim/bump.sh（任意目录都能跑）
# 退出码：0 已加 1；1 一个 ?v=N 都没找到
cd "$(dirname "$0")" || exit 1
python3 - public/index.html public/js/*.js <<'PY'
import re, sys
n = 0
for f in sys.argv[1:]:
    s = open(f, encoding='utf-8').read()
    t, k = re.subn(r'\?v=(\d+)', lambda m: '?v=%d' % (int(m.group(1)) + 1), s)
    if k:
        open(f, 'w', encoding='utf-8').write(t); n += k
        print('%s：%d 处 +1' % (f, k))
if not n:
    print('❌ 没找到任何 ?v=N'); sys.exit(1)
PY
