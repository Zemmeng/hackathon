# RippleTwin 施工规划交互模板

这里保存面向企业与市政的前端流程示意，供团队评审和后续实现参考。

## 预览版本

| 版本 | 打开文件 | 用途 |
| --- | --- | --- |
| 全地图底板 · 液态玻璃工作台 | [map-glass-workbench.html](map-glass-workbench.html) | 当前版本，与 Sites 已上线页面逐字节一致。地图铺满底层，六步功能置于可收起的玻璃工作台内，导航、工具与时间轴悬浮在地图上。 |
| 现有前端风格 · 地图与侧栏 | [current-ui-flow.html](current-ui-flow.html) | 保留上一轮概念稿，供对比布局。 |
| 独立横版概念稿 | [landscape.html](landscape.html) | 保留上一轮横向工作台，用来对比布局；五步流程，地图与操作表单并排。 |
| 最初上传原版 | [index.html](index.html) | 原样归档最初发布的上传文件，便于追溯。 |

完整横版流程为：**路况总览 → 配置施工 → 仿真评估 → 影响分析 → 比较方案 → 确认导出**。流程没有合并为单页表单：

- 路况总览：地图、当前数据说明、新建维修方案、历史案例入口。
- 配置施工：施工信息、设备诱导、约束目标三个完整页签。
- 仿真评估：情景范围、开始评估、运行状态、原方案与候选 B 回放、时间轴和运行记录。
- 影响分析：交通影响、施工叠加、数据依据与假设分别查看。
- 比较方案：原方案、A、B 的交通指标、费用、通行条件，配套推荐理由、权衡与选定入口。
- 确认导出：所选方案、评估摘要、设备费用、选定理由、报告与清单导出选项。

当前版本的地图覆盖整个工作区，玻璃工作台悬浮在上方；长内容在工作台内滚动，底部操作按钮持续可用，六步与各页签均完整保留。工作台可以收起以查看地图，独立页面已解除原导出文件的 736px 宽度上限。设计控件在支持的对话环境中可切换面板左右位置，以及表格 / 完整卡片对比。

当前版本的可编辑片段为 [fragments/map-glass-workbench.html](fragments/map-glass-workbench.html)。前两轮源文件也保留在 `fragments/` 中。同名的上层 HTML 为带沙盒的独立预览；更新片段后需重新导出，避免两者版本不一致。

[Sites 当前生产预览](https://rippletwin-workflow-preview.ming0618q.chatgpt.site) 为全地图与玻璃工作台版本，当前为私有访问，需要相应权限。所有版本均为设计示意。

## 已发布原版的完整性

`index.html` 原样保存用户于 2026-09-30 上传并发布到 Sites 的 `rippletwin-workflow-preview.html`，只调整存放路径和文件名。没有改写页面内容、脚本、沙盒 iframe 或 CSP。

- 文件大小：140,351 字节。
- SHA-256：`437c51981201ef2db84d36bcb7fd5008d819f7ea80c582ff3447e240834f52e5`。
- 保留 `sandbox="allow-scripts"`、`referrerpolicy="no-referrer"`，以及父页面和 iframe 内的 Content Security Policy。

## 本地查看 / Quick start

在仓库根目录运行：

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory apps/web/templates/workflow-preview
```

然后打开 <http://127.0.0.1:8080/map-glass-workbench.html>。历史版本分别是 `/current-ui-flow.html`、`/landscape.html` 和 `/index.html`。无需安装依赖或构建。页面使用的外部 CDN 资源受 CSP 限制，加载这些资源需要网络。

Run the command above from the repository root, then open the local URL. No dependency installation or build is required.

## 使用边界

地图、交通指标、费用和推荐理由均为示意数据；这些模板未接入 SUMO、真实路况或生产后端。输入会保留在预览内，但不会重新计算交通指标。天气与图层控制仅演示界面变化，导出按钮演示交互，不生成实际评估文件。

此目录用于保存设计参考，未加入主站构建与部署入口。本次 GitHub 归档没有修改正在使用的前端。后续集成时应另行实现地图与数据接入、计算、输入验证、审批记录和真实导出。
