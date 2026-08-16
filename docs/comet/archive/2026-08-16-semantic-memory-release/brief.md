# 目标

为已经完成的语义个人记忆能力补齐可交付的双语用户文档和发布元数据，让用户能清楚理解“什么会被记录、什么时候静默、如何查看和纠正”，并确保中文配置下的用户可见内容保持中文。发布收口不改变已经通过 Eval 的 Runtime、Skill、CLI、Dashboard 或 Native/Classic 行为。

# 范围

- 新增中文和英文的个人记忆用户文档，完整描述显式记忆、自动复盘、检索、纠正、遗忘、回滚、暂停、同步、冲突和安全边界。
- 文档分别说明 `zh-CN` 与 `en` 配置下的用户可见语言，并说明命令、路径和机器枚举可保留原文。
- 核对共享 `comet-memory` 的中英文资产、agent metadata、manifest 和安装发现契约；如发现发布阻断问题，只做最小同步修正并先改中文版再同步英文版。
- 根据 `origin/master` 和当前分支的真实版本基线更新 package、lockfile、asset manifest、发布元数据测试和英文 `CHANGELOG.md`。
- 运行发布所需的格式检查、架构/lint、生成 Runtime 检查、构建、全量测试和语义记忆 Eval。

# 非目标

- 不新增记忆策略、embedding、向量数据库、知识图谱、Skill 自进化或 Project Rules 自动升级。
- 不修改已经归档子 Change 的核心 Runtime、Personal Memory、Dashboard 或生命周期接线，除非发布验证证明存在真实阻断。
- 不把 Runtime 文件、candidate ID、evidence 数量、隐藏推理或内部验收过程写入用户文档或 Changelog。
- 不扩展 README、网站、GitHub Issue/PR、发布推送或其他未确认的外部交付面。

# 验收示例

- R1：中文和英文用户文档存在、结构对应，内容只描述当前已实现行为，不把“计划能力”写成已发布能力。
- R2：文档明确说明中文配置会记录中文的自动正文、标题、类别、标签和原因；直接 CLI 输入保留用户原文；英文配置对应英文。
- R3：文档明确说明显式 `remember`/纠正/遗忘会短确认，后台复盘、候选和 `skip` 默认静默，只有首次实际改变处理方式或冲突时才短提示。
- R4：文档覆盖 CLI/Dashboard/Markdown/Git sync 同一权威状态，以及本地可用、同步失败不阻塞、冲突不静默覆盖和用户可回滚的体验。
- R5：`comet-memory` 中英文 Skill、agent metadata、manifest 和安装发现保持一致，未引入独立的 workflow 判断规则。
- R6：package、package-lock、asset manifest 和发布元数据测试统一为比 `origin/master` 高一个 beta 版本；Changelog 只记录升级用户可感知的最终能力。
- R7：发布检查全部通过：格式、lint/架构、生成资产、构建、全量测试和最终语义记忆 Eval。

# 约束与不变量

- 本子 Change 的正式产物语言为中文；用户可见 Changelog 必须为英文，双语用户文档语义一致。
- 当前分支的既有功能提交和其他用户改动必须保留；只提交本子 Change 的发布文档和元数据。
- 任何 Runtime 生成资产必须由源码构建或生成检查确认，不能只手工修改 bundle。
- 版本号只能根据 `origin/master` 和实际发布基线确定；不得把开发过程、普通回归测试或内部修正写成用户可见发布内容。

# 决策

- 发布版本采用 `0.4.0-beta.21`：`origin/master` 为 `0.4.0-beta.19`，当前分支已经包含 beta.20，且本次功能是 beta.21 的新增用户能力。
- 正式用户文档放在 `docs/operations/`，不扩展 README；这样保留 README 的克制，同时提供可引用的完整说明。
- 以现有 CLI、Dashboard、Markdown 和 Git sync 实现为事实来源，文档只承诺已验证的入口和行为。

# 待解决问题

无。

# 验证预期

- 先执行双语文档与发布元数据的受影响格式/契约检查，再执行完整发布验证。
- 使用 `pnpm check:generated` 确认 Classic、Native、Entry bundle 与源码一致；使用 JSON 和 Markdown 两种输出执行最终 Eval。
- 独立 Verifier 逐项检查 R1-R7，并核对父 Change 的 A1-A23 用户可见发布要求没有被文档或版本收口削弱。
