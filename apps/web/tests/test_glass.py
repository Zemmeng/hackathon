"""T14 液态玻璃的静态断言：不开浏览器，只读源码和打包产物（docs/arch/T14-liquid-glass-PRD.md）。

用法：python3 apps/web/tests/test_glass.py
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
CSS = (SRC / "styles.css").read_text(encoding="utf-8")
GLASS = (SRC / "js" / "7-glass.js").read_text(encoding="utf-8")
APP = (SRC / "js" / "5-app.js").read_text(encoding="utf-8")
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


def block(src, head):
    """head 开头的 @media / @supports 块的内容（按花括号配对）"""
    i = src.find(head)
    if i < 0:
        return ""
    j = src.index("{", i) + 1
    depth = 1
    k = j
    while depth and k < len(src):
        depth += {"{": 1, "}": -1}.get(src[k], 0)
        k += 1
    return src[j:k - 1]


# 1. 降级：减少透明度 → 实底、不模糊；不支持 backdrop-filter → 实底；减少动态 → 不做过渡
rt = block(CSS, "@media (prefers-reduced-transparency: reduce)")
check("prefers-reduced-transparency：玻璃改实底并关掉 backdrop-filter",
      "var(--shell-solid)" in rt and re.search(r"(?<!-)backdrop-filter:none", rt))
check("prefers-reduced-transparency 时 JS 不挂折射滤镜", "prefers-reduced-transparency: reduce" in GLASS)
check("@supports not (backdrop-filter)：玻璃改实底", "var(--shell-solid)" in block(CSS, "@supports not ((backdrop-filter"))
check("prefers-reduced-motion：面板收起 / 折叠箭头不做过渡", "transition:none" in block(CSS, "@media (prefers-reduced-motion: reduce){\n  .panel"))

# 2. 可读性：玻璃底色很浅（像 Apple 那样透），靠 --glass-tone 把背后的地图压暗（深色）/ 提亮（浅色）保住 4.5:1。
#    实测（09-29，1440×900，3 种底图 × 6 种天气 × 深浅两套，最小字 --fg-3 叠上高光和卡片的最坏情况）：
#    底色 0.40 时深色 ≥ 4.50、浅色 ≥ 4.57；09-29 晚再调透到 0.30（压暗 .44 / 提亮 1.24）后深色 ≥ 4.63、浅色 ≥ 4.57
t14 = CSS[CSS.find("T14 liquid glass"):]
shells = [float(a) for a in re.findall(r"--shell:rgba\([^)]*,\s*(\.\d+)\)", t14)]
check(f"常规玻璃底色是浅的（--shell 不透明度 ≤ 0.35，{len(shells)} 处）", len(shells) == 3 and max(shells) <= .35, f"{shells}")
tones = re.findall(r"--glass-tone:(brightness[^;]+);", t14)
check("深浅两套都有 --glass-tone：深色压暗（brightness < 1），浅色提亮（brightness > 1）",
      len(tones) == 3 and float(re.search(r"brightness\(([\d.]+)", tones[0]).group(1)) < 1
      and all(float(re.search(r"brightness\(([\d.]+)", t).group(1)) > 1 for t in tones[1:]))
check("玻璃块的 backdrop-filter 都带 var(--glass-tone)",
      re.search(r"\.top,\.rail,\.panel,\.timeline,\.panel-open\{[^}]*backdrop-filter:blur\(\d+px\) var\(--glass-tone\)", t14) is not None
      and re.search(r"\.glass\{[^}]*backdrop-filter:blur\(\d+px\) var\(--glass-tone\)", t14) is not None)
check("折射也走 CSS：.lg-on 用 var(--lg-url) + var(--glass-tone)，JS 只设 --lg-url",
      "backdrop-filter:var(--lg-url) blur(var(--lg-blur,12px)) var(--glass-tone)" in t14
      and "setProperty('--lg-url'" in GLASS and "el.style.backdropFilter=" not in GLASS)
check("随背景自适应：深色底图 / 高温时用 --tone-deep，浓雾时用 --tone-fog",
      ':root[data-bm="imagery"],:root[data-bm="nir"],:root[data-wx="heat"]{--glass-tone:var(--tone-deep)' in t14
      and ':root[data-wx="fog"]{--glass-tone:var(--tone-fog)}' in t14 and t14.count("--tone-deep:") == 3)
check("JS 把当前底图 / 天气写到 <html data-bm / data-wx>",
      "document.documentElement.dataset.bm=S.basemap" in APP and "document.documentElement.dataset.wx=k" in APP
      and "document.documentElement.dataset.wx=S.wx" in APP)

# 3. 折射只在 Chromium 桌面上挂，只挂 1–2 块（PRD：backdrop-filter 只给少数 HUD，折射只给 1–2 个面板）
check("折射只在桌面宽度（≥ 821px）挂", "(min-width: 821px)" in GLASS)
check("Safari / Firefox 不挂 SVG 折射（走 CSS 磨砂）", re.search(r"Firefox.*Safari", GLASS) is not None)
n_fx = len(re.findall(r"GL\.fx\.push\(liquidGlass\(", GLASS))
check(f"折射面板 {n_fx} 块（≤ 2）", 1 <= n_fx <= 2)
check("滤镜用 sRGB 插值（不然中性灰会变成常量位移）", "'color-interpolation-filters','sRGB'" in GLASS)

# 4. 许可：参考的 liquid-glass.js 是 MIT，署名留在源码里；页面仍只连 Google Fonts（test_web 查外部地址）
check("署名 liquid-glass.js · Deepika Rao · MIT", "Deepika Rao" in GLASS and "sven1577/liquid-glass" in GLASS and "MIT" in GLASS)
check("没有引入第三方库（D-03）", not re.search(r"<script[^>]+src=", PAGE))

# 5. 地图铺满，玻璃浮在上面；--safe-* 是 JS 读的遮挡量
desk = block(CSS, "@media (min-width:821px){")
check("桌面：地图 fixed 铺满窗口", re.search(r"\.map\{position:fixed;inset:0", desk))
check("桌面：.app 声明 --safe-t / --safe-b / --safe-l / --safe-r",
      all(f"--safe-{k}:" in desk for k in "tblr"))
check("JS 读 --safe-*（readInsets），视图 / 比例尺 / 告警都避开玻璃",
      "--safe-l" in GLASS and "insets()" in APP and "GL.ins.l+22" in APP)
check("窄屏回到纵向堆叠（≤ 820px 不用浮层）", "@media (max-width:820px)" in CSS and "(min-width:821px)" in CSS)

# 6. 右侧面板精简：简洁 / 详细切换、折叠标题、收起按钮都有中英文
check("简洁 / 详细切换有中文", "L('Compact','简洁')" in GLASS and "L('Details','详细')" in GLASS)
check("收起面板按钮有中文", "收起面板" in GLASS)
check("展开面板按钮（body.html）有 data-zh / data-zh-aria-label",
      'id="panelOpen"' in BODY and 'data-zh-aria-label="展开分析面板"' in BODY and 'data-zh="分析面板"' in BODY)
check("折叠标题可用键盘操作（role=button + Enter / 空格）",
      "setAttribute('role','button')" in GLASS and "e.key==='Enter'" in GLASS and "aria-expanded" in GLASS)
check("简洁模式只藏说明文字，不藏数字（.metrics / 输入框 / 方案卡默认展开）",
      ".panel.compact p.muted{display:none}" in CSS and ".metrics" in GLASS and "textarea" in GLASS)
check("复制失败的提示在简洁模式下仍显示", "#copyFallback p.muted{display:block}" in CSS)

# 6b. 统一操作色（09-29 定）：主按钮、播放键、选中态都用 --sun；浅色主题下橙色文字用更深的 --sun-ink（对比度）
act = CSS[CSS.find("one action colour"):CSS.find("floating layout (desktop)")]
check("主按钮 / 播放键 / 选中的 chips、倍速、语言都用 --sun",
      all(re.search(sel + r"[^{]*\{[^}]*background:var\(--sun\)", act) for sel in (r"\.btn", r"\.play", r"\.chips \[aria-pressed")))
check("浅色主题有更深的橙色文字色 --sun-ink", CSS.count("--sun-ink:#874800") == 2)

# 7. 道路比建筑清楚（09-29 需求）：底图重画时压暗屋顶、描路沿
check("底图重画时调 emphasizeRoads（每次视图变化一次，不是每帧）",
      re.search(r"function renderBase\(\)\{[\s\S]*?emphasizeRoads\(", APP) is not None
      and not re.search(r"function render\(dt\)\{[^}]*emphasizeRoads", APP))

# 09-30 @unicornnnnnny：面板底部按钮一直悬浮（不用滑到最下面）；左侧图层栏缩小、位置不变
CLASH = (SRC / "js" / "8-clash.js").read_text(encoding="utf-8")
desk = CSS[CSS.index("@media (min-width:821px){"):]
check("桌面：面板里的 .cta（找更好的方案 / 错开 N 天 / 复制处置手册）sticky 贴在面板底部，背景近乎不透明（滚过去的字不透出来）",
      re.search(r"\.panel \.cta\{position:sticky;bottom:-20px;[^}]*color-mix\(in srgb,var\(--shell-solid\) 86%", desk) is not None)
check("没有毛玻璃 / 减少透明度时，底部按钮条也是实心背景",
      all(".glass,.panel .cta{background:var(--shell-solid)" in blk for blk in [CSS[CSS.index("@supports not"):], CSS[CSS.index("prefers-reduced-transparency"):]]))
check("「错开 N 天」挪进底部按钮条的 #clashAct 槽位（clashBtnHTML），叠加检查那一节只留说明",
      "cta.prepend(a)" in CLASH and "a.id='clashAct'" in CLASH and "function clashBtnHTML()" in CLASH
      and CLASH.count('id="clashStagger"') == 1 and "面板底部的「错开 ${n} 天」" in CLASH)
check("左侧图层栏缩小（50 px 宽、按钮 36 px、图标 17 px），仍按顶栏和时间轴之间居中",
      "left:12px;width:50px;" in desk and "translateY(-50%)" in desk[desk.index("  .rail{"):desk.index("  .rail{") + 200]
      and ".rail button{width:36px;height:36px;" in CSS and ".rail button svg{width:17px;height:17px}" in CSS)

# 09-30 @unicornnnnnny：数据来源不要边框、居中在地图下方；网页默认英文
cr = desk[desk.index("  .credits{"):desk.index("}", desk.index("  .credits{"))]
check("数据来源一行：不是 .glass（没有框和底），桌面居中在地图可见区域下方，文字带一圈底色光晕保证看得清",
      'class="credits" id="credits"' in BODY and "translateX(-50%)" in cr and "justify-content:center" in cr
      and "text-shadow:0 0 2px var(--shell-solid)" in cr and "border-radius" not in cr and "padding" not in cr)
check("第一次打开是英文：只认用户自己点过的 中文（rt-lang），不再按浏览器语言切中文",
      "LANG.cur=lg==='zh'?'zh':'en';" in APP and "navigator.language" not in APP and "const LANG={cur:'en'}" in (SRC / "js" / "0-i18n.js").read_text(encoding="utf-8"))
check("第一次打开是深色：<html data-theme=\"dark\">（脚本跑之前不闪浅色），开机只认用户自己点过的浅色（rt-theme），不跟系统设置",
      '<html lang="en" data-theme="dark">' in PAGE and "document.documentElement.dataset.theme=ls.get('rt-theme')==='light'?'light':'dark';" in APP)

# 09-30 tutor：右侧文字太多（limit the words）—— 简洁模式只留数字、按钮和一行假设；来源脚注、每套方案的 AI 解读、倾向的理由放「详细」
ENGJS = (SRC / "js" / "6-engine.js").read_text(encoding="utf-8")
CMPJS = (SRC / "js" / "8-compare.js").read_text(encoding="utf-8")
check("简洁模式隐藏来源脚注（.legend-src）、每套方案的 AI 解读（.cmp-explain）、倾向的理由（.cmp-lean-why）、重复的来源徽章（.eng-badges）和第 1 步的公交行人小行（.eng-impacts），详细模式照旧都在",
      ".panel.compact .legend-src,.panel.compact .cmp-explain,.panel.compact .cmp-lean-why,.panel.compact .eng-badges,.panel.compact .eng-impacts{display:none}" in CSS
      and "w.className='cmp-lean-why'" in CMPJS and 'class="cmp-explain"' in CMPJS)
check("假设说明缩成一行，但意思不丢：读懂比例 · 绕行比例 · 路线选择模型 · 信任度是假设值",
      "of drivers understand the sign · `" in ENGJS and "(route-choice model; trust in signs is an assumed value)" in ENGJS
      and "arrive, ${fmtN(l.cap)} veh/h get past" in ENGJS and "the route-choice model's per-driver-type parameters" not in ENGJS)
check("反向：「Reword」换成直白的「Edit sign」；第 1 步按钮说明不再写死 La Trobe × Swanston（第 2 步已是 4 个路口）",
      "Reword" not in ENGJS + CMPJS and "L('Edit sign','改字')" in ENGJS and "Micro-simulation of the La Trobe × Swanston junction" not in APP)

CLASHJS = (SRC / "js" / "8-clash.js").read_text(encoding="utf-8")
check("简洁模式默认收起「车往哪走」和「叠加检查」（SEC_FOLD），标题行直接写要点：叠加检查写冲突成本",
      "const SEC_FOLD='#clashBox,.eng-where';" in GLASS and "!sec.matches(SEC_FOLD)&&(" in GLASS and 'class="stack eng-where"' in ENGJS
      and "r.flags.reliable&&r.cost>0?`+${fmtN(r.cost)} ${U}`" in CLASHJS)
check("人行道照常时行人只占一行；第 1 步人行道选项写短（Works side closed / Both sides closed）",
      "L('Footpath open · no detour','人行道照常 · 不用绕')" in ENGJS and "L('Works side closed','施工侧封')" in ENGJS and "Works-side footpath closed" not in ENGJS)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
