# 可恢复的工作流创作

用户描述目标后，Creator 通过一个固定 SDK Run 关联分析、方案、用户决定、固定依赖、编译产物、实际加载验证和安装预览。宿主负责自然语言理解与真实 Skill 调查，机器步骤复用公开组合器；没有另一份可独立推进的 Creator 状态。

SDK Skill 应用包含完整入口 Skill 与由 SDK 推进的 Runtime。宿主 Agent 阅读真实依赖后，创作业务 Skill、业务 Rule、执行端口和验证器；SDK 根据同一份确认方案装配 Runtime，并在同一 Skill/Rule 文件后追加机械执行协议与通用保护规则。正式分发负责平台 Rule/Hook 配置。业务规则描述输入、产物和业务约束；Runtime 与 Guard 控制动作、批准和写入权限，正文不能代替用户决定。应用无需自己的安装器。Skill 加载、Rule 配置、实际 Hook 事件、SDK Run 和业务断言分别验证，文件安装成功不能代替真实宿主执行。

入口为 `comet creator start`、`status`、`next` 和 `dispatch`。原 Run 名称用于跨进程继续；`next` 只执行本地机器步骤，在宿主动作或用户决定前停下。Codex 与 Claude Code 领取分析动作需要声明实际的 Skill 加载与交接能力；能力缺失时拒绝领取，不能静默删去工作。

创作方案使用 `documents` 保存 Agent 的完整正文，必须包含 `SKILL.md` 与 `rules/workflow-guard.md`，可提供实际引用的 `references/*.md`。Skill 的 frontmatter name 等于应用 id，description 说明实际触发场景，正文说明输入、依赖 Skill 的调用、用户交互、产物、验收和恢复；Rule 写清具体业务约束。正文不限制字数。SDK 的通用模板是执行协议，不能代替组合应用的业务内容。

方案确认页来自组合器装配的真实图，同时展示上述完整正文和内容摘要、步骤、Skill 绑定、输出契约、失败路径与能力限制。文档原文位于 `plan.documents` 并参与整个方案摘要，展示视图不保存第二份文档状态。缺少两份必需正文时，Creator 在分析、准备及确认边界拒绝继续；已有方案需 revise，不能批准模板占位。用户决定绑定当前 Wait 的完整提案，摘要不能代替授权。修改正文、方案或目标走 revise，重新调查、装配并确认。依赖变化时保留现场、恢复固定依赖或重新确认，不静默改用新版本。

编译和验证固定实际内容摘要。成功回报不能用 completedChecks 字符串代替装配、加载和真实文件核对；即使冒报相同流程图，执行模块不同仍不能接受。原编译已发生但结果丢失时，沿原 Action 核对实际包并回传结果；不会重新覆盖文件。

安装预览同时展示完整包导出目录和 SDK 正式分发计划，包括固定依赖、宿主 Skill 入口、Runtime、Rule/Hook 配置、冲突和缺失能力；预览不写安装目标。`install-target` 是项目内的完整包导出目录，应与平台入口分开。用户批准当前预览后，Creator 导出已确认字节并通过 SDK 安装当前宿主的项目入口；任一文件或配置漂移使原批准失效。只读预览失败可重试或修订，已经发生的写入与未知安装结果须先核对现场，不能重复安装。部分安装不当作成功；用户级安装、升级和卸载继续使用分发入口。

## 三种起点

- Native 在原领域允许的位置增加步骤、指导和候选审查，不替换内部组件。
- Classic 使用原 full、hotfix、tweak 领域工厂，保持必要工件与授权，增加或替换符合契约的工作。
- 独立流程用 SDK 声明自己的图、Schema、状态、分支、join、子流程和转移上限；报告审批发布为独立样板。独立流程没有 Native 的独立 Verify 含义。

独立组合的 `composition.workflows` 是输入事实；顶层 `plan.workflows` 是组合器装配后的有效快照。编译时严格比较二者对应的实际有效定义，冲突拒绝。纯转移处理器以身份、版本、模块、导出函数和源码摘要固定，执行器和验证器集合必须对应实际引用；不接受完整手写 createApplication 代替组合。SDK 检查每次转移是否在图中声明，处理器不能越过未声明的边。

独立组合的 `transitionHandlers[].sourceHash` 使用公开 SDK 的 `hashRuntimeValue(moduleSource)` 计算完整源码字符串摘要。`executorIds` 与 `validatorRefs` 必须精确匹配实际注册集合及流程引用。需要未声明的执行、验证或证据端口时，装配拒绝并保留原方案；不能以某个名字存在代替真实能力。

## 阶段产物与本地验收

新创作使用 Creator v5，必须在 `manifest.artifactContracts` 中逐阶段声明必需文件及内容条件，或者用 `noArtifactsReason` 说明不产生文件的原因。独立流程覆盖执行步骤；Native、Classic 覆盖新增或替换的 Skill，保留原领域检查。契约绑定真实 `workflowId/stepId`，支持固定相对 `ref`、从输出读取路径的 `refFrom`、同步 JSON Schema、必需文本和 Markdown 章节。文件默认非空，完成回报必须携带实际 SHA-256；SDK 本地执行端口自动收集文件证据。

业务条件由 Agent 编写固定验证器，例如检查来源与结论是否对应、清单记录是否完整。`artifactTests` 为每个必需产物步骤提供正常文件和输出；有业务验证器时，还须提供通过通用文件和输出结构检查的 `invalidCases`。Creator 在无宿主凭据的独立 Node 进程和临时项目中运行检查，自动补充缺失、空文件、内容不符与摘要变化样例。扩展的业务验证器单独验收，原 Native/Classic 候选和审批约束继续由实际领域 Run 核对。

独立组合还须为每个根流程提供一个 `workflowTests` 样例，沿固定原图运行主要路径，包含实际涉及的会话步骤、子流程和审批；不要求遍历全部分支。每项声明 `workflowId`、启动 `input`、固定测试模块 `module` 与 `exportName`。模块须写入 `proposal.modules`，例如 `tests/workflow.mjs`；导出的异步函数接收 `{ runtime, runId, projectRoot, application }`。根 Run 已启动，使用 `runtime.inspect/next/claim/recordOutcome/resolveWait/execute` 推进，可以调用交付包的辅助模块；`application.store` 仅支持只读查询。Skill 结果及审批使用样例，文件仅写入隔离项目。

测试模块返回“通过”不构成证据。SDK 重新加载固定应用定义，读取隔离内存 Store 中的根 Run 及其实际子 Run，全部完成才接受；报告绑定当前方案样例和固定包。该检查不访问网络、宿主凭据或用户级 Runtime，不验证持久化、CLI 进程和真实模型行为。现有 Creator v3/v4 Run 继续沿原定义恢复，不追加此要求。运行 `comet creator guide --json` 查看字段示例。

本地验收失败进入 `review-verification`，可以 retry、revise 或 rejected，没有 skip。通过后才进入可选模型 Eval；安装预览再次核对验收报告是否属于当前固定包。实际应用在完成阶段、领取下游动作及接受下游结果时复验文件与原 Action 证据。修复步骤通过同一流程的 `replaces` 声明重做的产物，接受新结果后替代旧证据；未声明的文件变化保持阻塞。完整字段与样例见发布包 `comet-any/reference/sdk-creation.md`。

## 预发布 Creator Run 的恢复

新创作使用 v6。Eval 重试先重新预览已收集的固定用例，用户确认新摘要后才启动下一次评估；原实验仍有容器运行时继续阻塞。

0.4.5 不含 Creator Run。开发候选曾创建的 v3/v4/v5 Run 保留原固定定义，仍可读取和沿原定义处理，不修改其摘要或自动迁移。旧 Run 的 incomplete Eval 重试会保留待决定状态并提示创建 v6 Run；不要删除旧 Run、`.comet/eval/runs/<experimentId>` 报告或结果中 `taskSet` 指向的固定用例及输入快照。

重新创作时保留旧方案和应用包用于核对。Creator 新 Run 不会自动导入旧 Eval；若需要严格复用旧用例，可通过应用 Eval 的公开接口传入原 `taskSet` 作为 `reuseTaskSet`，重新预览并确认。原用例与输入快照的摘要必须匹配，不能把旧报告改成新 Run 的评估结果。

## 证据范围

定向测试、生成 Runtime、真实 npm 包消费者、真实宿主 Skill/交接与模型执行分别记录。本地加载通过只能证明当前包和注册实现满足本地契约；用户可见报告明确真实宿主、模型及完整业务样本中尚未执行的部分。凭据仅从执行上下文注入，不写入包、Run、报告或生成配置。
