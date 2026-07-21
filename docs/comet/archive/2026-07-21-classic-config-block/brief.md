# Outcome

把 `.comet/config.yaml` 中 Classic 工作流专属的配置字段（`language`、`context_compression`、`review_mode`、`auto_transition`）从顶层平铺改为收纳到 `classic:` 嵌套映射下，与已有的 `native:` 嵌套块对称，让配置按工作流分组、易于识别。

# Scope

- 在 `.comet/config.yaml` 引入 `classic:` 嵌套块，承载 Classic 专属的四项配置：`language`、`context_compression`、`review_mode`、`auto_transition`。
- Classic 运行时（guard / state / handoff 等读取 `.comet/config.yaml` 的路径）改为从 `classic:` 块读取这四项；块或字段缺失时回退与今天一致的默认值。
- `comet init` / `comet update` 写 `.comet/config.yaml` 时生成新格式；遇到旧平铺字段时将其值迁入 `classic:` 块并从顶层删除。
- 注释渲染（`domains/workflow-contract/project-config.ts` 的 `COMMENTS` 与 `renderStructuredProjectConfig`）为 `classic:` 块及块内字段补充与 `native:` 对称的双语注释。
- `CometProjectConfig` 类型（`domains/comet-native/native-types.ts`）扩展可选 `classic` 块。
- 同步更新涉及这些字段名 / 读取路径的测试。

# Non-goals

- 不改变 Native 工作流配置（`native:` 块）的结构或读取。
- 不改变顶层全局字段（`schema`、`default_workflow`、`workflows`、`ambient_resume`）的语义。
- 不在 Classic 运行时保留对旧顶层平铺字段的向后兼容读取（已明确：仅靠 init/update 迁移）。
- 不改变各配置字段的值域（`context_compression` 仍为 `off|beta`、`review_mode` 仍为 `off|standard|thorough`、`auto_transition` 仍为布尔、`language` 仍为 `en|zh-CN`）。
- 不调整 Classic change 级 `.comet.yaml`（change 状态文件）结构。
- 不把迁移触发点扩展到 `init`/`update` 之外的命令。

# Acceptance examples

- 新项目运行 `comet init`（启用 classic）后：`.comet/config.yaml` 包含 `classic:` 块且块内含四项字段；顶层不再出现 `language` / `context_compression` / `review_mode` / `auto_transition`。
- 旧平铺 config.yaml（顶层有上述字段）运行 `comet update` 后：这些字段被移入 `classic:` 块，顶层对应条目被删除；其余顶层字段与 `native:` 块原样保留。
- Classic guard / state 读取 `review_mode`：从 `classic.review_mode` 取值；块或字段缺失时回退默认 `standard`。
- 旧平铺 config.yaml 在未跑 init/update 的情况下直接被 Classic 读取：顶层 `review_mode` 被忽略，回退默认（不兼容旧格式的明确后果）。
- `comet init` 生成的 config.yaml 中，`classic:` 块内每个字段带有与 `native:` 块风格一致的双语注释。

# Constraints and invariants

- 配置文件大小上限、字段值域、顶层 `schema: comet.project.v1` 字符串保持不变。
- `classic:` 块整体可选；缺失时 Classic 四项全部回退默认，行为等价于今天未配置。
- 迁移幂等：对新格式 config.yaml 重复跑 init/update 不产生重复字段、不丢失已填值。
- 迁移只搬运字段值与注释，不改写用户为其他字段填写的自定义内容。
- 解析仍用 error-tolerant 的 yaml 解析（`uniqueKeys: false`），其他字段的语法错误不阻断单字段读取。

# Decisions

- 字段范围：完整集——`language` + `context_compression` + `review_mode` + `auto_transition` 全部归入 `classic:` 块。依据：运行时这四项只被 Classic 读取，Native 有独立 `native.language`，不读其余三项。用户已确认。
- 迁移策略：仅自动迁移，不兼容旧格式——Classic 运行时只读 `classic.*`；用户需跑一次 `comet init` / `update` 迁移，否则旧顶层值被忽略并回退默认。用户已确认。
- 冲突优先级：同一配置同时含旧顶层字段和新 `classic:` 块内同名字段时，保留新的 `classic.*` 值并删除旧顶层字段，避免陈旧旧值覆盖新格式中的明确配置。用户已确认。

# Open questions

- 无阻塞问题。

# Verification expectations

- 单元测试覆盖：新格式生成、旧平铺迁移（值搬运 + 顶层删除 + 幂等）、Classic 从 `classic:` 块读取与默认回退、旧格式不兼容回退、双语注释渲染。
- 构建与现有契约测试通过（`pnpm build`、`test/domains/comet-classic/`、`test/domains/skill/`、`test/domains/workflow-contract/`）。
- 本仓库自身 dogfood：`comet update` 把当前平铺 `.comet/config.yaml` 迁移为新格式后，Classic 读取结果与迁移前一致。
