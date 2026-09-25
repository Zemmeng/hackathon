<!--
标题格式 / Title：<模块>: 做了什么 —— 为什么
  例：lobby: 加入房间后显示在线人数 —— 评委要能一眼看出是多人实时
  改了契约（docs/contract.md）的 PR，标题以 contract: 开头
不用 AI 的同学：这份模板就是你的交接单 —— 交接四节（事实 / 要改的共享文件 / 留给 lead / 下一步）
  分别对应下面的「改了什么 + 怎么验证的 + 还没做的」「要改的共享文件」「还没做的」「下一步」，写在这里就行，不必另建 handoff/ 文件。
🔒 不写任何 key、token、密码、账号、邮箱、学号。
-->

## 关联任务 / Related task

- 任务 / Task：T<!-- 编号，对应 docs/3-tasks.md -->
- 交接单 / Handoff：<!-- handoff/<handle>-T<n>-<MMDD-HHMM>.md，没有就写「无」 -->

## 改了什么 / What changed

<!-- 用户能看到的效果，一两句 -->

## 为什么 / Why

<!-- 解决什么问题 / 对应哪条需求或 decision -->

## 怎么验证的 / How it was verified

<!-- 命令 + 汇总行原文，直接粘贴，别概括。例：
     $ bash scripts/check.sh --quick
     ======== 汇总 0 ❌ 1 ⚠️
     UI 改动：附桌面和 375px 两张截图 / UI changes: attach desktop + 375px screenshots -->

```
$ 
```

## 还没做的 / 尚未验证的 · Not done / not yet verified

<!-- 没有就写「无」。不确定的也写上，别让 reviewer 猜；要 lead 拍板的事也写这里 -->

## 要改的共享文件（我没权限，lead 落实）/ Shared files to change (lead applies)

<!-- 没有就写「无」。只写要改成什么，自己不改 -->

| 文件 / File | 哪一节 / Section | 改成什么 / Change to |
|---|---|---|
|  |  |  |

## 下一步（下一个人要敲的第一条命令）/ Next step (first command for whoever picks this up)

```
$ 
```

## 自查 / Self-check

- [ ] 只改了本模块和公共区（否则已 @lead，或已请 lead 打 `cross-module` 标签）/ Only touched my module + shared area (otherwise @lead or `cross-module` label)
- [ ] `bash scripts/check.sh --quick` 全绿（汇总行已贴在上面）/ check --quick is green (summary line pasted above)
- [ ] 没有 key、token 或个人信息（包括截图和日志里）/ No keys, tokens or personal info (incl. screenshots and logs)
- [ ] 契约没变（变了的话标题以 `contract:` 开头）/ Contract unchanged (otherwise title starts with `contract:`)
- [ ] 对外文案（页面文字、pitch、提交材料）已给人过目 / Public-facing copy reviewed by a human

## AI 协作 / AI collaboration

<!-- 用了什么工具（Claude Code / Codex / Cursor / 没用）；是否派了 subagent、几个；有没有起 Workflow
     Tools used; whether subagents were spawned and how many; any Workflow -->
