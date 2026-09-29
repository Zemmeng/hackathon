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
