"""apps/web 的静态断言：不开浏览器，只读源码和打包产物。

用法：python3 apps/web/tests/test_web.py
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
JS = "\n".join(p.read_text(encoding="utf-8") for p in sorted((SRC / "js").glob("*.js")))
BODY = (SRC / "body.html").read_text(encoding="utf-8")
PAGE, _ = build.bundle()
WX_KINDS = ["clear", "storm", "flood", "fog", "heat", "wind"]

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}{('：' + detail) if detail else ''}")


# 1. 仓库里的 public/index.html 和 src/ 同步（改了源码忘了打包会红）
committed = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
check("public/index.html 与 src/ 打包结果一致", committed == PAGE, "先跑 python3 apps/web/build.py")

# 2. 单文件体积在 2MB 以内（D：public/ 下文件上限）
size = len(PAGE.encode("utf-8"))
check(f"打包后 {size} 字节 < 2MB", size < 2 * 1024 * 1024)

# 3. 反向断言（隐私）：页面只从同源取东西（/engine/ /roads/ /params/ /api/，T13 PRD 第 6 节），不往别的服务器发数据
SAME_ORIGIN = ("/engine/", "/roads/", "/params/", "/api/")
loads = re.findall(r"\b(import|fetch)\s*\(\s*([^)]*?)\s*[,)]", JS)
bad = [f"{k}({a})" for k, a in loads if not re.fullmatch(r"'(/[^']*)'", a) or not a.strip("'").startswith(SAME_ORIGIN)]
check(f"import() / fetch() 只用同源的固定路径（{len(loads)} 处）", loads and not bad, f"不合规 {bad}")
check("JS 里没有 XMLHttpRequest / WebSocket / sendBeacon", not re.search(r"XMLHttpRequest|WebSocket|sendBeacon", JS))
hosts = set(re.findall(r"https?://([a-zA-Z0-9.-]+)", PAGE))
allowed = {"fonts.googleapis.com", "fonts.gstatic.com", "www.w3.org"}
# 许可要求的数据署名（OSM、OpenMapTiles / OpenFreeMap、DataVic、墨尔本市）是给人点的链接，不是页面去取的东西：
# 只准出现在 CREDITS 的 href 里（矢量瓦片是 tools/fetch_vectormap.py 在构建期拉的，页面不连它）
CREDIT_HOSTS = {"www.openstreetmap.org", "openfreemap.org", "discover.data.vic.gov.au", "data.melbourne.vic.gov.au"}
check("外部地址只有 Google Fonts（另有署名链接，见下一条）", hosts <= allowed | CREDIT_HOSTS, f"多出 {sorted(hosts - allowed - CREDIT_HOSTS)}")
stray = [h for h in CREDIT_HOSTS if PAGE.count("https://" + h) != len(re.findall(r"href:'https://" + re.escape(h), PAGE))]
check("署名链接只出现在 CREDITS 的 href 里，不被 fetch / import / src 加载", not stray, str(stray))
check("署名链接新开窗口且不带 referrer（rel=noopener noreferrer）", 'target="_blank" rel="noopener noreferrer"' in PAGE and re.search(r"CREDITS\.map\(c=>`<a href=\"\$\{c\.href\}\" target=\"_blank\" rel=\"noopener noreferrer\">", PAGE) is not None)

# 3b. 接后端（T13）：只接 backend.js 的 connect()；连不上走 BE.err，页面留着预设数字
ENG = (SRC / "js" / "6-engine.js").read_text(encoding="utf-8")
check("6-engine.js 加载 /engine/public/js/backend.js 并调 connect()",
      "import('/engine/public/js/backend.js')" in ENG and re.search(r"\.then\(m=>m\.connect\(\)\)", ENG))
check("后端加载失败的分支：catch 里记 BE.err，不往外抛",
      re.search(r"\.catch\(e=>\{BE\.err=e;", ENG) and "engOfflineCard" in ENG)
check("反向（T20）：引擎连不上时不再拿预设数字顶上（没有 RESULTS 查表，离线卡片写「暂时没有数字」）",
      "RESULTS" not in JS and "Engine offline — no numbers to show" in ENG and "showing preset numbers" not in ENG)

# 3c. 反向断言（注入）：引擎 / T5 / 顾问给的文字（why、路名、报错）不原样拼进 HTML
#     why 只用 textContent；路名、报错进模板一律过 esc()；画在 canvas 上的（drawTag）和剪贴板文字（engPlaybook）不算 HTML
html_part = re.sub(r"function engPlaybook\(\)\{.*?\n\}\n", "", ENG, flags=re.S)
html_part = re.sub(r"/\* pure:begin.*?/\* pure:end \*/", "", html_part, flags=re.S)  # 拼方案的纯数据，不进 HTML
interp = [m.group(0) for m in re.finditer(r"\$\{((?:[^{}]|\{[^{}]*\})*)\}", html_part)]
raw_why = [x for x in interp if re.search(r"\.why\b", x)]
check("why 不拼进 HTML（只用 textContent）", not raw_why, str(raw_why[:3]))
check("why 用 textContent 写（第 3 步读数、第 4 步顾问）", ENG.count(".textContent=w||''") + ENG.count(".textContent=o&&o.why||''") >= 2)
def interpolations(text):
    """每个 ${…} 单独拿出来（含嵌在 L(`…${x}…`) 里的内层），按花括号配对"""
    out, i = [], text.find("${")
    while i != -1:
        depth, j = 0, i + 1
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append(text[i + 2:j])
        i = text.find("${", i + 2)
    return out


def unsafe_in(text):
    """引擎 / 读屏 / 顾问给的字段直接进了插值、又没过 esc()（外层 L(…) 的整段不算，里面每个 ${} 另算）"""
    bad = []
    for x in interpolations(text):
        if "${" in x:  # 外层：里面的插值会单独检查
            continue
        code = re.sub(r"'[^']*'|\"[^\"]*\"|`[^`]*`", "''", x)  # 字符串字面量里的文案不算
        # 引擎 / 读屏 / 顾问 / check 给的字段，和用户打的字（f1 f2 sign）、顾问改法（what kind frames）
        if re.fullmatch(r"\s*(fmtN|pctS|engHour)\([^()]*(\([^()]*\))?[^()]*\)\s*", code):  # 数字格式化，输出只有数字
            continue
        if re.search(r"(?<![.\w])(street|name|msg|message|reading_src|src|equipment|f1|f2|sign|what|kind|frames|text|headsign|short|m)\b|\.(street|name|msg|message|reading_src|src|equipment|f1|f2|sign|kind|frames|text|headsign|short)\b", code) and "esc(" not in code:
            bad.append(x[:60])
    return bad


lines = "\n".join(ln for ln in html_part.splitlines() if "drawTag(" not in ln and "toast(" not in ln)
unsafe = unsafe_in(lines)
check("路名 / 报错 / 来源进 HTML 模板都过 esc()（含 L() 里嵌的）", not unsafe, str(unsafe[:4]))
# 自检：去掉一处 esc() 必须被抓到（防止断言本身永远不会失败）
probe = "`${L(`One lane on ${shortSt(s.street)} backs up`,`x`)}` `${esc(a.src)}`"
check("自检：嵌在 L() 里的未转义路名会被抓到", unsafe_in(probe) == ["shortSt(s.street)"], str(unsafe_in(probe)))
app_js = (SRC / "js" / "5-app.js").read_text(encoding="utf-8")
check("第 1 步标题里的路名过 esc()", "esc(shortSt(EP.street)" in app_js and not unsafe_in(app_js[app_js.find("S.step===1"):app_js.find("S.step===2")]))

# 3d. 真建筑（T15）：先同步画程序生成的城市（兜底），异步取 buildings.json，拿不到 / 太少就留着兜底，页面不会空白
WORLD_JS = (SRC / "js" / "1-world.js").read_text(encoding="utf-8")
no_comments = lambda t: re.sub(r"/\*.*?\*/|//[^\n]*", "", t, flags=re.S)  # noqa: E731
check("兜底城市先同步建好：let W=buildWorld(),G=buildGrids(W)", "let W=buildWorld(),G=buildGrids(W);" in app_js and "function buildWorld(){" in WORLD_JS)
lb = re.search(r"function loadBuildings\(\)\{.*?\n\}\n", app_js, re.S)
lb_src = lb.group(0) if lb else ""
check("loadBuildings 取同源的 /roads/public/cbd/buildings.json", "fetch('/roads/public/cbd/buildings.json')" in lb_src)
check("取不到 / 坏数据 / 不够 REAL_MIN 栋 → 不换世界（catch + REAL_MIN）",
      ".catch(" in lb_src and "nw.buildings.length<REAL_MIN)return false" in lb_src and "r.ok?r.json():null" in lb_src)
check("geoToWorld 只在 loadBuildings 的异步回调里用（1-world.js 顶层不碰它）",
      "geoToWorld" not in no_comments(WORLD_JS) and no_comments(app_js).count("geoToWorld") == no_comments(lb_src).count("geoToWorld") == 1)
check("rebuildWorld 清掉影像缓存、底图签名和高温统计", re.search(r"function rebuildWorld\(nw,g,imgs\)\{\s*W=nw;G=g\|\|buildGrids\(nw\);WX\.rebind\(W,G\);\s*for\(const k of Object\.keys\(IMG\)\)delete IMG\[k\];\s*if\(imgs\)Object\.assign\(IMG,imgs\);\s*baseKey='';probeKey='';heatStats=null;", app_js) is not None)
check("启动最多等 1.2 s 真建筑，超时先画兜底城市", "loadBuildings().then(once);setTimeout(once,1200);" in app_js)
# 真建筑晚到时分几个 task 换（轮廓 → 栅格 → 影像 → 一帧内换上），动画不整段卡住；栅格和影像都先建好再交给 rebuildWorld
lb_code = no_comments(lb_src)
check("loadBuildings 分 task 换世界：3 次 await nextTask()，栅格和影像先建好再 rebuildWorld(nw,g,imgs)",
      lb_code.count("await nextTask();") == 3 and "const g=buildGrids(nw);" in lb_code and "renderImagery(nw," in lb_code
      and lb_code.find("buildGrids(nw)") < lb_code.find("renderImagery(nw,") < lb_code.find("rebuildWorld(nw,g,imgs)"))
check("反向：loadBuildings 里没有不带预建栅格的 rebuildWorld(nw)", "rebuildWorld(nw)" not in lb_code)
# 天气栅格只在 start() 里建一次：boot 里先建（兜底城市上）会在真建筑到了之后被 WX.rebind 扔掉重建
bt = re.search(r"function boot\(\)\{.*?\n\}\n", app_js, re.S)
bt_code = no_comments(bt.group(0) if bt else "")
pre_start = bt_code[:bt_code.find("const start=")] if "const start=" in bt_code else bt_code
check("天气栅格在 start() 里建：if(WX.kind!==S.wx)WX.set(S.wx)", "const start=()=>{if(WX.kind!==S.wx)WX.set(S.wx);" in bt_code)
check("反向：boot 在 start() 之前不调 WX.set（不在兜底城市上白建一次高温栅格）", bool(bt) and "WX.set(" not in pre_start)
# 反向断言（注入）：数据里的楼名只画在 canvas 上，不进 HTML
BASE_JS = (SRC / "js" / "2-basemap.js").read_text(encoding="utf-8")
check("反向：楼名只用 fillText 画，1-world / 2-basemap 里没有 innerHTML", "innerHTML" not in WORLD_JS + BASE_JS and "c.fillText(t,px,py)" in BASE_JS)
# 真城市里 Little La Trobe / A'Beckett 只在真路网有的那段（STREET_SPAN）标街名，Swanston 以东的真楼上不压「A'BECKETT ST」
check("街名注记只标在真路网有的那段：drawLabels 按 W.real && STREET_SPAN 跳过",
      "real=W.real&&STREET_SPAN[st.id]" in BASE_JS and "if(real&&!(u>real[0]&&u<real[1]))continue;" in BASE_JS
      and "const STREET_SPAN={llatrobe:[-185,-15],abeckett:[-Infinity,-15]};" in WORLD_JS)

# 4. 反向断言（秘密）：源码里没有 key / token 形状的字符串
check("源码里没有 key / token", not re.search(r"(sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]|Bearer\s+[A-Za-z0-9])", JS + BODY, re.I))

# 5. 四步流程都在
steps = re.findall(r'data-ui="(\d)"', BODY)
check("stepper 有 00–05 六步（路况总览 → 配置施工 → 仿真评估 → 影响分析 → 比较方案 → 确认导出）", steps == ["0", "1", "2", "3", "4", "5"], str(steps))

# 6. 六种天气：每种都有颜色、图标、图例、影响说明（对比结果、复现种子是写死的假数，T20 删了）
for k in WX_KINDS:
    ok = all(re.search(pat, JS, re.S) for pat in [
        rf"WX_META=\{{.*?\b{k}:\{{label:", rf"WX_ICON=\{{.*?\b{k}:'", rf"const LEG=\{{.*?\b{k}:\{{t:",
        rf"const IMPACT=\{{.*?\b{k}:\["])
    check(f"天气 {k} 的配置齐全", ok)

# 7. 反向（T20）：安全分、修复前后对比表、复现种子、预期冲突曲线这些按天气查表的假数都删了
check("没有 RESULTS / SEEDS / PROFILE 查表", not re.search(r"\bconst (RESULTS|SEEDS|PROFILE)=", JS))

# 8. 方案 v2 的几何和文案对得上：护栏西移 8 m、收窄 0.9 m、无障碍通道 1.8 m、VMS 上游移 80 m
lay = {m.group(1): dict((k, float(v)) for k, v in re.findall(r"(\w+):(-?[\d.]+)", m.group(2)))
       for m in re.finditer(r"\b(before|after):\{([^}]*)\}", JS.split("const LAYOUTS=")[1].split(";")[0])}
b, a = lay.get("before", {}), lay.get("after", {})
check("Δ1 护栏西移 8 m", b and a and a["bx0"] - b["bx0"] == -8 and a["bx1"] - b["bx1"] == -8)
check("Δ1 护栏收窄 0.9 m", b and a and abs((a["by"] - b["by"]) + 0.9) < 1e-9)
check("Δ3 人行通道 1.1 m → 1.8 m", b and a and abs(abs(b["hoard"] + 10.5) - 1.1) < 1e-9 and abs(abs(a["hoard"] + 10.5) - 1.8) < 1e-9)
check("Δ4 VMS-1 上游移 80 m", b and a and a["vms"] - b["vms"] == 80)

# 9. 中英切换：静态文案都带 data-zh，JS 里用 L(英, 中) 的地方两边都有字
check("body.html 至少 30 处 data-zh 译文", len(re.findall(r"data-zh[-=]", BODY)) >= 30)
bad = [m.group(0)[:60] for m in re.finditer(r"\bL\('([^']*)','([^']*)'\)", JS) if not m.group(1) or not m.group(2)]
check("L('英','中') 没有空字符串", not bad, str(bad[:3]))
cjk = len(re.findall(r"[一-鿿]", JS))
check(f"JS 里有中文文案（{cjk} 个汉字）", cjk > 800)

# 10. 页面里没有写死 localhost（线上冒烟 check --e2e 也查这一条）
check("没有写死 localhost", "localhost" not in PAGE)

# 11. 部署配置：纯静态（只托管 public/，没有 Worker 代码 / 绑定），deploy.sh 调得到 npm run deploy
import json  # noqa: E402
wr_txt = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
wr = json.loads(re.sub(r"(?m)^\s*//.*$|\s//[^\"\n]*$", "", wr_txt))
check("wrangler.jsonc 用 assets 托管 public/", wr.get("assets", {}).get("directory") == "public")
check("wrangler.jsonc 是纯静态：没有 main / durable_objects / vars", not any(k in wr for k in ("main", "durable_objects", "vars", "kv_namespaces")))
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
check("package.json 的 deploy 是 wrangler deploy", pkg.get("scripts", {}).get("deploy") == "wrangler deploy")
check("反向断言：部署配置里没有 token / account_id", not re.search(r"api[_-]?token|account_id|CLOUDFLARE_", wr_txt, re.I))

# T21 叠加检查（8-clash.js，D-0929-2011 ②）：登记表从同源 /api/ 取，数全由 be.clash / be.stagger 算；不可信时不显示负数
CLASH = (SRC / "js" / "8-clash.js").read_text(encoding="utf-8")
check("T21 登记表走 /api/public/js/worksites.js，数由 BE.api.clash / stagger 算",
      "import('/api/public/js/worksites.js')" in CLASH and "BE.api.clash(" in CLASH and "BE.api.stagger(" in CLASH)
check("T21 flags.reliable = false 时写「≈ 0 · 结果不可信」（中英）",
      "!r.flags.reliable" in CLASH and "result not reliable" in CLASH and "结果不可信" in CLASH)
check("T21 两种 ≈ 0 分开写：negative_delay 说基线超通行能力，substitutes 说同一走廊；错开前看 best.reliable",
      "r.flags.negative_delay?" in CLASH and "r.flags.substitutes?" in CLASH and "same corridor" in CLASH and "同一走廊" in CLASH and "b&&!b.reliable" in CLASH)
check("T21 第 3 步挂上叠加检查（clashMount）、地图画那处施工（clashDraw）", "clashMount();" in app_js and "clashDraw();" in app_js)
raw_title = [x for x in interpolations(CLASH) if "${" not in x and re.search(r"\.(title|name)\b", x) and "esc(" not in x]
check("T21 反向断言：登记表的标题 / 路名进 HTML 都过 esc()", not raw_title and "esc(o.title)" in CLASH, str(raw_title[:3]))

# 9. T23 方案对比 · 选定 · 导出（src/js/8-compare.js）
CMP = (SRC / "js" / "8-compare.js").read_text(encoding="utf-8")
cmp_html = re.sub(r"/\* pure:begin.*?/\* pure:end \*/", "", CMP, flags=re.S)
cmp_html = "\n".join(ln for ln in cmp_html.splitlines() if "toast(" not in ln)
cmp_unsafe = unsafe_in(cmp_html)
check("T23：方案名称、改法、路名进 HTML 模板都过 esc()", not cmp_unsafe, str(cmp_unsafe[:4]))
cmp_loads = re.findall(r"(?:import|fetch)\('([^']+)'\)", CMP)
check("T23：只取同源的 /api/public/js/pack.js 和 explain.js", sorted(cmp_loads) == ["/api/public/js/explain.js", "/api/public/js/pack.js"], str(cmp_loads))
check("T23：改法说明和纯文字执行包用 textContent 写", ".textContent=r?cmpWhat(r):''" in CMP and "pre.textContent=txt" in CMP)
check("T23：排版版执行包只经 cmpDocHTML（里面每个字符串过 esc()，compare_glue.mjs 反向断言）", CMP.count("innerHTML=doc") == 1 and "doc=cmpDocHTML(" in CMP)
check("T23 反向断言：用户写的理由不拼进 HTML（只用 .value）", "ta.value=CP.reason" in CMP and not re.search(r"\$\{[^}]*reason", cmp_html))
check("T23：页面上写明租金是假设值（中英）", "day rates and stock are assumptions" in CMP and "日租价和库存件数是假设值" in CMP)
check("T23：由人拍板的字样在（不是工具替人选）", "a person decides" in CMP and "由人拍板" in CMP)
check("T23：挂在第 4 步顾问下面（engPanel4 有 #cmp4，engRender4 调 cmpRender）", 'id="cmp4"' in ENG and "cmpRender();" in ENG)
check("T23：方案名称（可能是顾问给的 kind）过 esc()", "esc(cmpLabel(r))" in CMP)
probe_cmp = "`<b>${cmpLabel(r)}</b><i>${r.kind}</i>`"
check("自检：T23 去掉 esc() 会被抓到", len(unsafe_in(probe_cmp)) >= 1)

# 10. T40 决赛亮点（lead 派单）：①对比表标出「结果一样、却多花钱」的那套 ②加一行「和附近施工叠加」③01 Signs「比只写 ROADWORK AHEAD 少排多少」
#     只把引擎已有的数摆出来：页面不自己算、源码里不写死验收时看到的数
CLASHJS = (SRC / "js" / "8-clash.js").read_text(encoding="utf-8")
T40_SRC = JS + "\n" + BODY + "\n" + (SRC / "styles.css").read_text(encoding="utf-8")
t40_lits = [x for x in ["1,250", "1250", "33,015", "33015", "25,719", "25719"] if x in T40_SRC or x in PAGE] \
    + re.findall(r"(?<![\w.])725(?!\d)", T40_SRC + PAGE)
check("T40 反向断言：源码和打包页里没有验收时的数（1,250 / 33,015 / 25,719 / 725），都从引擎来", not t40_lits, str(t40_lits[:4]))
check("T40①：「结果和 A 一样 · 多花 A$…」由 cmpSameAs(CP.rows) 逐列算，字母和金额都不写死（中英成对）",
      "dup=cmpSameAs(CP.rows)" in CMP and "function cmpSameAs(rows){" in CMP and "String.fromCharCode(65+d.of),amt=fmtN(d.extra)" in CMP
      and "L(`Same result as ${a} · +A$${amt}`,`结果和 ${a} 一样 · 多花 A$${amt}`)" in CMP and 'class=\\"cmp-dup\\"' in CMP.replace('"', '\\"'))
t40_same = CMP[CMP.index("function cmpSameAs(rows){"):CMP.index("function cmpSpan(")]
check("T40① 反向断言：不是只认 B 列的特判（cmpSameAs 里没有 rows[1] / 'B' / i===1）",
      not re.search(r"rows\[1\]|'B'|===1\b", t40_same))
check("T40②：叠加一行用 8-clash.js 的同一挑法（clashPick）+ BE.api.clash 逐套算；表先出、这一行后补；无重叠写 none、算失败写 — 并 console.warn",
      "async function clashPick(cur,alive){" in CLASHJS and "await clashPick(clashCur(),()=>seq===CL.seq)" in CLASHJS
      and "await clashPick(cur,alive)" in CMP and "BE.api.clash(r.plan.worksites[0],x.ws)" in CMP and "${cmpClashRow(rc)}" in CMP
      and "cmpUpdate();cmpExplainUpdate();cmpClashUpdate();" in CMP and "L('none','无')" in CMP
      and "console.warn('compare: clash check failed for plan'" in CMP and "console.warn('compare: nearby works check failed'" in CMP
      and "L('Nearby works','和附近施工叠加')" in CMP)
check("T40②：进过 03 就沿用它挑好的那处施工（CL.other），没进过就按同一规则现挑",
      "CL.key===JSON.stringify(cur)&&!CL.busy&&!CL.err)x=CL.other" in CMP)
t40_vs = ENG[ENG.index("function engVsHTML(){"):ENG.index("async function engStep4(){")]
check("T40③：基准 = 同一方案、VMS 只写 options.js 的 WARN_FRAME，再跑一次引擎；按基准方案缓存（不含屏上文字，打字不重跑）",
      "import('/engine/public/js/options.js')" in ENG and "VSB.frame=m.WARN_FRAME" in ENG and "if(VSB.runs.has(k))return;" in ENG
      and "frames:[[...VSB.frame]]" in ENG and 'id="vmsVs"' in ENG and "['vmsVs',engVsHTML]" in ENG)
check("T40③：当前就是 ROADWORK AHEAD 时不显示；更长时用 var(--risk) 写 +X m；中英成对",
      "JSON.stringify(v.frames)===JSON.stringify([w]))return''" in t40_vs and "d>0?'var(--risk)'" in t40_vs
      and "L(`vs ${wt} only: queue" in t40_vs and "`只写 ${wt} 时：排队" in t40_vs)
check("T40③ 反向断言：基准那行的 ROADWORK / AHEAD 字样来自引擎的 WARN_FRAME，不在页面里写死", "ROADWORK" not in t40_vs and "AHEAD" not in t40_vs)

# 11. T42（@unicornnnnnny 09-30）：01 施工信息 / 设备诱导不放引擎四个数；02 仿真的冲突 / 严重 / 急刹在地图上标出来
GRIDJS = (SRC / "js" / "4b-grid.js").read_text(encoding="utf-8")
check("T42：01 施工信息 / 设备诱导两个页签不再放「引擎 · 真实 CBD 车流」四个数，只在没选街 / 引擎算不了时留一行提示",
      "engOutSec()" not in app_js and app_js.count("engStateSec()") == 2 and "function engStateHTML(){" in ENG and "['engState',engStateHTML]" in ENG)
check("T42：4×4 仿真的急刹和冲突都带位置记进 sim.events（冲突 TTC < 1.5 s、严重 < 1.0 s，只算 2×2）；地图 drawEvents 画出来",
      "kind:'harsh'" in GRIDJS and "kind:'conflict'" in GRIDJS and "ttc:1.5,ttcCrit:1" in GRIDJS and "if(e.kind==='harsh'){" in app_js
      and "const keep=sim.isGrid?EV_KEEP_GRID:25" in app_js)
check("T42 反向断言：02 面板急刹写的阈值来自 4×4 仿真自己的 GRID_P.harsh（3.5），不再写旧场景的 4.2",
      "-GRID_P.harsh/GRID_K" in app_js and "grid?fmtN(-GRID_P.harsh/GRID_K*10)/10:'4.2'" in app_js)
check("T42：02 面板有图例说明地图和时间轴上的标记（中英成对）；冲突 / 严重也画成菱形，不和信号灯的圆点混",
      "L(`map: last ${EV_KEEP_GRID} s · timeline: share of vehicles, per 10 min`,`地图标最近 ${EV_KEEP_GRID} 秒 · 时间轴：每 10 分钟车辆占比`)" in app_js and 'class="eng-legend ev-legend"' in app_js
      and "evDiamond(px,py,sim.isGrid?(e.sev===2?7.5:6.5)" in app_js and "ev-dot" not in app_js)
check("T42：02 时间轴改成每 10 分钟一根的 100% 堆叠柱（红 = 急刹或卷入冲突的车占比，灰 = 其余），两段都标百分比；其他步骤按最忙的一分钟缩放（不再按每分钟 3 次封顶）",
      "function histShare(c,sim,top,bot){" in app_js and "hit/seen" in app_js and "pct(1-p)" in app_js
      and "Math.min(1,v/3)" not in app_js[app_js.index("function drawHist(){"):app_js.index("function histShare(")] and "let mx=3;" in app_js
      and "this.mSeen=new Float32Array(60);this.mHit=new Float32Array(60);" in GRIDJS and "mBy" not in GRIDJS + app_js)
check("T42：02 的 4×4 仿真按时钟记分钟（clock0 = 时钟 − 仿真秒数），时间轴柱子和时钟指针对得上",
      "s.clock0=CLOCK_EVENT-s.t;return s;" in app_js and "g.clock0=S.clock-g.t;" in app_js)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
