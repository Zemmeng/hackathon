"""T26 的静态断言：T20 收尾（docs/arch/T26-T27-web-PRD.md 第 2 节）。

用法：python3 apps/web/tests/test_t26.py
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
APP = (SRC / "js" / "5-app.js").read_text(encoding="utf-8")
ENG = (SRC / "js" / "6-engine.js").read_text(encoding="utf-8")
BODY = (SRC / "body.html").read_text(encoding="utf-8")
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
    """函数体（按花括号配对）"""
    i = src.index(f"function {name}(")
    j = src.index("{", i) + 1
    d, k = 1, j
    while d:
        d += {"{": 1, "}": -1}.get(src[k], 0)
        k += 1
    return src[j:k - 1]


# 2.1 顶栏场景名跟着屏上的场景走
scene = re.search(r'<span class="scene-name"[^>]*>([^<]*)</span>', BODY)
check("2.1 反向：body.html 的 .scene-name 没有写死 La Trobe", scene is not None and "La Trobe" not in scene.group(0), scene.group(0) if scene else "找不到 .scene-name")
check("2.1 地图 canvas 的 aria-label 没有写死 La Trobe", re.search(r'<canvas id="mapCanvas"[^>]*La Trobe', BODY) is None)
us = fn(APP, "updateScene")
check("2.1 updateScene()：微观场景写 La Trobe 路口，否则写施工街名 + 方向 + 小时（中英）",
      "microOn()" in us and "shortSt(EP.street)" in us and "dirL(EP.dir)" in us and "engHour(EP.hour)" in us and "墨尔本 CBD" in us)
check("2.1 每次重画面板都更新场景名（切步骤、切方案、切语言都走 renderPanel）", "syncMicro();updateScene();" in APP)

# 2.2 「回到施工区」
home = re.search(r"\$\('#zoomHome'\)\.onclick=\(\)=>\{([^}]*)\}", APP)
check("2.2 反向：#zoomHome 不再只飞 HOME —— 引擎方案时 engFly()", home is not None and "engFly(" in home.group(1) and "microOn()" in home.group(1), home.group(0) if home else "")

# 2.3 第 1 步：4 个大数字 → 紧跟 VMS 输入框 → 其余说明
p1 = fn(ENG, "engPanel1")
check("2.3 第 1 步顺序：施工区 → 引擎 4 个数字 → VMS 输入框 → 说明 / 公交行人 / 徽章（engPanel1 由三段拼成）",
      "engSiteHTML()+engOutSec()+engSignsHTML()+'<div id=\"engMore\"" in p1 and "data-foot" in fn(ENG, "engSiteHTML")
      and 'id="engOut"' in fn(ENG, "engOutSec") and 'id="vmsF1"' in fn(ENG, "engSignsHTML"))
out = fn(ENG, "engOutHTML")
check("2.3 #engOut 只放 4 个大数字（说明、公交行人、徽章挪到 #engMore）",
      "engMetrics(s)" in out and "engWhy(s)" not in out and "engImpacts(s)" not in out and "engBadges(" not in out)
more = fn(ENG, "engMoreHTML")
check("2.3 #engMore 放假设说明、公交行人、读屏 / 参数徽章（徽章仍走 engBadges → aiPlanSrc / aiSrcLabel）",
      all(x in more for x in ["engWhy(s)", "engImpacts(s)", "engBadges(s.flags,s)"]) and "aiPlanSrc(s,f)" in ENG and "aiSrcLabel(rs.src)" in ENG)
check("2.3 engRenderOut 两块一起刷新", "['engOut',engOutHTML],['engMore',engMoreHTML]" in ENG)

# 2.4 取景让开图例
fit = fn(ENG, "engFit") + fn(ENG, "fitView")  # T49：取景算法抽成 fitView()
check("2.4 桌面取景把左下图例（折起）的高度算进下边留白", "getElementById('legend')" in fit and "offsetHeight" in fit)
check("2.4 图例每次打开都先折起", "$('#legend').classList.add('collapsed')" in APP)

# 2.5 假设两行
why = fn(ENG, "engWhy")
check("2.5 反向：页面文案里没有「照标志 / 屏走」「act on the signs」", not re.search(r"照标志|屏走|act on the signs", PAGE))
check("2.5 53% 说的是「读懂屏上的字」，改不改道由路线选择模型算，并写出这次绕行比例", "读懂屏上的字" in why and "路线选择模型" in why and "pctS(s.detour_share)" in why)
why_txt = re.sub(r"//[^\n]*", "", why)  # 注释里可以提数据出处，页面文字里不写
check("2.5 信任度标「假设值」，不写「按 T12 参数」", "假设值" in why_txt and "assumed value" in why_txt and "T12" not in why_txt)
check("2.5 全封（cap = 0）时也有一行说明排队从哪来", "EP.all||(l&&l.cap===0)" in why and "施工段全封" in why)
check("2.5 反向：「绕行的车」那一行不传 better=true（中性色）",
      re.search(r"row\(L\('Drivers detouring','绕行的车'\),[^)]*\),pctS\(da\),true\)", ENG) is None
      and "row(L('Drivers detouring','绕行的车'),pctS(B.detour_share),pctS(da),null)" in ENG and "better==null?'var(--fg)'" in ENG)
i = ENG.index("的前提：")
check("2.5 第 4 步绕行前提那一行也不写「T12 参数」", "T12" not in ENG[i - 200:i + 200])
check("2.5 「每车多等」旁的车数写明是主进口道的", "${L('main approach','主进口道')} ${fmtN(s.vehicles)}" in ENG)

# 2.6 名不副实的字
check("2.6 步骤条（09-30 换成 6 步工作台）：路况总览 / 配置施工 / 仿真评估 / 影响分析 / 比较方案 / 确认导出",
      all(x in BODY for x in ['data-zh="路况总览">Overview', 'data-zh="配置施工">Configure', 'data-zh="仿真评估">Simulate', 'data-zh="影响分析">Impact', 'data-zh="比较方案">Compare', 'data-zh="确认导出">Export'])
      and not re.search(r"Stress test|Ripple trace|>Repair<|压力测试|涟漪追踪|\"修复\"", BODY))
check("2.6（审查）第 3 步面板小标题跟步骤条一样叫「影响 / Impact」，反向：页面上不再有「Ripple trace / 涟漪追踪」",
      "L('Impact · network','影响 · 路网')" in ENG and not re.search(r"Ripple trace|涟漪追踪", PAGE))
check("2.5（审查）参数角标写「T12（信任度是假设值）」，反向：不再写「T12 sources / 有出处」",
      "L('Parameters · T12 (trust is assumed)','参数 · T12（信任度是假设值）')" in ENG and not re.search(r"T12 sources|T12 with sources|有出处", PAGE))
check("2.6 反向：没有「生成更安全的布局」这类说法（v2 是预设布局，不是生成的）", "Generate a safer layout" not in APP)
check("2.6 反向：页面上不再说「智能体」（会让人以为用了 AI）", "智能体" not in APP and "Agents involved" not in APP and "AGENT IMPACT" not in APP)

# AI 面板的挂钩（PRD 4.3：T26 不删不挪）
check("第 3 步的 AI 面板挂钩还在（clashMount();aiMount();）", "clashMount();aiMount();" in APP)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
