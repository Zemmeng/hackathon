#!/usr/bin/env bash
# test.sh —— py-tool 的测试入口（check.sh [5] 会自动发现并调用它）
# 用途：跑 tests/test_tool.py，按统一约定核对计数行；崩溃不许伪装成绿。
# 用法：bash test.sh              （从任意目录都能跑）
# 退出码：0 全部通过；1 有失败，或测试没打印「N passed, M failed」计数行，或退出码非 0
# 最后一行固定输出「N passed, M failed」。
set -uo pipefail
cd "$(dirname "$0")" || { echo "0 passed, 1 failed"; exit 1; }

log=$(mktemp "${TMPDIR:-/tmp}/pytool-test.XXXXXX") || { echo "0 passed, 1 failed"; exit 1; }
trap 'rm -f "$log"' EXIT

# 边跑边打印（tee），同时留一份用来核对最后一行
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 python3 tests/test_tool.py 2>&1 | tee "$log"
code=${PIPESTATUS[0]}

last=$(tail -n 1 "$log")
if ! printf '%s\n' "$last" | grep -Eq '^[0-9]+ passed, [0-9]+ failed$'; then
  echo "❌ tests/test_tool.py 没有打印计数行（多半是崩了，看上面的报错），按失败处理"
  echo "0 passed, 1 failed"
  exit 1
fi
p=$(printf '%s\n' "$last" | sed -E 's/^([0-9]+) passed.*/\1/')
f=$(printf '%s\n' "$last" | sed -E 's/.* ([0-9]+) failed$/\1/')

if [ "$code" -ne 0 ] || [ "$f" -ne 0 ]; then
  [ "$f" -eq 0 ] && f=1   # 计数全绿但退出码非 0：也算失败
  echo "❌ 测试未通过（退出码 ${code}）"
  echo "$p passed, $f failed"
  exit 1
fi
# 全绿：python 打印的计数行就是最后一行，不重复打印
exit 0
