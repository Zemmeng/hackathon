"""2×2 路口微观仿真接进第 2 步（4b-grid.js 的 GridSim）。只做源码静态断言，不跑浏览器。

用法：python3 apps/web/tests/test_grid_wire.py（要 git，不联网）
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent.parent
SRC = ROOT / "src"
JS = {p.name: p.read_text(encoding="utf-8") for p in sorted((SRC / "js").glob("*.js"))}
APP, ENG = JS["5-app.js"], JS["6-engine.js"]
ALL = "\n".join(JS.values())

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}" + (f" —— {detail}" if detail else ""))


def fn_body(src, name):
    m = re.search(r"^function " + re.escape(name) + r"\(.*$", src, re.M)
    return m.group(0) if m else ""


# 1. helpers exist, each defined exactly once across all js files (one classic script: names must be unique)
for name in ["gridOn", "newGrid", "gridShown", "gridFly", "gridRebuild", "gridNote", "drawJunctions"]:
    n = len(re.findall(r"^function " + name + r"\(", ALL, re.M))
    check(f"{name}() 定义且全局只有一处", n == 1, f"找到 {n} 处")

# 2. gridOn guards a missing 4b-grid.js and only fires on step 2 inside GRID_BOX
on = fn_body(APP, "gridOn")
check("gridOn() 先判断 typeof GridSim==='function'", "typeof GridSim==='function'" in on)
check("gridOn() 只在第 2 步、施工段全在 GRID_BOX 里", "S.step===2" in on and "GRID_BOX.x0" in on and "EP.pts.every" in on)

# 3. newGrid falls back to null on any throw
ng = fn_body(APP, "newGrid")
check("newGrid() 有 try/catch，出错返回 null", "try{" in ng and "catch(" in ng and "return null" in ng)

# 4. every newGrid() call sits behind gridOn()
calls = [m.start() for m in re.finditer(r"(?<!function )newGrid\(\)", APP + ENG)]
bad = [i for i in calls if not (APP + ENG)[max(0, i - 10):i].endswith("gridOn()&&")]
check("newGrid() 每次调用前都有 gridOn()&&", len(calls) >= 2 and not bad, f"{len(bad)} 处没守")
g2 = re.search(r"if\(n===2\)\{(.*?)\n\s*else\{(.*?)\}\}", APP, re.S)
check("goStep(2)：gridOn()&&newGrid() 成功才用网格，否则原来的 newStress('before') 原样保留",
      bool(g2) and "gridOn()&&newGrid()" in g2.group(1) and "S.stress=newStress('before');S.sim=S.stress" in g2.group(2) and "flyTo(-8,-4,4.2)" in g2.group(2))
check("goStep(2) 网格分支把 S.stress 置空（第 3 步会自己重建 La Trobe 场景，不碰 GridSim.script）",
      bool(g2) and "S.stress=null" in g2.group(1))

# 5. La Trobe-only drawing skips the grid sim
check("drawRisk / fogRings 遇到 isGrid 直接返回",
      "if(!sim||sim.isGrid)return;" in APP and "if(!sim||sim.isGrid||S.wx!=='fog'" in APP)
check("render 第 2 步网格不画 La Trobe 施工，画网格的施工和信号灯",
      "if(micro&&!grid)drawWorks('before')" in APP and "if(grid&&fine)drawJunctions(S.sim)" in APP)

# 6. plan change in step 2 rebuilds the grid
run = ENG[ENG.find("async function engRun("):]
run = run[:run.find("\n}\n")]
check("engRun 结束时第 2 步调 gridRebuild()", "if(S.step===2)gridRebuild();" in run)

# 7. panel line + things other tests rely on
check("第 2 步面板写明信号配时和转弯比例是假设值", "signal timing and turn shares are assumed" in APP and "信号配时和转弯比例是假设值" in APP)
check("clashMount();aiMount(); 还在", "clashMount();aiMount();" in APP)

# 8. 4-sim.js untouched vs origin/main
r = subprocess.run(["git", "-C", str(REPO), "diff", "--quiet", "origin/main", "--", "apps/web/src/js/4-sim.js"])
check("4-sim.js 和 origin/main 一致", r.returncode == 0, f"git diff 退出码 {r.returncode}")

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
