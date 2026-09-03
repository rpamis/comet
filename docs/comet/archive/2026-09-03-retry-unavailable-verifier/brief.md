# 目标

当一次独立 Verifier 被记录为不可用后，用户可以直接要求重新尝试独立验收；Comet 保留当前候选和已完成检查，恢复到可重新派发状态，不再要求用户处理文件、进程、服务地址或回调配置。

# 范围

- 为 `semantic-verification-unavailable` 的等待用户状态增加受状态版本保护的 `retry-verifier` 备选动作。
- 重试时清除本次“不可用”的验证结论和降级阻塞，保留候选实现、Runtime 已通过检查及正确的验收范围，再派发新的只读 Verifier。
- 明确 Skill 中平台原生 subagent 的执行边界：`dispatch-verifier` 返回任务包，当前 Agent 启动只读 subagent 并转交其结果；不依赖常驻 Verifier 进程、服务地址或外部回调。
- 明确区分平台没有 subagent 能力的 `verifier-unavailable`，与 subagent 启动失败、超时、丢失或无返回的 `verifier-execution-error`。
- 同步 Native Runtime 发布 bundle，并保持 `0.4.0-rc.3` 版本。

# 非目标

- 不新增 Verifier 服务、后台进程、网络端点或回调协议。
- 不降低 Archive 对独立语义验收或用户明确接受降级结果的要求。
- 不让 Runtime 自动接受未完成的验收，也不绕过 stale attempt、state version 或 expected action 校验。
- 不改变 Verifier 对实现的只读约束和 Builder/Verifier 分离要求。

# 验收示例

- A1：平台报告独立 Verifier 不可用且 Runtime 检查均通过后，continuation 同时提供“重新尝试独立验收”和“接受降级结果”，用户不需要处理文件、进程或回调配置。
- A2：用户选择重新尝试后，Runtime 保留同一候选与已通过检查，清除不可用结论和降级阻塞，并返回新的 `dispatch-verifier` 动作。
- A3：首次全量 Verify 在不可用后重试并通过时，只完成一次全量验收；修复范围 Verify 在不可用后重试并通过时，仍继续要求最终全量 Verify。
- A4：subagent 启动失败、超时、丢失或无返回继续按 `verifier-execution-error` 处理；只有平台确实无法启动独立执行时才使用 `verifier-unavailable`。
- A5：重试仍校验当前 state version、expected action 和 attempt，旧结果或错误动作不能推进状态。
- A6：公开 CLI、默认状态输出和中英文 Skill 使用一致的恢复语义，生成的 Native Runtime bundle 与源码一致。

# 约束与不变量

- Runtime 继续拥有候选、检查、验收范围、attempt、状态版本和 Archive 判定。
- 用户只需表达“重试独立验收”或同等意图；Agent 执行 continuation 返回的完整命令。
- 已通过的 Runtime 检查可以复用，失败、未运行或超时的检查不得被标记为通过。
- `verifierExecutionRef` 是当前 Runtime attempt 的绑定标识，不是外部服务或 OS 进程证明。

# 决策

- 在现有 `confirm-verifier-unavailable` 等待用户状态增加 `retry-verifier` 备选动作，保留原有降级确认路径。
- 不把 `verifier-unavailable` 自动改写为成功或自动无限重试；重新派发由用户的明确重试意图触发。
- 恢复首次全量验收时清空修复范围标记；恢复局部修复验收时保留待解决范围，使其通过后仍进入最终全量验收。
- 修改 TypeScript 源码并通过 `pnpm build:native-runtime` 生成发布资产，不直接维护 `dist` 或 bundle 中的业务逻辑。

# 待解决问题

无。

# 验证预期

- 为 unavailable → retry → dispatch 增加 Runtime 与 CLI 回归测试，覆盖首次全量和修复范围两种验收范围。
- 保留并运行 execution-error 连续失败、降级确认、stale continuation、Verifier 结果绑定相关测试。
- 运行 Native Runtime 构建和生成物一致性检查；根据跨 Runtime、Skill 与发布资产的风险运行最终全量测试、lint 和 build。
