# 目标

建立可复现的语义记忆质量评估，证明 Comet 的 `comet-memory` 在用户真正关心的体验上优于旧的 command-summary 观察：记录更少但更有用，语言跟随配置，候选和作用域可追溯，危险/一次性内容会跳过，后续任务能检索到正确的记忆。

# 范围

- 构建固定、脱敏、无真实凭据的 Eval 数据集，覆盖 `zh-CN`/`en`、Native/Classic、full/hotfix/tweak。
- 覆盖显式 remember、重复隐式候选、同 Change 多候选、跨 Change 稳定证据、近义合并、纠正、遗忘、回滚、冲突、暂停和 Git 同步降级。
- 覆盖一次性要求、命令成功/测试数量/Change/PR/Issue 摘要、仓库可重查事实、原始日志、完整 diff、PII、secret 和 prompt injection 的拒绝或 skip。
- 覆盖 global/project 作用域、跨项目全局证据、candidateKey 幂等、失败/取消/重试不虚增计数、语言一致性和无相关记忆时 abstain。
- 记录每个 case 的期望动作、实际 action、状态差异、检索文本、后续任务结果、评分证据和失败分类；不记录完整 transcript、真实用户内容或隐藏推理。
- 提供可在本地运行的确定性命令和汇总报告，用于回归比较，不把质量判断简化为“文件写成功”。

# 非目标

- 不在本 child 引入新的记忆策略、embedding、向量库、scheduler 或生产运行时分支。
- 不修改 `comet-memory` Skill、Native/Classic 状态机、Dashboard/CLI 用户体验。
- 不把基准数据上传外部服务，不依赖网络模型调用，不使用真实凭据/PII。

# 验收示例

1. 每个数据集 case 都能在干净临时目录中重复运行，结果包含期望/实际动作和持久化状态差异。
2. 旧 command-summary 基线会产生流水账或语言不匹配，新实现对一次性/日志/普通事实返回 skip，并保持状态不增长。
3. 同一项目两个独立成功 Change 的一致证据只能激活 project 记忆；没有跨项目证据时不能自动激活 global 记忆。
4. 同一 Change 重试、恢复或重复 candidateKey 不增加独立证据；不同 candidateKey 可并列评估。
5. 显式记忆高于隐式矛盾证据，冲突不被静默覆盖；纠正/遗忘/回滚的用户可见结果正确。
6. 中文配置的正文/类别/标签为中文，英文配置为英文；机器枚举可保持英文。
7. 无相关记忆时检索 abstain，不因为关键词碰巧相似而注入错误上下文。
8. secrets、PII、prompt injection、完整日志/diff 都不落盘；所有测试结果可生成稳定 JSON/Markdown 报告。

# 约束与不变量

- 测试时间、随机源、项目身份和临时存储均可控，重复运行产生稳定结果。
- 每个 case 使用隔离的 memory root 和 project identity，测试结束清理临时目录。
- 评估区分“契约正确”“记忆质量正确”“后续任务收益”和“执行基础设施失败”，不把类型/状态测试当作语义质量证明。
- 评分证据只引用有限字段和状态摘要，不输出完整记忆 Runtime、候选 ID、evidenceKeys 或隐藏推理给普通用户。
- 基线与新实现使用同一数据集、同一查询和同一预算；报告明确标出基线差异。

# 决策

- 以 case-level precision/recall、skip precision、scope/language correctness、安全拒绝率、幂等错误率、冲突保护率和后续任务收益为核心指标。
- 设硬性失败项：危险内容落盘、错误作用域注入、语言违约、同一候选重复计数、显式记忆被隐式覆盖、无相关记忆强行注入。
- 允许少量召回损失换取安全和低噪声；没有有用内容返回 skip 是成功，不是失败。

# 待解决问题

- 确认现有 domain/experience 测试可复用的工厂和时间控制接口，避免在 Eval 中复制生产逻辑。
- 确认 Eval 报告只加入用户可运行的测试资产，不把一次性运行产物或本机路径提交进仓库。

# 验证预期

- 先写 baseline/new evaluator 的红测，再实现固定数据集、runner 和报告汇总。
- 运行 Eval 子集后运行完整 Eval、相关 domain 回归和 TypeScript/ESLint/Prettier；跨层发布前由 parent 再执行全量测试。
