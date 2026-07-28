# Outcome

把 Comet 的项目产物统一组织为 `docs/comet/`、`docs/openspec/`、`docs/superpowers/` 三个产品目录，同时保持 Native 与 Classic 的状态机、Guard 和产物所有权独立。新 Classic 项目默认使用 docs 布局；已发布的 legacy Classic 项目继续原位工作，只有显式、可恢复的迁移才移动 OpenSpec 产物。

# Scope

- 在 `.comet/config.yaml` 的 `classic:` 块新增 `artifact_layout: legacy | docs`，由一个 Classic 布局模块推导所有 OpenSpec 与 Superpowers 路径。
- 新建 Classic / Both 项目默认创建 `docs/openspec/` 与 `docs/superpowers/`；Native 继续按现有 `native.artifact_root` 使用 `docs/comet/` 或用户配置的 root。
- 增加 root-aware 的 `comet classic openspec -- <args...>` 适配命令，以解析后的 OpenSpec root 作为 cwd，并透传 OpenSpec 的输出与退出码。
- 拆分 OpenSpec CLI / 平台工具资产安装和 OpenSpec artifact root 初始化，覆盖 `comet init`、`update`、`doctor`、`uninstall`。
- 迁移 Classic runtime、Entry status、Hook Router / Guard、dashboard、workflow-contract、双语 Comet-owned Skill / Rule 和生成 runtime 的固定路径消费者。
- 增加 `comet classic root move docs --dry-run` 与 `--apply --plan <id>` 的可审计、可恢复迁移；首版只迁移没有 active change / pending action 的 legacy 项目。
- 更新相关测试、当前 eval treatment、生成物、英文 Changelog，并按 master 发布基线决定版本号。

# Non-goals

- 不修改 OpenSpec 或 Superpowers 的原始 Skill。
- 不把 OpenSpec store registry 用作同仓库 `docs/openspec/` 的定位机制。
- 不合并 Native 与 Classic 的状态机、change schema、Guard 或 runtime。
- 不自动迁移旧项目，不在双根冲突时静默合并或双写。
- 首版不迁移 active Classic / unmanaged OpenSpec change，不重写历史 handoff hash、Run、checkpoint 或 trajectory。
- 不修改 `039-release`、`040-beta` 等冻结 eval benchmark。
- 不把 Classic layout 扩展成任意低层 `openspec_root` / `superpowers_root` 自定义路径组合。

# Acceptance examples

- 全新 Classic 项目执行 `comet init` 后，配置包含 `classic.artifact_layout: docs`，产物目录为 `docs/openspec/{changes,changes/archive,specs}` 与 `docs/superpowers/{specs,plans,reports}`，项目根不留下第二个 `openspec/`。
- 全新 Both 项目同时得到配置指定的 `<native.artifact_root>/comet/`、`docs/openspec/` 和 `docs/superpowers/`；Native-only 项目不创建 Classic 目录。
- 已有配置缺少 `classic.artifact_layout` 时，Classic runtime 按 `legacy` 解析；`comet update` 将其显式补为 `legacy`，但不移动 `openspec/`。
- docs 布局中，`comet classic openspec -- status --change demo --json` 从 `<project>/docs` 运行 OpenSpec，保持原 stdout、stderr 和退出码；不要求每台机器注册 store。
- status、resume、state、guard、handoff、archive、dashboard 与 workflow-contract 在配置的唯一布局下解析同一个 change；legacy 与 docs 根同时存在时写操作失败关闭并给出 doctor / migration 指引。
- `comet classic root move docs --dry-run` 只报告移动、冲突、配置变化和 plan ID；`--apply --plan <id>` 锁定后重新预检并验证 staging / journal，再原子切换配置。中断后 doctor 能继续或回滚，不删除无法证明安全的目录。
- migration 遇到 active Classic / unmanaged OpenSpec change、pending action、未收口 archive、非空目标、特殊文件、路径越界或源文件漂移时不移动任何用户产物。
- `comet uninstall` 只删除 Comet 管理且为空的布局目录，保留所有用户 specs、changes、archives 与 Superpowers 文档。
- 当前 eval 新增 docs-layout 覆盖，冻结 benchmark 保持逐字节不变。

# Constraints and invariants

- 实现基于 `origin/master@2945693e4061c369be0d400ed2999a66fa87c680` 及 Issue #173 的 2026-07-27 最新技术方案。
- `.comet/config.yaml` 保持“顶层全局字段 + `native:` / `classic:` 工作流专属块”；新增字段不单独升级 `comet.project.v1`。
- 缺失 layout、旧配置升级、全新 init 三种情形必须可区分：runtime 缺失回退 legacy；旧项目 update 写 legacy；全新 Classic init 写 docs。
- 所有路径必须由单一布局模块解析；不能通过扫描两个候选根或目录遍历顺序猜归属。
- OpenSpec 是外部依赖，Comet adapter 必须保留其输出、退出码和平台启动语义；Windows `.cmd` 仍通过安全的进程适配执行。
- Native / Classic 共用的 selection 继续只记录 `workflow + change`，不写布局路径。
- 保留工作区中用户已有的 `website` 子模块修改，不纳入本 change。
- 源码修改后同步 Classic / Entry 生成 runtime；测试范围按跨模块高风险变更执行。

# Decisions

- 用户已授权按 Issue #173 的最新技术方案开始实现。
- 目标产品目录为 `docs/comet/`、`docs/openspec/`、`docs/superpowers/`。
- Classic 配置只暴露 `artifact_layout: legacy | docs`，不暴露可冲突的多个低层路径字段。
- OpenSpec root 使用 cwd-based adapter，不使用 per-machine store registry。
- 新项目默认 docs；旧项目保持 legacy；双根冲突失败关闭。
- migration 首版拒绝 active change，并采用 dry-run + 可恢复 apply。
- frozen eval baseline 不修改，当前能力另增 docs-layout treatment。
- 用户已确认共享理解：新 Classic 项目默认 docs 布局，旧项目保持 legacy 且仅显式事务迁移；OpenSpec 使用 cwd adapter；首版拒绝迁移 active change；Native 与 Classic 保持独立。

# Open questions

- 无。

# Verification expectations

- 配置契约、布局 resolver、init/update、OpenSpec adapter、Classic runtime、Entry、Hook、dashboard、workflow-contract、迁移事务、doctor/uninstall 均有最小相关回归。
- 验证 Windows 与 POSIX 路径/进程差异、双根冲突、迁移中断继续/回滚、历史 legacy 兼容和新项目默认行为。
- 运行 Classic / Entry runtime 构建与生成物一致性检查。
- 双语 Skill 先中文后英文同步，并运行相关契约测试与受影响文件 Prettier。
- 最终运行 lint、build、全量测试、格式检查和 `git diff --check`；若环境或既有基线阻塞，记录真实失败与隔离验证。
