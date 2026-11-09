# Native/Classic 继续简化实施记录

来源：`report:2026-11-09-agent-managed-workflow-simplification`。用户确认按聊天中的六项方案实施，并已确认中文协议同步英文。工作区分支 `053`，比较基线 `5426c4cbb3569e749ce8050888517f93b8437f5d`；上一轮内容证明移除尚未提交，本轮保留并沿用。网站与无关修改不在范围内。

## 六项方案与当前实现

1. **文档语义交给 Agent。** brief、Spec、设计、计划和报告保留可读取、非空及实际消费者所需结构，取消固定章节、语言比例、frontmatter、占位词和 Spec 豁免措辞证明。自由格式 Native Shape 经 `native next --session` 提交验收来源与正文，由 CLI 分配 ID；用户仍确认完整方案。Classic full 保留设计、计划、实际任务与批准。
2. **交接引用原材料。** Classic 普通交接读取正式 proposal 和原 Run，不默认复制 JSON/Markdown；`handoff --full` 才生成一份完整可读 Markdown，包含设计、任务和嵌套 Spec。原消费者需要的 engine/context 继续维护。真实 pending 恢复写一次 recovery 事件，不重复推进；路径逃逸保护保留。
3. **Agent 选择检查。** Guard/status 不扫描包配置猜测并启动 Build。明确的 argv 或原 Run 已登记命令才能执行；真实失败、超时、未知结果和已完成单次操作保持原事实。新增业务续行只提交原执行收据，不重跑已完成命令。
4. **Agent 判断开发进展。** 移除按未解决验收 ID 集合计算停滞与强制暂停。重复、交替、增大的集合允许真实修复；真实失败预算和最终用户接受仍保留。旧计数不覆盖实际预算原因。
5. **业务 CLI 装配 SDK。** Native 业务入口覆盖 Shape、Child、父级与集成修复；Classic `state next --continue` 连续处理已授权内部步骤，普通 `state next` 保持只读。沿用原 Run、Action、领取、并发控制、执行收据与用户决定。不同执行者、用户等待、真实失败或外部等待返回当前下一步；没有第二套状态机。
6. **Agent 决定任务拆分与验收分配。** 有效 Spec 验收无需先失败才可分派，子任务无需并集覆盖全部父级条目，复制正文从原验收目录读取。Runtime 保留 ID、依赖、实际工作区、Git、执行身份与恢复。父级验收仍覆盖所有已确认条目。并行 Child 的集成串行执行；独立 Verifier 不自动接手实现修复，集成修复使用实际集成工作区。

两项相邻回归暴露的有效契约已补齐：按真实依赖重新计算无在途任务/候选的 ready、pending，不因文案变化清空执行或验收；旧 Compat 父级失败后，可以直接修复父级集成范围并提交完整候选；Agent 决定修改计划时，用明确的方案修订命令返回 Shape 并保留失败预算。取消强制把失败条目分配给新 Child，不再依赖编辑触发的自动失效。

## 逐行为证据

以下是不同边界的实际结果，存在重叠，不能累加成独立案例数。完整 JSON 报告保存在本次会话支持目录 `agent-workflow-simplification/`。

- 旧文档样例 5 项失败，旧命令选择 4 项失败，旧默认交接副本 1 项失败，旧 Classic 业务续行 1 项失败；对应新源码和生成 Runtime 样例已通过。Supervisor 集成修复工作区的定向反例先失败，修正实际工作区选择后源码与生成 Runtime 均通过。
- Native/Classic 文档、命令选择、Shape 与循环的组合检查 14 项通过；后续 Native 文档、Shape、循环、拆分和双语协议 39 项通过。自由格式 Shape 覆盖错误会话、未确认不能 Build、确认后同一结果幂等及不同结果不能替换。
- Classic 业务命令 6 项通过：源码与生成 Runtime、Compat 与 SDK 的明确命令选择，以及原检查已完成但尚未交回的收据续行；查询不执行，明确续行不重复执行。
- Supervisor 完整业务流程源码与生成 Runtime 各 1 项通过：串行依赖与两个独立 Child、真实 Git 检查失败及集成修复、独立会话约束、父级保留 A3、遗漏 A3 被拒绝、完整验收后原 Run 完成并归档。错误回报保留拒绝历史，不伪称 Run 完全无审计变化。
- 普通交接、显式视图、pending 恢复、Spec Patch 后 Build 续行、Windows 路径、原材料读取次数有定向结果。Windows 相对路径 mock 的错误已修正并单项通过；符号链接用例在平台不授予创建权限时按原测试条件跳过，不能报告为通过。
- TypeScript、Native/Classic/Entry 构建及生成物一致性此前通过；最终改动后的检查结果补在下方。没有执行仓库全量测试、真实平台 Hook、安装包验证或耗时对照。未获得 Eval 启动授权，未运行真实模型/容器 Eval；确定性检查不能证明 Agent 语义判断质量，也不能支持“数小时变成几分钟”的数值承诺。

## 旧断言撤下与保留映射

撤下由用户明确批准的机制，不把修改后的测试称作旧语义仍通过。完整旧登记、测试正文、补丁及精确替代选择器随仓库保存，冻结历史登记不改写；两轴 Review 已明确批准这些退休范围及替代，认可限于确定性契约，不代表模型语义判断质量或发布验收。

| 原规则/来源                                                             | 本轮处理                                             | 仍需保持的行为与对应证据                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `native-242-budget-progress` 按 ID 集合停滞                             | `workflow-progress-removal-*` 归档并使用历史 overlay | 循环模块的重复/交替/增长修复、真实预算、通过后接受；原 config 预算用例保留                                                       |
| `native-supervisor-referenced-acceptance` 正文一致、失败后才能分派      | `workflow-document-handoff-removal-*` 归档并关联替代 | v1/referenced-v2 读取、原 Shape 确认、3 项拆分检查和源码/生成完整 Supervisor                                                     |
| `native-299-dag-contract` DAG 与内容 hash 的组合断言                    | 内容证明退休；依赖断言保留                           | 缺依赖/重复/环/未知 ID 拒绝，父级可保留条目，原 SDK ready frontier                                                               |
| `issue-439-child-dependency` 内容变化清空候选并重验                     | 自动失效退休；真实依赖重新计算保留                   | pending/ready 正确、已集成不可改、候选保留、overlay doctor、SDK frontier                                                         |
| `native-299-real-integration-parent-verify` 实际 Git 与自动文档失效组合 | hash 和自动失效退休，显式方案修订取代                | 原真实合并、提前启动阻塞、依赖 HEAD、跨 workflow/多父级保护、父级失败后的直接修复与可选重新规划、失败预算；补源码/生成新业务流程 |
| 未单独登记的 Brief 关键词推断、复制正文和全量 Child 覆盖                | 完整原文件与补丁同上归档，不保留关键词猜测           | 自由格式 Brief 含 Supervisor/Child 词仍按明确计划；有效 ID/依赖与完整父级验收                                                    |
| Classic handoff 默认 JSON/MD、FRESH/STALE、内容增删自动作废             | 完整三份旧 handoff 测试归档；普通路径读取原文        | 真实 Build 和 Spec Patch 续行、pending 一次恢复、显式完整视图、Windows 路径、junction 不能写出边界；原源文件符号链接反例保留     |
| 两项 Supervisor 默认非空检查模板                                        | 旧循环测试全文随 progress 证据保存                   | Agent 可选空计划；已选择的真实命令必须通过；父级全部条目不可遗漏                                                                 |

额外归档了 Native Skill、SDK handoff 与 Classic efficiency 三份完整原契约测试。目录标题、默认非空集成检查、固定 SDK 手工字段和任务内容 revision 断言按已确认协议替换；独立验收、任务 ID、实际检查、用户确认、工作区及进度恢复断言保留。历史 `issue-308-bounded-guidance`、`issue-421-classic-context` 通过同组证据关联替代；同名测试继续执行，只移除内容证明字段的前置要求。

这些授权不移除共享 SDK 请求身份、安装摘要或 Git 提交 ID，不允许未批准推进、不允许跨 Run/工作区污染、不允许用旧成功覆盖新失败。

## 双语与版本

用户已确认本轮中文“Agent 判断与 CLI 执行”协议，英文已同步。核对当前 package 为 0.5.3、origin/master 与上一发布 tag 为 0.5.2；无需再升版本。Changelog 追加到 0.5.3：业务入口、Agent 文档/检查/进展判断、原材料交接与父级完整验收都是最终可见行为；不记录内部修复过程或普通回归数量。

## 最终检查与 Review

公开 `test:core-regressions --case ...` 选择七项新业务案例与原失败预算案例，8 组、41 次测试执行通过（含重叠案例，不作为独立案例数量）。Native children 全模块 14 项通过，覆盖真实父级失败后无需强制新 Child 的修复与显式重规划保留预算。中英文 Native/Classic Skill、业务 handoff 契约 99 项通过。最终源码/生成 Runtime 的 Child 独有子目录检查与真实集成失败修复共 2 项通过；原 SDK Shape 确认、重启、修复、交付和清理等精确选择共 13 项通过，195 项未命中选择器，未执行。这些均为确定性检查，不是模型 Eval。

已知仓库全量架构检查受原有根目录 `.ruff_cache/` 阻塞，不能为通过而删除无关工作区文件或扩大白名单。没有提交、推送、PR 或发布操作。

最终构建：Native、Classic、Entry 均已重新生成，TypeScript 通过；Entry Guard 最初被一致性检查判为过期，重新构建后 `pnpm check:generated` 通过。192 个任务范围文件通过 Prettier（含默认被忽略的发布 Skill Markdown），审计冻结快照未格式化。源码 ESLint 无错误，已有 Dashboard/DSH 未用变量警告保留。两轴 Review 均批准本轮六项和 7 个迁移条目，归档旧正文与本轮开始副本完全一致。

实际限制：`pnpm lint:architecture` 已运行并因原有 `.ruff_cache` 顶层目录失败，该检查没有通过；未删除缓存或扩大白名单。未运行全仓测试、npm 打包安装、真实平台 Hook、真实模型/容器 Eval、线上发布或小时级归档耗时对照。代码与文档在本地 053 工作区，未提交、推送或发布。
