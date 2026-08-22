# Outcome

将 Project Knowledge 从尚未发布的 Unit Markdown 文件模型替换为项目外的 Project Knowledge Record。Local Provider 默认服务当前用户，Remote Provider 可选服务团队；两者共享 `status/query/apply` 接口，成功验证后自动学习，Dashboard、CLI 和工作流使用同一份状态。

# Scope

- 以稳定仓库 ID 保存共享的 Local Record，以 workspace ID 隔离当前工作区的源码和 Markdown section 索引。
- 让 Local/Remote Provider 支持状态、搜索、列表、读取、自动 upsert、用户纠正、忘记和刷新。
- 在成功的 verification/change/task checkpoint 中自动写入来源有效的 active Record，不要求用户打开 Dashboard。
- 让来源失效的 Record 进入 `needs-review` 并停止注入；用户纠正的正文优先于后续自动学习。
- 通过 CLI、Dashboard 和普通工作流维护同一份 Provider 状态；Dashboard 可配置 Local/Remote 和 Remote 连接参数。
- 保留有界 `<project_knowledge>` 注入、来源引用、Local 检索与 Remote 不回退 Local 的行为。
- 更新中英文 Project Knowledge 文档、正式 Spec 和 `0.4.0-rc.1` 用户可见 Changelog。

# Non-goals

- 不把 Project Knowledge 数据写入项目仓库；不保留 `docs/comet/knowledge/units/` 默认产品路径。
- 不实现 Unit schema、`maintained/generated/draft`、`knowledge units`、`share`、`share-memory` 或旧格式迁移/兼容读取。
- 不把 Personal Memory 的项目偏好自动复制为 Project Knowledge；Personal Memory 的 User Profile、项目记忆和 Provider 不改模型。
- 不实现 Local/Remote 双写、自动同步、离线队列、能力协商、后台服务、Provider marketplace、embedding、向量数据库或通用图数据库。
- 不让 Project Knowledge 覆盖用户请求、系统约束、当前代码、测试、Skill 或 Native/Classic workflow 状态。

# Acceptance examples

- A1：任务不打开 Dashboard，成功验证后仍能自动形成并在下一次相关查询中召回来源有效的 active Record。
- A2：Local Record 和 workspace section 索引只存在用户数据目录；同一仓库 worktree 共享 Record，不同仓库默认隔离，项目目录不新增 Project Knowledge 文件。
- A3：Local/Remote 均实现 `status/query/apply`；Remote 使用 `comet.project-knowledge.provider.v1`，失败不读取或发送 Local 内容，也不回退 Local。
- A4：查询只注入 active 且来源仍有效的结果；最多四条、单条不超过 1,600 字符、总计不超过 5,000 字符，并显示来源。
- A5：来源删除、变化或 anchor 失效后，Record 变为 `needs-review`，立即停止注入；重新核对成功后可恢复 active。
- A6：用户纠正将 Record 标为 `authority=user`，后续 automatic upsert 不能覆盖用户正文；用户 forget 后旧来源不能直接复活同一自动内容。
- A7：CLI 提供 `list/get/correct/forget/query/rebuild/status`，所有读写均通过 Provider，且不再提供 `knowledge units` 或 `share`。
- A8：Dashboard 展示 Provider 状态、记录状态/来源/更新时间、查询预览、纠正/忘记/重新核对和诊断，并可编辑项目 `knowledge` Provider 配置。
- A9：Dashboard、CLI 和 workflow 读取同一份 Local/Remote 状态，任何入口都不是自动学习的必经步骤。
- A10：Remote 请求只包含有界任务、路径、阶段、操作和知识记录数据，不包含完整 transcript、diff、日志、凭据或 token 值。
- A11：`<project_knowledge>` 与 `<personal_memory>` 分开召回、分开失败、分开预算；Personal Memory 的现有行为保持不变。
- A12：SQLite 损坏、锁超时、FTS 不可用、来源不可读、语义 reviewer 失败或 Remote 失败都不阻塞普通 workflow，并产生有界诊断。
- A13：中英文操作文档、正式 Spec、代码、测试和 `0.4.0-rc.1` Changelog 描述同一最终用户行为。

# Constraints and invariants

- Provider 是领域唯一读写边界；CLI、Dashboard、learning 和 context bridge 不直接访问 SQLite 或 Remote HTTP。
- Local 与 Remote 严格二选一，不双写；Remote Provider 不静默切换 Local。
- Record 状态只有 `active | needs-review | retired`，权威只有 `automatic | user`。
- 所有自动 Record 必须有当前来源和成功验证证据；没有可靠来源时不得注入。
- 手动纠正可以重新核对当前来源；来源仍失效时保留用户正文但维持 `needs-review`。
- 只修改本 change 及其 Native 正式产物，保留其他工作区改动；最终通过 Native Verify 后才 Archive。

# Decisions

- 项目外 Local SQLite 是本地唯一权威状态；Record 共享按 repository ID，当前来源索引按 workspace ID。
- Local 是默认 Provider，Remote 是可选团队 Provider；Remote 接口先设计为可兼容未来的外部实现，但本期不实现 mem0 专用适配。
- 成功验证且来源有效的自动知识直接 active，不等待 Dashboard 确认。
- 用户纠正优先于自动学习；自动学习只能更新来源状态或标记 review，不能覆盖用户正文。
- Dashboard 是可选管理界面，同时提供 Provider 配置和记录管理；CLI 与普通 workflow 具备等价的记录管理能力。
- Personal Memory 保持独立，不再提供把个人项目偏好转换为共享 Project Knowledge 的旁路。

# Open questions

无。此前关于存储位置、Local/Remote 归属、自动激活、来源失效、用户纠正优先、Dashboard 管理和 mem0 兼容边界的决定均已确认。

# Verification expectations

- 每个领域任务先运行对应 Vitest；Dashboard 改动运行 source、host 和 Playwright 测试。
- 最终运行 `pnpm format:check`、`pnpm lint`、`pnpm build`、`pnpm test`、Dashboard E2E、Project Knowledge Retrieval Eval 和 `comet native check`。
- Archive 前由独立只读 Verifier 逐项检查 A1–A13，并检查旧 Unit 产品路径、Remote 回退、用户纠正覆盖、来源失效注入和 Personal Memory 回归。
