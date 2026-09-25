#!/usr/bin/env bash
# 用途：跑本模块全部测试——自动发现 tests/*.test.mjs 和 tests/sim.mjs，逐个执行并汇总
# 用法：bash test.sh（任意目录都能跑）；前置条件：node ≥ 18，不需要 npm i
# 退出码：0 全部通过；1 有失败（断言失败 / 崩溃 / 缺计数行 / 超时 / 没找到测试都算）
# 最后一行固定是「N passed, M failed」，scripts/check.sh 靠它汇总
cd "$(dirname "$0")" || exit 1

LIMIT=60 # 单个测试文件限时（秒）
P=0
F=0
N=0

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 没找到 node（需要 ≥ 18）"
  echo "0 passed, 1 failed"
  exit 1
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/webworker-test.XXXXXX") || exit 1
PID=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

run_one() {
  local f="$1" out="$TMP/out.txt" ticks=0 code timed_out=0 last p q
  N=$((N + 1))
  # macOS 没有 timeout 命令：后台跑 + kill -0 轮询
  node "$f" >"$out" 2>&1 &
  PID=$!
  while kill -0 "$PID" 2>/dev/null; do
    if [ "$ticks" -ge $((LIMIT * 10)) ]; then
      kill "$PID" 2>/dev/null
      sleep 0.2
      kill -9 "$PID" 2>/dev/null
      timed_out=1
      break
    fi
    sleep 0.1
    ticks=$((ticks + 1))
  done
  wait "$PID" 2>/dev/null
  code=$?
  PID=""

  last=$(tail -n 1 "$out" | tr -d '\r')
  if [ "$timed_out" = 1 ]; then
    printf '❌ %-24s 超时（>%ss）\n' "$f" "$LIMIT"
    F=$((F + 1))
  elif ! printf '%s\n' "$last" | grep -Eq '^[0-9]+ passed, [0-9]+ failed$'; then
    # 崩溃不许伪装成绿：没有计数行一律记 1 个失败
    printf '❌ %-24s 缺少「N passed, M failed」计数行（退出码 %s）\n' "$f" "$code"
    F=$((F + 1))
  else
    p=$(printf '%s\n' "$last" | sed -E 's/^([0-9]+) passed.*/\1/')
    q=$(printf '%s\n' "$last" | sed -E 's/.* ([0-9]+) failed$/\1/')
    P=$((P + p))
    F=$((F + q))
    if [ "$code" -ne 0 ] && [ "$q" -eq 0 ]; then
      printf '❌ %-24s %s，但退出码是 %s\n' "$f" "$last" "$code"
      F=$((F + 1))
    elif [ "$q" -gt 0 ]; then
      printf '❌ %-24s %s\n' "$f" "$last"
    else
      printf '✅ %-24s %s\n' "$f" "$last"
      return
    fi
  fi
  echo "   ── 输出末尾 ──"
  tail -n 25 "$out" | sed 's/^/   /'
}

for f in tests/*.test.mjs tests/sim.mjs; do
  [ -f "$f" ] || continue
  run_one "$f"
done

if [ "$N" -eq 0 ]; then
  echo "❌ tests/ 下没有找到任何测试文件"
  F=$((F + 1))
fi

echo "$P passed, $F failed"
[ "$F" -eq 0 ] || exit 1
