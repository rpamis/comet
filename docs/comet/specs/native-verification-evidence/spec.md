# native-verification-evidence

## 目标

Native 必须把 Builder 的“候选完成”与最终验收分开。Runtime 真实执行必要检查，Runner 为当前候选分派新的 Verifier execution，Runtime 只根据完整、结构化且由可信宿主通道绑定的结果决定通过、返回 Build 或等待用户。

本 capability 保留原路径以承接历史规格，但新 change 不再生成或消费 snapshot、文件哈希、implementation scope、receipt、evidence envelope 或内容寻址证据链。

## Shape 验收清单

- Shape 必须从 `brief.md` 与完整目标 Spec 形成非空、可观察、互不重复的验收项。
- Runtime 为已确认验收项分配 `A1`、`A2` 等顺序 ID，并把完整来源与文字保存在 `comet-state.yaml`；ID 只用于结果映射，不由内容计算。
- 进入 Verify 前，Runtime 只重新读取该 change 的 brief 与目标 Spec，并逐项比较来源和文字；不得为此扫描项目树或计算文档哈希。
- 正式需求发生变化时，当前候选与验收结论必须失效，change 返回 Shape。只有用户再次确认新的验收清单后，才能开始新的目标周期。

## Builder 候选边界

- Builder 负责实现、开发期最小相关检查、修复说明和已知限制，但只能提交候选，不能宣布最终通过或直接推进 Archive。
- 候选提交必须通过 Runner 的可信通道附带宿主生成的 `identity_provider` 与 `builder_execution_ref`；Agent 通过文本、JSON 或 CLI 自报的身份不得被接受。
- Runtime 为候选生成随机 `candidate_id`，并把精简 Builder handoff 写入 `comet-state.yaml`。该 ID 只关联一次 execution，不代表项目内容或文件身份。
- handoff 只保存实现摘要、已处理验收项、开发期检查与已知限制，不要求逐文件清单，也不复制命令完整输出。

## Runtime 必要检查

- 必要检查来自用户确认的验证预期、项目说明和 Runtime 或 Verifier 的项目发现；计划必须使用可执行文件、参数、项目相对工作目录和超时，而不是接受 Agent 拼接的结果文本。
- Runtime 必须直接执行检查，并把 stdout/stderr 流式写入本机日志；退出状态、耗时和脱敏后的命令摘要可以进入 portable 状态。
- 在正常、未中断的一次候选验收中，同一个规范化检查最多执行一次。重复请求复用已有结果，Archive 不再运行这些检查。
- 宿主能证明检查发生在最后一次已观察实现写入之后时可以复用 Runtime 执行的通过结果；无法证明时必须在 Verify 执行一次最终检查。
- timeout、启动失败、日志写入失败或中断属于明确的检查或基础设施结果，不能被 Agent 的“tests passed”描述覆盖。

## 独立 Verifier

- Runner 必须为当前候选启动一个新的 Verifier subagent 或隔离 execution，并通过可信宿主通道附加全局唯一的 `verifier_execution_ref`。
- Verifier 与 Builder 必须使用同一 `identity_provider`，但 execution ref 必须不同；普通 Agent 字符串不能证明角色分离。
- 无法提供独立 execution 或可信身份的宿主不得静默让 Builder 自验通过，只能降级为确定性检查加用户确认，并返回 `await-user`。
- Verifier 必须读取已确认验收清单、brief、完整目标 Spec、当前实现、Runtime 检查结果和 Builder handoff；handoff 只作线索，不能替代实际检查。
- Verifier 是只读角色，不修改实现、`comet-state.yaml` 或最终报告，也不直接推进 phase。

## 结构化结果与覆盖完整性

- Verifier 的 `final-result` 必须绑定当前 iteration 与 attempt，并为每个已知验收 ID 恰好返回一次 `passed`、`failed` 或 `blocked`。
- Runtime 必须拒绝缺失、重复、未知 ID，拒绝候选不匹配、身份来源不匹配、Builder 与 Verifier execution 相同的结果。
- `pass` 只在全部验收项为 `passed` 且全部必要检查成功时成立；任何 failed、blocked、skipped、timeout、中断或未执行的必要检查都不能形成 pass。
- summary、reason、risk 等诊断文本超出显示预算时可以截断预览，但验收 ID、verdict、计数和完整覆盖集合不得截断；诊断长度本身不能把合法结果变成 schema error。
- Verifier 可以批量请求额外检查；每个 attempt 最多两轮 `request-checks`。等价请求必须去重，超过轮次或持续请求等价检查按 execution error 处理，不能形成 pass。

## Archive 边界

- 有效 pass 由 Runtime 原子写入 `comet-state.yaml`，再生成与该 `state_version` 对齐的 `verification.md`。
- Archive 只确认归档意图、应用完整目标 Spec、写入最终 portable 状态、移动 change 并清理本机 Runtime。
- Archive 不重新分派 Verifier，不重新运行检查，不重新计算项目状态，也不恢复任何 receipt 或 evidence 链。
- 最终通过后若观察到实现写入，当前 pass 必须失效并返回 Build；正式需求改变则返回 Shape。Runtime 不声称能检测宿主没有上报的外部并发写入。

## 兼容与验证

- 旧 active change 的历史验收产物不得被迁移为新 pass；迁移后的候选必须由新的 Builder 和独立 Verifier execution 重新建立。
- 旧 archive 可以通过 legacy adapter 只读展示，但旧 parser 不参与新 change 的 Verify 或 Archive 决策。
- 回归测试必须覆盖 Builder 自信但遗漏验收项、身份伪造、验收 ID 缺失或重复、必要检查失败、两轮额外检查、长输出、实现写入失效，以及 Archive 不重复验收。
- 中英文 Native Skill、Native Runtime 源码和生成资产必须表达同一流程。
