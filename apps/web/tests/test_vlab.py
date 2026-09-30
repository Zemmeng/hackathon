"""T42 VMS 试验台：静态断言（挂载、文案成对、没有写死的数字）+ 调 node tests/vlab_glue.mjs 在真路网上跑。

用法：python3 apps/web/tests/test_vlab.py（要 node ≥ 18，不联网）
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / "src"
LAB = (SRC / "js" / "6d-vmslab.js").read_text(encoding="utf-8")
APP = (SRC / "js" / "5-app.js").read_text(encoding="utf-8")
ENG = (SRC / "js" / "6-engine.js").read_text(encoding="utf-8")
CSS = (SRC / "styles.css").read_text(encoding="utf-8")
PAGE, _ = build.bundle()

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}" + (f" —— {detail}" if detail else ""))


check("打包产物带上 6d-vmslab.js", "function vlRun(" in PAGE and "function vlCands(" in PAGE)
check("设备诱导页挂载：5-app.js 拼 vlabHTML()、绑定后 vlMount()", "engStateSec()+vlabHTML()" in APP and "engBind1();vlMount();" in APP)
check("引擎算完刷新标记：6-engine.js engRun() 调 vlAfterRun()", "engRenderOut();vlAfterRun();" in ENG)
check("每个数都来自 BE.api.run()，不在页面里算排队", LAB.count("BE.api.run(") >= 3 and "queue_m" in LAB)
check("屏上文字进 HTML 前过 esc()", "esc(vlText(" in LAB and not re.search(r"\$\{vlText\(", LAB))
lits = [n for n in ("918", "548", "193", "82 m", "836", "725", "1,250") if n in LAB]
check("反向断言：源码里没有写死的演示数字", not lits, str(lits))
pos = [m.start() for m in re.finditer(r"\bL\(", LAB)] + [len(LAB)]
bad = [LAB[a:a + 60] for a, b in zip(pos, pos[1:]) if not re.search(r"[一-鿿]", LAB[a:b])]
check("文案中英成对（每个 L( 到下一个 L( 之间都有中文）", len(pos) > 8 and not bad, str(bad))
check("简洁模式不折叠：外层不是 .stack（7-glass.js 只折叠顶层 .stack）", '<div id="vlab" class="vlab">' in LAB and 'class="stack' not in LAB.split("function vlabHTML")[1][:200])
check("样式：试验台行 / 推荐 / 当前", ".vlab-row{" in CSS and ".vlab-row.best" in CSS and '.vlab-row[aria-current="true"]' in CSS)
check("窄屏：行用 minmax(0,1fr)，长文案折行不撑破面板", "grid-template-columns:minmax(0,1fr) 64px 54px" in CSS and "overflow-wrap:anywhere" in CSS.split(".vlab-row .tx{")[1][:120])

node = shutil.which("node")
if not node:
    check("找到 node", False, "真路网断言要用 node 跑")
else:
    try:
        r = subprocess.run([node, str(HERE / "vlab_glue.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=180)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, code = "❌ vlab_glue.mjs 超过 180 秒没跑完\n", 1
    n_before = failed
    for line in out.splitlines():
        if line.startswith("✅"):
            passed += 1
            print(line)
        elif line.startswith("❌"):
            failed += 1
            print(line)
        elif line.startswith("   "):
            print(line)
    if code != 0 and failed == n_before:
        check(f"vlab_glue.mjs 退出码 {code}", False, "\n".join(out.splitlines()[-15:]))

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
