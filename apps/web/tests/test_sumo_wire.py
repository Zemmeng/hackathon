"""第 2 步接真实路网 SUMO 回放（T40：4c-sumo.js 的 SumoReplay + 5-app.js 的接线）。

tests/sumo_glue.mjs 在 node 里用内存里造的 v2 回放（Lonsdale 西行几辆车 + 公交 + 两个信号头 + 两块）跑 SumoReplay；
apps/sumo/public/real/ 在的话也验它。这里再加源码静态断言：只经同源 sumo-client.js、失败留在 GridSim、预跑绝不标实时。
用法：python3 apps/web/tests/test_sumo_wire.py（要 node ≥ 18，不联网）
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
APP, SU = JS["5-app.js"], JS.get("4c-sumo.js", "")
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
    m = re.search(r"^(?:async )?function " + re.escape(name) + r"\(.*?(?=^(?:async )?function |^const |^/\*|\Z)", src, re.M | re.S)
    return m.group(0) if m else ""


# 1. 4c-sumo.js：纯逻辑、名字带 sumo 前缀、排在 4b-grid.js 之后（用 GRID_K）、5-app.js 之前
check("4c-sumo.js 有 /* sumo:begin */ … /* sumo:end */", "/* sumo:begin */" in SU and "/* sumo:end */" in SU)
names = re.findall(r"^(?:const|let|class|function) ([A-Za-z_$][\w$]*)", SU, re.M)
check("4c-sumo.js 的顶层名都带 sumo / Sumo / SUMO 前缀", names and all(n.lower().startswith("sumo") for n in names), str(names))
check("反向：4c-sumo.js 不碰 DOM、不自己取数据", not re.search(r"\b(document|window|canvas|fetch|import)\b", SU))
order = list(JS)
check("打包顺序 4b-grid.js → 4c-sumo.js → 5-app.js", order.index("4b-grid.js") < order.index("4c-sumo.js") < order.index("5-app.js"))
check("SumoReplay 的形状和 GridSim 一样（isGrid、all / agents、signalHeads、works、stats、minute、resetStats、setWeather）",
      all(k in SU for k in ["this.isGrid=true", "this.isSumo=true", "this.agents=all", "signalHeads(){", "works(){", "resetStats(){", "setWeather(){", "this.minute=new Float32Array(60)", "this.critical=null"]))

# 2. 接线：只经同源 sumo-client.js；只在 gridOn() 且是 Lonsdale 演示路段时换；失败留在 GridSim
check("页面只用字面量 import('/sumo/public/js/sumo-client.js') 连 SUMO", APP.count("import('/sumo/public/js/sumo-client.js')") == 1)
want = fn(APP, "sumoWant")
check("sumoWant()：gridOn() && EP.link===SUMO_LINK，封 1 条道", "gridOn()" in want and "EP.link===SUMO_LINK" in want and "EP.lanes===1" in want and "typeof SumoReplay==='function'" in want)
g2 = re.search(r"if\(n===2\)\{(.*?)\n", APP)
check("goStep(2)：先起 GridSim（立刻有车），再 sumoStart()", bool(g2) and g2.group(1).index("gridOn()&&newGrid()") < g2.group(1).index("sumoStart()"))
start = fn(APP, "sumoStart")
check("sumoStart() 客户端载不进来只打一行 console.info、SU.failed 退回 GridSim", "console.info('SUMO client unavailable, keeping the browser grid sim:'" in start and "SU.failed=true" in start)
check("T42：sumoStart() 不先放预跑——同一种子 + 方案 10 分钟内现场算过就播那次，否则 sumoRerun()（转圈）", "if(!sumoStale())" in start and "return sumoRerun();" in start and "loadReal" not in start)
play = fn(APP, "sumoPlay")
check("sumoPlay()：第一块到了才换 S.sim，换前再确认还在第 2 步 / 还要 SUMO / 没被新请求顶掉",
      "R.addChunk(k,await c.realChunk(ref,scen,ch[k]))" in play and "if(!gridShown()||!sumoWant())return;" in play and "if(tok!==SU.tok)return;}while(" in play
      and play.index("R.addChunk(k,") < play.index("S.sim=R"))
check("换方案（chips）停在同一时刻：先载到含当前时刻的块再换，R.seek(keepT)", "const keepT=S.sim&&S.sim.isSumo?S.sim.t:0" in play and "+ch[k].start<=keepT" in play and "if(keepT)R.seek(keepT);" in play)
check("sumoPlay()：施工多边形和路口用正在跑的 GridSim 的（同一路段）", "polys:base.works().polys" in play and "spec:base.spec" in play)
check("gridRebuild()：SUMO 回放在放且还该放就不重建；新网格后再试 SUMO", "if(S.sim&&S.sim.isSumo&&sumoWant())return;" in APP and re.search(r"renderPanel\(\);sumoStart\(\);\}", APP))

# 3. 来源标签：只有客户端说 live 的那次运行才写实时；预跑写「预先跑好」+ 原因
pill = fn(APP, "sumoPill")
check("来源标签读屏上回放自己的 src，live 要 source==='live' 且有用时", "S.sim.src" in pill and "s.source==='live'&&isFinite(s.elapsedMs)" in pill)
check("预跑标签写 SUMO · pre-computed / 预先跑好，带原因", "SUMO · pre-computed" in pill and "SUMO · 预先跑好" in pill and "sumoReason(s.reason)" in pill)
rr = fn(APP, "sumoRerun")
check("运行：runReal({seed（面板上设的）, p_original:.14, p_ai})，只有 source==='live' 且有 runId 才记成 live",
      "const tok=++SU.tok,seed=SU.seed" in rr and "runReal({seed,p_original:.14,p_ai:sumoPAi()}" in rr and "r.source==='live'&&r.runId" in rr)
check("T42：云端没算成才换预跑（sumoBaked 带原因），预跑也没有就 SU.failed 退回 GridSim", "await sumoBaked(r&&r.reason)" in rr and "await sumoBaked('not_found')" in rr and "SU.failed=true" in rr)
check("p_ai：引擎顾问对比的绕行比例，没有就 0.53", "return isFinite(p)&&p>=0&&p<=1?" in APP and ":.53;}" in APP)
check("第 2 步面板 SUMO 模式：说明、两个方案按钮、重跑按钮、四个指标",
      "real CBD network (OSM) + SCATS" in APP and "Original plan · ROADWORK AHEAD" in APP and "AI plan · USE RUSSELL" in APP
      and "▶ Run SUMO (~15 s)" in APP and all(k in APP for k in ["Vehicles on map", "Works queue now", "Extra time per vehicle", "Detoured vehicles"]))
check("中文也有", all(k in APP for k in ["真实 CBD 路网（OSM）", "原方案 · ROADWORK AHEAD", "AI 方案 · USE RUSSELL", "运行 SUMO（约 15 s）", "地图上的车"]))
check("不在 SUMO 模式时第 2 步原来的四个 GridSim 指标还在", "${su?sumoTiles():wait?'':`" in APP and "L('Road users','道路使用者')" in APP and "TTC &lt; 1.5 s" in APP)
# T46（lead 拍板）：SUMO 回放也标急刹、时间轴也画 100% 堆叠柱；冲突 / 严重没法算，写 —，绝不写 0
tiles, lg, hs, dh = fn(APP, "sumoTiles"), fn(APP, "sumoEvLegend"), fn(APP, "histShare"), fn(APP, "drawHist")
check("T46：SUMO 模式的指标多两格——急刹（data-live=\"harsh\"，阈值取 GRID_P.harsh）、冲突 · 严重写 —「SUMO: not computed / SUMO 不算冲突」",
      'data-live="harsh"' in tiles and "-GRID_P.harsh/GRID_K" in tiles and "SUMO: not computed" in tiles and "SUMO 不算冲突" in tiles
      and "L('Conflicts · critical','冲突 · 严重')" in tiles)
check("T46 反向：SUMO 指标里没有 conf / crit 的实时格子（不会被写成 0）；页面把 stats 里的 null 写成 —",
      'data-live="conf"' not in tiles and 'data-live="crit"' not in tiles
      and "set('conf',sim.stats.conflicts==null?'—':sim.stats.conflicts);set('crit',sim.stats.critical==null?'—':sim.stats.critical);" in APP
      and "conflicts:null,critical:null" in SU)
check("T46：SUMO 模式面板有图例（急刹菱形；冲突 / 严重 —、SUMO 不算冲突；时间轴按回放的柱宽）",
      "${su?sumoEvLegend():''}" in APP and 'class="eng-legend ev-legend"' in lg and "SUMO: not computed" in lg and "SUMO 不算冲突" in lg
      and "per ${n} min" in lg and "每 ${n} 分钟" in lg)
check("T46：时间轴 histShare 按 sim.bins {m0, n} 分柱（4×4 没有 bins 时仍是每 10 分钟），柱子摆在它那几分钟的钟点上；SUMO 回放不再走每分钟急刹那条路",
      "const B=sim.bins||{m0:0,n:10}" in hs and "x=m0*mw+(W-bw)/2" in hs and "this.bins={m0:Math.floor(this.clock0/60),n:2}" in SU
      and "this.mSeen=new Float32Array(60);this.mHit=new Float32Array(60);" in SU and "sumo?Math.max(2,top1*.67)" not in dh and "per_minute" not in SU)
add, stp, sk = re.search(r"addChunk\(k,data\)\{.*?\n  \}", SU, re.S), re.search(r"\n  step\(dt\)\{.*?\n  \}", SU, re.S), re.search(r"\n  seek\(t\)\{[^\n]*", SU)
check("T46：急刹只在 addChunk 时扫一遍新到的样本（_harsh），step() / seek() 不扫，只挪指针（_stats）",
      bool(add and stp and sk) and "this._harsh(this.nLoaded);this._stats();" in add.group(0) and "_harsh" not in stp.group(0) and "_harsh" not in sk.group(0)
      and "this._stats();" in stp.group(0) and "gridIn(V,px,py)" in SU and "a<P.harsh" in SU)
check("时钟跟回放走（clock0_s + t），时间轴点击跳过去，时段用回放的 hour",
      "if(S.sim&&S.sim.isSumo)S.clock=S.sim.clock();" in APP and "S.sim.seek(S.clock-S.sim.clock0)" in APP and "S.sim.isSumo?S.sim.hour:" in APP)

# 4. node：SumoReplay 行为（内存回放 + 有的话验预跑目录）
node = shutil.which("node")
if not node:
    check("找到 node（sumo_glue.mjs 要用）", False)
else:
    try:
        r = subprocess.run([node, str(HERE / "sumo_glue.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=150)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, code = "❌ sumo_glue.mjs 超过 150 秒没跑完\n", 1
    n0 = passed + failed
    for line in out.splitlines():
        if line.startswith("✅"):
            passed += 1
            print(line)
        elif line.startswith("❌"):
            failed += 1
            print(line)
        elif line.startswith("   "):
            print(line)
    if code != 0 and passed + failed == n0:
        check(f"sumo_glue.mjs 退出码 {code}", False, out[-400:])

check("T42：同一种子 + 同一 AI 绕行比例 10 分钟内算过就不重算；现场算成功才记 liveKey / liveAt",
      "const sumoKey=()=>`${SU.seed}|${sumoPAi()}`;" in APP and "SU.liveKey===sumoKey()&&performance.now()-SU.liveAt<600000" in APP and "SU.liveKey=sumoKey();SU.liveAt=performance.now();" in fn(APP, "sumoRerun"))
check("T42：等待时不画浏览器 GridSim 的车和信号灯，地图中间转圈，面板转圈 + 种子",
      "if(walkers&&!wait){drawAgents(S.sim);drawEvents(S.sim);}if(grid)drawJunctions(S.sim,wait);if(wait)drawSumoWait();" in APP
      and "if(!noHeads)for(const h of sim.signalHeads())" in APP and "function sumoWaiting(){return gridShown()&&!!S.sim&&!S.sim.isSumo&&sumoWant()&&!SU.failed;}" in APP
      and "${su?sumoNote()+sumoCtl():wait?sumoWaitHTML():" in APP and 'class="spin"' in APP)
check("T42：种子输入框（0–2147483647）、随机按钮、运行按钮；标签带 seed", 'id="sumoSeed"' in APP and 'id="sumoDice"' in APP and 'max="2147483647"' in APP and "seed ${s.seed}" in APP)
check("T42：文字不叫「回放」，也不再先放预跑", "SUMO 回放" not in APP and "SUMO replay ·" not in APP and "先显示预先跑好的" not in APP and "Cloud SUMO · computed live" in APP)
ENG = (ROOT / "src" / "js" / "6-engine.js").read_text(encoding="utf-8")
imp = fn(APP, "sumoImpactHTML")
check("T47：第 3 步在引擎数字上面放第 2 步 SUMO 这一次的结果（来源 + seed），引擎的数标「引擎估算 · 整个 CBD、1 小时」",
      "${typeof sumoImpactHTML==='function'?sumoImpactHTML():''}" in ENG and "Engine estimate · whole CBD, 1 hour" in ENG and "引擎估算 · 整个 CBD、1 小时" in ENG
      and "SU.index" in imp and "src.source==='live'&&isFinite(src.elapsedMs)" in imp and "seed ${sd}" in imp)
check("T47：SUMO 表是原方案 / AI 方案两行：排队最长 / 平均、过施工段每车多花、绕行车；没跑过 SUMO 时提示去第 2 步", "row('original'" in imp and "row('ai'" in imp
      and "works_queue_max_m" in imp and "works_traffic_extra_s" in imp and "detour_vehicles" in imp and "Run SUMO in step 2" in imp)
check("T47：写明两个模型为什么差很多，不说是实证", "not measured proof" in imp and "不是实测证据" in imp)
check("T47：跑之前设种子——第 1 步「保存并进入仿真」上面有种子框和随机按钮，进第 2 步就用 SU.seed 算",
      "${typeof sumoPreHTML==='function'?sumoPreHTML():''}${navHTML()}" in APP and "engBind1();vlMount();sumoPreBind();" in APP
      and 'id="sumoSeedPre"' in APP and 'id="sumoDicePre"' in APP and "const tok=++SU.tok,seed=SU.seed" in APP)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
