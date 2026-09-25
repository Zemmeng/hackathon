#!/usr/bin/env bash
# 用途：把 public/index.html 里所有 ?v=N 加 1，逼浏览器重新拉 CSS/JS（改完前端必跑）
# 用法：bash bump.sh（任意目录都能跑）
# 退出码：0 已加 1；1 找不到 index.html 或里面没有 ?v=N
cd "$(dirname "$0")" || exit 1
f=public/index.html

if [ ! -f "$f" ]; then
  echo "❌ 找不到 $f"
  exit 1
fi
before=$(grep -oE '\?v=[0-9]+' "$f" | tr '\n' ' ')
if [ -z "$before" ]; then
  echo "❌ $f 里没有 ?v=N"
  exit 1
fi

# 用 awk 做加法：sed 不会算数；BSD awk 和 gawk 都支持这个写法
tmp="$f.bump.$$"
awk '{
  out = ""; line = $0
  while (match(line, /\?v=[0-9]+/)) {
    out = out substr(line, 1, RSTART - 1) "?v=" (substr(line, RSTART + 3, RLENGTH - 3) + 1)
    line = substr(line, RSTART + RLENGTH)
  }
  print out line
}' "$f" >"$tmp" && mv "$tmp" "$f" || { rm -f "$tmp"; echo "❌ 改写失败"; exit 1; }

after=$(grep -oE '\?v=[0-9]+' "$f" | tr '\n' ' ')
echo "改前：$before"
echo "改后：$after"
