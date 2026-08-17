# 目标

修复语义自进化记忆在独立验收中暴露的真实体验缺口：一次性用户任务不能被自动记录；生产插件必须经过 `comet-memory` Skill 调用边界；中文配置允许技术专有名词但不接受英文句子；Eval 必须在同一任务定义上运行真实 `current-observe` 基线和真实下游检索；首次实际复用和冲突需要以短通知交给 CLI、Workflow 和 Dashboard。

# 范围

- 增强一次性请求、命令摘要、测试摘要和工作流状态的跳过判定，同时保留显式 remember/correct/forget 优先级。
- 增加 `MemoryReviewSkillRunner` 边界；宿主可调用已安装 `comet-memory` Skill，内置有界适配器用于无法 fork Agent 的宿主，Skill 失败、输出无效或校验失败时安全跳过。
- 放宽中文自动记忆中的技术专有名词混排校验，继续拒绝英文自然语言正文；自动生成标题、理由和标签遵守配置语言。
- 将通知接入插件、Entry Workflow 和 Dashboard；自动流程只在第一次实际检索应用或发生冲突时提示，显式操作即时确认。
- 将 semantic-memory Eval 的 current-observe treatment 改为真实隔离 Personal Memory Runtime，记录真实状态、检索和下游决策，不再使用固定摘要条数作为结果；运行时 provenance 覆盖 Skill 边界和插件集成源码。

# 非目标

- 不做 self-improve，不让记忆修改 Skill、AGENTS、Project Rules、Specs、测试、构建或 CI。
- 不改变 Native/Classic 状态机、记忆文件布局、永久 forget tombstone 或检索算法。

# 验收示例

- `请帮我修复登录页面样式` 和 `这次测试通过了` 的隐式评审返回唯一 `skip`；显式“记住”仍立即保存。
- `Dashboard 使用 Ant Design` 在 `zh-CN` 下可以作为自动记忆正文，英文句子不会冒充中文自动正文。
- 宿主传入 Skill runner 时收到有界 `comet.memory.review.v1` packet；runner 不可用或返回非法动作时主 workflow 仍成功并保持原记忆状态。
- 自动候选只在第一次通过检索真正注入任务上下文时提示；冲突只提示一次，Dashboard 能展示通知。
- Eval 的三种 treatment 都有真实记录/检索结果，冻结动作、提取、检索、下游、延迟和失败降级指标通过。

# 验证预期

- 记忆契约、插件集成、CLI/Entry、Dashboard 和 semantic-memory Eval 相关测试通过。
- TypeScript、Lint/Architecture、Dashboard 构建和仓库构建通过。
