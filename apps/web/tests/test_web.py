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
check("外部地址只有 Google Fonts", hosts <= allowed, f"多出 {sorted(hosts - allowed)}")

# 3b. 接后端（T13）：只接 backend.js 的 connect()；连不上走 BE.err，页面留着预设数字
ENG = (SRC / "js" / "6-engine.js").read_text(encoding="utf-8")
check("6-engine.js 加载 /engine/public/js/backend.js 并调 connect()",
      "import('/engine/public/js/backend.js')" in ENG and re.search(r"\.then\(m=>m\.connect\(\)\)", ENG))
check("后端加载失败的分支：catch 里记 BE.err，不往外抛",
      re.search(r"\.catch\(e=>\{BE\.err=e;", ENG) and "engOfflineCard" in ENG)
check("引擎连不上时第 4 步仍显示预设的小汽车延误（RESULTS.car）",
      re.search(r"\$\{eng\?'':row\(L\('Mean car delay'", JS) is not None)

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
        if re.search(r"(?<![.\w])(street|name|msg|message|reading_src|src|equipment|f1|f2|sign|what|kind|frames|text|m)\b|\.(street|name|msg|message|reading_src|src|equipment|f1|f2|sign|kind|frames|text)\b", code) and "esc(" not in code:
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
steps = re.findall(r'data-step="(\d)"', BODY)
check("stepper 有 01–04 四步", steps == ["1", "2", "3", "4"], str(steps))

# 6. 六种天气：每种都有颜色、图标、图例、影响说明、对比结果、复现种子
for k in WX_KINDS:
    ok = all(re.search(pat, JS, re.S) for pat in [
        rf"WX_META=\{{.*?\b{k}:\{{label:", rf"WX_ICON=\{{.*?\b{k}:'", rf"const LEG=\{{.*?\b{k}:\{{t:",
        rf"const IMPACT=\{{.*?\b{k}:\[", rf"const RESULTS=\{{.*?\b{k}:\{{severe:", rf"const SEEDS=\{{.*?\b{k}:\d"])
    check(f"天气 {k} 的配置齐全", ok)

# 7. 修复方案在每种天气下都要比原方案好（安全分升、严重冲突降、无路可走不增加）
rows = re.findall(r"\b(\w+):\{severe:\[(\d+),(\d+)\],conf:\[(\d+),(\d+)\],noRoute:\[(\d+),(\d+)\],.*?score:\[(\d+),(\d+)\]\}", JS)
check("RESULTS 覆盖 6 种天气", sorted(r[0] for r in rows) == sorted(WX_KINDS), str([r[0] for r in rows]))
for r in rows:
    k = r[0]
    s0, s1, c0, c1, n0, n1, sc0, sc1 = map(int, r[1:])
    check(f"{k}：修复后严重冲突 {s0}→{s1}、安全分 {sc0}→{sc1}", s1 < s0 and c1 < c0 and n1 <= n0 and sc1 > sc0)

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

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
