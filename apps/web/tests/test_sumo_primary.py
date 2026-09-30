"""T49（lead：屏上交通数字全用 SUMO，引擎退幕后）：Lonsdale 封 1 条道这份方案上，03 / 04 顾问 / 05 导出 / 01 检查 / 地图
不出引擎的交通数字（排队米数、每车秒数、车·分钟、人·分钟、全网延误、各类人分钟数、电车公交 / 行人分钟数、叠加冲突），
只出 SUMO 的数和 AI 读牌（看到 / 看懂 / 相信、绕行比例 = SUMO 的输入）。静态接线 + tests/sumo3_glue.mjs（node 渲染）。

用法：python3 apps/web/tests/test_sumo_primary.py（要 node ≥ 18，不联网）
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "src"
JS = {p.name: p.read_text(encoding="utf-8") for p in sorted((SRC / "js").glob("*.js"))}
ENG, S3, AI = JS["6-engine.js"], JS.get("6e-sumo3.js", ""), JS["9-ai.js"]
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


def first_stmt(src, name):
    return fn(src, name).strip().split("\n")[0]


# 1 新文件：排在 6-engine.js 之后、7-glass.js 之前（build.py 按文件名拼）；判断和 sumoWant / suPlan 一样
order = sorted(JS)
check("6e-sumo3.js 存在，拼在 6-engine.js 之后、7-glass.js 之前", "6e-sumo3.js" in JS and order.index("6-engine.js") < order.index("6e-sumo3.js") < order.index("7-glass.js"))
check("sumoPlanOn = Lonsdale 那段、封 1 条道（和 sumoWant / sumoImpactHTML 同一个判断）",
      "function sumoPlanOn(){return typeof SUMO_LINK==='string'&&!!EP.link&&EP.link===SUMO_LINK&&!EP.all&&EP.lanes===1;}" in S3)

# 2 6-engine.js 里的钩子：每处一行，SUMO 方案先走 6e-sumo3.js
check("03：engPanel3 第一句就分到 SUMO（三个页签都是：交通 / 依据 / 附近施工），页签行 engTabs3 留着",
      first_stmt(ENG, "engPanel3").startswith("if(typeof sumoPanel3==='function'&&sumoPlanOn())return sumo3Top()+(EP.view3==='evidence'?sumo3Evidence():EP.view3==='clash'?sumo3Clash():sumoPanel3())+navHTML();")
      and "${engTabs3()}" in fn(S3, "sumo3Top"))
check("04 顾问：eng4HTML 在「文字不合规」之后分到 sumo3Eng4", "if(typeof sumo3Eng4==='function'&&sumoPlanOn())return sumo3Eng4();" in fn(ENG, "eng4HTML")
      and fn(ENG, "eng4HTML").index("if(EP.badText)") < fn(ENG, "eng4HTML").index("sumo3Eng4()"))
check("05 导出：engPlaybook 第一句分到 sumo3Playbook", first_stmt(ENG, "engPlaybook").startswith("if(typeof sumo3Playbook==='function'&&sumoPlanOn())return sumo3Playbook();"))
check("01 检查：engMoreHTML 第一句分到 sumo3More", first_stmt(ENG, "engMoreHTML").startswith("if(typeof sumo3More==='function'&&sumoPlanOn())return sumo3More();"))
check("地图：engSumFor 在 SUMO 方案上给 null → engDraw / engLabels / engFit 不画引擎的排队、涟漪、绕行、电车行人和它们的标签（每一步都是）",
      "if(EP.badText||EP.runErr||(typeof sumoPlanOn==='function'&&sumoPlanOn()))return null;return which==='before'" in fn(ENG, "engSumFor")
      and "const s=engSumFor(which)" in fn(ENG, "engDraw") and "const s=engSumFor('now')" in fn(ENG, "engLabels") and "const s=engSumFor('now')" in fn(ENG, "engFit"))
check("反向：engDraw 的引擎排队 / 涟漪 / 绕行、电车行人都挂在 s 上（s 为 null 就不画）；施工段和设备方块不挂",
      "if(s&&S.step!==2){\n    const faint" in fn(ENG, "engDraw") and "if(s&&S.step!==2){engTransitDraw(s,S.step===1);engPedDraw(s,S.step===1);}" in fn(ENG, "engDraw")
      and "ctx.strokeStyle=TK.works;ctx.lineWidth=9*k;engLine(EP.pts,off);" in fn(ENG, "engDraw") and "if(S.step<=2){\n    const vm=[]" in fn(ENG, "engDraw"))
check("反向：engLabels 的「QUEUE 918 m · drawn to Spring St」和「+N veh·min」标签都挂在 s 上", "if(s&&s.queue_m>0){const q=engUp" in fn(ENG, "engLabels") and "if(S.step===3&&s){" in fn(ENG, "engLabels"))
check("地图：SUMO 的整点排队画在施工段下面、标「SUMO queue at 09:00 · X m」、取景带上它（只在 03 路网 · 交通）",
      "if(!s&&typeof sumo3QueueDraw==='function')sumo3QueueDraw(which,k,off);" in fn(ENG, "engDraw")
      and fn(ENG, "engDraw").index("sumo3QueueDraw(") < fn(ENG, "engDraw").index("ctx.strokeStyle=TK.works;ctx.lineWidth=9*k")
      and "if(!s&&typeof sumo3QueueTag==='function')sumo3QueueTag(vis);" in fn(ENG, "engLabels") and fn(ENG, "engLabels").rstrip().endswith("tagFlush();")
      and "if(typeof sumo3Fit==='function')sumo3Fit().forEach(add);" in fn(ENG, "engFit")
      and "S.step!==3||EP.tab3!=='net'||EP.view3!=='traffic'" in fn(S3, "sumo3QueueM") and "c.m.works_queue_end_m" in fn(S3, "sumo3QueueM")
      and "SUMO queue at ${c.end} · " in fn(S3, "sumo3QueueTag") and "engSub(Math.min(m,engReach()))" in fn(S3, "sumo3QueueDraw"))
check("AI 路人面板：SUMO 方案上说「绕行比例是 SUMO 的输入 · 交通数字由 SUMO 算」，别的方案照旧「数字都由引擎算」",
      "typeof sumoPlanOn==='function'&&sumoPlanOn()?'the share who detour is SUMO’s input · SUMO computes the traffic numbers':'the engine computes every number'" in AI
      and "绕行比例是 SUMO 的输入 · 交通数字由 SUMO 算':'数字都由引擎算'" in AI)

# 3 6e-sumo3.js 自己不碰引擎的结果字段（只读 SU、EP.sum 的 detour_share / 读牌、EP.cmp 的 detour_share）
code = re.sub(r"//[^\n]*|/\*[\s\S]*?\*/", "", S3)
bad = re.findall(r"\.queue_m\b|\bmean_delay_s\b|\bdelay_min\b|\bextra_min\b|\bpax_min\b|\bper_capita_min\b|\.hot\b|\bdelta_min\b|\bcost\b|\.why\b|\bped_h\b|\bdetour_m\b|\.transit\b|\.peds\b|engMetrics|engWhy|engImpacts|engHeadline|engQueueTxt", code)
check("反向：6e-sumo3.js 不读引擎的排队 / 延误 / 车·分钟 / 人·分钟 / 叠加 / 顾问理由等字段", not bad, str(sorted(set(bad))))
check("反向：6e-sumo3.js 不写 innerHTML（只返回字符串，由 6-engine.js 原来的地方写进页面）", "innerHTML" not in code)
check("03 交通：没跑 SUMO → 卡片 + 按钮 goStep(2)（委托点击，不用每次绑定）",
      "Run SUMO in step 2 first" in fn(S3, "sumoPanel3") and 'data-sumo3-go="2"' in fn(S3, "sumoPanel3") and "closest('[data-sumo3-go]')" in S3 and "goStep(2)" in S3)
check("03 交通：被拦住的车数——有 works_held_end 用它，否则 works_queue_equiv_end_vehicles 求和，否则 round(equiv_end_m × 2 / 7)，注释写明",
      "works_held_end" in fn(S3, "sumo3Held") and "works_queue_equiv_end_vehicles" in fn(S3, "sumo3Held") and "*2/7" in fn(S3, "sumo3Held") and "N = round(m × 2 / 7)" in S3)
check("03 交通：四块 = 通过施工段 veh/h、过施工段每车多花、绕行车、最长排队；电车 / 公交 / 行人一句「SUMO 暂不覆盖」",
      all(x in fn(S3, "sumoPanel3") for x in ["works_throughput_vph", "s3ex(m)", "m.detour_vehicles", "m.works_queue_max_m", "sumo3NotCovered()"]) and "not covered by SUMO" in S3 and "SUMO 暂不覆盖" in S3)
check("来源：现场 = 秒数 + seed；预先跑好 = seed + 原因（sumoReason）", "Cloud SUMO · computed live" in fn(S3, "sumo3Pill") and "SUMO · pre-computed" in fn(S3, "sumo3Pill") and "sumoReason(src.reason)" in fn(S3, "sumo3Pill"))
check("注入：SUMO 情景名、原因、假设文字都过 esc()", "esc(sumo3Name(idx,id))" in S3 and "esc(why)" in fn(S3, "sumo3Pill") and "esc(t)" in fn(S3, "sumo3Evidence"))
check("反向：04 顾问的 SUMO 版不放 data-optwhy（顾问理由里有引擎的分钟 / 车·分钟），data-opt / #applyBtn 照旧给 engRender4 绑",
      "data-optwhy" not in code and 'data-opt="${i}"' in fn(S3, "sumo3Eng4") and 'id="applyBtn"' in fn(S3, "sumo3Eng4") and "computed by SUMO" in fn(S3, "sumo3Eng4"))

# 4 打包后的整页脚本语法对（一行函数里塞 // 注释会把后半截注释掉，别的测试都查不出来）
check("public/index.html 是最新打包（python3 apps/web/build.py）", (ROOT / "public" / "index.html").read_text(encoding="utf-8") == PAGE)
node = shutil.which("node")
if not node:
    check("找到 node", False, "PATH 里没有 node")
else:
    m = re.search(r"<script>\n([\s\S]*?)</script>\n</body>", PAGE)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(m.group(1) if m else "")
        tmp = f.name
    r = subprocess.run([node, "--check", tmp], capture_output=True, text=True, timeout=60)
    pathlib.Path(tmp).unlink(missing_ok=True)
    check("整页 <script> 过 node --check（语法）", bool(m) and r.returncode == 0, (r.stderr or "")[-300:])
    r = subprocess.run([node, str(HERE / "sumo3_glue.mjs")], capture_output=True, text=True, timeout=120)
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if line.startswith("✅") or line.startswith("❌"):
            check("node · " + line[2:], line.startswith("✅"))
    if r.returncode != 0 and "❌" not in out:
        check(f"sumo3_glue.mjs 退出码 {r.returncode}", False, out[-400:])

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
