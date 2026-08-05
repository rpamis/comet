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

磁盘中的 config、当前 change 记录、change 状态和正式产物优先于聊天记忆。不要直接编辑 Runtime 管理的状态、证据、锁或事务文件。

Native 主流程不依赖任何外部 Skill。

## CLI 引导

Native Skill 只使用 PATH 中的公开 `comet native <cmd>` CLI；随 Skill 发布的命令 bundle 属于内部安装与 Runtime 资产，不由 Skill 搜索或直接调用。若命令返回 `command not found`、`executable not found` 或 `ENOENT`，停止并说明 Comet CLI 安装不完整；不得搜索 Skill 文件、枚举平台目录或直接调用内部 bundle。

常用命令：

```bash
comet native status [--json]
comet native show <change-name>
comet native select <change-name>
comet native new <change-name> [--language en|zh-CN] [--isolation current|branch|worktree]
comet native next <change-name> --summary <text> [--confirmed]
comet native archive <change-name> --dry-run
```

## 开始或恢复

1. 若项目使用 Git，先读取当前分支与 `git worktree list --porcelain`；对每个安全可访问的工作目录运行只读 `comet native status --project-root <path> --json`。这一步是默认发现流程，不等待用户说“并行”。
2. 运行当前工作目录的 `comet native status`，结合其他工作目录的结果确认目标 change、所属工作目录和 phase。同名 active change 已存在时，进入其工作目录恢复，不再创建。
3. 对目标运行 `comet native show <change-name>`；Verify、Archive 或失败后的 Build 再对 status 命令加 `--details` 运行。
4. 需要更多 acceptance 时，按 `acceptancePage.nextCursor` 分页；findings 被截断时，先处理已返回项，再重新读取。
5. 进入目标实际所属的工作目录后运行 `comet native select <change-name>`；不要要求用户手动 `cd`。

存在多个合理候选时让用户选择。只有确认所有已发现工作目录中都没有对应 active change 时才创建，并执行下方工作区协议。

只使用配置指定的 Native artifact root。

## 新 change 的工作区协议

并行单位是 change：不同 change 可以位于不同工作目录并行推进；同一个 change 只能由其绑定工作目录中的当前执行上下文写入，不为会话建立长期 lease。

创建前读取当前分支、未提交改动、当前目录中的 active Native change 和已登记 Git worktree。工作方式保留三种：

- `current`：保留当前分支和目录；
- `branch`：在当前目录创建并切换到 change 分支；
- `worktree`：创建独立 change 分支和 Git 工作目录，并在其中继续。

选择规则：

- 当前目录干净且所有已发现工作目录都没有其他 active change 时，默认直接使用 `current`，不询问“是否并行”；
- 当前目录已有未提交改动或其他事实使隔离方式会明显影响用户目录时，一次联合展示 `current / branch / worktree`，说明推荐项、分支名和工作目录；不要拆成“是否并行”等多轮问题；
- 当前目录已被另一个 active Native change 占用时，披露 `current` 和 `branch` 因 baseline 漂移风险不可用，并直接使用唯一安全的 `worktree`；其他 worktree 中的 active change 不会让本目录的 `current` 或 `branch` 自动失效；
- 用户可在同一次选择中覆盖默认分支 `comet/<change-name>` 和默认目录 `.worktrees/<change-name>`；路径或分支冲突时停止，不追加随机后缀、不接管不属于该 change 的现有目录。

`branch` 与 `worktree` 都必须在运行 `new`、建立 baseline 之前准备完成。目标分支默认绑定为创建分支或 worktree 时所在的起始分支：

```text
# current
comet native new <change-name> --language zh-CN --isolation current

# branch：先创建并切换分支
comet native new <change-name> --language zh-CN \
  --isolation branch --change-branch comet/<change-name> --target-branch <起始分支>

# worktree：先创建并进入 .worktrees/<change-name>
comet native new <change-name> --language zh-CN \
  --isolation worktree --change-branch comet/<change-name> --target-branch <起始分支>
```

创建 worktree 前，把 `.worktrees/` 写入仓库本地 Git exclude（Git common dir 的 `info/exclude`），不得为此修改 tracked `.gitignore`。Agent 必须在新工作目录中自动继续，不把进入目录的操作交给用户。

worktree 必须从已解析的本地目标分支提交创建。源目录有未提交内容时，先归因：可证明与新 change 无关的内容留在原目录；可能属于新 change 且无法从该提交带入时，等待用户决定如何保留，不静默提交、复制或遗漏。目标目录必须从目标分支获得一致配置，或通过公开 `comet native init` 建立合法配置并核对 artifact root、language、clarification、archive、verify 与 snapshot 语义；无法证明一致时停止。不得复制源目录的 `.comet/current-change.json`。

目标配置就绪后、运行 `new` 前，Agent 必须在新工作目录中依次执行：

```bash
comet doctor --repair --scope project
comet doctor --scope project --json
```

只有 Doctor 确认 Hook runtime 为当前版本、该平台恰好存在一个以目标项目为根的 Router，且没有遗留或重复 Comet Hook 时才继续。Agent 自行在新工作目录中执行这些命令，不让用户手动进入目录；不得从源目录复制 `.comet/current-change.json`。若项目配置未从目标分支继承，则先用公开 `comet native init` 按源项目的已核对语义建立配置，再执行上述 Doctor 序列。

worktree 创建只完成部分步骤时立即停止：报告原始错误、目标分支与目标路径、已明确创建的分支/worktree/exclude/config/change 资源，以及可恢复的下一步。只能清理可证明由本次操作新建且删除安全的资源；无法证明归属时保留现场，绝不删除已有或可能属于用户的 worktree、分支与文件。

Runtime 会在 `new` 的同一个 mutation lock 中重新检查当前目录是否已出现 active change。系统默认的 `current` 因竞态返回 `workspace-isolation-required` 时，自动按默认 `worktree` 重新准备并创建；用户明确选择的方式若在执行前失效，停止并重新确认，不擅自换方式。

没有 workspace v3 绑定的旧 active change 保持兼容：不自动生成 worktree、不移动文件、不刷新 baseline；同一旧目录内仍一次只选择一个 change。只有真实 baseline 或 scope 漂移时才按 Runtime 失败关闭，并让用户决定恢复、重建或放弃。

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

提交 Verify 时只传 `--result` 和 `--report`；`next` 不接受 `--receipt` 或其他调用方提供的 required-check 参数。Runtime 会先校验报告格式、完整验收矩阵和 acceptance receipt，只有这些输入有效后才执行或复用当前 scope 的内置 required check。报告无效时先修正报告，不要反复重试同一个 `next` 命令。

`fail` 会回到 Build。先根据 Runtime 返回的 failed/missing acceptance 和 failed check 修复，再重新验证；不要把再次调用 `next` 当作修复。`repair-stagnation-stop` 由 Agent 按恢复参考提出新假设并使用 Runtime 返回的 override；只有 continuation 要求 `repair-continuation-decision` 时才等待用户选择。

Verify 失败的中间循环不运行 Archive，也不触发归档确认。持续执行 Build → Verify，直到 pass、Runtime 阻塞或需要用户决定。

## Archive

只有最终 Verify pass 后才准备 Archive。先读取该 change 的 workspace 绑定；旧 workspace 元数据按 `current` 兼容处理。

`current` 沿用 `native.archive_confirmation`，不额外询问分支收尾。`branch` 或 `worktree` 必须在 Archive 前一次联合选择：

1. 归档并本地合并到已绑定目标分支；
2. 归档并推送 change 分支；
3. 归档、推送并创建 PR；
4. 归档并保留当前分支/工作目录；
5. 暂不归档。

展示精确 change 分支、目标分支和工作目录；结合目标分支是否本地可用、目录是否干净给出一个推荐。只有用户选择后才执行对应外部 Git 动作；选择“暂不归档”时保留现场并停止。

然后预演：

```text
# current
comet native archive <change-name> --dry-run

# branch / worktree：把联合选择写入正式 workspace 元数据
comet native archive <change-name> --dry-run --finish merge|push|pull-request|keep
```

预演成功后：

- `automatic`：执行 continuation 返回的精确提交命令；
- `required`：向用户展示实现、验证和规格操作摘要，等待用户选择立即归档或保留 change。

不要复用旧 preflight。发生事实漂移、canonical 冲突或未完成事务时，按 continuation 和恢复参考处理。

Runtime 返回的 `workspaceFinish` 必须与用户选择一致；后续会话从正式 workspace 元数据恢复该决定，不重复例行询问。归档成功后，只暂存并提交已确认 change 归属的实现、规格和 Archive 路径，排除其他用户改动。此前的联合选择授权这一次精确 stage/commit 以及所选收尾动作：

- 本地合并：在已绑定目标分支的工作目录中合并 change 分支，运行与改动风险匹配的合并后验证；成功后删除干净的 change worktree 和已合并本地分支。任何失败都保留分支与工作目录；
- 推送：推送 change 分支。成功后可删除干净的 change worktree，但保留本地和远端分支；
- 推送并创建 PR：推送后以 workspace 中持久化的 `targetBranch` 作为 PR base 创建 PR，不使用仓库默认分支推断；成功后按推送方式清理；Native 不持续监控 PR；
- 保留：提交后保留分支和工作目录，不做合并或推送。

多个 change 独立 Archive；只有更新同一个目标 ref 的本地合并需要串行。合并冲突只有在能机械地保留双方已确认契约时才可解决并重新验证；任何语义冲突都中止合并并询问是否创建新的 integration change，不把某一方静默覆盖。

## Continuation 与停止条件

Shape、Build 和 Verify 的 transition 都会返回 `next: auto | manual`、`continuation.disposition: continue | await-user | blocked | done`、所需输入与下一步动作；Archive 不通过 `next` 推进，归档成功才返回 `done`。每次 transition 后按该 Runtime continuation 行动：

- `continue`：重新读取 phase 和当前所需产物后继续；
- `await-user`：等待确实需要用户决定或补充的输入；
- `blocked`：暂停正常循环，处理 findings，必要时读取恢复参考；处理后按新的 continuation 恢复，不因 `blocked` 本身结束任务；
- `done`：change 已完成。

`next: auto` 只表示本次 transition 成功，不表示后续步骤已执行。调用方明确要求在某次 transition 后停止时，严格按“更新正式产物 → 执行一次允许的 transition → transition 成功后不再调用工具 → 输出约定标记并结束本轮”执行；即使 continuation 为 `continue` 也不得继续执行后续步骤。

旧元数据的 `workspace-root-changed` 与 `workspace-inspection-unavailable` 是只读提示，不单独阻止推进或归档。`workspace-binding-root-changed`、`workspace-branch-changed`、`workspace-kind-changed` 与 `workspace-vcs-unavailable` 表示新绑定失效，必须回到绑定工作目录/分支或停止并走恢复流程。其他未知 workspace 完整性 finding、确定冲突、失效证据和 repair stop 也必须处理；Runtime 要求修复工作区身份时，先运行只读 doctor，再按报告执行显式 `doctor --repair`。

摘要、理由、报告和产物中不得写入 token、密码、私钥、连接串或其他凭据。
