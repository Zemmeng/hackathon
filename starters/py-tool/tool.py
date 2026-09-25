#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tool.py —— 零依赖批处理脚本模板（批量调付费 API / 处理数据 / 生成素材）

用途：把一个目录或一串文件逐项交给「平台适配器」处理，产物写到 out/，日志追加到 logs/tool.log。
      🔒 默认只试算（dry-run），不调用、不花钱、不写 out/；加 --run 才真的调用。
      已有产物就跳过：中断后重跑同一条命令即可续跑。

用法：
  python3 tool.py --check                           # 自检：环境变量、连通性（占位）、余额（占位）
  python3 tool.py                                   # dry-run，用内置 3 条示例输入
  python3 tool.py data/                             # dry-run：列出要做什么、预计调用次数和花费
  python3 tool.py data/ --run                       # 真的跑（默认 mock 平台，不联网、不花钱）
  python3 tool.py a.txt b.txt --run --limit 1       # 先只跑 1 条看看
  python3 tool.py data/ --run --platform example    # 真平台（先填 ExampleAdapter 里的 TODO）

退出码：0 成功；1 有条目失败 / 自检有 ❌；2 用法错误（参数不对、输入不存在、重名、缺 key）；130 被 Ctrl-C 中断

兼容系统自带 python3 3.9：不用 match、不用 `X | Y` 类型标注，只用标准库。
key 只从环境变量读（EXAMPLE_API_KEY），任何输出和日志都只写「已设置 / 未设置」，绝不写值。
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "out")    # 产物（已 gitignore）
DEFAULT_LOGS = os.path.join(HERE, "logs")  # 日志（已 gitignore）
KEY_ENV = "EXAMPLE_API_KEY"                # 只写变量名；值放 .env / 密码管理器

OK, FAIL, WARN = "✅", "❌", "⚠️"
MAX_CONSECUTIVE_FAIL = 3  # 连续失败这么多次就停：多半是 key / 配置错了，别把额度烧光

# 没给输入时用的内置示例：让 `python3 tool.py` 零准备就能看到完整流程
DEMO_ITEMS = [
    ("demo-1", "第一条示例输入：你好，hackathon。"),
    ("demo-2", "第二条示例输入\n多行文本也可以。"),
    ("demo-3", "third demo item, plain ascii."),
]


class UsageError(Exception):
    """用法错误 → 退出码 2"""


# ---------------------------------------------------------------- 日志

class Log(object):
    """屏幕 + logs/tool.log 双写。每条立即 flush：长任务中途也能看到进度。"""

    def __init__(self, log_dir):
        os.makedirs(log_dir, exist_ok=True)
        self.path = os.path.join(log_dir, "tool.log")
        self.fh = open(self.path, "a", encoding="utf-8")

    def file(self, msg):
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for line in str(msg).splitlines() or [""]:
            self.fh.write(stamp + " " + line + "\n")
        self.fh.flush()

    def __call__(self, msg=""):
        print(msg, flush=True)
        self.file(msg)

    def close(self):
        self.fh.close()


# ---------------------------------------------------------------- 平台适配器
# 接新平台：复制 ExampleAdapter，改 name / cost_per_call，填 TODO，再加进下面的 ADAPTERS。
# 适配器只管「一条输入 → 一个 dict」；跳过、续跑、进度、写文件都由 process() 统一处理。

class Adapter(object):
    name = "base"
    needs_key = False     # True：--run 前必须设置 KEY_ENV
    cost_per_call = 0.0   # 每次调用的预计花费（美元），dry-run 用它估算；占位，按平台价目表改

    def check(self):
        """自检，返回 [(项目, 状态, 说明)]，状态是 OK / FAIL / WARN。"""
        return []

    def call(self, item_name, text):
        """处理一条输入，返回可 JSON 序列化的 dict。出错直接抛异常，由 process() 记为失败。"""
        raise NotImplementedError


class MockAdapter(Adapter):
    """假平台：不联网、不花钱、结果确定。demo 兜底和测试都靠它。"""
    name = "mock"

    def check(self):
        return [
            ("连通性", OK, "mock 平台不联网"),
            ("余额", OK, "mock 平台不花钱"),
        ]

    def call(self, item_name, text):
        lines = text.splitlines()
        first = lines[0].strip() if lines else ""
        return {
            "chars": len(text),
            "lines": len(lines),
            "summary": first[:40],
            "text": "[mock] %s: %d 字符 / %d 行" % (item_name, len(text), len(lines)),
        }


class ExampleAdapter(Adapter):
    """真平台骨架（示例）。网络调用还是 stub：填好 TODO 并把 READY 改成 True 才会真的发请求。"""
    name = "example"
    needs_key = True
    cost_per_call = 0.0                        # TODO: 按平台价目表填（美元/次）
    API_BASE = "https://api.example.com/v1"    # TODO: 换成真实地址
    TIMEOUT_S = 30
    READY = False                              # TODO: 下面的请求格式按平台文档改好后改成 True

    def _key(self):
        return os.environ.get(KEY_ENV, "")

    def _request(self, method, path, payload=None):
        """零依赖 HTTP 调用。key 只放进 header，绝不打印、不写日志、不拼进 URL。"""
        if not self.READY:
            raise NotImplementedError("example 适配器还是 stub：先填 ExampleAdapter 里的 TODO，再把 READY 改成 True")
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.API_BASE + path, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self._key())  # TODO: 按平台要求改 header 名
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=self.TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def check(self):
        if not self._key():
            return [
                ("连通性", WARN, "缺 key，跳过"),
                ("余额", WARN, "缺 key，跳过"),
            ]
        rows = []
        if not self.READY:
            rows.append(("连通性", WARN, "占位：TODO 调一个免费接口（如 GET /models）确认 key 有效"))
        else:
            try:
                self._request("GET", "/models")  # TODO: 换成平台最便宜 / 免费的接口
                rows.append(("连通性", OK, "GET /models 正常"))
            except Exception as e:  # 只打印异常类型，避免把带 key 的请求细节打出来
                rows.append(("连通性", FAIL, "请求失败：%s" % type(e).__name__))
        rows.append(("余额", WARN, "占位：TODO 平台有余额接口就在这里查，没有就去控制台看"))
        return rows

    def call(self, item_name, text):
        data = self._request("POST", "/generate", {"input": text})  # TODO: 改成真实路径和参数
        return {"text": data.get("output", "")}                      # TODO: 按返回结构取字段


ADAPTERS = {
    "mock": MockAdapter,
    "example": ExampleAdapter,
}


# ---------------------------------------------------------------- 输入与产物

def safe_name(name):
    """产物文件名：只留字母数字（含中文）、点、横线、下划线。"""
    return re.sub(r"[^\w.-]+", "_", name).strip("_") or "item"


def collect_items(inputs):
    """输入 → [{"name", "path", "text"}]。目录只取第一层、跳过隐藏文件，按文件名排序。"""
    if not inputs:
        return [{"name": n, "path": None, "text": t} for n, t in DEMO_ITEMS]
    paths = []
    for raw in inputs:
        if os.path.isdir(raw):
            for fn in sorted(os.listdir(raw)):
                full = os.path.join(raw, fn)
                if not fn.startswith(".") and os.path.isfile(full):
                    paths.append(full)
        elif os.path.isfile(raw):
            paths.append(raw)
        else:
            raise UsageError("输入不存在：%s" % raw)
    items, seen = [], {}
    for p in paths:
        name = safe_name(os.path.basename(p))
        if name in seen:
            raise UsageError("产物重名：%s 和 %s 都会写成 out/%s.json，请改名或分两次跑" % (seen[name], p, name))
        seen[name] = p
        items.append({"name": name, "path": p, "text": None})
    return items


def out_path(out_dir, item):
    return os.path.join(out_dir, item["name"] + ".json")


def read_text(item):
    if item["text"] is not None:
        return item["text"]
    # 二进制输入（图片等）在这里改成 "rb"，并相应修改适配器
    with open(item["path"], "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def write_json_atomic(path, obj):
    """先写临时文件再改名：中途被杀不会留下半截产物（否则续跑会误以为已完成）。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def rel(p):
    try:
        return os.path.relpath(p)
    except ValueError:
        return p


# ---------------------------------------------------------------- 三个命令

def cmd_check(adapter, log):
    rows = []
    if os.environ.get(KEY_ENV):
        rows.append(("环境变量 " + KEY_ENV, OK, "已设置"))
    elif adapter.needs_key:
        rows.append(("环境变量 " + KEY_ENV, FAIL, "未设置（值找 lead 要，写进 .env 后 export；别发群）"))
    else:
        rows.append(("环境变量 " + KEY_ENV, WARN, "未设置（%s 平台用不到；切真平台前要设）" % adapter.name))
    rows.extend(adapter.check())
    log("== 自检 平台: %s ==" % adapter.name)
    for i, (what, status, detail) in enumerate(rows, 1):
        log("[%d] %s %s %s" % (i, what, status, detail))
    n_fail = sum(1 for r in rows if r[1] == FAIL)
    n_warn = sum(1 for r in rows if r[1] == WARN)
    log("======== 自检 %d ❌ %d ⚠️" % (n_fail, n_warn))
    return 1 if n_fail else 0


def cmd_process(items, adapter, out_dir, log, run, limit):
    total = len(items)
    mode = "运行" if run else "dry-run（只试算：不调用、不花钱、不写 out/）"
    log("== 阶段 1/3 收集输入：%d 条 · 平台 %s · %s ==" % (total, adapter.name, mode))
    if run and adapter.needs_key and not os.environ.get(KEY_ENV):
        log("❌ 缺环境变量 %s：先跑 python3 tool.py --check --platform %s" % (KEY_ENV, adapter.name))
        return 2

    log("== 阶段 2/3 %s ==" % ("逐条处理" if run else "逐条计划"))
    done = skipped = failed = calls = planned = streak = 0
    t_all = time.time()
    for i, item in enumerate(items, 1):
        dst = out_path(out_dir, item)
        tag = "[%d/%d]" % (i, total)
        if os.path.exists(dst):
            skipped += 1
            log("%s 跳过 %s（已有 %s）" % (tag, item["name"], rel(dst)))
            continue
        if limit is not None and planned >= limit:
            log("%s 暂缓 %s（已到 --limit %d，下次续跑）" % (tag, item["name"], limit))
            continue
        planned += 1
        if not run:
            log("%s 计划 %s → %s" % (tag, item["name"], rel(dst)))
            continue
        # 先打半行再调用：长调用进行中也看得到卡在哪一条
        head = "%s 调用 %s …" % (tag, item["name"])
        print(head, end="", flush=True)
        t0 = time.time()
        calls += 1
        try:
            text = read_text(item)
            result = adapter.call(item["name"], text)
            write_json_atomic(dst, {
                "item": item["name"],
                "source": item["path"] or "builtin",
                "platform": adapter.name,
                "created_at": datetime.now().isoformat(timespec="seconds"),
                "elapsed_s": round(time.time() - t0, 3),
                "result": result,
            })
            done += 1
            streak = 0
            tail = " %s %.2fs → %s" % (OK, time.time() - t0, rel(dst))
        except Exception as e:
            failed += 1
            streak += 1
            tail = " %s %.2fs %s: %s" % (FAIL, time.time() - t0, type(e).__name__, e)
        print(tail, flush=True)
        log.file(head + tail)
        if streak >= MAX_CONSECUTIVE_FAIL:
            log("⏹ 连续失败 %d 次，先停下（多半是 key 或配置问题）；修好后重跑同一条命令会续跑" % streak)
            break

    log("== 阶段 3/3 汇总 ==")
    if not run:
        cost = planned * adapter.cost_per_call
        log("预计调用 %d 次（跳过已有 %d 条），预计花费 ~$%.2f（占位：按平台价目表改 cost_per_call）" % (planned, skipped, cost))
        if adapter.needs_key and not os.environ.get(KEY_ENV):
            log("⚠️ 真跑前要设置环境变量 %s" % KEY_ENV)
        log("确认无误后加 --run 真的执行。")
        return 0
    log("======== 完成 %d / 跳过 %d / 失败 %d · 实际调用 %d 次 · 总耗时 %.2fs" % (
        done, skipped, failed, calls, time.time() - t_all))
    if failed:
        log("失败的条目没有产物，修好后重跑同一条命令只会重试它们。")
    return 1 if failed else 0


# ---------------------------------------------------------------- 入口

def build_parser():
    p = argparse.ArgumentParser(
        description="零依赖批处理模板：默认 dry-run，--run 才真的调用，--check 自检。")
    p.add_argument("inputs", nargs="*", help="输入目录或文件；不给就用内置 3 条示例")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--run", action="store_true", help="真的调用（可能花钱）；不加就是 dry-run")
    g.add_argument("--check", action="store_true", help="自检：环境变量、连通性、余额")
    p.add_argument("--platform", choices=sorted(ADAPTERS), default="mock", help="平台适配器（默认 mock）")
    p.add_argument("--limit", type=int, default=None, help="本次最多处理 N 条待办（先小批试跑）")
    p.add_argument("--out", default=DEFAULT_OUT, help="产物目录（默认脚本目录下 out/）")
    p.add_argument("--logs", default=DEFAULT_LOGS, help="日志目录（默认脚本目录下 logs/）")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.limit is not None and args.limit < 1:
        print("❌ --limit 必须 ≥ 1", file=sys.stderr)
        return 2
    adapter = ADAPTERS[args.platform]()
    log = Log(args.logs)
    mode = "check" if args.check else ("run" if args.run else "dry-run")
    log.file("---- tool.py 模式=%s 平台=%s 输入=%s" % (mode, adapter.name, args.inputs or "内置示例"))
    try:
        if args.check:
            return cmd_check(adapter, log)
        items = collect_items(args.inputs)
        if not items:
            log("⚠️ 输入里没有文件（目录只取第一层、跳过隐藏文件）")
            return 0
        return cmd_process(items, adapter, args.out, log, args.run, args.limit)
    except UsageError as e:
        log("❌ %s" % e)
        return 2
    except KeyboardInterrupt:
        print("", flush=True)
        log("⏹ 已中断：做完的产物都保留了，重跑同一条命令会从断点续跑。")
        return 130
    finally:
        log.close()


if __name__ == "__main__":
    sys.exit(main())
