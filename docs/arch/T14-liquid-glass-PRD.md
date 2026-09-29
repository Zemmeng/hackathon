# T14 网页改「液态玻璃」风格 PRD

> 负责人：@unicornnnnnny（高h）· 模块：`apps/web/` · 分支：`unicornnnnnny/web/T14-liquid-glass` · 写于 2026-09-29 17:20（lead）
> 依据：lead 原话「让高h改液态玻璃风格」；D-03（零构建，不加库）；T13 已把第 1/3/4 步接上引擎（PR #43），这一单只动外观

## 1. 为什么

页面现在的 `.glass` 是一层平的毛玻璃。演示和 pitch 截图要更像一个成熟产品：用 Apple 的 Liquid Glass（WWDC 2025）那套视觉语言，让浮在地图上的控件看起来像一块有厚度、会折射底下地图的玻璃。**只改外观，不改功能和数字。**

## 2. 液态玻璃长什么样（落到 CSS）

| 特征 | 怎么做 |
|---|---|
| 半透明、透出并「折射」底下的地图 | `backdrop-filter: blur(14–24px) saturate(160–180%)`；只给地图上浮着的 HUD 加（见第 4 节性能） |
| 边缘有高光、像玻璃的厚度 | 多层 `box-shadow`：顶部 1px 内高光（`inset 0 1px 0 rgba(255,255,255,.5)`）、底部内暗边、外面一层柔和投影；1px 渐变描边（`border` 用半透明白 + `mask` 或伪元素） |
| 大圆角、胶囊形控件 | 面板 16–22px 圆角；按钮、chips、分段控件用胶囊（`border-radius: 999px`） |
| 颜色随底下内容变 | 玻璃本身只带很淡的色调（`--glass-tint`），深 / 浅两套主题各一份 |
| （可选）真折射 | 只给 1–2 个主面板试 SVG `feDisplacementMap` 做边缘弯折；只有 Chrome 支持 `backdrop-filter: url()`，其他浏览器退回普通模糊，不许因此白屏 |

新颜色一律写成 `:root` 里的 token（在现有 `--glass` `--glass-line` 旁边加 `--glass-hi` `--glass-edge` `--glass-tint` 之类），深色、浅色（`prefers-color-scheme` 和 `[data-theme]` 两处）都要写。

## 3. 范围

| 改 | 不改 |
|---|---|
| `src/styles.css`：`.glass`（地图上的 HUD：场景信息、天气、底图切换、缩放、图例、取值条、告警、提示）、顶栏、步骤条、左侧图层栏、右侧面板里的卡片（`.card .metric .list .table .eng-*`）、按钮、chips、分段控件、时间轴 | `src/js/*.js` 的逻辑和数字；地图 canvas 的画法 |
| `src/body.html` 只在需要多包一层元素做高光时改 | `id`、`data-*`、JS 用到的 class 名（改名会让 JS 找不到元素） |
| 需要的话 `src/js/5-app.js` / `6-engine.js` 模板里加 class | 中英文案（新文案照旧 `L('英','中')`） |

VMS 输入框保持「黑底琥珀字」的 LED 屏样子（它模拟的是路边的屏），外框可以玻璃化。

## 4. 约束

- **可读性**：玻璃上的文字对比度 ≥ 4.5:1，在最花的底图（近红外、雷暴图层）上也要看得清；文字底下的玻璃色调要够（面板建议不透明度 ≥ 0.72）
- **无障碍**：`@media (prefers-reduced-transparency: reduce)` 退回实色面板；`@media (prefers-reduced-motion: reduce)` 不做会动的高光；`@supports not (backdrop-filter: blur(1px))` 也退回实色
- **性能**：地图每帧重画，`backdrop-filter` 只给地图上浮着的那几个 HUD（约 8 个），右侧面板、列表行、按钮不要逐个加模糊。改完在 1440×900 打开第 2 步（仿真最忙），DevTools Performance 看帧率 ≥ 50 fps
- 不加库、不加外部资源（字体仍只用 Google Fonts），D-03
- 手机 375px：不能横向滚动；深浅两套主题都要好看

## 5. 验收

1. 改了 `src/` 就跑 `python3 apps/web/build.py`
2. `bash apps/web/test.sh` 全绿（65 条；外观改动不应该让任何一条变红）、`bash scripts/check.sh --quick` 无 ❌
3. preview 起 `site`（8790，带引擎），开 `/web/public/`，截图：桌面 1440 和 375px × 深 / 浅主题 × 第 1、3、4 步，放进 PR 描述
4. 开 PR，lead 合并后部署

## 6. 时间盒

2h。先做最显眼的：地图上的 HUD + 右侧面板卡片 + 按钮 / chips；再做顶栏、图层栏、时间轴。

开工：

```bash
git switch main && git pull
git switch -c unicornnnnnny/web/T14-liquid-glass origin/main
```
