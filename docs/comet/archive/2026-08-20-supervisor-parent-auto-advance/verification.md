---
generated_from_state_version: 18
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 3
- 验证器尝试次数: 2
- 完成时间: 2026-08-20T15:44:06.100Z
- 摘要: Independent review passed after adding the zero-parent blocker and deduplicating the same v1 parent observed through multiple Git worktrees. Focused v2, continuation, Skill, native-children, formatting, typecheck, lint, and generated-asset checks passed.

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：Supervisor v2 最后一个 Child 成功集成后，同一次父级 Runtime 推进把父级从 `build` 转为 `verify`，返回自动推进结果和最终 Verifier continuation。 | Independent review and focused v2 regression passed |
| A2 | passed | brief.md | A2：Supervisor v1 最后一个 Child 完成 `finish=merge` Archive 后，Runtime 只在唯一、已确认且分支匹配的父级全部 Child 均完成时自动进入 `verify`。 | v1 archive discovery requires unique matching completed parent facts |
| A3 | passed | brief.md | A3：仍有 Child 处于 pending、ready、active、verified、blocked 或 needs-reverify 时，父级保持 `build`，不得提前进入最终 Verify。 | Incomplete Child facts keep parent in Build |
| A4 | passed | brief.md | A4：进程在最后一个 Child 完成后、父级状态写入前中断，下一次恢复只补做一次父级推进，不重复集成、归档或创建候选。 | Recovery reuses idempotent parent transition |
| A5 | passed | brief.md | A5：父级已经处于 `verify`、`archive` 或 `done` 时，重复 Child 回报或重复恢复保持幂等，不创建第二个父级候选或 Verifier。 | Repeated advancement is a no-op after Verify |
| A6 | passed | brief.md | A6：父级无法唯一解析、Child Archive 未合入父分支、绑定工作区不一致或存在 repair blocker 时，不猜测推进，并返回可见、可恢复的阻塞信息。 | Zero, ambiguous, incomplete, unmerged, and binding-mismatched v1 parent facts return blockers |
| A7 | passed | brief.md | A7：Native Skill 收到自动父级 continuation 后无需用户再次确认即切回父级并派发最终 Verifier；若宿主无法继续，父级至少已持久化为 `verify` 并显示明确下一步。 | Skill consumes parent continuation without a second confirmation |
| A8 | passed | brief.md | A8：用户收到“全部 Child 已完成，Supervisor 父级正在进行最终验证”的明确通知；最终 Archive、merge、push 和 PR 行为仍遵循现有配置与用户授权。 | User notification stops at final Verify and preserves delivery authorization |
| A9 | passed | specs/supervisor-agents/spec.md | Runtime 只返回精简 Agent 任务包 - **Given** 父级有一个可执行的 Builder 或 Verifier 工作项 - **When** continuation 向宿主请求执行 - **Then** 任务包只包含 `role`、`child`、`projectRoot`、`baseCommit` 和 `runId` - **And** 任务明确绑定当前父级事实与一个 Child worktree - **And** 临时传输文件由 Runtime 在 `.comet/runtime` 内创建、消费和清理 | Existing Supervisor task package contract remains intact |
| A10 | passed | specs/supervisor-agents/spec.md | Builder 只推进指定 Child - **Given** Agent 收到角色为 `builder` 的任务包 - **When** Agent 执行任务 - **Then** 它只在指定 Child worktree 中推进 Build - **And** 到达 Verifier 边界或遇到 blocker 后返回 - **And** 不自行推进父级集成或最终交付 | Builder remains bound to one Child |
| A11 | passed | specs/supervisor-agents/spec.md | Verifier 是新的只读 Agent - **Given** Child 产生待验证候选 - **When** 父级派发角色为 `verifier` 的任务包 - **Then** 使用与 Builder 分离的新 Agent，只读验收指定候选 - **And** 不修改实现、不接受 Builder 自证，也不负责创建嵌套 Agent - **And** 独立性沿用 Native 现有可信宿主或 skill-coordinated 降级规则 | Independent read-only Verifier contract remains intact |
| A12 | passed | specs/supervisor-agents/spec.md | 支持 Agent 的宿主并行派发无依赖任务 - **Given** 至少两个无依赖 Child 同时 ready，且当前会话提供原生 Agent 工具 - **When** 父级协调者派发 Builder 或 Verifier - **Then** 每个任务使用独立 Child worktree，并可按宿主并发上限并行 - **And** 无法获得并发上限时最多同时派发两个 - **And** 并行不扩展到 integration branch 写入 | Bounded parallel dispatch remains unchanged |
| A13 | passed | specs/supervisor-agents/spec.md | 不支持 Agent 时自动顺序降级 - **Given** 当前会话没有可用原生 Agent 工具 - **When** 父级仍有 ready 工作项 - **Then** 同一协调流程按稳定顺序逐项执行 Builder 和 Verifier - **And** 依赖、独立验证、串行集成和最终交付结果与并行模式一致 - **And** 不要求用户手工选择另一套流程 | Serial fallback remains unchanged |
| A14 | passed | specs/supervisor-agents/spec.md | 平台注册表不硬编码多 Agent 能力 - **Given** 同一宿主可能通过会话配置启用或关闭 Agent - **When** Runtime 决定是否并行派发 - **Then** 能力来自当前会话实际可用工具 - **And** 不在 33 平台 canonical registry 中维护易漂移的 `supportsMultiAgent` 静态字段 | No static multi-agent registry field was added |
| A15 | passed | specs/supervisor-agents/spec.md | 同一 Child 只有一个有效任务 - **Given** 某 Child 已有有效 Builder 或 Verifier 任务 - **When** continuation 再次计算可执行工作 - **Then** 不为同一 Child 创建第二个有效任务 - **And** 其他无依赖 Child 仍可被派发 | Duplicate effective Child tasks remain rejected |
| A16 | passed | specs/supervisor-agents/spec.md | runId 拒绝重复或迟到结果 - **Given** Runtime 已记录当前 Child、角色、父级状态、base commit 和 `runId` - **When** 收到重复完成、旧 `runId`、错误角色或不匹配基线的返回 - **Then** 该返回不能推进 verified、integrated 或父级状态 - **And** `runId` 只用于执行去重，不作为权限凭证或 Agent 身份证明 | Stale runId and mismatched results remain rejected |
| A17 | passed | specs/supervisor-agents/spec.md | Agent 完成消息只唤醒协调者 - **Given** 宿主通知某 Agent 已完成 - **When** 父级继续推进 - **Then** Runtime 重新读取 Portable State、Child 验证记录、verified commit 和 Git 关系 - **And** 只有这些事实一致时才推进状态 - **And** Agent 的文字摘要不直接成为 Runtime 事实 | Runtime rereads authoritative facts before progression |
| A18 | passed | specs/supervisor-agents/spec.md | 全部 Child 完成后自动切回父级 - **Given** Runtime 已根据可信状态和 Git 事实确认全部 Child 完成 - **When** Child 完成命令返回父级自动推进结果和 continuation - **Then** Native Skill 不要求用户再次说“推进”或重复确认范围 - **And** 自动切换到父级上下文并继续派发最终 Verifier - **And** 明确通知用户“全部 Child 已完成，Supervisor 父级正在进行最终验证” | Automatic parent continuation and Skill contract tests passed |
| A19 | passed | specs/supervisor-agents/spec.md | 宿主中断时保留可恢复的父级下一步 - **Given** Runtime 已把父级持久化为 Verify，但宿主无法立即启动最终 Verifier - **When** 当前协调任务结束或稍后恢复 - **Then** continuation 明确指向父级最终 Verifier 动作 - **And** 不把父级回退为 Build，也不以最后一个 Child 完成消息冒充整个 Supervisor 完成 | Verify persistence retains a recoverable Verifier continuation |
| A20 | passed | specs/supervisor-agents/spec.md | 恢复时优先重连旧任务 - **Given** 协调会话重启且某 Child 仍有有效任务 - **When** 宿主提供可恢复的 Agent 运行标识 - **Then** 父级优先重新连接旧任务 - **And** 不因为会话重启重复派发已 verified 或 integrated 的 Child | Reconnect behavior remains unchanged |
| A21 | passed | specs/supervisor-agents/spec.md | 重新派发前确认旧任务已停止 - **Given** 旧 Agent 无法重连 - **When** 父级考虑为同一 Child 创建替代任务 - **Then** 只有宿主确认旧任务已结束或取消后，Runtime 才失效旧 `runId` 并重新派发 - **And** 无法确认时只阻塞该 Child，不让两个 Agent 并发写同一 worktree | Redispatch still requires old task stop confirmation |
| A22 | passed | specs/supervisor-agents/spec.md | 单个 Agent 阻塞不冻结无依赖任务 - **Given** 一个 Agent 失败、等待外部授权或无法安全恢复 - **When** 其他无依赖 Child 仍有可执行工作 - **Then** Runtime 只阻塞受影响 Child并继续提供其他任务 - **And** 最终 integration branch 写入仍保持串行 | Independent ready work remains available around blockers |
| A23 | passed | specs/supervisor-agents/spec.md | Agent 不需要共享协调基础设施 - **Given** 父级同时协调多个 Child - **When** Builder 和 Verifier 执行 - **Then** Agent 不共享 mailbox、宿主任务列表或直接通信 - **And** Child Agent 不需要创建嵌套 Agent - **And** Runtime 不管理模型选择、消息路由或通用 Worker 生命周期 | No shared mailbox or nested agent infrastructure was added |
| A24 | passed | specs/supervisor-agents/spec.md | 自动接回不绕过最终交付授权 - **Given** Native Skill 已自动切回父级并完成最终 Verify - **When** 父级进入 Archive 或 workspace finish 边界 - **Then** Skill 继续遵循现有项目配置、Runtime continuation 和用户授权 - **And** 不因为 Child 自动接回而擅自 merge、push 或创建 PR | Final delivery authorization remains unchanged |
| A25 | passed | specs/supervisor-integration/spec.md | Shape 确认后创建父级 integration workspace - **Given** 新 Supervisor v2 的 Shape 已确认 - **When** Runtime 开始父级实施 - **Then** Runtime 记录真实 target branch 的起始 commit - **And** 通过平台 Adapter 创建父级专用 integration branch/worktree - **And** integration workspace 的身份和基线写入父级 Runtime 状态 | Shape creates and persists integration workspace facts |
| A26 | passed | specs/supervisor-integration/spec.md | 父级最终交付前 target 保持不变 - **Given** integration workspace 已建立 - **When** 任意 Child 实现、验证或集成，或父级 Verify 尚未通过 - **Then** 所有组合结果只进入 integration branch - **And** 真实 target branch 仍指向父级开始时记录的提交，除非外部产生可识别漂移 | Target remains unchanged before final delivery |
| A27 | passed | specs/supervisor-integration/spec.md | ready Child 从当前 integration HEAD 创建 - **Given** 一个 Child 的全部依赖均已 integrated - **When** Runtime 将该 Child 变为 ready 并创建工作区 - **Then** Child 使用独立 branch/worktree - **And** 其 base commit 等于当时的 integration HEAD - **And** 该基线包含所有依赖的 integration commit | Ready Children use current integration HEAD |
| A28 | passed | specs/supervisor-integration/spec.md | 缺少依赖提交时拒绝 Child 执行 - **Given** Child B 声明依赖 Child A - **When** A 尚未 integrated，或 B 的 base commit 不包含 A 的 integration commit - **Then** Runtime 拒绝启动、验证或集成 B - **And** 返回指出缺失依赖事实的可恢复 blocker | Missing dependency commits block Child execution |
| A29 | passed | specs/supervisor-integration/spec.md | Child Verify 绑定准确候选提交 - **Given** Builder 已提交 Child 的候选结果 - **When** 独立 Verifier 通过全部 Child 范围 - **Then** Runtime 记录准确的 verified commit 和结构化 Child 验证记录 - **And** Child 状态变为 `verified` - **And** Agent 文本结论或未提交工作区不能单独形成 verified 事实 | Verified commit and evidence remain required |
| A30 | passed | specs/supervisor-integration/spec.md | verified 与 integrated 保持分离 - **Given** Child 已在准确 commit 上 verified - **When** verified commit 尚未合入 integration branch 或合入后的检查尚未通过 - **Then** Child 保持 `verified` 或进入明确 blocker - **And** 不显示为 `integrated`、`done` 或 `archived` | Verified and integrated states remain separate |
| A31 | passed | specs/supervisor-integration/spec.md | 父级串行集成 verified Child - **Given** 一个或多个 Child 已 verified 且依赖满足 - **When** 父级集成器推进队列 - **Then** Runtime 使用短事务锁、Git 引用比较更新和恢复记录逐个处理 - **And** 同一时刻最多执行一个 integration branch 写入 - **And** 每次只合入已记录的 verified commit | Integration remains short-locked and serial |
| A32 | passed | specs/supervisor-integration/spec.md | 同时完成 Verify 仍按稳定顺序集成 - **Given** 两个无依赖 Child 同时完成 Verify - **When** 父级选择下一项集成 - **Then** Runtime 使用确定性的稳定顺序串行处理 - **And** Agent 完成先后不改变依赖图或产生并发 merge | Stable dependency order remains deterministic |
| A33 | passed | specs/supervisor-integration/spec.md | 集成检查通过后记录 integrated - **Given** verified commit 已合入 integration branch - **When** Git/状态不变量和该 Child 已确认实施责任对应的最小跨模块检查通过 - **Then** Runtime 记录 Child 名称、摘要、verified commit、integration commit、Child 验证记录和检查结果 - **And** Child 状态才变为 `integrated` - **And** 不在每次 Child 合入后重复运行完整父级检查 | Integration facts and checks precede integrated state |
| A34 | passed | specs/supervisor-integration/spec.md | 集成冲突保留现场 - **Given** verified commit 与当前 integration HEAD 发生合并冲突 - **When** 父级集成器尝试合入 - **Then** Runtime 停止该集成、保留可诊断现场并返回用户决定 blocker - **And** 不自动解决冲突、不推进 Child 状态，也不修改真实 target | Conflicts preserve the integration worktree |
| A35 | passed | specs/supervisor-integration/spec.md | 全部 Child integrated 前拒绝父级 Verify - **Given** 至少一个已声明 Child 尚未 integrated 或处于 blocked - **When** 父级尝试进入最终 Verify - **Then** Runtime 拒绝进入并指出剩余 Child 与下一动作 - **And** 不以 Child 已 verified 或 Agent 已完成代替 integrated | Parent Verify still requires all Children integrated |
| A36 | passed | specs/supervisor-integration/spec.md | v2 最后一个 Child 集成后自动进入父级 Verify - **Given** 父级处于 active Build，且当前 `supervisor-integrate` 使最后一个 Child 变为 `integrated` - **When** Runtime 重新投影全部 Child 并确认没有 repair blocker - **Then** Runtime 在同一 CLI 操作返回前自动完成父级 Build 并进入最终 Verify - **And** 只创建一个父级候选，返回自动推进结果和最终 Verifier continuation - **And** 不要求用户再次发出父级“推进”或范围确认 | v2 final Child integration auto-advance regression passed |
| A37 | passed | specs/supervisor-integration/spec.md | v1 最后一个 Child Archive merge 后自动进入父级 Verify - **Given** active Supervisor v1 的 Child 使用既有独立 Archive 生命周期 - **When** 最后一个声明 Child 完成 `finish=merge`，且归档状态已提交到唯一父级分支 - **Then** Runtime 从分支绑定一致的权威工作区定位该父级并重新检查全部 Child - **And** 全部 Child 均为 `done` 时自动完成父级 Build 并进入最终 Verify - **And** detached、binding mismatch 或未合入的 Archive 不能形成完成事实 | v1 final Child archive merge auto-advance path is guarded by Git facts |
| A38 | passed | specs/supervisor-integration/spec.md | 中断恢复补做父级推进 - **Given** 全部 Child 已完成，但进程在父级 Build 状态写入前中断 - **When** 下一次父级恢复或相关 Supervisor 推进重新读取 Portable State、父子声明和 Git 事实 - **Then** Runtime 幂等补做父级 Build 完成并进入 Verify - **And** 父级已在 Verify、Archive 或 done 时不创建第二个候选或重复 Verifier | Recovery progression remains idempotent |
| A39 | passed | specs/supervisor-integration/spec.md | 父级歧义或未完成事实阻止自动推进 - **Given** v1 Child 对应零个或多个 active 父级、Child Archive 未合入父分支、父级绑定不一致，或仍有未完成/blocked Child - **When** Runtime 尝试自动接回父级 - **Then** Runtime 不猜测父级、不提前进入 Verify - **And** 返回包含父级、分支或剩余 Child 事实的可恢复 blocker | Zero or multiple active parents and all incomplete/binding facts now produce recoverable blockers |
| A40 | passed | specs/supervisor-integration/spec.md | 父级 Verify 在 integration worktree 验收完整目标 - **Given** 所有当前 Child 已 integrated - **When** 父级进入最终 Verify - **Then** Verifier 读取完整 brief、全部目标 Specs、Child 验证记录和最终 integration HEAD - **And** 在 integration worktree 执行完整父级集成检查 - **And** 对跨 Child、宿主和 workflow 的完整用户目标作出判断 | Parent Verify uses complete acceptance and integration HEAD |
| A41 | passed | specs/supervisor-integration/spec.md | 父级 Verify 失败不污染 target - **Given** 父级最终 Verify 发现集成结果失败 - **When** Runtime 返回修复循环 - **Then** 真实 target 保持不变 - **And** 允许按已确认范围追加修复 Child 后继续同一 integration workspace - **And** 已 integrated Child 历史保持不可变 | Verify failure preserves target and integrated history |
| A42 | passed | specs/supervisor-integration/spec.md | target 漂移触发完整重新集成检查 - **Given** 父级最终交付前真实 target 出现新的提交 - **When** Runtime 检查交付前提 - **Then** Runtime 把最新 target 重新带入 integration workspace - **And** 重新运行父级 integration checks，不推断只需要验证部分范围 - **And** 新检查通过前不交付 | Target drift triggers refreshed checks |
| A43 | passed | specs/supervisor-integration/spec.md | Archive 确认遵循项目配置 - **Given** 父级 Verify 已通过且 integration HEAD 与验证记录一致 - **When** `native.archive_confirmation` 为 `automatic` - **Then** Skill 不再询问并继续最终交付 - **And** 配置为 `required` 时最多请求一次最终确认 | Archive confirmation remains configuration-controlled |
| A44 | passed | specs/supervisor-integration/spec.md | Child 完成不会直接触发最终交付 - **Given** Runtime 因全部 Child 完成而自动把父级推进到最终 Verify - **When** 父级尚未完成完整验证或 workspace finish 尚未授权 - **Then** Runtime 不执行父级 Archive、target merge、push 或 PR - **And** 后续交付继续遵循父级验证结果、项目配置和用户授权 | Child completion does not trigger final delivery |
| A45 | passed | specs/supervisor-integration/spec.md | 父级唯一发布最终权威 Specs - **Given** 父级开始最终交付 - **When** Runtime发布规格和历史 - **Then** 只有父级 Specs 写入 `docs/comet/specs` 成为最终权威版本 - **And** Child scoped Specs、验证记录和 Agent 摘要只保存在父级 Archive 历史中 - **And** Child 不各自发布重叠的权威 Specs | Parent remains the authoritative Specs publisher |
| A46 | passed | specs/supervisor-integration/spec.md | 最终交付一次合入真实 target - **Given** target 漂移已处理、父级验证仍对应当前 integration HEAD - **When** Runtime 执行最终 merge - **Then** integration branch 只合入真实 target 一次 - **And** Runtime 核对 target 已包含最终结果后才继续归档 - **And** 中断重试通过 Git 事实识别已完成步骤，不重复 merge | Final delivery remains Git-fact idempotent |
| A47 | passed | specs/supervisor-integration/spec.md | 父子只在最终交付后统一归档 - **Given** 最终 target 已包含验证通过的 integration 结果 - **When** Runtime 完成 Archive 状态转换 - **Then** 父级和全部 Child 一起变为 `archived` - **And** 任何 Child 不因自己 integrated 而提前归档 | Parent and Children archive only after final delivery |
| A48 | passed | specs/supervisor-integration/spec.md | 清理前保护用户工作区 - **Given** Runtime 准备清理 Child 或 integration branch/worktree - **When** 存在未提交文件、未合入 commit、当前进程位于待删除 worktree 或其他不安全条件 - **Then** Runtime 保留现场并返回明确 blocker - **And** 不强制删除、重置或覆盖用户文件 | Cleanup preflight protects dirty and unsafe workspaces |
| A49 | passed | specs/supervisor-integration/spec.md | Supervisor 依赖修复后的统一 Archive 能力 - **Given** Issue #313 跟踪的 Archive preview 状态一致性能力尚不可用 - **When** Supervisor v2 尝试最终交付 - **Then** Runtime 保持最终交付为 blocked 并指出外部前置能力 - **And** Supervisor 模块不复制一套 Archive preview 或 Portable State 修复 | Supervisor reuses unified Archive capability |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| v2 Supervisor auto-advance regression | exec vitest run test/domains/comet-native/native-supervisor.test.ts -t automatically advances | . | passed | 0 | 7183 ms |
| Parent advance continuation regression | exec vitest run test/domains/comet-native/native-loop-runtime.test.ts -t automatic parent-advance | . | passed | 0 | 2104 ms |
| Native Skill auto-advance contract | exec vitest run test/domains/skill/skills.test.ts -t auto-advance | . | passed | 0 | 3785 ms |
| Native Skill regressions | exec vitest run test/domains/comet-native/native-skill.test.ts | . | passed | 0 | 1814 ms |
| ESLint and architecture lint | lint | . | passed | 0 | 9043 ms |
| TypeScript compile check | exec tsc --noEmit | . | passed | 0 | 7265 ms |
| Changed source and test formatting | exec prettier --check domains/comet-native/native-children.ts test/domains/comet-native/native-children.test.ts | . | passed | 0 | 1283 ms |
| Native runtime generated assets | scripts/build/build-native-runtime.mjs --check | . | passed | 0 | 646 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- The existing Windows worktree integration test is environment-sensitive during generated worktree cleanup; the focused test passed after deduplicating parent observations across worktrees.
- No background daemon or file watcher was introduced; continuation and related Supervisor progression provide recovery.

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A6, A39 | Required fix: make findNativeV1SupervisorParents collect every active v1 parent that declares the Child, then reject ambiguity, branch mismatch, or incomplete archive facts with a visible blocker before choosing a parent. | 2026-08-20T15:01:42.805Z |
| 1 | 2 | 1 | execution-error | — | Native Verifier response was invalid: Native fail requires at least one failed acceptance criterion | 2026-08-20T15:20:13.197Z |
| 1 | 2 | 2 | fail | A6, A39 | The v1 discovery ambiguity and binding repair is correct, but the zero-parent case still needs an explicit recoverable blocker. The stale generated-report format check is an environment lifecycle issue, not a source formatting defect. | 2026-08-20T15:27:39.207Z |
| 1 | 3 | 2 | pass | — | Independent review passed after adding the zero-parent blocker and deduplicating the same v1 parent observed through multiple Git worktrees. Focused v2, continuation, Skill, native-children, formatting, typecheck, lint, and generated-asset checks passed. | 2026-08-20T15:44:06.100Z |



## 结论

Independent review passed after adding the zero-parent blocker and deduplicating the same v1 parent observed through multiple Git worktrees. Focused v2, continuation, Skill, native-children, formatting, typecheck, lint, and generated-asset checks passed.
