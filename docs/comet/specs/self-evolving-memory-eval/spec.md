# 自进化记忆质量评估

## 目的

Comet 必须用可复现评估证明语义记忆比当前命令摘要观察更准确、更少噪声，并确实改善后续任务。状态机测试和“成功写入文件”不能替代记忆质量评估。

## Treatments

同一任务集至少运行：

1. `no-memory`：不形成或检索记忆；
2. `command-summary-observe`：保持当前基线行为；
3. `semantic-comet-memory-review`：使用新 Skill、Runtime 动作和检索闭环。

每个 treatment 使用冻结任务、相同基础模型/Agent 配置和可追溯版本；报告记录 Skill、Runtime、数据集和评分规则 hash。

## 数据集

数据集同时覆盖 `zh-CN`/`en` 与 Classic/Native，并包含：显式创建、重复隐式创建、一次性内容跳过、近义合并、纠正更新、明确遗忘、global/project 作用域、矛盾证据、时间更新、secret/PII/prompt injection、多会话检索、无相关记忆时 abstain、同 Change 多候选、重复事件幂等和记忆对后续任务行为的影响。

任务既包含确定性期望，也包含需要语义判断的样例。语义样例由独立 Judge 根据冻结 rubric 评分；安全、schema、scope、语言、幂等、文件变化和下游测试优先使用确定性验证。

## 指标

- extraction precision / recall；
- harmful or noisy save rate；
- skip accuracy；
- create/update/forget operation accuracy；
- scope accuracy；
- language compliance；
- deduplication/consolidation accuracy；
- stale-memory resurrection rate；
- retrieval precision / recall；
- downstream task success delta；
- injected context bytes/tokens；
- latency、超时和失败降级率。

报告必须分开展示“形成质量”“检索质量”和“后续行为”，不能用单个综合分数掩盖安全或作用域退化。

## 发布门槛

`semantic-comet-memory-review` 必须相对 `command-summary-observe` 提高有效记忆 precision 和后续任务成功率，并且不得提高 harmful/noisy save、错误 scope、错误语言或 stale resurrection。上下文预算和延迟必须有界。

具体数值阈值在首次基线测量后固化到 Eval 配置和说明中，不能事后按新实现结果修改。未达到门槛时先调整证据包、Skill 判断和合并规则；没有检索证据前不引入 embedding、向量数据库或更大上下文。

## 可复现性与失败归因

Eval 保存每个任务的输入摘要、期望动作、实际动作、持久状态差异、检索结果、后续任务结果、评分证据和失败分类，但不保存真实凭据、用户私有对话或无界日志。

失败至少归类为 evidence、extraction、action、validation、persistence、retrieval、language、scope、safety、host-integration 或 downstream-behavior，便于确定应修 Skill、Runtime 还是检索。

## 非目标

- 不把供应商论文数字当作 Comet 的效果承诺。
- 不只使用单轮合成样例或只测写入成功。
- 不因 Eval 基础设施不足阻塞核心实现；如果 #298 尚未交付，先使用现有 `eval/local` task/treatment 结构。
