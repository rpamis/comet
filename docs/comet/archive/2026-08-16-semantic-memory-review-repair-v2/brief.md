# 目标

修复父级语义自进化记忆 Verify 发现的第二轮缺口，使自动和显式记忆都经过同一安全、语言和动作闭环，并让 Eval 报告可独立审计。

# 范围

- 评审包支持有界显式记住、纠正和遗忘请求，分别生成 `create`、`update`、`forget` 或 `skip`。
- 自动路径补齐少量用户证据和稳定 checkpoint 事实；后台能力不可用时非阻塞降级。
- 直接 remember/correct 与 review path 使用一致的安全、PII、注入和语言边界；中文配置生成中文自动类别与说明。
- Eval 报告明确拆分形成质量、检索质量、后续行为，并使用不可变阈值配置。
- Eval 的 treatment latency、timeout、degradation、stale resurrection、下游成功率和 treatment hash 来自实际运行结果；数据集输入、Skill/Runtime 内容、Judge rubric 和阈值配置都有内容 hash。
- Judge 与被测 Eval 编排分离；阈值报告既保留原始指标，也明确相对 current-observe 的发布判断。

# 非目标

- 不修改 Comet Guard、Native/Classic 状态机或引入新的 scheduler、embedding、向量数据库。
- 不保存完整 transcript、原始日志、完整 diff 或凭据。

# 验收示例

- 自动和显式评审都能安全地产生或应用 create/update/forget/skip，且错误动作不落盘。
- `zh-CN` 自动记忆的 category、title、reason 和提示均为中文；直接 CLI 文本保留原文。
- 宿主无后台 Agent 时仍由当前协调流程完成同一有界评审，失败不阻塞主 workflow。
- Eval 的报告正文独立列出 formation quality、retrieval quality、downstream behavior，阈值来自冻结配置而不是运行结果。
- 删除后重放旧证据不会复活旧记忆；报告包含 stale resurrection 结果、三种 treatment 的实测指标和独立 Judge 证据。
