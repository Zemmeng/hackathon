"""数据来源署名：OSM（ODbL）、DataVic（CC BY 4.0）、墨尔本市（CC BY）的许可都要求署名，评委也可能问。

用法：python3 apps/web/tests/test_credits.py
最后一行固定输出「N passed, M failed」，有失败退出码 1。
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import build  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
APP = (SRC / "js" / "5-app.js").read_text(encoding="utf-8")
CMP = (SRC / "js" / "8-compare.js").read_text(encoding="utf-8")
BODY = (SRC / "body.html").read_text(encoding="utf-8")
CSS = (SRC / "styles.css").read_text(encoding="utf-8")
PAGE, _ = build.bundle()
DATA = ROOT.parent / "roads" / "public" / "cbd"

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}{('：' + detail) if detail else ''}")


credits = APP[APP.index("const CREDITS=["):APP.index("function creditLines()")]

# 1. 必须有的两条（lead 09-29 点名）
check("页面有「© OpenStreetMap contributors」，链到 openstreetmap.org/copyright",
      "© OpenStreetMap contributors" in credits and "https://www.openstreetmap.org/copyright" in credits)
check("页面有 DataVic SCATS 署名（Traffic Signal Volume Data，CC BY 4.0，链到数据集页）",
      "SCATS" in credits and "Traffic Signal Volume Data" in credits and "CC BY 4.0" in credits
      and "https://discover.data.vic.gov.au/dataset/traffic-signal-volume-data" in credits)

# 2. 数据文件自己记的每个来源，署名里都有（以后加了新数据、忘了署名，这条会红）
KEYS = ["OpenStreetMap", "Traffic Signal Volume Data", "Victorian traffic signals", "PTV GTFS", "City of Melbourne"]
missing = []
for f in sorted(DATA.glob("*.json")):
    if f.name == "equipment.json":  # 设备：RPM Hire 产品页 + 假设的日租价，执行包里已写明，不是开放数据许可
        continue
    try:
        srcs = json.loads(f.read_text(encoding="utf-8")).get("sources") or []
    except Exception:
        continue
    for s in srcs if isinstance(srcs, list) else []:
        key = next((k for k in KEYS if k.lower() in s.lower()), None)
        if key is None or key not in credits:
            missing.append(f"{f.name}: {s}")
check(f"apps/roads/public/cbd/*.json 里记的来源都在署名里", not missing, "; ".join(missing[:4]))

# 3. 放在哪
check("页面页脚：#credits 由 renderCredits() 按当前语言填，开机和切语言都会重画",
      'id="credits"' in BODY and APP.count("renderCredits();") >= 2)
check("桌面在地图可见区域下方居中（--safe-l 和 --safe-r 之间）、不加玻璃框，手机是页面最底下的一行",
      re.search(r"\.credits\{position:fixed;z-index:4;left:calc\(var\(--safe-l\) \+ \(100vw - var\(--safe-l\) - var\(--safe-r\)\)/2\);transform:translateX\(-50%\);bottom:calc\(var\(--safe-b\)", CSS) is not None
      and '<div class="credits" id="credits"' in BODY
      and ".credits{grid-area:credits;padding:12px 16px 20px;" in CSS and 'grid-template-areas:"top" "map" "time" "panel" "credits"' in CSS)
check("执行包打印页：页脚上方有「数据来源」一节", "<section class=\"pd-src\"><h2>${esc(L('Data sources','数据来源'))}</h2>" in CMP and "credits:creditLines()" in CMP)
check("执行包复制的文字末尾带数据来源", "packText(p,lang)+`\\n\\n${L('Data sources','数据来源')}\\n`+creditLines()" in CMP)
check("处置手册（第 4 步复制）末尾带数据来源", APP.count("creditLines().map(s=>'- '+s)") >= 2)
check("署名文字都有中英两版", credits.count("short:[") == credits.count("full:[") == 4)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
