#!/usr/bin/env bash
# 用途：跑本模块全部测试（tests/test_*.py），逐个执行并汇总
# 用法：bash apps/roads/test.sh（任意目录都能跑）；前置条件：python3 ≥ 3.9，测试只用标准库
# 退出码：0 全部通过；1 有失败（断言失败 / 崩溃 / 缺计数行 / 超时 / 没找到测试都算）
# 最后一行固定是「N passed, M failed」，scripts/check.sh 靠它汇总
cd "$(dirname "$0")" || exit 1

LIMIT=90 # 单个测试文件限时（秒）
P=0; F=0; N=0
OUT=$(mktemp "${TMPDIR:-/tmp}/roads-test.XXXXXX") || exit 1
PID=""
trap '[ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -f "$OUT"' EXIT
trap 'exit 130' INT TERM

for f in tests/test_*.py; do
  [ -f "$f" ] || continue
  N=$((N + 1)); ticks=0; timed_out=0
  # macOS 没有 timeout 命令：后台跑 + kill -0 轮询
  python3 "$f" >"$OUT" 2>&1 &
  PID=$!
  while kill -0 "$PID" 2>/dev/null; do
    if [ "$ticks" -ge $((LIMIT * 10)) ]; then kill -9 "$PID" 2>/dev/null; timed_out=1; break; fi
    sleep 0.1; ticks=$((ticks + 1))
  done
  wait "$PID" 2>/dev/null; code=$?; PID=""
  last=$(tail -n 1 "$OUT" | tr -d '\r')
  if [ "$timed_out" = 1 ]; then
    echo "❌ $f 超时（>${LIMIT}s）"; F=$((F + 1))
  elif ! printf '%s\n' "$last" | grep -Eq '^[0-9]+ passed, [0-9]+ failed$'; then
    # 崩溃不许伪装成绿：没有计数行一律记 1 个失败
    echo "❌ $f 缺少「N passed, M failed」计数行（退出码 $code）"; F=$((F + 1)); tail -n 20 "$OUT" | sed 's/^/   /'
  else
    p=${last%% passed*}; q=${last##*, }; q=${q%% failed}
    P=$((P + p)); F=$((F + q))
    if [ "$code" -ne 0 ] && [ "$q" -eq 0 ]; then echo "❌ $f $last，但退出码是 $code"; F=$((F + 1))
    elif [ "$q" -gt 0 ]; then echo "❌ $f $last"; grep '^❌' "$OUT" | sed 's/^/   /'
    else echo "✅ $f $last"; fi
  fi
done

[ "$N" -eq 0 ] && { echo "❌ tests/ 下没有找到任何测试文件"; F=$((F + 1)); }
echo "$P passed, $F failed"
[ "$F" -eq 0 ] || exit 1
