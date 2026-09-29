#!/usr/bin/env bash
# 用途：校验 apps/params/public/params.json
#   - 每个叶子参数有 source + confidence（confidence ∈ high/medium/low/none）
#   - 比例类 value ∈ [0,1]；区间 range 两端也在 [0,1] 且 value 在区间内（value 非 null 时）
#   - mix 四类之和 = 1（±1e-6）
#   - 键名全 ASCII（D-05）
#   - 最后一行固定「N passed, M failed」
# 用法：bash test.sh
# 退出码：0 全绿；1 有失败
set -u
cd "$(dirname "$0")" || exit 1

JSON="public/params.json"
P=0
F=0

pass() { P=$((P + 1)); echo "  ✅ $1"; }
fail() { F=$((F + 1)); echo "  ❌ $1"; }

if [ ! -f "$JSON" ]; then
  echo "缺少 $JSON"
  echo "0 passed, 1 failed"
  exit 1
fi

python3 - "$JSON" <<'PY'
import json, sys, re

path = sys.argv[1]
ok = 0
bad = 0

def check(cond, msg):
    global ok, bad
    if cond:
        ok += 1
        print("  ✅", msg)
    else:
        bad += 1
        print("  ❌", msg)

try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print("  ❌ JSON 解析失败:", e)
    print("0 passed, 1 failed")
    sys.exit(1)

check(isinstance(data.get("version"), int) and data.get("version") >= 1, "version 是正整数")

ASCII_RE = re.compile(r"^[\x20-\x7e]+$")

def walk(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not ASCII_RE.match(k):
                yield ("key", prefix + k, None)
            yield from walk(v, prefix + k + ".")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, prefix + f"[{i}].")
    else:
        yield ("leaf", prefix.rstrip("."), obj)

# 1) 键名 ASCII
bad_keys = [p for t, p, _ in walk(data) if t == "key"]
check(not bad_keys, "键名全 ASCII" + (f" 违规: {bad_keys}" if bad_keys else ""))

# 2) 参数叶子：凡是形如 {value, source, confidence, ...} 的对象
def is_param(d):
    return isinstance(d, dict) and "value" in d and ("confidence" in d or "source" in d)

params = []

def collect(obj, path=""):
    if isinstance(obj, dict):
        if is_param(obj):
            params.append((path, obj))
        for k, v in obj.items():
            collect(v, path + "/" + k if path else k)

collect(data)
check(len(params) >= 8, f"参数对象不少于 8 个（实得 {len(params)}）")

UNIT_SHARE = {"share", "ratio"}
CONF_OK = {"high", "medium", "low", "none"}

for path, p in params:
    conf = p.get("confidence")
    src = p.get("source")
    val = p.get("value")
    rng = p.get("range")
    unit = p.get("unit")

    check(conf in CONF_OK, f"{path}.confidence ∈ high/medium/low/none (got {conf!r})")

    if conf == "none":
        check(val is None, f"{path}.value 为 null（confidence=none 不得编数）")
    else:
        check(src not in (None, ""), f"{path}.source 非空")

    if unit in UNIT_SHARE and val is not None:
        check(isinstance(val, (int, float)) and 0.0 <= float(val) <= 1.0,
              f"{path}.value 在 0–1 (got {val})")
        if rng is not None:
            check(isinstance(rng, list) and len(rng) == 2, f"{path}.range 是 [lo,hi]")
            if isinstance(rng, list) and len(rng) == 2:
                lo, hi = rng
                check(0.0 <= float(lo) <= float(hi) <= 1.0, f"{path}.range 在 0–1 且 lo≤hi (got {rng})")
                check(float(lo) <= float(val) <= float(hi), f"{path}.value 落在 range 内")

# 3) mix 四类加总
mix = data.get("mix") or {}
need = ["commuter", "local", "tourist", "delivery"]
check(all(k in mix for k in need), f"mix 含 {need}")
if all(k in mix for k in need):
    s = 0.0
    for k in need:
        v = mix[k].get("value")
        check(isinstance(v, (int, float)), f"mix.{k}.value 是数字")
        if isinstance(v, (int, float)):
            s += float(v)
    check(abs(s - 1.0) <= 1e-6, f"mix 四类之和 = 1（实际 {s:.6f}）")

# 4) 两个 anchor 的 high 置信必须有可点击出处（http 或作者年份）
for k in ("named_route_divert", "stated_to_actual"):
    a = (data.get("anchors") or {}).get(k) or {}
    src = a.get("source") or ""
    check(a.get("confidence") == "high", f"anchors.{k}.confidence = high")
    check("http" in src or re.search(r"\d{4}", src), f"anchors.{k}.source 含链接或年份")

print(f"{ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
PY
