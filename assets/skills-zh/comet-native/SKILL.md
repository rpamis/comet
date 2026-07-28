---
name: comet-native
description: 当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用；负责澄清需求、读取状态并推动 Shape → Build → Verify → Archive。
---

# Comet Native

Native 保存需求、完整目标规格、状态和证据。你负责理解、实现和验证；Runtime 负责状态、边界和恢复。

## 按需加载

先只使用本文件。遇到对应任务时再读取一份 reference：

- Shape 中存在尚未确定的用户可见行为时，读取[澄清参考](reference/clarification.md)。
- 需要高级参数、receipt、partial scope 或外部角色交接命令时，读取[命令参考](reference/commands.md)。
- 需要编辑 brief、规格或 verification 时，读取[产物参考](reference/artifacts.md)。
- 出现中断、失效证据、repair stop、冲突、锁或迁移问题时，读取[恢复参考](reference/recovery.md)。

## 核心规则

从 `.comet/config.yaml` 读取：

- `native.clarification_mode`：默认 `sequential`；
- `native.archive_confirmation`：默认 `automatic`；
- `native.max_verify_failures`：默认 `5`。

磁盘中的 config、selection、change 状态和正式产物优先于聊天记忆。不要直接编辑 Runtime 管理的状态、证据、锁或事务文件。

Native 主流程不依赖任何外部 Skill。

不要接收签名私钥，也不要代替外部审批角色。缺少外部动作时，按 Runtime continuation 等待并转交所需命令。

## 开始或恢复

1. 运行 `comet native status`，确认当前 change 和 phase。
2. 对目标运行 `comet native show <change-name>`；Verify、Archive 或失败后的 Build 再运行 `status <change-name> --details`。
3. 需要更多 acceptance 时，按 `acceptancePage.nextCursor` 分页；findings 被截断时，先处理已返回项，再重新读取。
4. 确认目标后运行 `comet native select <change-name>`。
5. 只读取当前 phase 需要的正式产物、实现、测试和项目规则。

存在多个合理候选时让用户选择。只有确认没有对应 active change 时才创建：

```text
comet native new <change-name> \
  --creation-authorization <owner-provided-path> \
  --language zh-CN
```

如果 Runtime 报告缺少外部授权，停止创建并等待 owner。只使用配置指定的 Native artifact root。

## Shape

先调查能从仓库、工具和运行环境查明的事实。只有不同选择会实质改变用户可见结果，并且无法从已有要求可靠确定时，才询问用户；实现方式由你决定。

存在未决行为时，按 `clarification_mode` 读取并执行澄清参考。每次用户回答后，立即更新同一个 change 的 Decisions、brief 和完整目标规格。未解决项继续以 `[blocking]` 保存；存在阻塞项时不修改项目实现，也不推进阶段。

所有用户决定处理完后，重新检查是否仍有静默假设，并向用户提供目标、范围、关键决定、验收标准和非目标的共享理解摘要。只有用户明确确认后，才移除最终阻塞项并推进：

```text
comet native next <change-name> --summary <摘要> --confirmed
```

brief 或规格改变已确认的行为时，重新取得用户确认；不要手工修改确认状态。

## Build

实现满足 brief 和完整目标规格的最简单可靠方案。可以分批完成；长任务可使用 checkpoint 保存恢复摘要，但 checkpoint 不是完成证据。

需求变化时先更新正式产物。出现新的用户决定时回到 Shape 的澄清与确认边界。

候选实现完成后，对照完整规格和全部 acceptance 复核是否仍有遗漏，再提供真实项目产物推进：

```text
comet native next <change-name> \
  --summary <摘要> \
  --artifact <项目内路径>
```

没有代码变化或 Runtime 无法证明完整 scope 时，读取命令参考。不得把未知或不完整范围声明为 complete。

## Completion Loop

进入 Build 后按以下循环收敛：

1. 运行 `status <change-name> --details` 并读取当前需要的 acceptance 页；上一轮 Verify 失败时，优先处理 failed/missing acceptance 和 failed check。
2. 完成一批相关的实际修复。需要中断时可以写 checkpoint，但 checkpoint 不是完成证据。
3. 形成候选实现后，重新读取 brief、完整规格和全部 acceptance，执行一次完整审查。
4. 运行真实验证并提交 Verify 结果。
5. `fail` 回到 Build，从第 1 步继续，且不运行 Archive；`pass` 才进入 Archive。

Loop 只在 `done`、`await-user`、`blocked` 或调用方明确要求停止时结束。一次 Agent turn、一次 checkpoint 或 Agent 自述“已完成”都不是终态。Agent 负责发现并修复缺口，Runtime 负责判断是否完成。

## Verify

根据 acceptance、完整目标规格和改动风险运行真实验证。用实际结果完成 `verification.md` 和验收证据；未运行或失败的检查不能写成通过。

使用 Runtime 返回的 acceptance ID 和 receipt。需要生成证据块、记录 automated/manual receipt、申请 waiver 或交接独立审核时，读取产物与命令参考。当前 Agent 不执行外部签名。

只有 Runtime 接受完整且新鲜的验收矩阵、required checks 和独立审核时才能提交 `pass`。相关实现、规格、报告或证据改变后重新验证。

`fail` 会回到 Build。先根据 Runtime 返回的 failed/missing acceptance 和 failed check 修复，再重新验证；不要把再次调用 `next` 当作修复。达到 Runtime 的重复缺口停止条件或 `native.max_verify_failures` 预算时，停止并等待用户决定。

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
- `await-user`：等待确实属于用户或外部角色的输入；
- `blocked`：处理 findings，必要时读取恢复参考；
- `done`：change 已完成。

`next: auto` 只表示本次 transition 成功，不表示后续步骤已执行。调用方明确要求在某次 transition 后停止时，严格按“更新正式产物 → 执行一次允许的 transition → transition 成功后不再调用工具 → 输出约定标记并结束本轮”执行；即使 continuation 为 `continue` 也不得继续执行后续步骤。

`workspace-root-changed` 与 `workspace-inspection-unavailable` 是只读提示，不单独阻止推进或归档。未知的 workspace 完整性 finding、确定冲突、失效证据和 repair stop 必须处理；Runtime 要求修复工作区身份时，先运行只读 doctor，再按报告执行显式 `doctor --repair`。

摘要、理由、报告和产物中不得写入 token、密码、私钥、连接串或其他凭据。
