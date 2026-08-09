# Native 恢复参考

只在 Runtime 报告 execution 中断、本机 Runtime 缺失、Loop 停滞、冲突、迁移或损坏状态时读取。

## 通用原则

停止写入，重新运行 `status --details --json` 和只读 `doctor`。只执行后续指令、blocker、findings 或 doctor 返回的动作；不要手改 portable 状态、本机 execution、锁或事务。无法证明自动恢复安全时保留现场并等待用户。

## Workspace

`status` 会跨已登记 worktree 查找绑定一致的 change，并返回实际 `workspace.projectRoot`。在该目录恢复并重新 `select`；不要复制 active change、在其他目录重建同名 change，或编辑 workspace 取得所有权。

root、branch、worktree kind 或 Git 可用性与 portable workspace 不一致时阻止写入。Runtime 可以安全定位或创建已声明 worktree 时按其动作继续；否则进入 `await-user`。原目录或分支确实丢失时，只有用户可决定恢复目录、从可信备份重建或放弃 change。

## 稳定状态与本机 execution

`comet-state.yaml` 决定从哪个稳定边界继续。本机 `state.json` 只说明这台机器正在执行什么；缺失、版本落后或来自旧 operation 时丢弃并从 YAML、brief 和目标 Spec 重建，不能反向覆盖更新的 YAML。

- Shape：保持 Shape，继续澄清或确认。
- Build / repairing：保持当前 iteration，根据 Builder handoff、未解决验收项和 next action 继续。
- Verify / verify-ready：重跑当前候选的必要检查，启动新的 Verifier attempt，不复用旧设备的 pass。
- Archive / archive-ready：先原子返回 Verify / verify-ready，把当前验收结果重置为 pending，再验收同步后的实现。
- `await-user` / `blocked`：恢复原 blocker、责任人和允许动作，不擅自继续。
- active 路径中的 `done`：只完成可确定的目录移动与清理，不重新验收。
- archive 路径中的 `done`：只读展示，不创建 per-change Runtime。

旧 operation 的进程、日志句柄和 Agent execution 一律视为丢失，不猜测成功。检查完成但 YAML 尚未推进时，只有可安全重复的检查可以重跑；不能安全重复的外部动作转为 `await-user`。

`verification.md` 缺失、写入中断或 `generated_from_state_version` 落后时，只从 YAML 重建报告。正文不能用于恢复机器状态，报告对齐前不能授权 Archive。

旧 active change 使用只读状态显示 `migration-required`。只有 `doctor --repair` 或 Runtime 返回的持锁写动作可以迁移；迁移失败时保留旧文件，不手工移动或删除。

## 零聊天上下文与跨设备

零聊天上下文恢复要求新设备取得同一份已同步项目代码、`comet-state.yaml`、brief、目标 Spec，以及非默认 artifact root 所需的 `.comet/config.yaml`。先停止旧设备推进并完成同步；发现 Git 冲突或同一状态版本的两份分叉时进入 `blocked`，不自动合并。

恢复不包含旧设备尚未同步的代码，也不能继续同一个 subagent execution。新设备根据 portable workspace、Loop、验收结果、blocker、Builder handoff 和 next action 创建新的本机 execution；若同步实现缺失，新的 Verifier 会报告缺口并正常返回 Build。

Verify 或 archive-ready 的跨设备重新验收属于基础设施恢复：不增加 iteration、失败轮次或停滞计数；实际启动新的 Verifier 时只增加 attempt。恢复过程不重跑已经完成的 Shape 或 Build，也不枚举整个项目来猜测进度。

## Verify fail 与停滞

Verify fail 后读取 failed/blocked 验收项和失败检查，实际修复后再提交新的 Builder handoff。未解决集合缩小才算有进展；只改措辞、重复相同检查或重复同一原因不算修复。

连续无进展或多次 execution error 时按 Runtime 返回的 `blocked` 动作处理。失败轮次达到 `native.max_verify_failures` 时进入 `await-user`，让用户选择继续当前目标、修改已确认需求或停止；只有确认新的验收清单并开始新 goal cycle 才清零语义失败计数。

## 规格与 Archive 冲突

canonical Spec 改变时，重读最新 canonical、brief 和拟议完整规格，按用户意图改写后执行 finding 返回的 rebase 动作，再重新实现和验收。不得覆盖并发变化。

两个 active change 声明同一 capability 时，Archive 在锁内进入 `await-user`，由用户确定串行顺序；不得自动选择较新的版本或静默合并。

Archive 或 root move 中断时，以 doctor 返回的 transaction 和允许方向为准。路径、状态或实际文件不一致时保留两侧现场，不自行回滚或删除。

若 `workspaceFinishResult.status` 为 `blocked`，change 已可能归档或提交；先运行其 `recoveryArgs` 查看 Git 状态。不要重复 Archive、强制删除 worktree，或在未知状态下再次 merge/push。

## 损坏状态

- 不手动删除锁；只有 doctor 明确允许时 repair。
- 损坏的 config、change、brief、规格或 verification 不由 Agent 猜测重写。
- active 与 archive 同时存在、owner 不明确或事务步骤无法唯一判断时保留现场并停止。
