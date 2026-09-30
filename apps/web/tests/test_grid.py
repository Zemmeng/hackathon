"""2×2 路口微观仿真（src/js/4b-grid.js）：tests/grid_glue.mjs 用真路网、真车流在 node 里跑。

用法：python3 apps/web/tests/test_grid.py（要 node ≥ 18，不联网）
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
JS = {p.name: p.read_text(encoding="utf-8") for p in sorted((ROOT / "src" / "js").glob("*.js"))}
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}{('：' + detail) if detail else ''}")


G = JS.get("4b-grid.js", "")
check("4b-grid.js 有 /* grid:begin */ … /* grid:end */", "/* grid:begin */" in G and "/* grid:end */" in G)
names = re.findall(r"^(?:const|let|class|function) ([A-Za-z_$][\w$]*)", G, re.M)
check("4b-grid.js 的顶层名都带 grid / Grid / GRID 前缀", names and all(n.lower().startswith("grid") for n in names), str(names))
check("反向：4b-grid.js 不碰 DOM", not re.search(r"\b(document|window|canvas)\b", G))

# 真路网 / 真车流（node）
node = shutil.which("node")
if not node:
    check("找到 node（grid_glue.mjs 要用）", False)
else:
    try:
        r = subprocess.run([node, str(HERE / "grid_glue.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=150)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, code = "❌ grid_glue.mjs 超过 150 秒没跑完\n", 1
    n0 = passed + failed
    for line in out.splitlines():
        if line.startswith("✅"):
            passed += 1
            print(line)
        elif line.startswith("❌"):
            failed += 1
            print(line)
    if code != 0 and passed + failed == n0:
        check(f"grid_glue.mjs 退出码 {code}", False, out[-400:])

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
