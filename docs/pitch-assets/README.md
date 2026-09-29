# pitch 素材

只放 **< 500KB** 的图和 PDF：截图、架构图、slides 导出的 PDF、提交成功页截图。
命名 `NN-说明.png`（例 `01-首页.png`）。

- 视频不入库：放网盘或 unlisted 链接，写进 `hackathon.conf` 的 `VIDEO_URL`
- 原图 / 录屏原片放 `assets-src/` 或 `out/`（已 gitignore）
- 由 pitch owner 维护

## 架构图 `03-architecture-*`（初筛 PDF 第 3 页）

- 源文件 `03-architecture.html`：浏览器打开就是图（中文），地址后面加 `?lang=en` 是英文版。给评审用英文版
- 改字：只改 `<script>` 里 `t('英文', '中文')` 的两段文字；框的位置和大小是旁边的数字，字多了会出框，改完打开看一眼
- 导出 PDF：浏览器打印 → 目标「另存为 PDF」→ 边距「无」→ 勾上「背景图形」，页面大小是 16:9；覆盖同名的 `-en.pdf` / `-zh.pdf`
- 导出 PNG（可选）：截图整张图，存成 `-en.png` / `-zh.png`，保持 < 500KB
- 谁都能改：开 `<handle>/pitch/T<n>-arch` 分支（模块段写 `pitch`），`check [3]` 放行 `docs/pitch-assets/`

## 架构图 SVG 版 `03-architecture-rippletwin-en.svg`

- 1920×1080 英文，文字、框、箭头都是矢量，能在 Figma / Illustrator / 浏览器里直接改字（不是贴图）
- 字体：Inter + Source Serif 4（Google Fonts，OFL 授权）。浏览器打开时在线加载，没网或在编辑器里退回 Charter / Georgia + Helvetica / Arial，两套都量过不出框。**第三方素材要在提交里列出**
- 2026-09-29 按 D-0929-2307 和 main 更新：LLM 读屏 + 规则兜底、真实 CBD 叠加与错开、公交电车和行人影响、规则顾问、3 套设备方案比较与一页导出均标 working。状态指已实现的功能，不表示每次读取都现场调用 LLM；演示也使用预计算读数。顾问仍明确标为规则版。
- 可复现源文件：`gen_arch.py`。从仓库根运行 `python3 docs/pitch-assets/gen_arch.py docs/pitch-assets/03-architecture-rippletwin-en.svg`；加 `--test` 为文字添加容器标记，加 `--fallback` 检查 Georgia / Arial。改图优先改生成脚本，避免下次生成覆盖手工修改。
- 本版 Inter / Source Serif 4 与 Georgia / Arial 均已渲染检查：74 段可编辑文字，越界、文字互相遮挡、箭头压字均为 0；主线为深色实线，规则顾问闭环为紫色实线。
