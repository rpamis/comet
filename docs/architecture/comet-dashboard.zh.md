# Comet Dashboard

Dashboard 是项目观测和管理入口。React 和 Ant Design 界面通过本地 HTTP 服务取得 Native、Classic、Any 和 Eval 的视图。`comet dashboard --json` 提供一次性项目快照。项目设置、应用分发、评估管理、插件和记忆操作由对应入口执行。

```mermaid
flowchart LR
    UI[React / Ant Design] --> Server[本地 HTTP 服务]
    CLI[comet dashboard --json] --> Collect[项目采集与投影]
    Server --> Collect
    Server --> Commands[设置、分发与 Eval 管理入口]
    Collect --> Changes[Native / Classic 状态与 Git]
    Collect --> Any[Creator 和应用只读观察]
    Collect --> Eval[Eval 查询入口]
    Collect --> Index[项目和 worktree 隔离的 SQLite 索引]
```

## 查询与刷新

```mermaid
sequenceDiagram
    participant UI as Dashboard
    participant Route as HTTP 路由
    participant Query as 采集器
    participant Index as 摘要索引
    participant Source as 领域记录
    UI->>Route: 打开当前工作区
    alt Native 或 Classic
        Route->>Query: 读取当前工作流的总览
        Query-->>UI: 返回首屏所需数据
        opt Classic
            UI->>Route: 首屏加载后查询归档总数
            Route->>Query: 单独读取归档摘要
            Query-->>UI: 更新归档总数
        end
    else Any、应用或 Eval
        Route->>Query: 查询当前页面的列表
        Query->>Index: 查询摘要并安排刷新
        Index->>Source: 发现并更新有变化的来源
        Query-->>UI: 返回当前摘要和索引状态
    end
    UI->>Route: 打开某个 Run 或工件
    Route->>Query: 获取当前选中的记录
    Query->>Source: 重读 Run 并核对固定身份
    Query-->>UI: 详情、证据或明确的读取诊断
```

Native 和 Classic 的浏览器总览用 `/overview?workflow=native` 或 `/overview?workflow=classic`。Classic 活跃列表和摘要独立读取活跃目录，归档数量未读取时为 `null`，归档和全部页面继续使用原有分页。省略 `workflow` 时返回完整总览。`comet dashboard --json` 继续读取完整快照。插件目录用于导航，页面详情和项目配置在打开对应页面或设置时读取。

列表索引可以重建。详情从实际记录解析动作、决定、证据和子流程，保留读取失败与记录尚未同步的差别。浏览器刷新后恢复当前选择，观测结果未知的 Action 继续显示未知。预览工件以当前记录保存的标识和允许路径为准，应用观察的 JSON 投影在返回浏览器前过滤领取凭据等敏感字段。

## 读模型

```mermaid
erDiagram
    WORKSPACE ||--o{ SUMMARY_SOURCE : scopes
    SUMMARY_SOURCE ||--o{ RUN_SUMMARY : projects
    RUN_SUMMARY ||--o| RUN_DETAIL : locates
    RUN_DETAIL ||--o{ EXECUTION_RECORD : shows
    RUN_DETAIL ||--o{ EVIDENCE_VIEW : shows
    RUN_DETAIL ||--o{ ARTIFACT_VIEW : references
```

应用观察按固定包身份关联 Creator 的本地和模型证据，另行显示历史或不可用的证据。读取详情只使用 SDK 观察入口和已保存的应用材料。运行中的创作、审批、重试与业务推进由 Agent 使用对应 Runtime；明确的分发操作交给应用领域。详见 [Any 过程观测](dashboard-any.zh.md)。

| 职责                             | 源码入口                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI、HTTP 与客户端               | [dashboard.ts](../../app/commands/dashboard.ts)、[server.ts](../../domains/dashboard/server.ts)、[界面](../../domains/dashboard/web/)                                                                                    |
| Native/Classic Change 和摘要索引 | [native-collector.ts](../../domains/dashboard/native-collector.ts)、[collector.ts](../../domains/dashboard/collector.ts)、[summary-index.ts](../../domains/dashboard/summary-index.ts)                                   |
| Any 和 Eval 的投影               | [application-collector.ts](../../domains/dashboard/application-collector.ts)、[application-evidence.ts](../../domains/dashboard/application-evidence.ts)、[eval-collector.ts](../../domains/dashboard/eval-collector.ts) |

运行和验证命令见 [Dashboard 开发说明](../../domains/dashboard/README.md)。
