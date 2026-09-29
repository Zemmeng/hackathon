"""AI 面板（src/js/9-ai.js）：第 3 步「AI 路人 · 各自读到了什么」+「AI 调用日志」，第 4 步方案卡片上的 AI 解读。

用法：python3 apps/web/tests/test_ai.py（要 node ≥ 18，不联网、不调大模型）
纯函数和接真 backend.js 的断言在 tests/ai_glue.mjs；这里先做源码上的静态断言，再调 node 转发它的 ✅ / ❌ 行。
最后一行「N passed, M failed」。
"""
import pathlib
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / "src" / "js"
AI = (SRC / "9-ai.js").read_text(encoding="utf-8")
APP = (SRC / "5-app.js").read_text(encoding="utf-8")
CMP = (SRC / "8-compare.js").read_text(encoding="utf-8")
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"✅ {name}")
    else:
        failed += 1
        print(f"❌ {name}{('：' + detail) if detail else ''}")


def body(name, text):
    """function name(){…} 的函数体（按花括号配对）"""
    i = text.find(f"function {name}(")
    if i < 0:
        return ""
    j = text.find("{", i)
    depth = 0
    for k in range(j, len(text)):
        depth += {"{": 1, "}": -1}.get(text[k], 0)
        if depth == 0:
            return text[j:k + 1]
    return ""


code = re.sub(r"/\*.*?\*/", "", AI, flags=re.S)
# 1 挂载点：只在别人的文件里加一行钩子
check("5-app.js 第 3 步路网面板挂上 aiMount()", "clashMount();aiMount();" in APP)
check("8-compare.js 的 cmpRender() 最后调 aiCmp()", "aiCmp();" in body("cmpRender", CMP))
# 2 隐私 / 网络：不发任何请求；下载在浏览器里拼文件
check("反向：9-ai.js 没有 import() / fetch() / XMLHttpRequest / sendBeacon / WebSocket",
      not re.search(r"\bimport\s*\(|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket", code))
dl = body("aiDownload", AI)
check("下载 JSON：Blob + createObjectURL（本地文件，不上传），内容只经 aiLogJSON() 白名单",
      "new Blob([txt]" in dl and "URL.createObjectURL" in dl and "aiLogJSON(AI.log" in dl and "revokeObjectURL" in dl)
check("日志只从 backend.js 来：aiLog() 快照 + onAiLog() 订阅，同一个 tick", re.search(r"AI\.log=api\.aiLog\(\);\s*api\.onAiLog\(", AI) is not None)
# 3 注入：模型写的字只走 textContent
check("why 用 textContent 写（data-aiwhy）", "q.textContent=p&&p.reading&&p.reading.why||''" in AI)
paint = body("aiCmpPaint", AI)
check("反向：第 4 步解读（summary / pros / cons / lean / decide）不用 innerHTML，只用 textContent / createTextNode",
      paint and "innerHTML" not in paint and "n.textContent=txt" in paint and "createTextNode(' — '+res.lean.why)" in paint)
check("反向：整个 9-ai.js 只有一处 innerHTML（aiRender 写 aiHTML() 的结果，里面每个字符串过 esc()）",
      code.count("innerHTML") == 1 and "el.innerHTML=h;" in body("aiRender", AI))
interp = re.findall(r"\$\{((?:[^{}]|\{[^{}]*\})*)\}", body("aiPersonaHTML", AI) + body("aiLogRowHTML", AI))
raw = [x for x in interp if re.search(r"\.(text|why|src|error|persona)\b|\b(txt|adv|who)\b|aiAdvice\(|aiSrcLabel\(|aiKind\(|aiTime\(", x) and "esc(" not in x and not x.startswith("aiSrcTone(")]
check("读数卡片 / 日志行里的字都过 esc()", not raw, str(raw[:3]))
# 4 签名守卫（CLAUDE.md §9）：同样的状态不重建 DOM
check("aiRender 有签名守卫（HTML + why 一起算签名）", "if(el.dataset.sig===sig)return;" in AI and "const sig=h+'\\u0000'+whys;" in AI)
check("第 4 步每张卡片、底部那条也有签名守卫", paint.count("dataset.sig===") == 2)
check("一次 run 问 ~20 条读数只重画一次（aiRenderSoon 防抖）", "setTimeout(aiRender,120)" in AI)
# 5 解读的请求：用 T5 的 optionFromRun + explainOptions（数字只来自引擎），过期的回答丢掉
cmp = body("aiCmp", AI)
check("解读请求 = explainOptions({ lang, options: optionFromRun(卡片) })，模块用 T23 已加载的 explain.js",
      "ex.optionFromRun(r.id,aiLabel(cmpLabel(r)),r.s,{hire_aud:r.hire,days:r.days})" in cmp and "ex.explainOptions(req)" in cmp and "CP.mod&&CP.mod.ex" in cmp)
check("过期的解读丢掉（seq），失败只写一行灰字", "if(seq!==x.seq)return;" in cmp and "AI explanation unavailable" in paint)
# 6 审查修复：出错 / 不合规 / 还没算完时不画上一份方案的读数；徽章按这份方案的读数算来源
check("反向：aiReadings 和 engPanel3 同一个判断（run() 出错留着的旧 EP.sum 不拿来画卡片）",
      "if(aiState(EP)!=='ok'" in body("aiReadings", AI) and "ep.runErr&&!ep.busy?'err'" in AI)
check("aiRender 按状态画：不是 ok 就只写一行和面板一致的说明 + 调用日志",
      "aiHTML(rd,st)" in body("aiRender", AI) and "if(st&&st!=='ok')" in body("aiHTML", AI))
check("中英：面板标题和日志标题两边都有", "L('AI road users · what each one read','AI 路人 · 各自读到了什么')" in AI and "L(`AI call log (${n})`,`AI 调用日志（${n}）`)" in AI)

node = shutil.which("node")
if not node:
    check("找到 node（纯函数断言要用 node 跑）", False)
else:
    try:
        r = subprocess.run([node, str(HERE / "ai_glue.mjs")], capture_output=True, text=True, encoding="utf-8", timeout=120)
        out, rc = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, rc = "❌ ai_glue.mjs 超过 120 秒没跑完\n", 1
    f0 = failed
    for line in out.splitlines():
        if line.startswith("✅"):
            passed += 1
            print(line)
        elif line.startswith("❌"):
            failed += 1
            print(line)
    if rc != 0 and failed == f0:
        failed += 1
        print(f"❌ ai_glue.mjs 退出码 {rc}")
        print("\n".join(out.splitlines()[-15:]))
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
