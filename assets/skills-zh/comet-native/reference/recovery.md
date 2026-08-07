# Native 恢复参考

只在 Runtime 报告中断、证据失效、repair stop、冲突、迁移或损坏状态时读取。

## 通用原则

停止写入，重新运行 `status --details --json` 和只读 `doctor`。只执行后续指令、findings 或 doctor 返回的动作；不要手改状态、workspace、hash、证据、锁或事务。无法证明自动修复安全时保留现场并等待用户。

## Workspace

`status` 会跨已登记 worktree 查找绑定一致的 change，并返回实际 `workspace.projectRoot`。在该目录恢复并重新 `select`；不要复制 active change、在其他目录重建同名 change，或编辑 workspace 取得所有权。

以下绑定错误阻止写入：root、branch、worktree kind 或 Git 可用性与记录不一致。原目录或分支确实丢失时保留 artifacts，先看 doctor；只有用户可决定恢复目录、从可信备份重建或放弃 change。旧元数据的 root 提示不单独阻塞，也不授权自动刷新 baseline。

## Transition、baseline 与证据

- 未完成 transition：优先按后续指令重试；doctor 只允许其明确列出的 continue/rollback。
- baseline 缺失或不完整：只能从可信备份恢复，或保留已确认事实后重建 change；不能从当前文件猜测 baseline。
- brief、规格、实现、报告或 receipt 改变：回到 Build，重新确认受影响行为、生成 scope 并验证；不复用旧 pass 或 preflight。
- receipt binding mismatch：按输出分类。仅 source revision 不一致的 manual receipt 可 refresh；automated receipt 重跑；contract、scope、snapshot 或 artifact 不一致重新验证。

## Verify fail 与 repair stop

Verify fail 后读取 failed/missing acceptance 和 failed check，实际修复并重新验证。

`repair-stagnation-stop` 不是用户决定：根据当前 signature 提出一个不同且具体的新假设，完成对应修改后使用一次 override。不要让用户提供 signature 或 hash。

只有 `repair-continuation-decision` 才让用户选择继续尝试、调整已确认契约或停止。你负责修改配置或正式产物并执行后续动作。

## 规格与 Archive 冲突

canonical spec 改变时，重读最新 canonical、brief 和拟议完整规格，按用户意图改写后执行 finding 返回的 rebase 动作，再重新实现和验证。不得覆盖并发变化。

Archive 或 root move 中断时，以 doctor 返回的 transaction 和允许方向为准。journal、路径或实际文件不一致时保留两侧现场，不自行回滚或删除。

若 `workspaceFinishResult.status` 为 `blocked`，change 已可能归档或提交；先运行其 `recoveryArgs` 查看 Git 状态。不要重复 Archive、复用旧 preflight、强制删除 worktree，或在未知状态下再次 merge/push。

## 损坏状态

- 不手动删除锁；只有 doctor 明确允许时 repair。
- 损坏的 config、change、brief、规格或 verification 不由 Agent 猜测重写。
- 无法确定 owner、事务或文件身份时保留现场并停止。
