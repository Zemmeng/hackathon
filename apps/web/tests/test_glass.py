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

# 2. 可读性：文字底下的玻璃不透明度 ≥ 0.72（PRD）
t14 = CSS[CSS.find("T14 liquid glass"):]
t14_alphas = [float(a) for a in re.findall(r"--(?:panel|glass|shell):rgba\([^)]*,\s*(\.\d+)\)", t14)]
check(f"玻璃底色不透明度都 ≥ 0.72（{len(t14_alphas)} 处）", t14_alphas and min(t14_alphas) >= .72, f"最小 {min(t14_alphas) if t14_alphas else None}")

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
check("浅色主题有更深的橙色文字色 --sun-ink", CSS.count("--sun-ink:#A35A00") == 2)

# 7. 道路比建筑清楚（09-29 需求）：底图重画时压暗屋顶、描路沿
check("底图重画时调 emphasizeRoads（每次视图变化一次，不是每帧）",
      re.search(r"function renderBase\(\)\{[\s\S]*?emphasizeRoads\(", APP) is not None
      and not re.search(r"function render\(dt\)\{[^}]*emphasizeRoads", APP))

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
