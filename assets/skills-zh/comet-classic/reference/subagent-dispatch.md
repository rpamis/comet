# Subagent 驱动开发的 Comet 扩展

规范路径：`comet-classic/reference/subagent-dispatch.md`

仅在用户选择 `build_mode: subagent-driven-development` 后读取。加载当前安装的 Superpowers `subagent-driven-development`，再应用本文的 Comet 调用契约。上游提供实现方法与文件交接；Classic 保留执行方式、任务验收、审查预算和五阶段收尾。上游要求额外 final review 或 `finishing-a-development-branch` 时，返回 `comet-build`，由 Verify / Archive 统一处理。

## 开始与任务身份

1. 读取一次计划、确认的设计和 `comet state check <name> build --json` 返回的配置。范围、文件或配置变化后刷新相应材料。
2. 做一次计划预检：计划不能与规格、验收或全局约束矛盾。能从仓库消除的疑问自行调查；会改变目标或授权的冲突成组询问用户。
3. 运行 `comet state tasks <name> --json`。`tasks.md` 是唯一完成状态来源；按依赖选择未完成的 task ID，不能用行号、顺序或可变标题匹配任务。
4. `needsIds: true` 时先运行 `comet state tasks <name> --assign-ids --json`，再刷新受影响 handoff 和计划映射。已有 ID 保留。旧计划仍有 checkbox 时，先按现有双清单恢复；核对每项实现与验收后才能明确迁移为 ID 引用，不能删除未完成项来让检查通过。

主会话协调派发、整合和验收，不代写所选子代理实现任务。实现可见且验收完成后继续下一任务，不在任务间反复询问是否继续。用户要求暂停、真实需求歧义或达到下述阻塞条件时停止。

## 派发单位

默认一个独立可验收结果对应一个 implementer。以下条件全部满足时，可把 **2–3 个同类微任务**交给同一新 implementer：修改模式相同、共享局部上下文、文件范围不冲突、依赖已满足；每项有独立 task ID 和验收证据；每项及整批均不命中下方风险信号；`review_mode` 不是 `thorough`。

批次不是新任务身份。逐项报告、验收和记录完成，不能因一项通过就完成整批。出现风险或范围扩大时停止扩大批次，按风险任务审查实际变更，其余未执行任务恢复为单项派发。

跨任务或角色不复用 agent，但同一任务/批次的修复优先恢复原 implementer。会话不可恢复或没有实际进展时才新建修复 agent，保留审查预算。reviewer 始终独立于 implementer；子代理不得再次派发 implementer/reviewer，派发由主会话集中管理。

## 交接与证据

派发只包含当前任务所需内容：task ID 与完整需求、计划/设计引用、允许修改范围、依赖接口、配置产物语言、必跑检查及回报契约。大段需求、报告和审查反馈使用上游支持的文件交接，主会话只保留路径和必要摘要，不重复粘贴累计历史。模型沿用用户与平台配置，按可用能力选择角色，不以指定模型名称作为协议要求。

implementer 回报 `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`，逐 task ID 给出变更文件、提交引用、检查命令与真实结果、未完成内容和风险信号。它只实现和自测，不勾选任务。主会话确认文件和提交在当前工作区可见后才验收；隔离副本需先整合。

若 `tdd_mode: tdd`，implementer 和修复 agent 在独立上下文中加载 `test-driven-development`，提供 RED 失败及 GREEN 通过的命令和摘要。恢复同一完整上下文不重复加载，压缩后按需重载；缺少证据不能视为完成。`direct` 不要求逐项 RED/GREEN，但仍执行相关检查，为缺陷修复保留回归证据。

## 风险与审查预算

风险信号：跨模块协调；认证、授权、加密、SQL、外部输入或凭证；并发、锁、共享可变状态；数据/schema 迁移；公共 API 变化；`DONE_WITH_CONCERNS`；单项或整批 diff 超过 200 行。主会话同时检查 implementer 自报与实际 diff，不能只依赖自报。

| `review_mode` | Build 任务审查                                         | 修复后复查上限 |
| ------------- | ------------------------------------------------------ | -------------- |
| `off`         | 不自动派发 reviewer                                    | 0              |
| `standard`    | 仅风险任务，单个 reviewer 同查规格符合性和代码质量     | 1 轮           |
| `thorough`    | 每个任务独立 reviewer 同查规格符合性和代码质量，不合批 | 2 轮           |

此预算接管上游默认 reviewer 节点，不叠加第二套审查。初审读取真实需求、diff 和证据，不只看实现摘要；复查只覆盖未解决问题、修复及新增风险，不重做全量需求分析，不重置轮次。已存在可信检查结果时核对适用性；只有证据不足、输入变化或新风险要求时才补跑检查。

reviewer 保持中立，不预先禁止发现。CRITICAL/IMPORTANT 问题必须解决；复查上限后仍未解决则记录 `BLOCKED` 并交用户决定。`off` 不豁免测试失败、异常调试协议或用户明确要求。只有实际核对后证明某发现已由既有实现满足，才记录理由并关闭，不能凭乐观推断放行。

## 完成与持久记录

主会话维护 `<classic-change-dir>/.comet/subagent-progress.md`，记录 task ID/批次成员、需求 revision、`implementing | task-review | checkoff | done | blocked`、会话标识、交接路径、提交与检查证据、风险信号、已过审查、未解决反馈及已用修复轮次。每次派发、回报、审查和完成后更新；已验收成员不重复派发。该检查点是协调记录，不是第二套完成清单。

规格内可逆的实现决定可自主处理。把影响后续工作的决定、依据及关联 task ID 保存到 `<classic-change-dir>/.comet/rulings.md`，在上游临时文件被清理前保留必要结论和证据引用。扩大范围、修改规格或验收、接受重要缺陷、安全例外及外部副作用仍需用户授权。不得把临时会话或上游内部目录作为唯一恢复来源。

逐项按配置验收后，使用本次读取的 revision 记录完成：

```bash
comet state task-complete <name> <task-id> --expect <revision> --json
```

此命令只记录完成，不替代验收。需求变更导致拒绝时，重新读取任务与受影响设计并重新判断，不能仅取新 revision 盲目重试。纯完成状态更新不改变 revision；命令可幂等重试。按已有提交策略保存进度，不为每个微任务机械追加单独进度提交。

所有任务验收完成后立即返回 `comet-build` 的退出检查。Build 不追加 whole-branch reviewer；`comet-verify` 按 `review_mode` 执行唯一最终集成审查，然后由 Archive 收尾。

## 中断恢复

按 `context-recovery.md` 获取最新状态，再读取协调检查点、rulings 和 task ID 列表。核对需求 revision、实际提交、文件和证据后，从原阶段继续，保留已过审查与已用轮次。

- 未勾选但已有实现的任务，先核对验收，不重复实现；已提交但未验收的任务保持未完成。
- 批次只恢复未验收成员；已完成成员以 `tasks.md` 为准。
- 任务被删、改名或需求变化时先重新映射和判断影响；缺少映射不能猜成第一个未勾选任务。
- 检查点缺失时先调查当前工作树和历史；仅对确认未实现的任务新建派发，不能把“无检查点”当作“无实现”。
- 派发失败或会话不可用时记录真实原因，停止对应循环并按恢复流程处理；不以主会话接管实现绕过用户选定方式。
- 全部任务完成时返回 `comet-build`，不恢复旧的 Build final-review/final-fix 状态。
