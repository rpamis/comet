# Native 命令参考

只在 Runtime 要求高级输入、Verifier 分派或诊断动作时读取。命令签名、选项、示例和输出以 CLI 为准：

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

不要从本文件复制旧参数；优先执行后续指令（`continuation`）的 `commandArgs`，并按 `inputOptions` 填入真实值。所有公开命令可使用 `--json` 和 `--project-root`。

## 结构化输出

JSON 外层包含 `command`、`exitCode`、`data`，失败时包含 `error`。常用动作字段：

- `continuation.disposition`（后续指令的处置）：`continue | await-user | blocked | done`；
- `commandArgs`：完整 executable 与 argv 模板；
- `inputOptions`：必需输入、flag、候选值、重复性和互斥备选；
- `workspace` / `preparation`：change 实际目录与本次创建结果；
- `stateVersion` / `loop`：当前稳定状态版本、stage、iteration 与 attempt；
- `acceptance` / `nextPageArgs`：验收状态与后续分页动作；
- `builderHandoff` / `verifierDispatch`：候选摘要与需要启动的独立验收 execution；
- `blockers` / `findings`：责任人、原因、允许的解决动作和是否需要用户决定；
- `localExecution`：这台机器上的 running、completed、interrupted 或 absent operation；
- `workspaceFinishResult`：归档后的 Git 收尾结果和恢复动作。

不要把包含尖括号的占位符原样执行，也不要在 `await-user` 时自动执行模板。`localExecution: absent` 只是当前没有本机 operation；只要 portable 状态有效，就不表示 change 损坏。

## Skill 协调桥接

`continuation.runnerAction` 要求协调时，按 `commandArgs` 对同一个 `next --runner-input <file>` 使用以下精确 JSON。文件放在系统临时目录，调用后在 `finally` 删除；不要放项目或 Runtime 目录。对于 Verifier 执行错误或不可用，必须把当前 `verifierDispatch` 中的 `stateVersion`、`iteration`、`attempt` 和 `verifierExecutionRef` 原样复制；这些是 Runtime 生成的迟到消息保护字段，不是 Agent 自报身份。

```jsonl
{"kind":"builder-handoff","summary":"本轮实现摘要","addressed_acceptance_ids":["A1"],"checks":[{"name":"开发期检查","result":"passed","note":null}],"known_limits":[]}
{"kind":"dispatch-verifier","checks":[{"id":"focused-test","name":"聚焦测试","executable":"pnpm","argv":["vitest","run","path/to/test.ts"],"cwdRef":".","timeoutMs":120000,"repeatable":true}]}
{"kind":"verifier-response","response":{"kind":"request-checks","iteration":1,"attempt":1,"checks":[{"id":"extra-check","name":"额外检查","executable":"pnpm","argv":["test"],"cwdRef":".","timeoutMs":120000,"repeatable":true}]}}
{"kind":"verifier-response","response":{"kind":"final-result","result":{"iteration":1,"attempt":1,"verdict":"pass","acceptance":[{"id":"A1","result":"passed","reason":"已观察到行为"}],"risks":[],"summary":"全部验收项已独立检查"}}}
{"kind":"verifier-execution-error","summary":"Verifier execution 失败原因","stateVersion":7,"iteration":1,"attempt":2,"verifierExecutionRef":"skill-coordinated:verifier:<从 verifierDispatch 复制>"}
{"kind":"verifier-unavailable","summary":"平台无法启动新的独立语义验证 execution","stateVersion":7,"iteration":1,"attempt":2,"verifierExecutionRef":"skill-coordinated:verifier:<从 verifierDispatch 复制>"}
```

Skill 根据仓库说明和改动显式解析检查计划，Runtime 真实执行；确实没有适用命令时明确用 `"checks":[]`，但 Verifier 仍须覆盖全部验收项。分派返回的 `verifierDispatch` 包含 Runtime 分配的 candidate/iteration/attempt、全部 acceptance、brief/Spec 引用、去身份字段的 handoff 和真实检查结果。

`request-checks` 后用更新的 `verifierDispatch` 恢复同一 Verifier/attempt。若平台既不能启动 subagent，也不能启动新的独立 Agent execution，只能在 `dispatch-verifier` 已显式解析检查计划且 Runtime 返回的全部检查都为 `passed` 后提交 `verifier-unavailable`；明确的 `checks: []` 也算已解析。Runtime 会以 `semantic-verification-unavailable` assurance 停在降级 `await-user`，用户明确确认后才以 `user-confirmed-degraded` assurance 进入 Archive，绝不写成 host-attested 或正常独立验收。

有效 Verifier 返回 semantic `blocked` 时，若用户确认无需修改实现，执行 continuation 返回的 `next --resolve-verifier-blocker --summary`：同一 candidate 的 `retry_epoch` 增加、已完成检查被复用，再分派新 attempt。若需要修改实现，仍使用 `--return-to-build`。
公共桥接只称 `skill-coordinated`，不能抵抗恶意本地调用者；只有从平台调度器取得身份的 in-process host adapter 才有强身份。正常 Skill 协调 pass 会停在 `await-user`，询问一次边界确认，再执行 Runtime 返回的 `next --confirmed --summary` 进入 Archive。

## 必须保留的语义

- Shape 确认：只有用户确认共享理解和验收清单后才使用 `--confirmed`。
- Build handoff：提交真实实现摘要、已处理验收 ID、实际运行或未运行的开发期检查和已知限制；不得提交验收结论。
- Verify/Archive 中途增加当前范围：先使用 `--return-to-build`，重新读取状态后再修改实现；验收标准变化时回 Shape 重新确认。
- Runtime checks：Skill 显式解析结构化检查计划，Runtime 只执行并记录该计划；完整输出进入日志，Agent 不把自由文本包装成成功结果。
- Verifier dispatch：使用新的只读 subagent 或独立 Agent execution，提供 brief、目标 Spec、实际实现、检查结果、全部验收项和 Builder handoff。
- Verifier requests：额外检查必须一次批量提出，由 Runtime 去重和执行；同一 attempt 不反复请求等价检查。
- Verifier result：每个验收 ID 恰好一次，`pass` 时全部为 `passed`。Agent 不在 body 或 CLI 中自报 candidate、provider 或 execution identity。
- Loop：`fail` 返回 Build，execution error 只增加 attempt 相关计数；semantic `blocked` 仅在用户选择后重试同一 candidate 或返回 Build；达到停滞或预算上限时服从 `blocked` / `await-user`。
- Archive：`--finish` 只持久化已确认的隔离 workspace 收尾选择；只针对当前状态版本执行，不重复检查或独立验收。

## 诊断

先使用只读 `doctor`。仅当输出提供 repair 动作时才使用 `--repair` 和它允许的 strategy。不要手动删除锁、改写状态或编辑事务。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 检查、验收或 execution 报告问题 |
| `64` | 参数或用法错误 |
| `65` | 配置、状态或正式产物无效 |
| `70` | 未预期的内部失败 |
| `73` | 锁、事务、并发、workspace 或收尾冲突 |
| `75` | Loop 停滞或失败预算阻塞继续 |
