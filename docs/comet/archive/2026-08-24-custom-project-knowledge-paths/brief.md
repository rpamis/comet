# Outcome

让用户可以在项目 `.comet/config.yaml` 和 Dashboard 总设置中，配置多个额外的本地 Markdown 文档 glob；这些文档追加到现有 Native、Classic 和 Superpowers 项目知识来源，并参与 Local Provider 的检索。

# Scope

- 增加 `knowledge.local.include: string[]` 项目配置。
- 在 workflow-contract 中完成类型、默认值、YAML 读写、标准化和安全校验。
- 在 Project Knowledge corpus 中匹配用户配置的 glob，并与内置来源合并去重。
- 在 Dashboard 项目配置设置中编辑、保存和重新加载多个路径。
- 让数据来源页面展示匹配到的自定义文档。
- 增加配置、语料、Provider、CLI 和 Dashboard 的回归测试。

# Non-goals

- 不替换内置 Native、Classic 和 Superpowers 语料。
- 不自动导入宿主 Rule（如 `AGENTS.md`、`CLAUDE.md`）；用户显式配置具体模式时仍按普通 Markdown 文档处理。
- 不增加 PDF、Office、源码或配置文件解析。
- 不增加自定义排除模式、独立权重或 Remote Provider 的本地路径同步。
- 不改变现有语料预算、检索结果数量或上下文字符预算。

# Acceptance examples

- A1: 未配置 `knowledge.local.include` 的项目行为和 YAML 结构保持不变。
- A2: 多个合法 glob 可以追加匹配 Markdown 文件，结果与内置语料一起参与 Local 检索。
- A3: `*`、`**`、`?`、多模式去重和大小写不敏感的 `.md` 扩展名按约定工作。
- A4: 绝对路径、反斜杠、`..`、空模式和非 Markdown 模式被拒绝，并指出具体配置项。
- A5: 符号链接或越界真实路径不会进入语料；无匹配模式不会阻断其他来源。
- A6: Remote Provider 不读取自定义本地路径，切换 Provider 不删除该配置。
- A7: Dashboard 可新增、删除、保存、重新加载多个模式；Remote 时字段保留但禁用并说明仅 Local 生效。
- A8: 保存或刷新后，Dashboard 数据来源能展示匹配到的自定义文档。

# Constraints and invariants

- 配置路径必须是项目相对路径，分隔符统一为 `/`。
- 只有 `.md` 文件进入自定义语料；目录不能隐式扩展为递归匹配。
- 现有内置来源和自定义来源按项目相对路径去重。
- 读取前确认路径位于项目根目录内并拒绝符号链接。
- Dashboard 不自行解析或拼接 YAML，使用现有 revision 并发保护。
- 继续沿用现有语料发现的文件数、单文件、总字节和时间边界。

# Decisions

- 自定义路径字段采用 `knowledge.local.include`。
- 自定义路径追加到内置来源，不替换默认来源。
- 自定义路径只影响 Local Provider。
- 每行一个显式 Markdown glob，例如 `docs/architecture/**/*.md`。
- 使用当前项目语言生成配置注释和 Dashboard 文案。

# Open questions

- [blocking] CONFIRM: 确认以上目标、范围、非目标、验收项和约束，按单一 Native change 进入 Build。

# Verification expectations

- 先运行 workflow-contract、project-knowledge 和 Dashboard 的最小相关测试。
- 运行格式检查与 lint；涉及配置契约、Provider 和 Dashboard 集成，最终补充 build 和全量测试。
- 验证结果必须覆盖 A1-A8，并区分实现测试、Dashboard 浏览器测试和集成检查。
