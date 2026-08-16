# 目标

把现有 Native Supervisor 父级 Change 升级为 integration-first、用户可读且可安全恢复的 v2 模式。父级代表完整用户目标，Child 保持普通 Native Change 的独立实现与验证边界；Runtime 负责依赖、工作区、验证事实、串行集成和恢复，宿主只负责按 Runtime 任务包派发 Builder 与独立 Verifier。

最终用户在正常流程中只看到稳定、简洁的父级摘要；真实目标分支在父级最终验证和交付前保持不变，Child 的“已验证”“已集成”和整个需求的“已归档”不再混为同一状态。验证保证级别使用统一的用户可理解文案，明确是否需要确认、是否只有自动检查，以及验收通过与实际归档的区别；Portable State 和 status JSON 继续保留机器枚举值。

# 范围

- 新增 `comet.native.children.v2`，用户可读计划只包含 Child 的 `name`、`summary` 和真实 `depends_on`；Runtime 校验名称、引用和无环依赖，不再要求 `covers`、`owns` 或位置型验收映射。
- 新建 Supervisor v2 使用父级专用 integration branch/worktree。Child 从包含全部前置集成结果的 integration HEAD 创建，独立 Verify 后进入 `verified`，由父级串行集成并校验后进入 `integrated`。
- 所有 Child 集成完成后才允许父级最终 Verify；通过后由父级在一个可恢复流程中发布唯一权威 Specs、合入真实 target、统一归档父子 Change 并安全清理工作区。
- 父级协调者统一派发 Builder 和只读 Verifier。Runtime 提供绑定 Child、角色、工作区、基线提交和 `runId` 的精简任务包；支持 Agent 的宿主可并行派发无依赖任务，不支持时按相同语义顺序执行。
- 同一 Child 同时最多一个有效任务；重复、迟到或已失效的 `runId` 不能推进验证或集成。恢复时优先重连旧任务，只有确认旧任务结束或取消后才允许重新派发。
- 正常 `status` 返回固定预算的父级、Child、Agent、检查和下一动作摘要；完整验收、验证记录和恢复历史通过按需详情与 cursor 分页读取，Dashboard 只消费同一份 Runtime `status` JSON。
- 父级验证记录分层展示 Child verification、Parent integration、Not rerun 和 Incomplete；超时、环境阻塞、缺失检查或缺少父级实际集成证据不能折算为通过。
- 父级 Verify 失败后，可追加严格处于已确认范围内的修复 Child；不得改写已集成 Child 的历史，新增用户可见范围或产品决定时必须返回父级 Shape。
- Supervisor 动态状态、Agent 执行、集成记录、验证记录、恢复日志和临时输入统一位于 `.comet/runtime/native/changes/<parent>/supervisor/`；父级 change 根目录只保留用户可读产物。
- `children.v1`、旧 Verifier response 和旧 `status` JSON 至少保留一个 beta 周期的读取兼容；已归档 v1 永不重写，已有 active v1 按旧语义完成，只有尚未启动 Child 的 v1 才能经用户确认升级。
- 同步 Native Runtime、平台 Git/worktree Adapter、CLI 组合层、中文与英文 Native Skill、Dashboard 只读适配、生成 bundles、资产清单、测试以及 `0.4.0-beta.20` 的用户可见 Changelog 与版本元数据。

## Supervisor Change 拆分

- `supervisor-integration-core`：负责 `children.v2` 双读、专用 integration workspace、`verified / integrated / archived` 生命周期、依赖基线、Git 校验、串行集成和一次最终交付。
- `supervisor-agent-coordination`：依赖 integration core，负责父级统一的 Builder/Verifier 任务包、`runId`、宿主并行与顺序降级、恢复重连以及重复/迟到回报保护。
- `supervisor-observability-recovery`：依赖前两个 Child，负责简洁状态、分层验证记录、修复 Child、Runtime 重建、最终归档恢复、Skill/CLI/Dashboard 横向接入和规模验证。

# 非目标

- 不建设 worker claim、lease、heartbeat、抢占、自动任务领取或通用 bounded-concurrency scheduler。
- 不建设 Agent Team、共享 mailbox、Agent 间自由通信、嵌套 Supervisor、模型自动选择或 exactly-once Agent execution。
- 不新增 provider attestation、跨平台 Agent SDK、多层父子树、跨仓库 DAG、软依赖或多种依赖边。
- 不改变 Native acceptance identity，不在本次引入命名验收场景、Markdown 机器职责规则或内容指纹迁移。
- 不新增 `comet supervisor` 命令族，不让 Dashboard 复制状态机或编辑父子计划，不重新设计 Dashboard。
- 不自动解决 Git merge conflict，不扩展到 Classic 父子 Change，不重复修复 Issue #313 的 Archive preview 缺陷。

# 规格结构与追踪

Issue #314 当前包含 37 条显式验收项，但完整合同还包括正文中的兼容、恢复、任务包和交付边界。为避免把多个状态转换和失败路径压进同一条场景，目标规格按责任拆成五组：

| 规格                         | 负责的合同                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| `supervisor-plan`            | `children.v2`、Shape 集成责任、修复 Child、v1 升级和兼容读取               |
| `supervisor-integration`     | integration workspace、Child 生命周期、依赖基线、target 保护和一次最终交付 |
| `supervisor-agents`          | Builder/Verifier 任务包、可选并行、顺序降级、`runId` 和重派保护            |
| `supervisor-evidence-status` | 默认摘要、详情分页、分层验证证据、Dashboard 同源状态                       |
| `supervisor-recovery`        | Runtime 布局、事实重建、中断恢复、跨平台边界和规模验证                     |

每条 `Scenario` 只表达一个可独立判定的行为或失败边界。Runtime 在 Shape 确认时仍可生成内部 `A1...An`，但这些位置型 ID 不进入 `children.v2` 或默认用户输出。

# 约束与不变量

- 正确性必须来自 Runtime 和 Git 事实，不能相信 Agent 自述、宿主任务完成消息或未经提交校验的 Archive 文件。
- 真实 target 在父级最终交付前保持原提交；target 漂移时必须重新带入 integration workspace 并重新执行父级集成检查。
- 集成始终串行；并行只加速互不依赖的 Builder 或 Verifier，不改变依赖、验证、集成和最终交付语义。
- Child scoped Specs 只作为父级 Archive 下的实施历史；父级是最终权威 Specs 的唯一发布者。
- Agent 会话和本机进程不是可移植状态；Runtime 丢失后只能依据用户产物、Portable State、Git 关系和可信验证记录恢复。
- 新的 Git/worktree 操作继续通过 `platform/` Adapter；Windows、macOS 和 Linux 使用相同 Runtime 语义，不能缩减 33 平台 canonical registry。
- 修改 Native Runtime 后必须重建 Native bundles；中文 Skill 语义先以本次 Shape 确认，确认后再保持英文 Skill 同步。
- 当前父级 Change 按用户选择使用 `current` 隔离并绑定 `beta20`；现有 `.comet/config.yaml` 与 `.gitignore` 未提交改动必须保留且不得混入无关提交。

# 决策

- 完整实现 Issue #314 的 integration-first Supervisor v2，不只优化 Skill 文案、状态摘要或在 v1 上逐项打补丁。
- 使用一个完整目标 capability `native-supervisor`，把目标 Specs 与三个实施 Child 分开；Child 数量不与 Spec 数量或验收项数量绑定。
- 三个 Child 按 integration core → Agent coordination → observability/recovery 的真实依赖顺序推进；第三个 Child 明确承担 Skill、CLI、Dashboard 和端到端验证的横向集成责任。
- v2 三个阶段全部完成前不设为新建 Supervisor 的默认模式，避免 v1/v2 生命周期混用。
- 本次用于实施 v2 的父级仍使用当前 Runtime 支持的 `children.v1` 契约；这是实施期兼容边界，不改变交付后的 `children.v2` 用户语义。
- 尚未启动任何 Child 的 active v1 在用户下次恢复或继续父级时，由 Skill 主动展示一次 v2 差异并请求确认；确认后升级，拒绝后继续 v1 且不再主动重复提示，不新增升级 CLI。
- 每个 verified Child 合入 integration branch 后，只执行 Git/状态不变量和其已确认实施责任对应的最小跨模块检查；所有 Child integrated、target 漂移或父级最终 Verify 时，执行完整父级集成检查。
- Issue #313 保持独立；本 Change 只接入修复后的统一 Archive 能力。若该能力在最终联调时仍不可用，Supervisor v2 的最终交付验证保持 blocked，不在本 Change 内复制 #313 修复。
- 目标版本按 `origin/master` 的 `0.4.0-beta.19` 递增为 `0.4.0-beta.20`；Changelog 只描述最终用户可感知的 Supervisor 行为。

# 待解决问题

- 无。用户已确认按以上目标、范围、关键决定、五组完整规格、三个实施 Child 与非目标实现 Issue #314，Runtime 已进入 Build。

# 验证预期

- 每个 Child 先运行覆盖自身改动的最小 Native、Skill、Dashboard、平台或仓库契约测试，并重建/检查受影响的 Runtime bundle。
- Integration core 至少覆盖一个真实 Git linked-worktree 的父级完整流程、依赖提交继承、串行集成、target 保护、中断恢复和一次最终交付。
- Agent coordination 至少覆盖两个无依赖 Child 的 Builder/Verifier 派发、顺序降级、单 Child 单有效任务、旧任务重连、取消后重派以及重复/迟到 `runId` 拒绝。
- Observability/recovery 至少覆盖默认状态预算、按名称查询、cursor 分页、分层验证、Incomplete 保留、Runtime 丢失重建、32 个 Child 的状态大小/性能和 Dashboard 同源展示。
- 最终交付前运行架构 lint、生成物检查、build、与发布包相关的验证以及一次风险匹配的全量测试；任何超时或环境阻塞都明确保留为未完成，不宣称通过。
