---
generated_from_state_version: 11
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 2
- 验证器尝试次数: 1
- 完成时间: 2026-08-16T17:20:41.661Z
- 摘要: 第二轮独立复核通过：显式 scope skip 的作用域一致性已修复，指定 33 个回归测试、TypeScript、受影响 ESLint/Prettier、Entry Runtime 构建和 git diff --check 全部通过。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | specs/memory-workflow-integration/spec.md | 系统必须在 Native 和 Classic 的稳定成功检查点调用同一个公开的生命周期 Bridge，并向 Personal Memory 传递以下字段： | Native/Classic 均通过同一公开 lifecycle Bridge 接线。 |
| A2 | passed | specs/memory-workflow-integration/spec.md | `workflow`：`native`、`classic` 或其 `full`/`hotfix`/`tweak` 语义标识； | workflow 默认值和 full/hotfix/tweak 覆盖值均保持。 |
| A3 | passed | specs/memory-workflow-integration/spec.md | `changeId`：当前 change 的稳定标识； | Native/Classic facade 均传递稳定 changeId。 |
| A4 | passed | specs/memory-workflow-integration/spec.md | `candidateKey`：当前候选或检查点的稳定关联键； | candidateKey 由 Bridge 传入并保留到 Personal Memory observation。 |
| A5 | passed | specs/memory-workflow-integration/spec.md | `projectKey`：由稳定项目身份解析得到的当前项目键； | projectKey 来自稳定项目身份并写入事件 payload。 |
| A6 | passed | specs/memory-workflow-integration/spec.md | `language`：当前 workflow 配置语言； | Bridge 从 active workflow 配置解析语言并注入 payload。 |
| A7 | passed | specs/memory-workflow-integration/spec.md | 检查点名称、成功结果、短摘要和操作类别。 | 事件包含名称、成功结果、摘要、类别和操作。 |
| A8 | passed | specs/memory-workflow-integration/spec.md | 事件是检查点摘要，不得扩展为逐工具调用的观察日志。成功检查点只在主命令成功后发出；失败命令不产生 `success: true` 的生命周期记忆。 | 仅稳定检查点摘要接线，失败命令不发出成功记录。 |
| A9 | passed | specs/memory-workflow-integration/spec.md | **当** Native facade 成功执行 `next`、`handoff`、`check` 或 `archive` | Native next/handoff/check/archive 成功检查点均接线。 |
| A10 | passed | specs/memory-workflow-integration/spec.md | **那么** 通过 `recordCometWorkflowResult` 发出对应的 `task.completed`、`verification.completed` 或 `change.completed` 事件 | Native 事件名称正确映射为 task/verification/change.completed。 |
| A11 | passed | specs/memory-workflow-integration/spec.md | **并且** 事件保留 Native 的 workflow、changeId、candidateKey、projectKey 和配置语言 | Native workflow、changeId、candidateKey、projectKey、language 保持。 |
| A12 | passed | specs/memory-workflow-integration/spec.md | **当** Classic facade 成功执行 `state`、`guard`、`handoff`、`archive` 或现有工作区成功操作 | Classic state/guard/handoff/archive/workspace 成功检查点均接线。 |
| A13 | passed | specs/memory-workflow-integration/spec.md | **那么** 通过同一个 Bridge 发出对应生命周期事件 | Classic 使用同一个公开 lifecycle Bridge。 |
| A14 | passed | specs/memory-workflow-integration/spec.md | **并且** Classic 的状态机和归档语义不被 Native 接线改变 | Classic 状态机和归档协议未改变。 |
| A15 | passed | specs/memory-workflow-integration/spec.md | **当** 当前 workflow 是 `full`、`hotfix` 或 `tweak` | full/hotfix/tweak workflow 语义均可传递。 |
| A16 | passed | specs/memory-workflow-integration/spec.md | **那么** 事件中的 workflow 标识必须保留该值 | dispatchLifecycle 不重写调用方 workflow 标识。 |
| A17 | passed | specs/memory-workflow-integration/spec.md | **并且** 不同候选的 `candidateKey` 不得相互覆盖或串联 | candidateKey 纳入 observation 幂等键，候选不串联。 |
| A18 | passed | specs/memory-workflow-integration/spec.md | 工作流自动观察必须选择当前项目作用域并只 dispatch 一次 Personal Memory 观察。一次事件不得同时生成全局和项目两份记忆；跨项目的个人偏好只能由显式用户操作产生。Project Rules 现有上下文收集和能力调用语义必须保持不变。 | 自动生命周期只 dispatch 当前项目作用域，Project Rules 语义保持。 |
| A19 | passed | specs/memory-workflow-integration/spec.md | **当** 一个成功检查点被 dispatch | 单个成功检查点只执行一次项目作用域 dispatch。 |
| A20 | passed | specs/memory-workflow-integration/spec.md | **那么** Personal Memory 最多接收一条对应项目观察 | Personal Memory 只接收对应项目观察。 |
| A21 | passed | specs/memory-workflow-integration/spec.md | **并且** 全局记忆数量不因该检查点增加 | 生命周期事件不会增加全局记忆。 |
| A22 | passed | specs/memory-workflow-integration/spec.md | Bridge 必须把解析出的项目语言写入 lifecycle payload；Personal Memory 插件从 payload 构造 `MemoryObservation` 时必须保留语言和 `candidateKey`。中文配置下自动记录的类别和摘要必须通过中文语言约束，英文配置下通过英文语言约束。缺失配置回退 `zh-CN`。 | language 和 candidateKey 端到端保持并受服务层语言约束。 |
| A23 | passed | specs/memory-workflow-integration/spec.md | **当**项目默认 workflow 的语言是 `zh-CN` 且检查点成功 | 缺失配置回退 zh-CN，中文观察可处理。 |
| A24 | passed | specs/memory-workflow-integration/spec.md | **那么**自动观察使用 `zh-CN`，不因系统 locale 或宿主语言改变 | zh-CN 来自项目配置或默认值，不依赖系统 locale。 |
| A25 | passed | specs/memory-workflow-integration/spec.md | **当**项目默认 workflow 的语言是 `en` 且检查点成功 | 英文项目配置可解析 en。 |
| A26 | passed | specs/memory-workflow-integration/spec.md | **那么**自动观察使用 `en` | 英文 lifecycle observation 保留 en。 |
| A27 | passed | specs/memory-workflow-integration/spec.md | Personal Memory Skill、宿主桥接、Git/远端同步和后台学习均为可选能力。能力不可用、超时、返回无效数据或抛出错误时，Bridge 必须吞掉该诊断并让 Native/Classic 保持原有状态、输出和退出码。不得用 catch 隐藏 workflow 主命令本身的失败。 | 插件、宿主桥接、同步和后台学习失败均为非阻塞。 |
| A28 | passed | specs/memory-workflow-integration/spec.md | **当** lifecycle dispatch 或 memory sync 失败 | dispatch 和 sync 失败均被隔离。 |
| A29 | passed | specs/memory-workflow-integration/spec.md | **那么** workflow 命令仍按原逻辑返回 | Native/Classic 主命令结果不受记忆接线影响。 |
| A30 | passed | specs/memory-workflow-integration/spec.md | **并且**可通过已有 diagnostics 发现降级原因 | PluginRuntime diagnostics 仍记录加载、事件和调用失败。 |
| A31 | passed | specs/memory-workflow-integration/spec.md | `validateMemoryReviewActions` 必须在逐条 action 校验完成后执行 action-set 级别校验：一个 action-set 不得同时包含 `global` 和 `project` 作用域动作。未显式声明 scope 的 `skip` 不参与作用域集合；同一作用域的合法 action-set 继续通过。 | 显式 scope 的 skip 会加入 actionScopes，并执行 action-set 级别校验。 |
| A32 | passed | specs/memory-workflow-integration/spec.md | **当** action-set 同时包含全局动作和项目动作 | global create 或显式 global skip 与 project action 混合均被识别。 |
| A33 | passed | specs/memory-workflow-integration/spec.md | **那么** validator 必须拒绝整组动作 | 混合作用域时 validator 拒绝整组 action-set。 |
| A34 | passed | specs/memory-workflow-integration/spec.md | **并且**不能部分执行其中任一动作 | 校验失败不返回可执行的部分动作，不能部分执行。 |
| A35 | passed | specs/memory-workflow-integration/spec.md | workflow facade 只能依赖 Entry/Plugin Bridge 的公开能力，不直接创建或调用 Personal Memory Service。 | workflow facade 只依赖 Entry/Plugin Bridge 公开能力。 |
| A36 | passed | specs/memory-workflow-integration/spec.md | Native 和 Classic 的状态文件、phase、目录、Guard 和 archive 协议保持独立。 | Native/Classic 状态、phase、目录、Guard 和 archive 边界保持。 |
| A37 | passed | specs/memory-workflow-integration/spec.md | 不新增 scheduler、embedding、vector store 或逐工具调用日志。 | 未新增 scheduler、embedding、vector store 或逐工具日志。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| lifecycle and review regression tests | vitest run test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-memory/review-contract.test.ts test/app/native-command.test.ts test/app/classic-command.test.ts test/app/comet-task-command.test.ts | . | passed | 0 | 5202 ms |
| TypeScript typecheck | exec tsc --noEmit | . | passed | 0 | 6987 ms |
| ESLint affected files | eslint domains/comet-entry/plugin-context.ts domains/comet-plugin/integration.ts domains/comet-memory/plugin.ts domains/comet-memory/review-contract.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-memory/review-contract.test.ts | . | passed | 0 | 2335 ms |
| Prettier affected files | prettier --check domains/comet-entry/plugin-context.ts domains/comet-plugin/integration.ts domains/comet-memory/plugin.ts domains/comet-memory/review-contract.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-memory/review-contract.test.ts | . | passed | 0 | 1620 ms |
| Entry runtime build | build:entry-runtime | . | passed | 0 | 898 ms |
| Git diff check | diff --check | . | passed | 0 | 133 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 未运行全量测试；本 child 已完成指定最小验证集。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A31, A32, A33, A34 | 验证发现显式 scope 的 skip 未纳入 action-set 作用域一致性检查，已在当前工作区修复并补充回归用例，需要重新验证。 | 2026-08-16T17:10:54.384Z |
| 1 | 2 | 1 | pass | — | 第二轮独立复核通过：显式 scope skip 的作用域一致性已修复，指定 33 个回归测试、TypeScript、受影响 ESLint/Prettier、Entry Runtime 构建和 git diff --check 全部通过。 | 2026-08-16T17:20:41.661Z |



## 结论

第二轮独立复核通过：显式 scope skip 的作用域一致性已修复，指定 33 个回归测试、TypeScript、受影响 ESLint/Prettier、Entry Runtime 构建和 git diff --check 全部通过。
