# Comet 工作流语言

Comet 复用 Agent 平台的推理与工具执行循环，提供可持久化的 Skill 编排。Native、Classic 和独立工作流拥有各自的业务规则。

## Language

**Run**：一份工作流定义的一次执行实例，可以跨越多个 Agent 会话。
_Avoid_: 用 Agent Session 代指工作流实例。

**Action**：工作流允许执行的一项工作，具有独立身份、输入绑定和执行尝试。
_Avoid_: 再引入一套与 Action 同义的 Task 名称。

**Outcome**：执行者对某个 Action 的一次结果回报；回报成功不等于业务验收通过。
_Avoid_: 将执行回报直接称为验收证明。

**Wait**：流程等待用户决定或外部条件的持久化事实，与对应提案及恢复条件绑定。

**Checkpoint**：从已提交工作流边界继续所需的持久化记录。

**Workflow Definition**：工作流允许的步骤、转换、输入输出与业务规则的版本化定义。

**Workflow Application**：基于 SDK 管理完整 Run，并提供自身工作流定义、业务规则和 Agent 平台适配的产品流程。Native 和 Classic 提供内置应用。
_Avoid_: 将只复用某个 SDK 协议的局部接入称为完整的 Workflow Application。

**Host**：执行 Skill、工具、交接和用户交互的 Agent 平台。

**Skill Package**：可发现、校验、安装并固定内容的结构化 Skill 定义，包含编排与运行检查。
_Avoid_: 把每个 Agent 平台的 `SKILL.md` 都称为结构化 Skill Package。

**Creator Run**：记录目标、方案、确认、验证及交付的一次 SDK 创作过程。
_Avoid_: 用最终应用的一次业务执行代指创作过程。

**Eval Run**：记录目标、用例、执行配置、样本结果和报告的一次评估实验。
_Avoid_: 将确定性 Runtime 检查或阶段产物验收称为模型 Eval。

**Baseline**：同一评估范围中被选作比较参照的完整 Eval Run。

**Projection**：从已记录事实生成的状态视图，可供 CLI、Dashboard 或恢复流程读取。推进仍由拥有该状态的领域或 Runtime 执行。
