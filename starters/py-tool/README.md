# py-tool —— 零依赖 Python 批处理模板

Owner: @<handle>（`new-app.sh` 复制进 `apps/<模块>/` 后填负责人）

**用途**：数据处理、批量调付费 API、生成素材。只用标准库，系统自带的 `python3`（3.9+）直接能跑。
把一个目录或一串文件逐项交给「平台适配器」处理，产物写 `out/`，日志写 `logs/`。

🔒 **默认只试算（dry-run），不调用、不花钱、不写 `out/`；加 `--run` 才真的调用。**
🔒 key 只从环境变量读，任何输出和日志都只写「已设置 / 未设置」，绝不打印值。

## 命令

```bash
python3 tool.py --check                            # ① 先自检：环境变量、连通性、余额（后两项是占位）
python3 tool.py data/                              # ② 默认 dry-run：列出要做什么、预计调用次数和花费
python3 tool.py data/ --run --limit 1              # ③ 先真跑 1 条看看
python3 tool.py data/ --run                        # ④ 全量跑；中断了重跑同一条命令就续跑
python3 tool.py data/ --run --platform example     # 切真平台（先填 ExampleAdapter 里的 TODO）
bash test.sh                                       # 测试，最后一行「N passed, M failed」
```

- 不给输入时用内置 3 条示例，`python3 tool.py` 零准备就能看到完整流程。
- 输入可以是目录（只取第一层、跳过隐藏文件）或文件列表；产物是 `out/<文件名>.json`。
- 已有产物就跳过：想重做某条，删掉它的 `out/*.json` 再跑。
- 进度逐条打印 `[i/N] 阶段 名称 … ✅ 耗时`；连续失败 3 次自动停下（多半是 key 或配置错了，别把额度烧光）。
- 退出码：`0` 成功 / `1` 有条目失败或自检有 ❌ / `2` 用法错误（参数、输入不存在、重名、缺 key）。

## 需要哪些环境变量（只写名字，值找 lead 要，别发群）

| 变量 | 什么时候要 | 没有值时 |
|---|---|---|
| `EXAMPLE_API_KEY` | `--platform example` 真跑时 | mock 平台照常跑；`--check --platform example` 报 ❌ |

接新平台时：在这里加一行，同时在根目录 `.env.example` 加变量名（写清用途 / 模块 / 申请入口 / 额度归谁）。

## 接一个真平台

1. 复制 `tool.py` 里的 `ExampleAdapter`，改 `name`、`API_BASE`、`cost_per_call`（dry-run 用它估算花费）。
2. 填 `_request` / `call` / `check` 里的 TODO，改完把 `READY` 改成 `True`，再加进 `ADAPTERS`。
3. 先 `--check`，再 dry-run，再 `--run --limit 1`，看一眼 `out/` 里的结果再全量跑。
4. 每次花钱记进 `docs/3-tasks.md` 的额度台账；实测的响应格式、限流、价格写进模块 README 的「外部 API」节。

## 要装依赖时

默认零依赖。真要装，先在 decisions 里写理由，然后用 uv，版本锁死在 `requirements.txt`：

```bash
uv venv .venv && uv pip install -r requirements.txt   # .venv/ 已 gitignore
source .venv/bin/activate
```

## 结构

| 文件 | 一句话 |
|---|---|
| `tool.py` | 入口：argparse、dry-run / `--run` / `--check`、平台适配器、跳过与续跑 |
| `tests/test_tool.py` | 零依赖断言：dry-run 不写 out/、续跑、mock 格式、key 不外泄 |
| `test.sh` | 测试入口：缺计数行或退出码非 0 都算失败 |
| `requirements.txt` | 默认为空；有依赖就锁定版本 |
| `out/` | 产物（gitignore，运行时生成） |
| `logs/` | 日志 `tool.log`（gitignore，运行时生成） |
