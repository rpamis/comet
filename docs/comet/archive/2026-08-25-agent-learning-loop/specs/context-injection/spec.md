# Progressive Agent Context

## Goal

Context Director 将 Personal Memory、Project Model 和 Project Policy 统一选择为紧凑、可解释、可按需展开的 Agent Context。它减少常驻上下文，同时保证核心用户画像和会改变当前任务行为的关键策略及时可见。

## Structured contribution

Plugin Runtime 不再只接收任意完整文本，而是接收结构化 Context Candidate：稳定 ID、owner、memory type、state、title、summary、可选 content、selectors、source refs、verification、priority 和 match reasons。第三方插件可以提供同一公开结构，不获得第一方私有入口。

Context Director 根据当前 task、project、path、operation、phase 和本会话 application ledger 做确定性过滤与排序，然后生成：

- `core_memory`：完整 Core Profile；
- `active_policies`：当前任务直接相关的 proven/enforced Collaboration Policy 与 Project Policy；
- `context_manifest`：其余相关 Unit 的 ID、标题、摘要、来源类型和 whyApplied；
- `expand_hint`：宿主/Skill 可调用的稳定展开方式。

输出使用单一 `<agent_context>` 根元素，并对所有用户/项目正文执行 XML 文本转义。未知插件内容只有转换为合法 Candidate 后才能进入 Manifest，不直接拼接任意提示词。

## Progressive disclosure

Core Profile 和会直接改变当前任务处理方式的少量 proven/enforced Policy 可以完整注入。Project Model、trial Unit、Episode、Procedure 和长证据默认只进入 Manifest。Agent 使用稳定 ID 调用 Context Director expand，取得完整正文、whyApplied、来源和验证方式。

Provider 存储与 Reflection 不受上下文预算限制。配置中的字符预算只约束一次 `<agent_context>`；超出时内容降级为 Manifest item，不拒绝写入、不截断权威 Record，也不抛 Review Packet byte budget 错误。

## Dynamic activation

任务开始时生成初始 Context。目标 path、operation 或 phase 首次明确或发生变化时，Context Director 可以增量重新选择；同一会话中内容、selector 和来源未变化的 Unit 不重复投递。

支持 Hook 的宿主通过唯一 Comet Hook Router 请求并投递 Context；只有存在有效 `.comet/config.yaml` 的项目启用。无 Hook 但有宿主 Rule 时，Rule 只告诉 Agent 如何调用同一选择器；两者均不可用时，Comet Skill/`comet task` 使用同一接口。

CLI 提供任务 Context 请求和按 ID expand。JSON 输出同时返回结构化 Manifest 和渲染后的 Agent 文本，方便宿主直接消费。

## Why applied and feedback

每个被选择 Unit 都带 `whyApplied`，由匹配的 project、path、operation、phase、明确用户偏好、来源和历史成功应用生成，不使用模型自由编造理由。

实际投递生成 `applicationId` 并发送 `context.applied`。任务完成时，宿主/Skill 发送 `context.outcome`，至少表达 used-successfully、ignored、overridden、corrected 或 contributed-to-failure。该反馈进入 Agent Learning Loop，影响后续状态和排序。

普通成功应用保持静默；只有内容第一次改变处理方式、发生冲突、触发确定性检查或用户查看详情时展示 whyApplied。Dashboard 在个人记忆和项目知识中心提供当前 Manifest 预览，可展开完整 application history；普通 Agent 文本不显示内部评分。

## Priority

Context Director 强制以下优先级：当前系统和用户请求、当前代码/config/test、proven/enforced Project Policy、Project Model、explicit/proven Personal Memory、trial Unit 和历史 Episode。低层内容不能通过数量覆盖高层内容。

## Failure behavior

某个 Provider 查询或 expand 失败时，其他插件 Context 和 workflow 继续；失败项不进入输出并产生有界诊断。Hook 失败时不阻断工具调用；Skill/CLI 仍可手动请求。空 Context 不输出空标签。

## Verification scenarios

- 新任务得到 Core Profile、关键策略和 Manifest，而不是全部记忆与项目知识正文。
- 路径从 `app/` 切换到 `domains/` 后新增对应路径策略，未变化内容不重复。
- expand 返回正文、来源、验证方式和与 Manifest 一致的 whyApplied。
- 字符预算不足时长内容变为 Manifest item，写入和 Reflection 仍成功。
- Hook、Rule fallback 和 Skill/CLI 生成相同选择结果；未知项目安静跳过。
- Application outcome 能在下一任务改变排序或推进/废弃 trial Unit。
