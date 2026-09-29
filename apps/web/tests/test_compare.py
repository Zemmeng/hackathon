"""T23 方案对比：8-compare.js 的纯函数 + 顾问的改法逐套跑 backend.js + T5 pack.js 执行包。

用法：python3 apps/web/tests/test_compare.py（要 node ≥ 18，不联网）
断言写在 tests/compare_glue.mjs；这里只负责调 node、转发它的 ✅ / ❌ 行。最后一行「N passed, M failed」。
"""
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
node = shutil.which("node")
if not node:
    print("❌ 没找到 node（接线层的断言要用 node 跑）")
    print("0 passed, 1 failed")
    sys.exit(1)
try:
    r = subprocess.run([node, str(HERE / "compare_glue.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=120)
    out, code = r.stdout + r.stderr, r.returncode
except subprocess.TimeoutExpired:
    out, code = "❌ compare_glue.mjs 超过 120 秒没跑完\n", 1
passed = failed = 0
for line in out.splitlines():
    if line.startswith("✅"):
        passed += 1
        print(line)
    elif line.startswith("❌"):
        failed += 1
        print(line)
if code != 0 and failed == 0:
    failed += 1
    print(f"❌ compare_glue.mjs 退出码 {code}")
    print("\n".join(out.splitlines()[-15:]))
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
