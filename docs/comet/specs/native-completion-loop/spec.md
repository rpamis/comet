# native-completion-loop

## 目标

Native 必须把一次 Agent turn 视为一次可恢复迭代，而不是完成证明。Builder 提交候选后由 Runtime 执行必要检查并分派独立 Verifier；只要仍有可处理缺口，工作流就在既有 Build ↔ Verify 路径有界收敛。Loop 不是第五个 phase。

## iteration 与 attempt

- `iteration` 表示一次完整的 Build → Verify 实现轮次，首次进入 Build 时为 1。
- 有效 Verifier 结果包含 failed 时，Runtime 必须把缺口写入 portable 状态、返回 Build，并令 `iteration += 1`。
- `attempt` 表示同一 iteration 中 Verifier execution 的单调序号。Runtime 必须先原子持久化新 attempt，再请求 Runner 启动 execution；已保留但未成功启动的序号不得复用。
- Verifier 崩溃、超时、输出结构无效或宿主无法恢复原 execution 时留在 Verify，并在再次分派时增加 attempt；这不是实现失败，不增加 iteration。
- 新 iteration 的 `attempt` 从 0 开始；开始新 iteration 或取得有效 Verifier 结果时清零连续 execution failure 计数。
- 连续三个 attempt 没有产生有效 `final-result` 时进入 `blocked`。外部问题解除后可以显式 `retry-verifier`，增加 `retry_epoch` 并重新开始 execution failure 计数。

## Verify 缺口回灌

- Verify fail 必须使用已经通过 schema 与覆盖检查的 acceptance 结果派生 failed/blocked ID，不接受另一套自由文本缺口清单。
- 返回 Build 后，`comet-state.yaml` 必须保存上一轮未解决 ID、精简原因、Builder 下一动作和 loop stage，使新 Agent 无需聊天历史即可继续。
- Builder 可以每轮集中处理一小组缺口，但下一次 Verify 仍必须由新的 Verifier 对全部验收项作答，不能只检查上一轮失败项。
- 任一 mandatory acceptance 缺失、failed、blocked，或任一必要检查未成功时，Runtime 不得产生最终 pass。

## 语义进展与停止

- Runtime 只根据有效 Verifier 结果比较进展，不根据文件数量、代码行变化或项目内容摘要判断。
- 未解决集合减少且没有已通过项退化才算进展；集合相同、增加，或修复部分问题同时新增失败都不算可靠进展。
- 相同未解决集合第一次重复时继续，第二次连续重复时警告 Builder 改变修复假设，第三次连续重复时进入 `await-user`。
- 同一目标周期的总实现失败轮次默认上限为 5；项目可以用 `.comet/config.yaml` 的 `native.max_verify_failures` 配置大于等于 1 的整数。非法值必须校验失败。
- 有效 Verify fail 才消耗实现失败预算。Verifier execution error、恢复、归档等待和检查协议往返不消耗该预算。
- 普通实现变化、局部进展或配置调整不得回溯清零预算；只有用户重新确认改变后的验收清单并开始新的 `goal_cycle` 才重置失败与停滞计数。

## Loop 状态与终态

- Dashboard 与 Runner 必须能区分 `building`、`checking`、`verifying`、`repairing`、`archiving`、`await-user`、`blocked` 和 `done`。
- `repairing` 仍属于 Build，`checking` 与 `verifying` 仍属于 Verify，`archiving` 属于 Archive。
- `done` 只在全部验收通过且 Archive 完成后成立。
- `await-user` 表示需要用户判断、外部条件或宿主无法提供独立验收；`blocked` 表示无法安全恢复或达到明确停止条件。
- `continue` 只要求 Runner 触发 portable 状态所指示的下一 action，不是完成状态。

## 完成与归档边界

- 最终 Verify pass 后才可以进入 `archive-ready` 并处理 `native.archive_confirmation`。
- `automatic` 可以继续 Archive；`required` 只在最终候选处返回一次 `await-user`，不得增加 Loop 计数或重新运行仍然有效的 Verify。
- Verify fail、缺失验收、检查失败或 Verifier execution error 时不得运行 Archive preview，也不得生成归档确认。
- Archive 不重新执行必要检查或 Verifier。归档失败只恢复归档事务，不重新消耗 Build/Verify Loop。
- 用户在最终 pass 后继续修改实现时，Runtime 必须清除当前结论、开始新 iteration 并返回 Build；正式需求改变时返回 Shape 并开始新目标周期。
- Loop 不得覆盖、改写或推断用户的 workspace finish 与 `native.archive_confirmation` 决定。

## 恢复与验证

- Loop 的 iteration、attempt、失败计数、未解决 ID、blocker 和 next action 必须保存在 `comet-state.yaml`；compact history 只用于展示，不能承担停止判断。
- 本机 execution 中断可以丢弃或重建 `state.json`，但不得丢失最近稳定 Loop 边界，也不得把中断推断为成功。
- 不新增 Native phase、独立 Loop Engine、新 CLI 命令、Goal 文件或外部 Skill 依赖。
- 回归测试和真实生命周期 Eval 必须覆盖“遗漏需求 → 回 Build 修复 → 新 Verifier 完整复验 → Archive”、语义停滞、总预算、连续 execution failure、显式 retry，以及两种归档配置。
