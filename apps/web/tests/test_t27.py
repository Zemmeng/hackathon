"""T27：地图放下整个 CBD（docs/arch/T26-T27-web-PRD.md 第 3 节）。静态断言 + tests/t27_glue.mjs（真路网、真引擎，node 跑）。

用法：python3 apps/web/tests/test_t27.py（要 node ≥ 18，不联网）
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
ROOT = HERE.parent
SRC = ROOT / "src"
JS = {p.name: p.read_text(encoding="utf-8") for p in sorted((SRC / "js").glob("*.js"))}
APP, ENG, CITYJS, WORLDJS = JS["5-app.js"], JS["6-engine.js"], JS.get("6c-city.js", ""), JS["1-world.js"]
PAGE, _ = build.bundle()

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}{('：' + detail) if detail else ''}")


def fn(src, name):
    i = src.index(f"function {name}(")
    j = src.index("{", i) + 1
    d, k = 1, j
    while d:
        d += {"{": 1, "}": -1}.get(src[k], 0)
        k += 1
    return src[j:k - 1]


# 0 全局名不能重名（6c-city.js 一度和 8-clash.js 都声明了 CL，整页脚本直接报错不跑）
names = re.findall(r"^(?:const|let|class|function) ([A-Za-z_$][\w$]*)", "\n".join(JS.values()), re.M)
dups = sorted({n for n in names if names.count(n) > 1})
check("所有 js 文件的顶层 const / let / function 不重名", not dups, str(dups))

# 1 范围：CITY 只管拖到哪、缩到多小、引擎线画到哪
check("1-world.js 有 CITY = Hoddle Grid + 约 150 m，北边到 Franklin St（x −1150..750、y −950..450），WORLD 不变",
      "const CITY={x0:-1150,x1:750,y0:-950,y1:450};" in WORLDJS and "const WORLD={x0:-320,x1:320,y0:-300,y1:300};" in WORLDJS)
check("反向：天气、微观仿真、正射影像的网格仍按 WORLD 建，不按 CITY",
      "CITY" not in JS["3-weather.js"] and "CITY" not in JS["4-sim.js"] and "CITY" not in JS["2-basemap.js"] and "CITY" not in fn(WORLDJS, "buildWorldReal"))

# 2 全城层：预渲染一次，平铺在精细窗口下面
check("6c-city.js 排在 6-engine.js 后面（build.py 按文件名排序）", sorted(JS).index("6c-city.js") == sorted(JS).index("6-engine.js") + 1)
cc = fn(CITYJS, "cityCanvas")
check("全城层预渲染到离屏画布、按明暗主题缓存", "document.createElement('canvas')" in cc and "CITYL.cv[key]=c" in cc and "(light?'L':'D')" in cc)
check("路网：双向街的两条路段只描一次（按两端节点去重）", "l.from<l.to?l.from+'|'+l.to:l.to+'|'+l.from" in cc and "seen.has(k)" in cc)
bl = cc[cc.index("if(CITYL.bld){"):cc.index("if(net){")]
check("建筑：画平的轮廓，不挤出、不描边", "g.fill('nonzero')" in bl and "stroke" not in bl)
rb = fn(APP, "renderBase")
check("renderBase：先贴全城层，再把精细窗口裁进 WORLD，最后画接缝",
      rb.index("cityDraw(bctx,V)") < rb.index("bctx.clip()") < rb.index("drawVector(") and "citySeam(bctx,V,TK.light)" in rb and "cityKey()" in rb)
check("全城层拿到的是完整的建筑表（loadBuildings → cityData）", "cityData(d);" in fn(APP, "loadBuildings"))

# 3 放开视图
check("缩放下限 = 刚好装下 CITY（cityMinS），平移夹到 CITY", "V.s=clamp(s,cityMinS(),14)" in APP and "CITY.x0+hw-I.l/V.s" in APP
      and "s=clamp(s,cityMinS(),14);cx+=" in APP and "function zoomAt(px,py,s){const wx=V.wx(px),wy=V.wy(py);s=clamp(s,cityMinS(),14);" in APP)
check("反向：视图里不再有写死的缩放下限 1.1", not re.search(r"clamp\(s,1\.1,14\)", APP))
rd = fn(APP, "render")
check("缩放 < 1：天气、微观仿真的小人和事件、经纬网都不画",
      "fine=V.s>=1" in rd and "wx=S.layers.weather&&fine" in rd and "walkers=micro&&fine" in rd and "S.layers.grid&&fine" in rd
      and not re.search(r"if\(S\.layers\.weather\)WX\.", rd))
check("缩放 < 1：经纬度探针隐藏", "hide=V.s<1" in APP)
check("反向：缩放 < 1 时点地图不挪施工区", "if(S.step!==1||!BE.api||V.s<1)return;" in ENG)

# 4 引擎线画全
check("引擎叠加层用 CITY：可点的路段、取景、标签剔除、可见范围", all(x in ENG for x in [
    "p[0]<CITY.x0||p[0]>CITY.x1", "clamp(p[0],CITY.x0,CITY.x1)", "if(c[0]<CITY.x0||c[0]>CITY.x1", "Math.max(CITY.x0,V.wx(24))"]))
check("反向：6-engine.js 里不再用 WORLD", "WORLD" not in ENG)
fit = fn(ENG, "engFit")
check("取景缩放下限跟着放开（cityMinS），画出来的绕行（≥ 1%）都框进来", "cityMinS(),3.6" in fit and ">=.01" in fit)

# 5 排队线沿真路
check("排队线沿施工街往上游找同名路段、按 len_m 累加（upstreamPath），画到街没了为止",
      "function upstreamPath(" in ENG and "u.name===link.name" in ENG and "+U.len_m" in ENG and "engSub(Math.min(s.queue_m,engReach())).reverse()" in ENG)
check("标签照写引擎的数，再说明画到哪（画到 Spring St 为止）", "engQueueTxt(s,vis)" in ENG and "画到 ${end} 为止" in ENG and "drawn to ${end" in ENG)
check("反向：不再沿施工路段方向直线外推（旧 engUp 把米当页面单位）", "return[a[0]-(b[0]-a[0])/l*m,a[1]-(b[1]-a[1])/l*m];" not in ENG)

# 6 比例尺
ds = fn(APP, "drawScale")
check("比例尺按 1 m ≈ 0.862 页面单位（K_UPM）", "K_UPM" in ds and "const K_UPM=0.862;" in ENG)

# 7 变慢路段按 extra_min（T28）
check("变慢路段用 extra_min 筛（rippleLinks），不再按 v·delay_s", "rippleLinks(s.raw.links,EP.link)" in ENG and "(l.v||0)*(l.delay_s||0)/60" not in ENG)
rl = fn(ENG, "rippleLinks")
check("反向：筛选和红色判断都只看 extra_min，不看 queue_m（Flinders / King St 平时就排队，PRD 3.2 第 7 条 #82）",
      "queue_m" not in rl and "sev:ex>=60?2:ex>=10?1:0" in rl)
check("反向：地图上最堵路段的标签也按 extra_min 标红（和底下的线同色），不按 queue_m",
      "h.extra_min>=60?TK.risk:TK.works" in ENG and "h.queue_m>0?TK.risk" not in ENG)
dt = fn(APP, "drawTag")
check("标签避让（375 px 施工标签曾压在缩放按钮下、出屏）：engLabels 期间 drawTag 走 tagSpot，避开玻璃控件、施工段和已画的标签；先画全部引线再画框",
      "TAGS.on?tagSpot(px,py,dx,dy,w,h)" in dt and "TAGS.boxes=[[wx0,wy0," in fn(ENG, "engLabels") and fn(ENG, "engLabels").rstrip().endswith("tagFlush();") and "if(TAGS.on)TAGS.q.push(t)" in dt
      and all(x in fn(APP, "tagObst") for x in ["#wx", "#basemap", ".zoom", "#legend", "#rail"]))

# 8 AI 面板的挂钩（PRD 4.3）
check("第 3 步 AI 面板挂钩还在", "clashMount();aiMount();" in APP and "aiPlanSrc(s,f)" in ENG)

# 9 真路网 / 真引擎（node）
node = shutil.which("node")
if not node:
    check("找到 node（t27_glue.mjs 要用）", False)
else:
    try:
        r = subprocess.run([node, str(HERE / "t27_glue.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=150)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, code = "❌ t27_glue.mjs 超过 150 秒没跑完\n", 1
    n0 = passed + failed
    for line in out.splitlines():
        if line.startswith("✅"):
            passed += 1
            print(line)
        elif line.startswith("❌"):
            failed += 1
            print(line)
    if code != 0 and passed + failed == n0:
        check(f"t27_glue.mjs 退出码 {code}", False, out[-400:])

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
