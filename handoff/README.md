# 交接单 —— 唯一定义

没有权限改共享文件时，交接单是唯一的回写通道。换人、换会话、睡前、context 快满，都要写。
一句话：**只存在于对话里的东西，等于不存在。**

## 什么时候写

睡前 · 换人 · 换会话 · context 快满 · 离开超过 1 小时 · 任务做完 · 每个集成点之前

## 命名

`handoff/<handle>-T<n>-<MMDD-HHMM>.md`，全 ASCII，任务号必须写（方便 `ls handoff/*T3*`）。
**每次新建，不改旧单**，多人同时写也不冲突。

## 四节模板（复制下面，节名固定，`check.sh [8]` 会查）

```markdown
# T<n> <任务名> —— 交接

## 1. 事实
- 做了什么：
- 停在哪（带时间）：
- 分支 / PR：
- 验证：`bash scripts/check.sh --quick` → `======== 汇总 0 ❌ 1 ⚠️`
- 尚未验证：
- 本次花了多少钱：0

## 2. 要改的共享文件（我没权限，lead 落实）
| 文件 | 哪一节 / 哪一行 | 改成什么 |
|---|---|---|
| | | |

## 3. 留给 lead
- 需要拍板：
- 风险：
- 需要别人配合：
- 中途想到的别的事：

## 4. 下一步
- 下一个人要敲的第一条命令：
- dev server 的名字（launch.json）：
```

## 生命周期

随分支进 PR → 接手的人 `gh pr checkout <号>` 后先读 → lead 落账后 `git mv handoff/<文件> handoff/done/`（目录已存在），**不删除**。
目标：每轮集成结束后 `handoff/` 根目录只剩这份 README。

## 🔒 不许写

key、token、密码、账号、邮箱、学号、主办方内部材料，也不贴大段对话原文。

## 示例（虚构）

```markdown
# T3 房间列表 —— 交接

## 1. 事实
- 做了什么：/api/rooms 接口 + 前端列表页，轮询 3 秒
- 停在哪（09-27 02:10）：列表能显示，点进房间还是 404
- 分支 / PR：alice/web/T3-rooms · PR #12（draft）
- 验证：`bash scripts/check.sh --quick` → `======== 汇总 0 ❌ 0 ⚠️`
- 尚未验证：手机端样式
- 本次花了多少钱：0

## 2. 要改的共享文件
| 文件 | 哪一节 | 改成什么 |
|---|---|---|
| docs/contract.md | HTTP API | 加一行 `GET /api/rooms` |

## 3. 留给 lead
- 需要拍板：房间列表要不要显示人数（涉及裁剪）
- 中途想到的：README 里端口表少了 web

## 4. 下一步
- `gh pr checkout 12 && bash scripts/check.sh --quick`
- dev server：`web`
```
