# Native 恢复参考

只读取当前阻塞对应的章节。

## 等待外部输入与监控

- 暂停条件：相关工作只等待用户或外部资料，且没有可执行子任务、没有仍在执行的相关任务，也没有值得周期检查的外部状态时，暂停当前工作对应的周期监控；保留独立任务及其监控。仍在执行的任务或可检查的 CI、外部作业继续使用平台等待或监控能力。
- 暂停操作：能明确识别当前工作对应的自动化且平台允许管理时，通过平台能力实际暂停并核对返回状态；返回信息不足时读取该自动化状态确认。无法识别、权限不足或暂停失败时，明确说明监控尚未确认暂停及所需人工操作。静默回复不等于暂停周期唤醒；不得操作归属不明或无关的自动化。
- 等待说明：首次进入等待时，一次性告知用户阻塞原因、缺少的资料、实际暂停范围、仍运行的任务和恢复条件；在既有协调记录中保存这些信息及对应监控标识、暂停结果，不新建正式产物格式。
- 恢复条件：收到相关新输入或核实相关依赖已解除后，重新读取 Runtime，沿用原 change、任务身份和已完成结果，按最新 `continuation` 继续；普通进度回报不解除阻塞，保留结果而不重新派工。仅在仍需周期检查时恢复对应监控，并核对结果。
- 状态边界：平台任务空闲、周期监控暂停不等同于 Runtime 的 `blocked` / `await-user`。只有现有公开动作适用于当前阶段和阻塞时才登记 Runtime 状态；否则保留业务阻塞记录并暂停依赖该输入的工作，不得直接修改状态文件或借用 Verifier 状态表示实施资料缺口。

## 故障恢复

Runtime 故障恢复时，先停止修改项目，再重新运行 `status --details --json` 和只读 `doctor`。只执行 `continuation` 或 `doctor` 明确返回的恢复动作。跨设备状态、本机执行状态、锁和事务始终交给 Runtime 管理；无法确定自动恢复是否安全时，保留现场并等待用户。仅等待外部输入时按[等待外部输入与监控](#等待外部输入与监控)处理，独立工作继续。恢复后重新派发 Supervisor 任务前必须读取[Supervisor 协作](commands.md#supervisor-协作)；重新启动 Verifier 前必须读取[Verify 协议](commands.md#verify-协议)，核对当前任务身份、候选和执行状态。

### 工作区

`status` 会跨已登记的 worktree 查找与当前绑定一致的 change，并返回实际工作目录 `workspace.projectRoot`。进入该目录并重新执行 `select`。恢复应沿用找到的 change 和工作目录，不复制 change，也不在其他目录重建同名 change。

如果项目根目录、分支、工作区类型或 Git 状态与 `comet-state.yaml` 中的记录不一致，Runtime 会阻止写入。Runtime 能安全找到或创建已声明的 worktree 时，按返回动作继续；否则进入等待用户（`await-user`）。原目录或分支确实丢失时，由用户决定使用哪个恢复目录、是否从可信备份重建，或是否放弃 change。

### 稳定状态与本机执行状态

`comet-state.yaml` 记录最后一个可以安全恢复的工作流状态。本机 `state.json` 只说明这台机器正在执行什么；如果它缺失、版本落后或属于旧任务，Runtime 会根据 YAML、brief 和目标 Spec 重建。本机状态不能覆盖版本更新的 YAML。

- Shape：保持 Shape，继续澄清或确认。
- Build：如果 Runtime 显示 `repairing`，表示 Verify 未通过后已返回 Build。普通 change 保持当前验收轮次并继续修改；Supervisor Change 按 `repair-child` 追加覆盖失败验收项、尚未完成的子任务，不重新打开已经归档的子任务。
- Verify（`verify-ready`）：重新运行当前候选的必要检查，并启动新的 Verifier；旧设备上的通过结果不再沿用。
- Archive（`archive-ready`）：先安全返回 Verify，把验收结果重置为待检查（`pending`），再验收已经同步到新设备的实现。
- 等待用户或阻塞（`await-user` / `blocked`）：恢复原来的阻塞原因、负责处理的人和允许动作，等待对应条件满足后再继续。
- active 目录中的 `done`：只完成可以确定的目录移动与清理。
- archive 目录中的 `done`：以只读方式展示，这个 change 已经结束。

旧任务的进程、日志连接和 Agent 会话都视为已经丢失，不能根据残留文件猜测它们是否成功。检查已经结束但 YAML 尚未记录结果时，只有可以安全重复的检查才会重跑；可能产生重复副作用的外部动作转为等待用户。`verification.md` 缺失、写入中断或 `generated_from_state_version` 落后时，只根据 YAML 重建报告。YAML 仍是恢复依据；报告版本对齐后才能授权 Archive。旧版本的 active change 会以只读状态显示 `migration-required`。使用 `doctor --repair` 或 Runtime 明确返回的迁移命令处理；迁移失败时保留旧文件，等待 Runtime 给出下一步。

### 零聊天上下文与跨设备

在没有聊天记录的新设备上恢复时，需要取得同一份已同步项目代码、`comet-state.yaml`、brief 和目标 Spec。如果 change 使用非默认产物目录，还需要同步 `.comet/config.yaml`。

先停止旧设备上的推进并完成同步。发现 Git 冲突，或同一状态版本出现两份不同内容时，进入阻塞状态并交给用户处理。

旧设备上尚未同步的代码无法随工作流状态恢复，同一个 subagent 任务也不能跨设备继续。新设备根据 YAML 中的工作目录、验收循环、验收结果、阻塞原因、Builder handoff 和下一步创建新的本机执行任务；如果同步后的实现不完整，新的 Verifier 会指出缺口并返回 Build。Verify 或待归档状态在新设备上重新验收，属于恢复过程：它不会增加验收轮次、失败轮次或停滞计数；只有实际启动新的 Verifier 时，Verifier 尝试次数才增加。已经完成的 Shape 和 Build 不会重做，Runtime 也不会扫描整个项目来猜测进度。

### Verify 未通过与持续无进展

Verify 未通过后，读取未通过、暂时无法验证的验收项以及失败检查。完成实际修改后，再提交新的 Builder handoff。只有未解决的问题变少才算有进展；只改说明文字、重复相同检查或再次报告同一原因，不算解决问题。

连续多轮没有进展，或 Verifier 任务多次执行出错时，按 Runtime 返回的阻塞处理动作继续。失败轮次达到 `native.max_verify_failures` 时进入等待用户，让用户选择继续当前目标、修改已经确认的需求或停止。用户确认新的验收清单并开始一轮新目标后，验收失败计数清零。

### 规格与 Archive 冲突

如果项目中已经归档的正式 Spec 在当前 change 期间发生变化，重读最新正式 Spec、brief 和当前 change 的完整目标规格，按用户意图改写后执行 Runtime 冲突信息中给出的重新对齐（rebase）动作，再重新实现和验收。并发产生的新内容应保留。

两个 active change 同时修改同一功能区域（capability）时，Archive 会进入等待用户。用户决定先归档哪一个，另一个 change 随后重新对齐最新 Spec。

Archive 或 change 目录移动中断时，以 `doctor` 返回的事务状态和允许动作作为恢复依据。路径、工作流状态和实际文件互相对不上时，保留两侧现场并等待明确的恢复动作。

若工作区收尾结果 `workspaceFinishResult.status` 为阻塞（`blocked`），change 可能已经完成归档或 Git 提交。先执行 `recoveryArgs` 检查实际 Git 状态，再根据返回结果决定下一步。

### 损坏状态

- 锁由 Runtime 管理；只有 `doctor` 明确给出命令时才修复。
- config、change、brief、规格或 verification 损坏时，保留原文件并等待 `doctor` 或用户给出恢复来源。
- 同一个 change 同时出现在 active 和 archive、无法确定文件归属，或无法判断事务进行到哪一步时，保留现场并停止写入。
