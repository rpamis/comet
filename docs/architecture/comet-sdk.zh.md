# Comet SDK

Runtime SDK 管理版本化工作流、运行状态、Action、决定和恢复。Agent 平台通过注册的执行端口落实 Skill、工具和交接。应用 SDK 将领域流程、适配契约、工件和分发组装为完整应用。插件 SDK 提供独立的平台插件契约。

```mermaid
flowchart LR
    Host[Agent 平台 / CLI] --> App[应用 SDK]
    Host --> Runtime[Runtime SDK]
    Extension[平台插件] --> Plugin[插件 SDK]
    App --> Definition[领域 Workflow Definition]
    Definition --> Runtime
    Runtime --> Scheduler[工作流调度与校验]
    Runtime --> Store[Runtime Store]
    Runtime -->|返回可领取 Action| Host
    Host -->|提交 Outcome 或决定| Runtime
```

| 公开导出                                                                    | 用途                              |
| --------------------------------------------------------------------------- | --------------------------------- |
| `@rpamis/comet/runtime`                                                     | 定义、调度、Store、执行端口和恢复 |
| `@rpamis/comet/applications`                                                | 加载、适配、观察、分发与证据      |
| `@rpamis/comet/applications/native`、`@rpamis/comet/applications/classic`   | 对应领域的应用组合工厂            |
| `@rpamis/comet/applications/creator`、`@rpamis/comet/applications/compiler` | 创作 Runtime 和确认方案编译       |
| `@rpamis/comet/plugins`、`@rpamis/comet/plugins/comet`                      | 插件 SDK 和 Comet 平台集成        |

## Run 与动作

```mermaid
erDiagram
    WORKFLOW_DEFINITION ||--o{ WORKFLOW_RUN : versions
    WORKFLOW_RUN ||--o{ STEP_ACTIVATION : schedules
    STEP_ACTIVATION ||--o{ ACTION : issues
    ACTION ||--o{ ACTION_ATTEMPT : claims
    ACTION_ATTEMPT ||--o| OUTCOME : records
    WORKFLOW_RUN ||--o{ WAIT : requires
    WAIT ||--o| USER_DECISION : resolves
    WORKFLOW_RUN ||--o{ EVIDENCE_WAIT : tracks
    WORKFLOW_RUN ||--o{ WORKFLOW_RUN : parents
```

Run 固定 Workflow Definition 及其输入，包含已就绪工作、执行尝试、决定、证据和子 Run 引用。每次写入核对相应 Run revision。调度器按合法边、触发条件与步骤约束推进，Store 保存可恢复记录。业务验证器和原领域规则决定某个结果是否足以完成业务步骤。读取接口可以只返回必要投影。

```mermaid
flowchart TD
    Start[启动或读取原 Run] --> Next[next 调度并返回当前工作]
    Next -->|可执行| Claim[领取 Action 和当前 attempt]
    Claim --> Work[平台执行并保存结果]
    Work --> Outcome[提交绑定当前 Action 的 Outcome]
    Outcome --> Next
    Work -->|结果未知| Reconcile[核对原执行并按协议恢复]
    Reconcile --> Next
    Next -->|等待决定| Decide[提交当前 Wait 的用户决定]
    Decide --> Next
    Next -->|等待证据或子流程| Evidence[记录证据或读取子 Run 结果]
    Evidence --> Next
    Next -->|终态| End[读取最终结果]
```

进程退出后先读取原 Run，已领取或结果未知的动作按执行证据恢复。通用 SDK 提供内存与文件 Store。内置业务应用另有工作区定位和可移植检查点，用于对应 Change 的恢复。公开协议见 [Runtime SDK](runtime-sdk.zh.md)、[本地存储](runtime-local-storage.zh.md)、[恢复与规模](runtime-recovery-and-scale.zh.md) 和 [发布契约](sdk-release-contract.zh.md)。

只读使用 `inspect` 或 `query`。`next` 可以保存调度结果，也会协调实际子流程的启动与推进。

| 职责               | 源码入口                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime API 和定义 | [runtime.ts](../../domains/engine/runtime.ts)、[workflow-definition.ts](../../domains/engine/workflow-definition.ts)                                                                    |
| Run、调度和 Store  | [workflow-run.ts](../../domains/engine/workflow-run.ts)、[workflow-scheduler.ts](../../domains/engine/workflow-scheduler.ts)、[runtime-store.ts](../../domains/engine/runtime-store.ts) |
| 执行端口与应用适配 | [runtime-handlers.ts](../../domains/engine/runtime-handlers.ts)、[应用 SDK](../../domains/workflow-application/index.ts)                                                                |
| 插件与发布入口     | [插件 SDK](../../domains/comet-plugin/sdk.ts)、[包导出](../../package.json)、[API 快照](../../config/sdk-api/)                                                                          |

首次接入见 [SDK 快速接入](sdk-getting-started.zh.md)。
