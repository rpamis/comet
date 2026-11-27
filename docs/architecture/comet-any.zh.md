# Comet Any

`/comet-any` 通过 `comet creator` 从用户目标创作可恢复的工作流应用。Creator 使用固定的 SDK 定义。Agent 调查和编写业务内容，组合器根据已确认方案组装运行定义、入口 Skill、Rule、绑定与验证器。

```mermaid
flowchart LR
    Agent[Agent 平台和用户] --> Creator[Creator 用例]
    Creator --> Skills[Skill 调查与适配]
    Creator --> Compiler[方案组合与编译]
    Compiler --> Bases[Native 扩展 / Classic 编排 / 独立流程]
    Compiler --> Verification[本地加载与隔离验收]
    Creator -->|用户选择后| Eval[Comet Eval]
    Creator --> Delivery[工作流应用分发]
    Delivery --> Install[平台安装与完整包导出]
    Creator --> SDK[SDK Runtime 与 Store]
    Bases --> SDK
```

## 创作与交付

```mermaid
flowchart TD
    Goal[目标和真实 Skill 调查] --> Plan[方案和固定依赖]
    Plan --> Confirm{确认当前方案}
    Confirm -->|修订| Goal
    Confirm -->|批准| Compile[编译并加载固定包]
    Compile --> Verify{隔离阶段产物与流程验收}
    Verify -->|失败| Recovery[检查失败与恢复选择]
    Recovery -->|重试| Verify
    Recovery -->|修订| Goal
    Recovery -->|拒绝| Stop[停止并保留记录]
    Verify -->|通过| EvalChoice{是否执行模型 Eval}
    EvalChoice -->|明确选择执行| Eval[固定用例和评估范围]
    Eval --> EvalResult{评估结果}
    EvalResult -->|通过| Preview[完整包和安装预览]
    EvalResult -->|失败或未完成| Review[决定重试、修订或跳过]
    Review -->|重试并重新确认| EvalChoice
    Review -->|修订| Goal
    Review -->|跳过| Preview
    EvalChoice -->|跳过| Preview
    Preview --> Approval{确认本次预览}
    Approval -->|批准| Deliver[导出并安装]
    Confirm -->|拒绝| Stop
    Approval -->|修订| Goal
    Approval -->|拒绝| Stop
```

恢复使用原 Creator Run 的 Action、Wait 和固定输入。结果未知时先核对环境中的原执行或产物。方案正文、依赖或安装预览变化后，按原流程重新确认受影响的决定。Native 和 Classic 组合沿领域工厂扩展，独立流程由自己的定义和验证器约束。详细分支及错误恢复以 [Creator 契约](workflow-creator.zh.md) 和 [编译契约](workflow-application-compiler.zh.md) 为准。

## 领域模型

```mermaid
erDiagram
    CREATOR_RUN ||--o{ PROPOSAL_REVISION : records
    PROPOSAL_REVISION ||--o{ SKILL_BINDING : fixes
    PROPOSAL_REVISION ||--o| APPROVAL : awaits
    PROPOSAL_REVISION ||--o| FIXED_APPLICATION : compiles
    FIXED_APPLICATION ||--o{ APPLICATION_RUN : starts
    FIXED_APPLICATION ||--o{ VERIFICATION_EVIDENCE : binds
    FIXED_APPLICATION ||--o{ INSTALL_PREVIEW : targets
    INSTALL_PREVIEW ||--o| INSTALL_RECORD : yields
```

Creator Run 保留方案和安装的确认上下文。应用 Run 执行已固定定义，Creator 与应用通过内容身份关联。SDK 子流程关系另由实际父子 Run 引用表达。阶段产物契约描述文件和内容要求，独立的本地、模型与 Agent 平台验证各自记录实际范围。`comet application` 管理固定应用的安装、导出和卸载。`comet bundle` 与 `comet publish` 仍是已有 Bundle 草稿和发布记录的入口。

| 职责               | 源码入口                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 用户入口与创作推进 | [Comet Any Skill](../../assets/skills-zh/comet-any/SKILL.md)、[creator.ts](../../app/commands/creator.ts)、[Creator 领域](../../domains/workflow-creation/creator.ts)          |
| 按方案组合与检查   | [编译器](../../domains/workflow-generation/compiler.ts)、[阶段产物验收](../../domains/workflow-generation/artifact-verification.ts)                                            |
| 应用加载、正式交付 | [应用入口](../../domains/workflow-application/index.ts)、[delivery.ts](../../domains/workflow-application/delivery.ts)、[平台适配](../../platform/install/application-host.ts) |

操作入口见 [工作流应用创建与交付](../operations/SKILL-CREATION-ZH.md)。
