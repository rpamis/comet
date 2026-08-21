# Native 命令与异常参考

正常流程直接执行 Runtime 在 `continuation` 中给出的命令。本文件用于解释返回字段，以及处理以下情况：命令输入被拒绝、无法启动 Verifier、Verifier 任务执行出错、Verifier 因缺少外部信息无法判断，或 Runtime 要求用户确认降级验收。`continuation.disposition` 说明现在应继续、等待用户、处理阻塞还是结束。只有用户明确确认后，才执行含 `--confirmed` 的后续命令。

命令签名和当前参数始终以 CLI 为准：

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

## Runtime 返回的下一步

- `disposition`：说明现在应该继续、等待用户、处理阻塞还是结束；
- `commandArgs` / `commandAlternatives`：Runtime 要求执行的完整命令参数；alternative 是互斥用户决策对应的完整命令，选择匹配项执行，不要合并多个 alternative；
- `inputOptions`：这次命令需要填写的字段和 JSON 模板；
- `workspace` / `preparation`：实际工作目录和 change 创建结果；
- `stateVersion` / `loop`：当前状态版本和验收循环进度；
- `acceptance` / `children` / `readyChildren` / `nextPageArgs`：验收摘要、Supervisor Change 的子项投影、当前可启动子项和下一页查询命令；
- `verifierDispatch`：启动独立 Verifier 所需的输入；
- `workspaceFinishResult` / `recoveryArgs`：归档后的工作区收尾结果和恢复命令。

模板中的尖括号表示需要填写的值。`await-user` 表示先等待用户决定，此时不执行推进命令。若 `commandArgs` 为 `null` 且返回了 `commandAlternatives`，先确认用户决定，再执行对应 alternative 的完整 `commandArgs`，保留其中的 `--expected-state-version` 和 `--expected-action`。命令因状态过期或动作不匹配失败时，重新读取最新 `continuation`，按当前状态继续；不要自行拼接不带 guard 的命令。`localExecution: absent` 只表示这台机器当前没有正在运行的本机任务，不代表 change 已损坏。

## 填写命令输入

把 `inputOptions.template` 复制到系统临时 JSON 文件，只替换模板要求填写的内容，然后执行 `continuation.commandArgs` 或所选 `commandAlternative.commandArgs`。命令结束后删除临时文件。模板中已有的验收轮次、Verifier 尝试次数、状态版本和任务标识都原样保留；只填写模板公开的字段。

- `builder-handoff`：提交本轮实现摘要、处理的验收 ID、Builder 实际做过的开发检查和已知限制。验收结论留给 Verifier。
- `dispatch-verifier`：列出当前候选需要由 Runtime 执行的检查。确认没有适用的命令检查时提交空列表。
- `verifier-response`：Verifier 请求补充检查，或提交覆盖全部验收 ID 的最终结果。
- `verifier-execution-error` / `verifier-unavailable`：报告 Verifier 任务执行出错或无法启动。模板中的任务关联字段必须原样保留，避免旧任务的迟到消息影响新的 Verifier。

Runtime 负责执行并记录验收检查。Builder 在 handoff 中列出的开发检查只用于说明候选；Verifier 以 Runtime 的实际检查结果为准。是否补充检查、重试或启动新的 Verifier，由最新 `continuation` 决定。

## 异常情况

- 无法启动独立 Verifier：先确认适用检查已经列明，且 Runtime 检查全部通过；随后按模板报告 unavailable，等待用户决定是否接受只有命令检查、没有独立语义验收的降级结果。
- Verifier 暂时无法判断（`semantic blocked`）：如果只缺用户或外部信息，执行 Runtime 返回的解决动作；如果需要修改实现，回到 Build。
- 由 Skill 协调的 Verifier 判断全部通过（`skill-coordinated pass`）：Runtime 要求用户确认时解释一次验收边界，用户确认后执行返回的命令。
- Verifier 任务执行出错（`execution error`）：按模板提交错误，再读取新的 `continuation`。Runtime 决定复用哪些检查以及是否重试。

## 诊断

先运行只读 `doctor`。只有 `doctor` 明确给出修复命令时才执行；锁、跨设备状态和事务仍由 Runtime 管理。
