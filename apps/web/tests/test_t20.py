"""T20 的静态断言：删掉页面上写死的假数 + 天气标示意 + 模拟评委团的 5 条（docs/arch/T20-addendum.md）。

用法：python3 apps/web/tests/test_t20.py
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
WXJ = (SRC / "js" / "3-weather.js").read_text(encoding="utf-8")
GLASS = (SRC / "js" / "7-glass.js").read_text(encoding="utf-8")
BODY = (SRC / "body.html").read_text(encoding="utf-8")
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


# ---- B1–B3：写死的假数 ----
check("B1 顶栏没有安全分（#safetyChip / updateSafety 都删了）", "safetyChip" not in BODY and "safetyVal" not in PAGE and "updateSafety" not in APP)
check("B1 第 4 步没有安全分圆环和查表的修复前后对比表", "Safety score" not in APP and "Severe conflicts" not in APP and "R.score" not in APP)
check("B1 处置手册不再抄查表的效果（严重冲突 / 安全分）", "Severe conflicts" not in fn(APP, "copyPlaybook") and "Safety score" not in fn(APP, "copyPlaybook"))
check("B2 第 2 步没有假进度、「变体 22/30」和变体清单", not re.search(r"data-live=\"(var|pct|dps)\"|varList|22 / 30|22 of 30", APP))
check("B2 没有「智能体决策 / 秒」（= 智能体数 × 10 × 倍速）", "agent decisions" not in APP and "智能体决策" not in APP)
check("B2 第 2 步写明是路口微观仿真、计数来自这一次运行，不是方案的引擎数字", "Junction micro-simulation" in APP and "不是方案的引擎数字" in APP)
check("B3 没有「AI 红队」「250 个智能体 × 30 种行为变体」「随机种子 4218」字样", not re.search(r"red team|红队|250 agents|250 个智能体|seed 4218|随机种子|行为变体|behaviour variations", PAGE, re.I))
check("B3 按钮改名：配置施工的下一步是「保存并进入仿真」（6 步工作台），不再叫 AI 红队", "Save & simulate" in APP and "保存并进入仿真" in APP and "red team" not in APP.lower())
check("第 3 步回放不再写「复现 n / 50 个种子」，告警卡也不写", "Reproduced in" not in APP and "SEEDS" not in APP)
check("时间轴只画这次仿真数到的冲突，没有编出来的「预期」曲线", "PROFILE" not in APP and "hash2(m,7" not in APP)

# ---- B4–B5：天气是示意 ----
check("B4 图例角标是「示意」，没有「实时 / LIVE」", "L('ILLUSTRATIVE','示意')" in APP and "L('LIVE','实时')" not in APP)
check("B4 图例写明天气不参与引擎计算", "天气不参与引擎计算" in APP)
check("B4 闪电标签没有随机的 kA 强度，闪电次数不上屏", "kA" not in WXJ and "strikeCount" not in APP)
check("B5 打开页面默认晴天，不读也不写 localStorage 的 rt-wx", "rt-wx" not in PAGE and re.search(r"S=\{step:1,wx:'clear'", APP) is not None)

# ---- 补充 1：地图对准 Lonsdale ----
fit = fn(ENG, "engFit") + fn(ENG, "fitView")  # T49：取景算法抽成 fitView()，engFit 调它
check("1 engFit 不再把路口 (0,0) 硬框进去", "xs=[0]" not in fit and "const xs=[],ys=[]" in fit)
check("1 engFit 按玻璃没挡住的区域（insets()）定缩放", "insets()" in fit and "V.w-I.l-I.r" in fit and "V.h-I.t-I.b" in fit)
check("1 engFit 框进排队线（沿真路、截到路网 / CITY 边，T27）和画出来的绕行（占比 ≥ 1%，T27 起；原来 ≥ 5%）", "engSub(Math.min(s.queue_m,engReach()))" in fit and ">=.01" in fit)
check("1 第一次拿到引擎结果时重新取景（第 1 步 / 第 3 步路网）", "if(first&&(S.step===1||(S.step===3&&EP.tab3==='net')))engFly(.7);" in ENG)
check("1 第 1、3、4 步进来都调 engFly()", all(re.search(rf"if\(n==={n}\)\{{.*?engFly\(", APP, re.S) for n in (1, 4)) and "if(engOn()&&EP.tab3==='net')engFly();" in APP)

# ---- 补充 2：引擎数字默认展开 ----
check("2 SEC_KEEP 带上 #engOut / #eng4（数字异步到，也不会被判成可折叠）", "#engOut" in GLASS and "#eng4" in GLASS and "sec.matches(SEC_KEEP)" in GLASS)
p1 = fn(ENG, "engPanel1")
check("2 第 1 步引擎那节在施工区表单下面、屏幕文字上面（engPanel1 = 施工区 + 引擎 + 屏）",
      "engSiteHTML()+engOutSec()+engSignsHTML()" in p1 and "data-foot" in fn(ENG, "engSiteHTML") and 'id="engOut"' in fn(ENG, "engOutSec") and 'id="vmsF1"' in fn(ENG, "engSignsHTML"))

# ---- 补充 3：单位 ----
check("3 顾问的节省量标「全施工期」，并写清天数 × 采样小时", "whole works" in ENG and "全施工期" in ENG and "engWindowTxt" in ENG and "天 × 每天采样" in ENG)
check("3 对比表写明「这一小时」，全网延误标「车·分钟（这一小时）」", "这一小时 · ${engHour(EP.hour)}" in ENG and "车·分钟（这一小时）" in ENG)

# ---- 补充 4：一个施工、一个时间 ----
check("4 microOn() 决定画不画 La Trobe 微观场景（护栏、小人、标注、Δ；T27 起小人 / 标注再加一条：缩放 ≥ 1，T38 第 2 步网格仿真例外）", all(x in APP for x in ["if(micro)drawWorks('before')", "&&walkers)planNotes()", "&&micro)drawDeltas()", "walkers=micro&&(fine||gridShown())", "if(micro)drawWorks('before');if(walkers){drawAgents(S.sim);"]))
check("4 引擎连着且方案不在 La Trobe 时不画微观场景；连接中也不先闪一下", re.search(r"if\(!BE\.api\)return false;.*?return /la trobe/i\.test\(EP\.street", fn(APP, "microOn"), re.S) is not None)
check("4 时间轴跟着微观场景走（.app.no-time 隐藏，桌面上 --safe-b 收回）", "classList.toggle('no-time',!on)" in APP and ".app.no-time .timeline{display:none}" in CSS and ".app.no-time{--safe-b:24px}" in CSS)
check("4 第 1 步的 La Trobe 设备清单 / 道路使用者只在微观场景显示（配置施工 · 施工信息页签）", "${microOn()&&t==='site'?`<div class=\"stack\"><div class=\"row between\"><span class=\"eyebrow\">${L('Junction micro-model" in APP)
check("4 滑动对比的标签不再写「AI 修复后 · v2」", "AI 修复后" not in BODY and 'data-zh="修改后">AFTER' in BODY)

# ---- 补充 5：假设亮出来 ----
why = fn(ENG, "engWhy")
check("5 引擎数字下写「施工段车流 X 辆/时 vs 封道后通行能力 Y 辆/时」（施工路段 raw.links 的 v 和 cap）", "l.v" in why and "l.cap" in why and "EP.link" in why and "const over=l.v>l.cap" in why)
check("5 写明绕行靠的假设（路线选择模型 + T12 参数 + 读懂标志的比例）", "路线选择模型" in why and "engInformed(s)" in why)
check("5 第 4 步绕行前后对比旁有假设说明", "绕行 ${pctS(B.detour_share)} → ${pctS(da)} 的前提" in ENG)
check("5 假设说明不用 .muted（简洁视图也看得到）", '<div class="eng-assume">' in why and ".eng-assume{" in CSS)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
