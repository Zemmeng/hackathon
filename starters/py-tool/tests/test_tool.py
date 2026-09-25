#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/test_tool.py —— tool.py 的零依赖测试（只用标准库，兼容 python3 3.9）

用途：守住模板的硬约定 —— dry-run 不写 out/、续跑跳过已有产物、mock 输出格式、
      key 未设置时 --check 的返回、key 的值绝不出现在输出和日志里。
用法：python3 tests/test_tool.py        （从任意目录都能跑；一般通过 bash test.sh 调）
退出码：0 全部通过；1 有失败。最后一行固定是「N passed, M failed」。
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback

sys.dont_write_bytecode = True  # 别在仓库里留 __pycache__
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOL = os.path.join(ROOT, "tool.py")
sys.path.insert(0, ROOT)
import tool  # noqa: E402

KEY_ENV = tool.KEY_ENV
# 假值现拼出来：不写成 key=长字符串 的样子，免得秘密扫描误报
SENTINEL = "zz" + "sentinel" + "4242"

PASSED = 0
FAILED = 0


def ok(cond, name, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print("  ✅ " + name)
    else:
        FAILED += 1
        print("  ❌ " + name + (("  —— " + detail) if detail else ""))


def eq(actual, expected, name):
    ok(actual == expected, name, "期望 %r，实际 %r" % (expected, actual))


def run(args, key=None):
    """用子进程跑 tool.py（和真实用法一致）。默认清掉 key，避免吃到本机环境变量。"""
    env = dict(os.environ)
    env.pop(KEY_ENV, None)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    if key is not None:
        env[KEY_ENV] = key
    p = subprocess.run([sys.executable, TOOL] + args, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, universal_newlines=True, env=env, timeout=60)
    return p.returncode, p.stdout


class Sandbox(object):
    """每个用例一个临时目录：in/ 放 3 个输入 + 1 个隐藏文件，out/ logs/ 由 tool.py 自己建。"""

    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="pytool-test-")
        self.inp = os.path.join(self.root, "in")
        self.out = os.path.join(self.root, "out")
        self.logs = os.path.join(self.root, "logs")
        os.makedirs(self.inp)
        for name, text in [("a.txt", "alpha\nsecond line\n"), ("b.md", "# 标题\n正文"), ("c.txt", "")]:
            with open(os.path.join(self.inp, name), "w", encoding="utf-8") as fh:
                fh.write(text)
        with open(os.path.join(self.inp, ".hidden"), "w") as fh:
            fh.write("不该被处理")

    def args(self, *extra):
        return [self.inp, "--out", self.out, "--logs", self.logs] + list(extra)

    def outputs(self):
        if not os.path.isdir(self.out):
            return []
        return sorted(f for f in os.listdir(self.out) if not f.startswith("."))

    def log_text(self):
        path = os.path.join(self.logs, "tool.log")
        if not os.path.exists(path):
            return ""
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


# ---------------------------------------------------------------- 用例

def test_dry_run_writes_nothing(sb):
    rc, out = run(sb.args())
    eq(rc, 0, "dry-run 退出码 0")
    ok("dry-run" in out, "输出里标明 dry-run")
    ok(not os.path.exists(sb.out), "dry-run 不创建 out/", sb.outputs())
    ok("预计调用 3 次" in out, "预计调用次数 = 3", out)
    ok("预计花费" in out, "打印预计花费占位")
    ok(".hidden" not in out, "跳过隐藏文件")


def test_default_demo_items(sb):
    rc, out = run(["--out", sb.out, "--logs", sb.logs])
    eq(rc, 0, "不给输入也能 dry-run")
    ok("[3/3]" in out, "内置 3 条示例")
    ok(not os.path.exists(sb.out), "内置示例 dry-run 也不写 out/")


def test_run_mock_output_format(sb):
    rc, out = run(sb.args("--run"))
    eq(rc, 0, "--run mock 退出码 0")
    eq(sb.outputs(), ["a.txt.json", "b.md.json", "c.txt.json"], "每个输入一个产物")
    with open(os.path.join(sb.out, "a.txt.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    for k in ("item", "source", "platform", "created_at", "elapsed_s", "result"):
        ok(k in data, "产物含字段 %s" % k)
    eq(data["platform"], "mock", "platform = mock")
    eq(data["item"], "a.txt", "item = 文件名")
    eq(data["result"]["lines"], 2, "mock 结果 lines 正确")
    ok(data["result"]["text"].startswith("[mock] a.txt:"), "mock 结果 text 以 [mock] 开头", data["result"]["text"])
    ok(re.search(r"^\[\d+/3\] 调用 \S+ … ✅ \d+\.\d+s", out, re.M) is not None, "进度行格式 [i/N] 阶段 … 耗时", out)
    ok("完成 3 / 跳过 0 / 失败 0" in out, "汇总行计数正确")
    ok("模式=run" in sb.log_text(), "日志写进 logs/tool.log")


def test_mock_adapter_unit(sb):
    r = tool.MockAdapter().call("x", "ab\ncd")
    eq(sorted(r), ["chars", "lines", "summary", "text"], "MockAdapter 返回字段")
    eq(r["chars"], 5, "chars 计数")
    eq(r["summary"], "ab", "summary 取首行")
    eq(tool.MockAdapter().call("x", "")["lines"], 0, "空输入不崩")


def test_resume_skips_existing(sb):
    run(sb.args("--run"))
    before = {f: os.path.getmtime(os.path.join(sb.out, f)) for f in sb.outputs()}
    rc, out = run(sb.args("--run"))
    eq(rc, 0, "重跑退出码 0")
    eq(len(re.findall(r"^\[\d/3\] 跳过 ", out, re.M)), 3, "3 条都跳过")
    ok("实际调用 0 次" in out, "重跑不产生调用", out)
    after = {f: os.path.getmtime(os.path.join(sb.out, f)) for f in sb.outputs()}
    eq(after, before, "已有产物没被改写")


def test_resume_partial(sb):
    run(sb.args("--run"))
    os.remove(os.path.join(sb.out, "b.md.json"))
    rc, out = run(sb.args())
    ok("预计调用 1 次" in out, "dry-run 只算缺的那 1 条", out)
    rc, out = run(sb.args("--run"))
    ok("实际调用 1 次" in out, "续跑只补缺的那 1 条", out)
    ok(os.path.exists(os.path.join(sb.out, "b.md.json")), "缺的产物补回来了")


def test_limit(sb):
    rc, out = run(sb.args("--run", "--limit", "1"))
    eq(rc, 0, "--limit 退出码 0")
    eq(len(sb.outputs()), 1, "--limit 1 只产出 1 个")
    ok("暂缓" in out, "超出 limit 的条目标为暂缓")


def test_check_key_unset(sb):
    rc, out = run(["--check", "--logs", sb.logs])
    eq(rc, 0, "mock 平台 key 未设置：--check 退出码 0（只 ⚠️）")
    ok("未设置" in out and "⚠️" in out, "mock 平台提示未设置", out)
    rc, out = run(["--check", "--platform", "example", "--logs", sb.logs])
    eq(rc, 1, "example 平台 key 未设置：--check 退出码 1")
    ok("❌" in out and "未设置" in out, "example 平台报 ❌ 未设置", out)
    ok(re.search(r"^======== 自检 1 ❌", out, re.M) is not None, "自检汇总行", out)


def test_key_never_printed(sb):
    rc, out = run(["--check", "--platform", "example", "--logs", sb.logs], key=SENTINEL)
    eq(rc, 0, "key 已设置：example --check 退出码 0（连通性/余额只是 ⚠️ 占位）")
    ok("已设置" in out, "只打印『已设置』")
    ok(SENTINEL not in out, "--check 输出里没有 key 的值")
    rc, out = run(sb.args("--run", "--platform", "example"), key=SENTINEL)
    ok(SENTINEL not in out, "--run 输出里没有 key 的值")
    ok(SENTINEL not in sb.log_text(), "日志里没有 key 的值")


def test_example_platform_guards(sb):
    rc, out = run(sb.args("--run", "--platform", "example"))
    eq(rc, 2, "example 缺 key 时 --run 退出码 2")
    eq(sb.outputs(), [], "缺 key 不产出任何文件")
    rc, out = run(sb.args("--run", "--platform", "example"), key=SENTINEL)
    eq(rc, 1, "example 网络还是 stub：--run 记为失败，退出码 1")
    eq(sb.outputs(), [], "stub 失败不留半截产物")
    ok("NotImplementedError" in out, "失败原因打印出来", out)


def test_consecutive_fail_stops(sb):
    for i in range(3):
        with open(os.path.join(sb.inp, "z%d.txt" % i), "w") as fh:
            fh.write("x")
    rc, out = run(sb.args("--run", "--platform", "example"), key=SENTINEL)
    ok("连续失败 3 次" in out, "连续失败 3 次就停", out)
    ok("[4/6]" not in out, "停下后不再调用后面的条目", out)


def test_usage_errors(sb):
    rc, out = run([os.path.join(sb.root, "nope"), "--logs", sb.logs])
    eq(rc, 2, "输入不存在 → 退出码 2")
    rc, out = run(["--run", "--check", "--logs", sb.logs])
    eq(rc, 2, "--run 和 --check 互斥 → 退出码 2")
    other = os.path.join(sb.root, "other")
    os.makedirs(other)
    shutil.copy(os.path.join(sb.inp, "a.txt"), other)
    rc, out = run([sb.inp, other, "--out", sb.out, "--logs", sb.logs])
    eq(rc, 2, "两个目录里有同名文件 → 退出码 2")
    ok("重名" in out, "提示重名", out)


TESTS = [
    test_dry_run_writes_nothing,
    test_default_demo_items,
    test_run_mock_output_format,
    test_mock_adapter_unit,
    test_resume_skips_existing,
    test_resume_partial,
    test_limit,
    test_check_key_unset,
    test_key_never_printed,
    test_example_platform_guards,
    test_consecutive_fail_stops,
    test_usage_errors,
]


def main():
    global FAILED
    for t in TESTS:
        print("● " + t.__name__, flush=True)
        sb = Sandbox()
        try:
            t(sb)
        except Exception:  # 用例崩了算 1 个失败，别让整个文件崩掉而丢了计数行
            FAILED += 1
            print("  ❌ 用例异常：")
            traceback.print_exc(file=sys.stdout)
        finally:
            sb.close()
        sys.stdout.flush()
    print("%d passed, %d failed" % (PASSED, FAILED))
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
