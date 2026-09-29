"""真建筑（T15）：buildings.json 的真轮廓换到页面方格、切掉压在街上的部分、生成地表 / 阴影 / 风影栅格、坏数据时退回程序生成的城市。

用法：python3 apps/web/tests/test_world.py（要 node ≥ 18，不联网）
断言写在 tests/world_real.mjs；这里只负责调 node、转发它的 ✅ / ❌ 行。最后一行「N passed, M failed」。
"""
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
node = shutil.which("node")
if not node:
    print("❌ 没找到 node（真建筑的断言要用 node 跑）")
    print("0 passed, 1 failed")
    sys.exit(1)
try:
    r = subprocess.run([node, str(HERE / "world_real.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=120)
    out, code = r.stdout + r.stderr, r.returncode
except subprocess.TimeoutExpired:
    out, code = "❌ world_real.mjs 超过 120 秒没跑完\n", 1
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
    print(f"❌ world_real.mjs 退出码 {code}")
    print("\n".join(out.splitlines()[-15:]))
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
