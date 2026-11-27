# Comet Eval

Comet Eval 从明确的目标、用例和执行配置生成可复查的评估结果。CLI、Dashboard 和 Creator 复用 Eval 领域规则，并保有各自的用户确认入口。确定性的 `comet skill check` 和 Creator 本地产物验收各有自己的证据来源。

```mermaid
flowchart LR
    CLI[comet eval] --> Eval[Eval 领域]
    UI[Dashboard Eval] --> Eval
    Creator[Creator 可选评估] --> Eval
    Eval --> Resolve[目标解析和用例准备]
    Eval --> Runs[运行记录与报告]
    Eval --> Execution[实验执行和停止恢复]
    Execution --> Executor[本地或容器执行器]
    Executor --> Judge[判定与可选独立评分]
    Judge --> Runs
    Runs --> Compare[范围校验和基线比较]
```

## 评估生命周期

```mermaid
flowchart TD
    Target[Skill / Eval 清单 / SDK 应用] --> Input[解析输入与用例]
    Input --> Preview[收集预览与环境检查]
    Preview -->|仅收集| Stop[结束预览]
    Preview -->|明确启动| Run[记录实验并执行指定范围]
    Run --> Grade[收集用例状态、判定与产物]
    Grade --> Assess[计算完整性、证据有效性和结论]
    Assess --> Report[生成报告并保留诊断]
    Report -->|范围匹配且符合资格| Baseline[设置或比较基线]
    Report -->|适用时| Retry[用原固定范围重跑失败用例]
    Retry --> Preview
```

应用评估固定整包内容与所用用例。Skill 可从本地目录或 `SKILL.md` 解析，也可使用 `comet/eval.yaml` 定义的用例。执行 Agent 和独立 Judge 保存各自的执行证据，报告展示实际覆盖。中断的运行保留已完成记录，停止与修复根据实验、进程和容器的已记录归属处理。

## 领域模型

```mermaid
erDiagram
    TARGET_IDENTITY ||--o{ EVAL_RUN : evaluated_by
    EVAL_RUN ||--o{ CASE_RESULT : records
    CASE_INPUT ||--o{ CASE_RESULT : supplies
    EVAL_RUN ||--o{ REPORT : produces
    BASELINE_SCOPE ||--o{ EVAL_RUN : compares
    BASELINE_SCOPE ||--o| BASELINE_SELECTION : selects
    EVAL_RUN ||--o{ RETRY_RUN : supplies
```

每个基线范围按目标、用例和评分等比较条件确定，最多选择一个默认基线。报告分别保留执行状态、完整性、证据有效性、质量和结论。失败用例重跑产生新记录并绑定来源，局部结果继续作为局部证据。Dashboard 从 Eval 入口读取列表、详情、报告和可用操作，应用交付依据已保存且与固定包匹配的评估证据。

| 职责                 | 源码入口                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公开入口与目标解析   | [eval.ts](../../app/commands/eval.ts)、[standalone-context.ts](../../domains/eval/standalone-context.ts)                                                                                    |
| 预览、应用输入与运行 | [eval-run-preview.ts](../../domains/eval/eval-run-preview.ts)、[application-eval.ts](../../domains/eval/application-eval.ts)、[eval-run-manager.ts](../../domains/eval/eval-run-manager.ts) |
| 记录、基线和失败重跑 | [eval-run-store.ts](../../domains/eval/eval-run-store.ts)、[eval-run-retry.ts](../../domains/eval/eval-run-retry.ts)                                                                        |
| 隔离执行和数据集     | [Eval 执行目录](../../eval/)、[builtin-datasets.ts](../../domains/eval/builtin-datasets.ts)                                                                                                 |

操作说明见 [Comet Eval 使用指南](../operations/EVAL-USAGE-ZH.md)。修改模型 Eval 的操作流程时，按根 [AGENTS.md](../../AGENTS.md) 核对启动授权及场景范围。
