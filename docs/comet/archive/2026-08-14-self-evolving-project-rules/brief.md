# Outcome

交付一个可独立使用的项目规则领域服务，让 Comet 能读取用户可读的规则来源、按任务选择相关规则、记录自动发现的规范候选，并复用项目自身的构建或检查入口。规则属于仓库，不属于 Comet change；用户可以直接维护 Markdown 文件，也可以通过 `comet rules` 查看和初始化盘点。

本 child 是 Supervisor Change 中的项目规则实现。个人记忆、插件 Runtime 和 Dashboard 由其他 child 提供；本 child 只依赖已归档的公开插件接口，不把规则模型塞进 Comet Core。

# Scope

- `.comet/rules/*.md` 使用普通 Markdown 保存多条用户可读规则，不要求 frontmatter、规则 ID 或登记命令。
- 读取仓库已有的 `.comet/rules/*.md`、根目录 Agent 指令文件和常见宿主指令文件；规则来源保留可读路径。
- `init`、`scan`、`status` 使用同一领域服务，扫描只写 `.comet/runtime/project-rules/` 下的机器状态，不创建规则文件、检查配置或 Comet change。
- 用户可以显式追加规则、忽略候选或稍后处理候选；写入时保留已有 Markdown 内容。
- 从项目 manifest、构建文件和脚本发现项目实际验证入口，支持不同技术栈和 Maven/Gradle 等插件，不规定统一命令。
- 以任务、路径和来源范围做确定性规则选择，使用固定条目数和字节上限；未选中的规则不进入上下文。
- 记录带 workflow、project、change 和成功结果的轻量观察；Native 使用 `native`，Classic 使用 `full`、`hotfix` 或 `tweak`（宿主传入 `classic` 时归一化为 `full`）；同一 change 去重，至少两个独立成功 change 的一致观察才形成非阻塞候选。
- 提供 `comet rules init|scan|status` 的 CLI 入口；Skill、Hook、宿主 Rule 加载器和 Dashboard 只消费本 child 的公开服务，留给最终接线。

# Non-goals

- 不实现个人记忆、插件生命周期、Dashboard 页面或平台 Hook 安装。
- 不保存完整对话、工具轨迹、diff 或新的 trajectory。
- 不自动修改检查配置、安装依赖或把未采用候选变成阻塞要求。
- 不维护一套覆盖原生工具严重级别的第二套规则执行器。

# Acceptance examples

- 用户手动创建 `.comet/rules/database.md`，写入普通标题、列表和可选的 `适用范围：server/**/migration/**`；扫描和选择器可以直接读取它。
- 在没有规则文件的仓库运行 `comet rules init`，得到盘点摘要并保存 Runtime 状态，但仓库不会出现空规则文件或 Comet change。
- 用户说“加入规则：迁移必须同步回滚说明”，服务追加到指定 Markdown 文件，已有内容和注释保持不变。
- 同一候选只在两个不同且成功的 change 中观察到后才进入待处理候选；重复恢复同一 change 不增加计数。
- `select` 对任务和目标路径返回相关规则，结果不超过固定字节上限；普通运行不返回整个候选列表。
- 项目含 `package.json`、`pom.xml`、`build.gradle` 或 Makefile 时，服务返回项目实际可用的验证入口，不要求统一为 Comet 命令。
- `comet rules status --json` 返回初始化状态、规则来源、验证入口和候选摘要；不暴露内部 Runtime 字段。

# Constraints and invariants

- 用户可读 Markdown 是规则的唯一仓库来源；Runtime 只保存扫描索引、观察和候选状态。
- 规则选择和候选状态更新必须保持项目边界，不能读取或写入项目外路径。
- 原生检查成功、失败和 warning 语义由项目工具决定；本 child 只发现入口，不重新解释严重级别。
- 领域服务可在没有 Hook、Dashboard 或 CLI 的宿主中独立调用。

# Decisions

- 项目规则总称使用“项目规则（Project Rules）”；确定性执行仍称“规则”和“检查”，不使用“契约”。
- 一文件可以维护多条规则；解析以 Markdown 标题/段落为单元，避免用户维护机器字段。
- 候选状态只对未采用的自动发现负责；显式规则写入立即生效，不等待重复观察。

# Open questions

无。父级已确认的宿主投递、跨平台 Hook 和 Dashboard 行为在最终集成中验证。

# Verification expectations

- 运行项目规则领域测试。
- 运行 TypeScript 类型检查、架构检查和受影响文件的 Prettier 检查。
- CLI 的 JSON 与普通文本输出至少覆盖初始化、扫描和状态读取。
