# Native 恢复参考

只在 Runtime 报告本机任务中断、Runtime 文件缺失、连续多轮没有进展、并发冲突、旧版本迁移失败或状态损坏时读取。

## 通用原则

先停止修改项目，再重新运行 `status --details --json` 和只读 `doctor`。只执行 `continuation` 或 `doctor` 明确返回的恢复动作。跨设备状态、本机任务、锁和事务始终交给 Runtime 管理；无法确定自动恢复是否安全时，保留现场并等待用户。

## Workspace

`status` 会跨已登记的 worktree 查找与当前绑定一致的 change，并返回实际工作目录 `workspace.projectRoot`。进入该目录并重新执行 `select`。恢复应沿用找到的 change 和工作目录，不复制 change，也不在其他目录重建同名 change。

如果项目根目录、分支、工作区类型或 Git 状态与 `comet-state.yaml` 中的记录不一致，Runtime 会阻止写入。Runtime 能安全找到或创建已声明的 worktree 时，按返回动作继续；否则进入等待用户（`await-user`）。

原目录或分支确实丢失时，由用户决定使用哪个恢复目录、是否从可信备份重建，或是否放弃 change。

## 稳定状态与本机任务

`comet-state.yaml` 记录最后一个可以安全恢复的工作流状态。本机 `state.json` 只说明这台机器正在执行什么；如果它缺失、版本落后或属于旧任务，Runtime 会根据 YAML、brief 和目标 Spec 重建。本机状态不能覆盖版本更新的 YAML。

- Shape：保持 Shape，继续澄清或确认。
- Build：如果 Runtime 显示 `repairing`，表示 Verify 未通过后已返回 Build。普通 change 保持当前验收轮次并继续修改；Supervisor Change 按 `repair-child` 追加覆盖失败验收项、尚未完成的 child，不重开已经归档的 child。
- Verify（`verify-ready`）：重新运行当前候选的必要检查，并启动新的 Verifier；旧设备上的通过结果不再沿用。
- Archive（`archive-ready`）：先安全返回 Verify，把验收结果重置为待检查（`pending`），再验收已经同步到新设备的实现。
- 等待用户或阻塞（`await-user` / `blocked`）：恢复原来的阻塞原因、负责处理的人和允许动作，等待对应条件满足后再继续。
- active 目录中的 `done`：只完成可以确定的目录移动与清理。
- archive 目录中的 `done`：以只读方式展示，这个 change 已经结束。

旧任务的进程、日志连接和 Agent 会话都视为已经丢失，不能根据残留文件猜测它们是否成功。检查已经结束但 YAML 尚未记录结果时，只有可以安全重复的检查才会重跑；可能产生重复副作用的外部动作转为等待用户。

`verification.md` 缺失、写入中断或 `generated_from_state_version` 落后时，只根据 YAML 重建报告。YAML 仍是恢复依据；报告版本对齐后才能授权 Archive。

旧版本的 active change 会以只读状态显示 `migration-required`。使用 `doctor --repair` 或 Runtime 明确返回的迁移命令处理；迁移失败时保留旧文件，等待 Runtime 给出下一步。

## 零聊天上下文与跨设备

在没有聊天记录的新设备上恢复时，需要取得同一份已同步项目代码、`comet-state.yaml`、brief 和目标 Spec。如果 change 使用非默认产物目录，还需要同步 `.comet/config.yaml`。

先停止旧设备上的推进并完成同步。发现 Git 冲突，或同一状态版本出现两份不同内容时，进入阻塞状态并交给用户处理。

旧设备上尚未同步的代码无法随工作流状态恢复，同一个 subagent 任务也不能跨设备继续。新设备根据 YAML 中的工作目录、验收循环、验收结果、阻塞原因、Builder handoff 和下一步创建新的本机任务；如果同步后的实现不完整，新的 Verifier 会指出缺口并返回 Build。

Verify 或待归档状态在新设备上重新验收，属于恢复过程：它不会增加验收轮次、失败轮次或停滞计数；只有实际启动新的 Verifier 时，Verifier 尝试次数才增加。已经完成的 Shape 和 Build 不会重做，Runtime 也不会扫描整个项目来猜测进度。

## Verify 未通过与持续无进展

Verify 未通过后，读取未通过、暂时无法验证的验收项以及失败检查。完成实际修改后，再提交新的 Builder handoff。只有未解决的问题变少才算有进展；只改说明文字、重复相同检查或再次报告同一原因，不算解决问题。

连续多轮没有进展，或 Verifier 任务多次执行出错时，按 Runtime 返回的阻塞处理动作继续。失败轮次达到 `native.max_verify_failures` 时进入等待用户，让用户选择继续当前目标、修改已经确认的需求或停止。

用户确认新的验收清单并开始一轮新目标后，验收失败计数清零。

## 规格与 Archive 冲突

如果项目中已经归档的正式 Spec 在当前 change 期间发生变化，重读最新正式 Spec、brief 和当前 change 的完整目标规格，按用户意图改写后执行 Runtime 冲突信息中给出的重新对齐（rebase）动作，再重新实现和验收。并发产生的新内容应保留。

两个 active change 同时修改同一功能区域（capability）时，Archive 会进入等待用户。用户决定先归档哪一个，另一个 change 随后重新对齐最新 Spec。

Archive 或 change 目录移动中断时，以 `doctor` 返回的事务状态和允许动作作为恢复依据。路径、工作流状态和实际文件互相对不上时，保留两侧现场并等待明确的恢复动作。

若工作区收尾结果 `workspaceFinishResult.status` 为阻塞（`blocked`），change 可能已经完成归档或 Git 提交。先执行 `recoveryArgs` 检查实际 Git 状态，再根据返回结果决定下一步。

## 损坏状态

- 锁由 Runtime 管理；只有 `doctor` 明确给出命令时才修复。
- config、change、brief、规格或 verification 损坏时，保留原文件并等待 `doctor` 或用户给出恢复来源。
- 同一个 change 同时出现在 active 和 archive、无法确定文件归属，或无法判断事务进行到哪一步时，保留现场并停止写入。
