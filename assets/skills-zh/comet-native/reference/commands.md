# Native 命令与异常参考

正常流程直接执行 Runtime 在 `continuation` 中给出的命令。本文件用于解释返回字段，以及处理以下情况：命令输入被拒绝、无法启动 Verifier、Verifier 任务执行出错、Verifier 因缺少外部信息无法判断，或 Runtime 要求用户确认降级验收。`continuation.disposition` 说明现在应继续、等待用户、处理阻塞还是结束。只有用户明确确认后，才执行含 `--confirmed` 的后续命令。CLI 文本先给出用户可读的 `summary`、唯一 `NEXT:` 和可选的 `RELAY TO USER:`；用 `--json` 读取新增 Envelope，`--verbose` 仅用于机器状态排查。

命令签名和当前参数始终以 CLI 为准：

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

## Runtime 返回的下一步

- `disposition`：说明现在应该继续、等待用户、处理阻塞还是结束；`userCommunication.required` 为 true 时先转述消息并等待，再执行任何确认命令；
- `commandArgs` / `commandAlternatives`：Runtime 要求执行的完整命令参数；每个备选操作对应一个互斥的用户决定，选择匹配项执行，不要合并多个备选操作；
- `inputOptions`：这次命令需要填写的字段和 JSON 模板；
- `workspace` / `preparation`：实际工作目录和 change 创建结果；
- `stateVersion` / `loop`：当前状态版本和验收循环进度；
- `acceptance` / `childSummary` / `readyChildren` / `supervisor` / `details.nextPageArgs`：验收计数、Supervisor Change 的子任务计数、当前可执行子任务、集成分支与当前任务包摘要，以及详情下一页命令；
- `verifierDispatch`：启动独立 Verifier 所需的工作区与证据位置、当前 `scopeIds`、数量、正文引用、详情分页参数、复核摘要和检查结果；如果存在 `recoveryContext`，也要把它作为最近一次恢复或用户补充的信息直接传给 Verifier；
- `workspaceFinishResult` / `recoveryArgs`：归档后的工作区收尾结果和恢复命令。

模板中的尖括号表示需要填写的值。`await-user` 表示先等待用户决定，此时不执行推进命令。若 `commandArgs` 为 `null` 且返回了 `commandAlternatives`，先确认用户决定，再执行对应备选操作的完整 `commandArgs`，保留其中的 `--expected-state-version` 和 `--expected-action`。命令因状态过期或动作不匹配失败时，重新读取最新 `continuation`，按当前状态继续；不要自行拼接不带 guard 的命令。`localExecution: absent` 只表示这台机器当前没有正在运行的执行任务，不代表 change 已损坏。

启动 Verifier 时原样传递 `verifierDispatch` 的定位信息：`projectRoot` 是运行 Native 命令的控制目录；`verificationRoot` 是验收实现的工作区，Supervisor 父级使用集成工作区；`changeDir` 是 `briefRef` 和 `specRefs[].ref` 的相对路径基准；`supervisorStateRef` 指向包含子任务验收与集成证据的本机状态，普通 change 为 `null`。如果存在 `recoveryContext`，也要原样交给 Verifier，作为最近一次恢复或用户补充的上下文。`detailsPageArgs` 已包含 `--project-root`，从任何工作目录查询都应保留它。追加检查后，把返回的检查结果和交接信息交回当前 Verifier，继续等待最终结果。

## 填写命令输入

把 `inputOptions.template` 复制到系统临时 JSON 文件，只替换模板要求填写的内容，然后执行 `continuation.commandArgs` 或所选 `commandAlternative.commandArgs`。命令结束后删除临时文件。模板中已有的验收轮次、Verifier 尝试次数、状态版本和任务标识都原样保留；只填写模板公开的字段。

- `builder-handoff`：提交本轮实现摘要、处理的验收 ID、Builder 实际做过的开发检查、已知限制，以及新的只读代码复核所产生的 `review.status=passed`、`review.summary` 和 `review.reviewer_execution_ref`。验收结论留给 Verifier。
- `dispatch-verifier`：列出当前候选需要由 Runtime 执行的检查。普通 change 确认没有适用的命令检查时可提交空列表；Supervisor 父级必须填写至少一项集成检查，`cwdRef` 相对于集成工作区。返回的是任务包和 attempt 标识，必须由 Agent 立即启动平台原生的只读 Verifier subagent；不存在需要另行启动或配置的 Verifier 服务、进程、地址或回调。
- `verifier-response`：Verifier 请求补充检查，或提交恰好覆盖当前 `scopeIds` 的结果。修复范围通过后 Runtime 会再要求一次覆盖全部验收场景的最终验证。
- Supervisor 任务回报使用 `supervisor-builder-result`、`supervisor-builder-failure`、`supervisor-verifier-result`、`supervisor-reconnect`、`supervisor-cancel` 和 `supervisor-integrate`；Builder、Verifier、重连和取消等操作必须带 Runtime 当前任务包的 `runId`，过期、角色错误或重复的回报会被拒绝；`supervisor-integrate` 使用已通过验证的子任务和检查结果，不携带 `runId`。需要按顺序执行时，可用 `comet native next <change> --max-parallel 1`，默认上限为 2。
- `verifier-execution-error` / `verifier-unavailable`：平台支持 subagent，但本次任务未启动、执行失败、超时或结束后没有返回时使用前者；只有当前平台确实没有可用的 subagent 能力时才使用后者。模板中的任务关联字段必须原样保留，避免旧任务的迟到消息影响新的 Verifier。
- `retry-verifier` / `confirm-verifier-unavailable`：Runtime 在 Verifier 不可用状态返回这两个 `commandAlternatives`。用户要求重试时选择前者，候选代码和已完成检查会保留；只有用户明确接受只有自动检查的降级结果时才选择后者。

Runtime 负责执行并记录验收检查。Builder 在 handoff 中列出的开发检查只用于说明候选；Verifier 以 Runtime 的实际检查结果为准。是否补充检查、重试或启动新的 Verifier，由最新 `continuation` 决定。

## 异常情况

- 无法启动独立 Verifier：先确认适用检查已经列明，且 Runtime 检查全部通过；随后按模板报告 unavailable，等待用户决定是否接受只有命令检查、没有独立语义验收的降级结果。
- Verifier 暂时无法判断（`semantic blocked`）：如果只缺用户或外部信息，执行 Runtime 返回的解决动作；如果需要修改实现，回到 Build。
- 由 Skill 启动的 Verifier 判断全部通过（`skill-coordinated pass`）：这表示检查已经完成，但系统无法确认验证者是否独立；Runtime 会显示“已完成检查，但需要你确认验证结果”，用户确认后再执行返回的命令。
- 如果显示“无法完成完整验证，只完成了自动检查”，表示没有可用的语义验证，只有 Runtime 自动检查结果；只有用户明确确认后才能继续归档。
- 用户确认接受这种不完整结果后，显示“你已确认接受不完整验证结果”；这只表示用户明确接受降级结果，不会把它改成独立验证。
- Verifier 任务执行出错（`execution error`）：按模板提交错误，再读取新的 `continuation`。Runtime 决定复用哪些检查以及是否重试。

## 诊断

先运行只读 `doctor`。只有 `doctor` 明确给出修复命令时才执行；锁、跨设备状态和事务仍由 Runtime 管理。
