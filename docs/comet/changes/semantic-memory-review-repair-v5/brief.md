# 目标

修正语义记忆 Eval 的下游成功判定：current-observe 如果只能要求用户再次提供偏好，不能被报告为已完成后续任务；在不修改冻结阈值的前提下，让对照指标反映真实用户收益。

# 范围

- 为 current-observe treatment 保留“需要用户补充”的可观察结果，并将其计为未完成；
- 增加回归测试，覆盖基线要求用户补充、semantic-review 直接复用记忆的场景；
- 重跑 semantic-memory Eval，确认冻结阈值与全套已有检查保持有效。

# 非目标

- 不调整冻结阈值；
- 不改变 Personal Memory 的实际保存、检索、通知或 Skill 行为；
- 不引入 embedding、向量数据库或更大上下文。

# 验收示例

- Eval 的跨项目下游场景中，current-observe 的“请用户补充偏好”被计为失败，semantic-review 的复用被计为成功；
- `downstreamTaskSuccessDelta` 达到冻结的 1.0，`thresholdsPassed` 为 `true`；
- 全部相关测试继续通过。

# 约束与不变量

- 保持父 Change 的中文正式产物和现有 acceptance 语义；
- 只修正评估的可观察完成判定，不用实现结果反向调整阈值；
- 不保存用户私有对话或无界日志。

# 决策

- 使用显式的基线字段表达“需要用户补充”，避免依赖展示文案字符串推断成功与否。

# 待解决问题

# 验证预期

- 运行 `test/domains/eval/semantic-memory-eval.test.ts`；
- 运行 `scripts/benchmark/semantic-memory-eval.mjs`；
- 运行受影响文件格式、lint 和 TypeScript 检查。
