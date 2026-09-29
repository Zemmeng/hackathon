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

# 3. 反向断言（隐私）：页面不向任何服务器发数据，只允许加载 Google Fonts
check("JS 里没有 fetch / XMLHttpRequest / WebSocket / sendBeacon",
      not re.search(r"\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon", JS))
hosts = set(re.findall(r"https?://([a-zA-Z0-9.-]+)", PAGE))
allowed = {"fonts.googleapis.com", "fonts.gstatic.com", "www.w3.org"}
check("外部地址只有 Google Fonts", hosts <= allowed, f"多出 {sorted(hosts - allowed)}")

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
