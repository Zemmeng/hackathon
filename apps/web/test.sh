#!/usr/bin/env bash
# 用途：跑 apps/web 的全部测试（tests/test_*.py），逐个执行并汇总
# 用法：bash apps/web/test.sh（任意目录都能跑）；前置条件：python ≥ 3.9，不需要装依赖
# 退出码：0 全部通过；1 有失败（断言失败 / 崩溃 / 缺计数行 / 没找到测试都算）
# 最后一行固定是「N passed, M failed」，scripts/check.sh 靠它汇总
cd "$(dirname "$0")" || exit 1

PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then echo "❌ 没找到 python3"; echo "0 passed, 1 failed"; exit 1; fi

P=0; F=0; N=0
for f in tests/test_*.py; do
  [ -f "$f" ] || continue
  N=$((N + 1))
  out=$(PYTHONIOENCODING=utf-8 "$PY" "$f" 2>&1); code=$?
  last=$(printf '%s\n' "$out" | tail -n 1 | tr -d '\r')
  if ! printf '%s\n' "$last" | grep -Eq '^[0-9]+ passed, [0-9]+ failed$'; then
    echo "❌ $f 缺少「N passed, M failed」计数行（退出码 ${code}）"; F=$((F + 1)); printf '%s\n' "$out" | tail -n 20 | sed 's/^/   /'
    continue
  fi
  p=${last%% passed*}; q=${last##*, }; q=${q%% failed}
  P=$((P + p)); F=$((F + q))
  if [ "$code" -ne 0 ] && [ "$q" -eq 0 ]; then echo "❌ $f ${last}，但退出码是 $code"; F=$((F + 1))
  elif [ "$q" -gt 0 ]; then echo "❌ $f $last"; printf '%s\n' "$out" | grep '^❌' | sed 's/^/   /'
  else echo "✅ $f $last"; fi
done

[ "$N" -eq 0 ] && { echo "❌ tests/ 下没有找到任何测试文件"; F=$((F + 1)); }
echo "$P passed, $F failed"
[ "$F" -eq 0 ] || exit 1
