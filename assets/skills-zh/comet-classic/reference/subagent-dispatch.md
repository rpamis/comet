# Subagent 驱动开发的 Comet 扩展

规范路径：`comet-classic/reference/subagent-dispatch.md`

在 `build_mode: subagent-driven-development` 或 autonomous 需要委派/任务审查时读取。前者加载同名 Superpowers Skill 后应用本契约；autonomous 直接应用，不要求加载外部执行 Skill。Classic 保留执行方式、任务验收、审查预算和五阶段收尾；外部 Skill 完成任务后返回 comet-build，不追加 final review 或 finishing-a-development-branch。

## 开始与任务身份

1. 读取一次计划、确认的设计和 `comet state check <name> build --json` 返回的配置。范围、文件或配置变化后刷新相应材料。
2. 做一次计划预检：计划不能与规格、验收或全局约束矛盾。能从仓库消除的疑问自行调查；会改变目标或授权的冲突成组询问用户。
3. 先用本轮入口的任务摘要；需要逐项需求和 ID 时才运行 `comet state tasks <name> --json`。`tasks.md` 是唯一完成状态来源；按依赖选择 task ID，不用行号、顺序或可变标题匹配。
4. `needsIds: true` 时运行 `comet state tasks <name> --assign-ids --json`，刷新受影响 handoff 和计划映射。已有 ID 保留。旧计划 checkbox 按 context-recovery.md 核对真实实现、检查与审查，明确 ID 映射后同步；未勾选不触发重复实施，额外真实任务不静默丢弃。

主会话协调派发、整合和验收，不与仍活跃的 implementer 同时修改其范围。subagent-driven-development 不由主会话代写；autonomous 可在明确收回委派、核对已有成果并保存检查点后自行实施。实现可见且验收完成后继续，不逐任务询问；用户暂停、真实授权歧义或下述阻塞条件出现时停止。

## 派发单位

默认按独立验收结果派发；同模块、共享局部上下文且依赖已明确的关联任务可组成有界工作包，由同一 implementer 连续实施。派发时固定 taskIds、允许修改范围、执行顺序、验收点和回报时机；不限制为机械的 2–3 个微任务，也不创建无限增长的会话。

工作包不是新任务身份。逐 ID 报告、验收和勾选，不因一项通过完成整包。thorough 允许复用 implementer，但仍逐任务独立审查。出现范围变化、依赖冲突或新风险时暂停受影响成员，先核对已完成部分，再调整后续工作包；不能悄悄追加任务。

工作包内可以跨任务复用 implementer，修复优先返回原会话。跨模块或边界显著变化、上下文压力使约束不能可靠保留、会话不可恢复、连续两次回报没有新增实现/证据且重复同一阻塞时，保存检查点并结束当前复用。恢复先调查原因，只交接尚未完成的成员与反馈，不靠无限新建会话消耗审查预算。reviewer 始终独立于 implementer，不复用实现角色做自审；子代理不嵌套派发，主会话统一协调。

## 交接与证据

派发只包含当前任务所需内容：task ID 与完整需求、计划/设计引用、允许修改范围、依赖接口、配置产物语言、必跑检查及回报契约。大段需求、报告和审查反馈使用上游支持的文件交接，主会话只保留路径和必要摘要，不重复粘贴累计历史。模型沿用用户与平台配置，按可用能力选择角色，不以指定模型名称作为协议要求。

implementer 回报 `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`，逐 task ID 给出变更文件、提交引用、检查命令与真实结果、未完成内容和风险信号。它只实现和自测，不勾选任务。主会话确认文件和提交在当前工作区可见后才验收；隔离副本需先整合。

若 `tdd_mode: tdd`，implementer 和修复 agent 提供原因匹配的真实 RED 失败及 GREEN 通过命令和摘要。autonomous 无需加载外部 TDD Skill，其他策略在独立上下文中加载 test-driven-development；完整上下文不重复加载。缺证据只补可补的验证并如实报告历史缺口，不能回退代码伪造 RED。direct 不要求逐项 RED/GREEN，但仍执行相关检查并保留缺陷回归证据。

## 风险与审查预算

风险信号：跨模块协调；认证、授权、加密、SQL、外部输入或凭证；并发、锁、共享可变状态；数据/schema 迁移；公共 API 变化；DONE_WITH_CONCERNS。主会话核对实际 diff 与自报；超过 200 行提示进一步核对复杂度，不能仅凭行数决定风险。机械变更/生成物不自动升级，但其源逻辑、安装和运行契约仍需审查。

| `review_mode` | Build 任务审查                                               | 修复后复查上限 |
| ------------- | ------------------------------------------------------------ | -------------- |
| `off`         | 不自动派发 reviewer                                          | 0              |
| `standard`    | 仅风险任务，单个 reviewer 同查规格符合性和代码质量           | 1 轮           |
| `thorough`    | 每个任务由独立 reviewer 同查规格符合性和代码质量，逐 ID 验收 | 2 轮           |

此预算接管上游默认 reviewer 节点，不叠加第二套审查。初审读取真实需求、diff 和证据，不只看实现摘要；复查只覆盖未解决问题、修复及新增风险，不重做全量需求分析，不重置轮次。已存在可信检查结果时核对适用性；只有证据不足、输入变化或新风险要求时才补跑检查。

reviewer 保持中立，不预先禁止发现。CRITICAL/IMPORTANT 问题必须解决；复查上限后仍未解决则记录 `BLOCKED` 并交用户决定。`off` 不豁免测试失败、异常调试协议或用户明确要求。只有实际核对后证明某发现已由既有实现满足，才记录理由并关闭，不能凭乐观推断放行。

## 完成与持久记录

主会话按 context-recovery.md 的 schemaVersion:1 JSON 示例，使用 `comet state checkpoint <name> --file <json-path>` 保存协调状态；Runtime 验证并生成 Markdown，不手工维护 subagent-progress.md。读取 `{checkpoint, stale}`，stale 时先核对真实成果。派发前、会话 ID 返回后及审查/验收/阻塞边界持久化；普通回报可合并，已验收成员不重复派发。检查点不是第二套完成清单。

规格内可逆的实现决定可自主处理。把影响后续工作的决定、依据及关联 task ID 保存到 `<classic-change-dir>/.comet/rulings.md`，在上游临时文件被清理前保留必要结论和证据引用。扩大范围、修改规格或验收、接受重要缺陷、安全例外及外部副作用仍需用户授权。不得把临时会话或上游内部目录作为唯一恢复来源。

逐项按配置验收后，使用本次读取的 revision 记录完成：

```bash
comet state task-complete <name> <task-id> --expect <revision> --json
```

此命令只记录完成，不替代验收。需求变更导致拒绝时，重新读取任务与受影响设计并重新判断，不能仅取新 revision 盲目重试。纯完成状态更新不改变 revision；命令可幂等重试。按已有提交策略保存进度，不为每个微任务机械追加单独进度提交。

所有任务验收完成后立即返回 `comet-build` 的退出检查。Build 不追加 whole-branch reviewer；`comet-verify` 按 `review_mode` 执行唯一最终集成审查，然后由 Archive 收尾。

## 中断恢复

按 context-recovery.md 获取最新入口包；coordination 摘要不足时才用 `comet state checkpoint <name>` 读取详情，必要时按引用加载 rulings。核对 revision、实际提交、文件和证据后，从原阶段继续，保留有效审查与已用轮次。

- 未勾选但已有实现的任务，先核对验收，不重复实现；已提交但未验收的任务保持未完成。
- 工作包只恢复未验收成员；已完成成员以 tasks.md 为准，旧 plan 映射 checkbox 仅同步显示。
- 任务被删、改名或需求变化时先重新映射和判断影响；缺少映射不能猜成第一个未勾选任务。
- 检查点缺失时先调查当前工作树和历史；仅对确认未实现的任务新建派发，不能把“无检查点”当作“无实现”。
- 派发失败或会话不可用时记录真实原因，停止对应循环并按恢复流程处理；不静默改变用户选定策略。
- 全部任务完成时返回 `comet-build`，不恢复旧的 Build final-review/final-fix 状态。
