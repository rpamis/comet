# 目标

收口语义自进化记忆的集成闭环：显式 CLI 记忆操作、Native/Classic/任务结果证据和 Eval 下游验证都使用同一条有界评审路径；中文配置下自动生成的记忆内容保持中文，并让后续任务基于真实检索结果做出决策。

# 范围

- 显式 `remember/correct/remove` 操作进入统一 review packet/action 校验路径，并支持永久删除语义。
- Native、Classic 和任务命令把用户可读的任务描述作为有界证据传入记忆生命周期。
- Eval 的下游任务真实调用记忆检索，记录检索数量和非零延迟，避免只验证静态字段。
- 同步相关测试、TypeScript、lint、构建和 Eval 验证证据。

# 非目标

- 不新增 self-improve 行为，不让记忆系统修改 Skill 或产品规则。
- 不改变现有记忆存储边界、脱敏规则、自动候选阈值或 Native/Classic 状态机版本。

# 验收示例

- CLI、Native、Classic 和 Eval 共享同一条有界记忆评审与证据闭环，且后续任务行为基于真实检索结果。
- 中文配置下自动记忆的标题、理由、正文和标签通过语言校验；显式用户原文可按原语言保留。
- 显式记住立即产生 active 记忆，纠正和忘记复用统一评审入口，永久忘记不会被后续自动流程恢复。
- Eval 真实检索后下游决策成功增量达到冻结阈值，延迟、超时和降级指标均通过。

# 约束与不变量

- 自动生成动作必须遵守配置语言和安全/长度边界；直接用户请求仍必须经过相同的结构校验。
- Runtime 证据只保留有界用户可读内容，不写入候选 ID、内部计数器或原始日志/差异。
- 插件记忆故障继续保持非阻塞，不能影响宿主主流程。

# 决策

- v3 只修复评审发现的集成缺口，沿用父 Change 的既有 review-contract、Native/Classic 分层和 children v1 兼容模式。
- Eval 使用确定性下游决策，检索调用和延迟测量是真实执行结果；处理时间变量不进入稳定 treatment hash。

# 待解决问题

- 无。

# 验证预期

- 相关 Vitest：记忆领域、CLI、Native、Classic、任务命令和 semantic-memory Eval 全部通过。
- `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build` 通过。
- semantic-memory Eval 的冻结阈值通过，且下游检索记录数、延迟、成功增量均有断言。
