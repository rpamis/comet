# Outcome

让 Native 初始化默认把工作流产物放在 `docs/comet/`，初始化完成提示只展示实际启用 workflow 的真实工作目录，从而避免项目根出现意外的 `comet/` 空目录，并让默认布局下的 Native change 能在另一台设备重新初始化后被直接发现。Classic 的默认审查深度继续保持 `standard`。

# Scope

- 将未配置项目的 Native `artifact_root` 默认值从 `.` 改为 `docs`，覆盖主入口 `comet init`、底层 `comet native init` 和共享默认配置构造。
- Native 初始化默认创建 `docs/comet/{specs,changes,archive,runtime}`，不再创建项目根 `comet/{specs,changes,archive,runtime}`。
- `comet init` 的完成摘要根据实际启用的 workflow 动态展示工作目录：Native 展示当前 `<artifact_root>/comet/`，Classic 展示 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`，Both 同时展示两组。
- 保留显式 `--root <path>` 与已有 `.comet/config.yaml` 中 `native.artifact_root` 的优先级，不迁移或覆盖已有自定义根目录。
- 确认并回归保护 Classic `classic.review_mode` 缺失时的默认值为 `standard`。
- 同步 CLI 测试、配置测试和用户可见文案的中英文覆盖。

# Non-goals

- 不自动移动已有 Native artifact root；已有项目需要移动时仍使用既有 root move 能力。
- 不自动删除包含文件的项目根 `comet/` 目录，也不把它猜测为废弃目录。
- 不改变 Classic 的 `docs/superpowers/` 目录结构、review mode 值域或用户显式配置。
- 不改变显式 `--root .` 的含义；用户明确选择项目根时仍创建 `<project>/comet/`。

# Acceptance examples

- 全新项目执行 `comet init` 并选择 Native：`.comet/config.yaml` 写入 `native.artifact_root: docs`，创建 `docs/comet/specs|changes|archive|runtime`，不创建项目根 `comet/`。
- 全新项目执行 `comet native init` 且不传 `--root`：默认根同样为 `docs`；传入 `--root artifacts` 时仍使用 `artifacts/comet/`。
- Native-only 初始化完成摘要显示 Native 工作目录 `docs/comet/`，不出现 `docs/superpowers/`；Classic-only 仍显示两个 Classic 工作目录；Both 同时显示 Native 与 Classic 工作目录。
- 一台设备提交并同步默认位置 `docs/comet/changes/<name>` 后，另一台设备在没有同步 `.comet/` 本地 sidecar 的情况下重新执行默认 Native 初始化，探针能够从同一个默认根发现该 active change。
- 已有配置为 `native.artifact_root: .` 或其他自定义路径时，再次 `comet init` 保留该值，不擅自切换到 `docs`。
- `classic.review_mode` 缺失时 Classic 读取结果为 `standard`；显式 `off` 或 `thorough` 保持原值。

# Constraints and invariants

- `.comet/config.yaml` 和 `.comet/current-change.json` 仍是本地 sidecar；默认跨设备恢复依赖所有设备对未配置 Native root 使用同一个 `docs` 默认值。
- 完成摘要必须由实际 workflow selection 和解析后的 artifact root 生成，不能继续使用与 workflow 无关的静态 Classic 文案。
- JSON 初始化结果中的 `nativeArtifactRoot` 必须与实际创建目录和写入配置一致。
- 默认值调整必须同步源码、生成 runtime 资产和锁定旧 `.` 行为的测试。

# Decisions

- Native 未配置时的默认 `artifact_root`：`docs`。用户已明确。
- Native 工作目录提示：展示实际解析后的 `<artifact_root>/comet/`；Classic 保留现有两个 Superpowers 目录；Both 展示两者。依据是提示必须反映真实创建结果。
- Classic 默认审查深度：`standard`。用户已明确，现有正确行为只加强回归保护。
- 已有配置优先于新默认，显式 `--root` 优先于默认；默认变更不构成隐式 root migration。

# Open questions

无阻塞问题。

# Verification expectations

- 测试先证明现有全新 Native 初始化仍返回 `artifactRoot: .`、创建根 `comet/` 且摘要打印 Classic 路径，再实施修复。
- 定向覆盖 `resolveInitWorkflow`、`defaultProjectConfig`、`comet native init`、`comet init` JSON/人类可读摘要，以及 Classic `review_mode` 默认与显式值。
- 运行相关 Vitest、构建、lint、格式检查、生成物一致性检查和全量测试。
