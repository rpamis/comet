---
name: comet-native
description: 当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用；负责澄清需求、读取状态并推动 Shape → Build → Verify → Archive。
---

# Comet Native

Native 保存需求、完整目标规格、状态和证据。你负责理解、实现和验证；Runtime 负责状态、边界和恢复。

## 核心规则

从 `.comet/config.yaml` 读取：

- `native.clarification_mode`：默认 `sequential`；
- `native.archive_confirmation`：默认 `automatic`；
- `native.max_verify_failures`：默认 `5`。

磁盘中的 config、selection、change 状态和正式产物优先于聊天记忆。不要直接编辑 Runtime 管理的状态、证据、锁或事务文件。

Native 主流程不依赖任何外部 Skill。

## CLI 引导

Native Skill 只使用 PATH 中的公开 `comet native <cmd>` CLI；随 Skill 发布的命令 bundle 属于内部安装与 Runtime 资产，不由 Skill 搜索或直接调用。若命令返回 `command not found`、`executable not found` 或 `ENOENT`，停止并说明 Comet CLI 安装不完整；不得搜索 Skill 文件、枚举平台目录或直接调用内部 bundle。

常用命令：

```bash
comet native status [--json]
comet native show <change-name>
comet native select <change-name>
comet native new <change-name> [--language en|zh-CN]
comet native next <change-name> --summary <text> [--confirmed]
comet native archive <change-name> --dry-run
```

## 开始或恢复

1. 运行 `comet native status`，确认当前 change 和 phase。
2. 对目标运行 `comet native show <change-name>`；Verify、Archive 或失败后的 Build 再对 status 命令加 `--details` 运行。
3. 需要更多 acceptance 时，按 `acceptancePage.nextCursor` 分页；findings 被截断时，先处理已返回项，再重新读取。
4. 确认目标后运行 `comet native select <change-name>`。

存在多个合理候选时让用户选择。只有确认没有对应 active change 时才创建：

```text
comet native new <change-name> \
  --language zh-CN
```

只使用配置指定的 Native artifact root。

## 按需加载

确认当前 change 和 phase 后，再按需读取一份对应 reference：

- 进入 Shape 时，必须先读取并执行[澄清参考](reference/clarification.md)。不得以“需求看起来明确”为由跳过；完成共享理解确认前，不得修改项目实现或推进到 Build。
- 需要高级参数、receipt 或 partial scope 命令时，读取[命令参考](reference/commands.md)。
- 需要编辑 brief、规格或 verification 时，读取[产物参考](reference/artifacts.md)。
- 出现中断、失效证据、repair stop、冲突、锁或迁移问题时，读取[恢复参考](reference/recovery.md)。

## Shape

先调查能从仓库、工具和运行环境查明的事实。只有不同选择会实质改变用户可见结果，并且无法从已有要求可靠确定时，才询问用户；实现方式由你决定。

按 `clarification_mode` 执行澄清参考。即使初步判断没有未决行为，也必须完成其中的信息分类和静默假设检查。每次用户回答后，立即更新同一个 change 的 Decisions、brief 和完整目标规格。未解决项继续以 `[blocking]` 保存；存在阻塞项时不修改项目实现，也不推进阶段。

所有用户决定处理完后，重新检查是否仍有静默假设，并向用户提供目标、范围、关键决定、验收标准和非目标的共享理解摘要。只有用户明确确认后，才移除最终阻塞项并推进：

```text
comet native next <change-name> --summary <摘要> --confirmed
```

brief 或规格改变已确认的行为时，重新取得用户确认；不要手工修改确认状态。

## Build

实现满足 brief 和完整目标规格的最简单可靠方案。可以分批完成；长任务可使用 checkpoint 保存恢复摘要，但 checkpoint 不是完成证据。

需求变化时先更新正式产物。出现新的用户决定时保持在 Build，但重新执行 Shape 的澄清与确认边界：保存 `[blocking]`、暂停实现并询问用户。用户确认后，更新 Decisions、brief 和完整目标规格并移除阻塞项；离开 Build 时执行 Runtime 返回的命令并传入 `--confirmed`。

候选实现完成后，对照完整规格和全部 acceptance 复核是否仍有遗漏，再提供真实项目产物推进：

```text
comet native next <change-name> \
  --summary <摘要> \
  --artifact <项目内路径> \
  [--confirmed]
```

没有代码变化或 Runtime 无法证明完整 scope 时，读取命令参考。不得把未知或不完整范围声明为 complete。

## Completion Loop

进入 Build 后按以下循环收敛：

1. 运行 `comet native status <change-name> --details`，读取当前需要的 acceptance 页；上一轮 Verify 失败时，优先处理 failed/missing acceptance 和 failed check。
2. 完成一批相关的实际修复。需要中断时可以写 checkpoint，但 checkpoint 不是完成证据。
3. 形成候选实现后，重新读取 brief、完整规格和全部 acceptance，执行一次完整审查。
4. 运行真实验证并提交 Verify 结果。
5. `fail` 回到 Build，从第 1 步继续，且不运行 Archive；`pass` 才进入 Archive。

`blocked` 会暂停正常 Build → Verify 循环并进入恢复分支。处理 findings 后，根据新的 continuation 从第 1 步恢复循环。只有 `done`、`await-user` 或调用方明确要求停止时，才结束当前工作。一次 Agent turn、一次 checkpoint、一次 `blocked` 或 Agent 自述“已完成”都不是终态。Agent 负责发现并修复缺口，Runtime 负责判断是否完成。

## Verify

根据 acceptance、完整目标规格和改动风险运行真实验证。用实际结果完成 `verification.md` 和验收证据；未运行或失败的检查不能写成通过。

使用 Runtime 返回的 acceptance ID 和 receipt。需要生成证据块或记录 automated/manual receipt 时，读取产物与命令参考。

只有 Runtime 接受完整且新鲜的验收矩阵和 required checks 时才能提交 `pass`。相关实现、规格、报告或证据改变后重新验证。

`fail` 会回到 Build。先根据 Runtime 返回的 failed/missing acceptance 和 failed check 修复，再重新验证；不要把再次调用 `next` 当作修复。`repair-stagnation-stop` 由 Agent 按恢复参考提出新假设并使用 Runtime 返回的 override；只有 continuation 要求 `repair-continuation-decision` 时才等待用户选择。

Verify 失败的中间循环不运行 Archive，也不触发归档确认。持续执行 Build → Verify，直到 pass、Runtime 阻塞或需要用户决定。

## Archive

只有最终 Verify pass 后才预演：

```text
comet native archive <change-name> --dry-run
```

预演成功后：

- `automatic`：执行 continuation 返回的精确提交命令；
- `required`：向用户展示实现、验证和规格操作摘要，等待用户选择立即归档或保留 change。

不要复用旧 preflight。发生事实漂移、canonical 冲突或未完成事务时，按 continuation 和恢复参考处理。

## Continuation 与停止条件

Shape、Build 和 Verify 的 transition 都会返回 `next: auto | manual`、`continuation.disposition: continue | await-user | blocked | done`、所需输入与下一步动作；Archive 不通过 `next` 推进，归档成功才返回 `done`。每次 transition 后按该 Runtime continuation 行动：

- `continue`：重新读取 phase 和当前所需产物后继续；
- `await-user`：等待确实需要用户决定或补充的输入；
- `blocked`：暂停正常循环，处理 findings，必要时读取恢复参考；处理后按新的 continuation 恢复，不因 `blocked` 本身结束任务；
- `done`：change 已完成。

`next: auto` 只表示本次 transition 成功，不表示后续步骤已执行。调用方明确要求在某次 transition 后停止时，严格按“更新正式产物 → 执行一次允许的 transition → transition 成功后不再调用工具 → 输出约定标记并结束本轮”执行；即使 continuation 为 `continue` 也不得继续执行后续步骤。

`workspace-root-changed` 与 `workspace-inspection-unavailable` 是只读提示，不单独阻止推进或归档。未知的 workspace 完整性 finding、确定冲突、失效证据和 repair stop 必须处理；Runtime 要求修复工作区身份时，先运行只读 doctor，再按报告执行显式 `doctor --repair`。

摘要、理由、报告和产物中不得写入 token、密码、私钥、连接串或其他凭据。
