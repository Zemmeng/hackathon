# T2 网页面板（RippleTwin GIS + 极端天气 + 四步流程）—— 交接

## 1. 事实
- 做了什么：新建模块 `apps/web`，一个单文件网页走完「方案 → 压力测试 → 涟漪追踪 → 修复」四步。地图是自绘 GIS：深色主题用正射影像（另有近红外假彩色），浅色主题自动换浅色矢量街道图；六种天气图层（雷达 dBZ、SAR 淹没深度、雾能见度、地表温度、风场粒子），带等值线、图例、鼠标取值；多智能体仿真（IDM 跟驰、信号相位、TTC 冲突）驱动第 2 步自动触发 C-17 × D-42 严重冲突；第 4 步修复前后滑动对比；中 / 英一键切换。
- 停在哪（09-29 14:40）：功能完整，已在浏览器里跑过；还没接 `apps/roads` 的真实路网和 T4 的计算结果，数字是模拟 / 预设值
- 分支 / PR：`unicornnnnnny/web/T2-gis-weather-ui` / PR 见本分支
- 验证：`bash scripts/check.sh --quick` → 见 PR 描述里的汇总行；`bash apps/web/test.sh` → `27 passed, 0 failed`
- 尚未验证：线上（Cloudflare）部署；Safari 上的 canvas pattern 变换（雾图层用了 `CanvasPattern.setTransform`）
- 本次花了多少钱：0

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| `apps/README.md` | 模块登记表 | 加一行：`web` · @unicornnnnnny · 没用 starter（单文件静态页）· 4175 · — |
| `.github/CODEOWNERS` | 模块区 | 加 `/apps/web/                    @unicornnnnnny` |
| `.claude/launch.json` | configurations | 加 `web`：`python3 -m http.server 4175 -d apps/web/public` |
| `hackathon.conf` | `DEPLOY_MODULES` | 需要上线时加 `web`（静态目录 `apps/web/public`） |

## 3. 留给 lead
- 需要拍板：R3 里 `apps/web` 原计划由 lead 建空架子，这次由 T2 分支直接建了模块目录，登记表 / CODEOWNERS 请按第 2 节补上
- 风险：修复方案的「护栏西移 8 m」与早先 Figma 稿写的「东移 12 m」不同，页面和测试以西移 8 m 为准
- 需要别人配合：T4（路网计算）出结果后，把延误 / 冲突数接进第 2、4 步替换预设值
- 中途想到的别的事：第 3 步的因果链可以直接当 pitch 的一页

## 4. 下一步
- 下一个人要敲的第一条命令：`python3 -m http.server 4175 -d apps/web/public`
- dev server 的名字（launch.json）：暂无（等 lead 按第 2 节加 `web`）
