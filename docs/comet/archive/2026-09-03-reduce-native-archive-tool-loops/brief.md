# 目标

让 Native 从验收通过进入 Archive 后，只需按 Runtime 提供的完整续执行信息完成收尾：先选择隔离工作区的收尾方式，再由一次完整 dry-run 暴露全部真实阻塞，清理后一次确认即可完成归档、归档提交及用户授权的 Git 收尾，避免 Agent 通过重复 `status`、失败的 `archive` 和手工提交 Runtime 产物来猜测下一步。

# 范围

- 修正 Archive-ready continuation：首次进入 Archive 时不再直接给出缺少预检或收尾选择的 `--confirmed` 命令。
- 对 `branch`、`worktree` 隔离返回 `keep`、`merge`、`push`、`pull-request` 的完整 dry-run 命令及实际影响，并提供暂不归档选项；对 `current` 返回无需收尾选择的完整 dry-run 命令。
- 让 Archive dry-run 复用正式归档前的工作区收尾预检，并在同一响应中返回全部阻塞路径和可执行的下一步，不再先报告 ready、到 confirmed 才失败。
- 将当前 change 目录视为归档事务授权范围，使 Runtime 生成的 `comet-state.yaml`、`verification.md` 和正式 change 产物由归档提交统一处理，不要求 Agent 先手工提交一次临时状态；Git 工作区中的 `current`、`branch`、`worktree` 都执行同一脏路径预检，只有归档授权范围内的路径会被自动提交。
- dry-run 成功后返回唯一、完整的 confirmed 命令；失败时保持只读，不删除、提交或覆盖用户文件。
- 加强中英文 Native Skill 的收尾约束：始终执行 Runtime 返回的完整命令；任务结束复用启动时保存的原始请求和 session，不探测 `COMET_TASK` 等未定义环境变量。
- 同步 Native Runtime bundles、相关契约测试和 rc.4 用户可见 Changelog/版本号。

# 非目标

- 不自动删除 `.turbo`、Storybook 输出或其他与 change 无法确定归属的工作区文件。
- 不放宽 Archive 对未提交实现、目标分支脏状态、Git 身份、远端或 PR Provider 的安全检查。
- 不改变 Verify、Verifier 派发、验收确认或 Classic Archive 的状态机。
- 不引入常驻进程、回调服务或新的外部执行机制。

# 验收示例

- A1：隔离方式为 `branch` 或 `worktree`、尚未选择收尾方式时，Archive-ready continuation 等待一次用户选择，并为四种方式返回包含 change 名、`--dry-run`、`--finish <mode>` 的完整命令及真实影响；不得返回不可直接执行的 `archive --confirmed`。
- A2：隔离方式为 `current` 时，Archive-ready continuation 直接返回完整 dry-run 命令，不要求选择 `--finish`，也不先执行 confirmed。
- A3：dry-run 发现 `.turbo`、构建输出或其他归档授权范围外的脏路径时，返回 `ready: false`、完整路径清单和阻塞 continuation；不得等到 confirmed 才暴露，也不得修改这些路径。
- A4：只有 change 自身的状态、verification 和规格产物未提交时，dry-run 仍可通过；confirmed 归档将它们与归档移动统一纳入自动归档提交，不要求 Agent 先执行手工 `git add/commit`。
- A5：dry-run 成功后 continuation 只给出当前 change 的完整 `archive --confirmed` 命令；执行后不得再次要求 `--finish`、额外 `status` 或第二次归档预检。
- A6：正式执行前工作区在 dry-run 后出现新的越界脏路径时，confirmed 仍安全阻塞并返回结构化路径与恢复方向，不静默继续。
- A7：中英文 Skill 明确复用首次 `comet task` 的原始请求与稳定 session 完成任务记录，不运行 `printenv COMET_TASK` 或其他环境探测。
- A8：Native Runtime 源码、发布 bundles、中英文 Skill 与相关帮助/契约保持一致，受影响测试、lint、build 和全量测试通过。

# 约束与不变量

- `continuation.commandArgs` 是 Agent 的唯一可执行下一步来源；状态读取只用于展示或诊断，不应成为正常 Archive 路径的必需调用。
- dry-run 必须只读，除已明确存在的收尾选择持久化外不得执行归档、提交、推送、合并或创建 PR。
- Runtime 可以自动提交的范围仅限当前 change、对应归档目录、该 change 的 canonical specs 和 selection；任何其他路径继续阻塞。
- 收尾方式仍由用户授权；本次任务最终选择 `pull-request`，不能据此改变产品默认值。
- 错误和阻塞响应保持稳定 JSON envelope，便于 Agent 不解析自然语言也能继续。

# 决策

- 把问题视为 Runtime continuation 与预检一致性缺陷，而不是增加 Agent 重试次数或外部回调。
- Archive-ready 与 Archive-preview 使用两个不同的 continuation：前者负责选择并执行 dry-run，后者仅在完整预检 ready 后给 confirmed，避免 dry-run 自循环。
- 复用正式 workspace-finish 的授权路径计算和安全检查，避免维护一套较弱的 dry-run 规则。
- 保留用户无法安全自动处置的脏路径，只在一次响应中给出足够诊断，不生成危险的自动删除命令。

# 待解决问题

无阻塞问题。

# 验证预期

- 针对 portable continuation、Archive CLI 与 workspace finish 添加失败优先的回归测试，覆盖 A1-A7。
- 运行 Native 相关 Vitest、Skill 契约与受影响文件 Prettier。
- 重新生成并校验 Native Runtime bundles。
- 因改动跨 Runtime、CLI、Skill 与发布资产，最终运行 lint、build 和全量测试，并等待 GitHub PR 全部 CI 检查通过。
