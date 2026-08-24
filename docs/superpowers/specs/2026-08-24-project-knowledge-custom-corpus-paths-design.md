# 项目知识自定义文档路径设计

## 背景

当前 Local Project Knowledge Provider 只会自动发现已启用工作流的 Native、Classic 与受归档 Change 引用的 Superpowers 文档。项目中已有的架构说明、ADR、模块 README 或团队维护文档不会进入本地召回，用户也无法通过项目配置扩展语料范围。

本设计允许用户在 `.comet/config.yaml` 中配置多个项目相对 glob，把匹配到的 Markdown 文档追加到现有项目知识语料。Dashboard 总设置提供同一配置的可视化编辑入口。

## 目标

- 保留现有 Native、Classic 和 Superpowers 内置知识来源。
- 允许用户配置多个额外 Markdown 路径，并支持 `*`、`**` 和 `?` 通配符。
- CLI、Dashboard、普通任务召回和索引刷新使用同一份标准化配置。
- 配置、发现与读取始终限制在当前项目根目录内。
- 用户能从 Dashboard 确认配置是否保存、是否生效以及实际发现了哪些来源。

## 非目标

- 不自动导入 `AGENTS.md`、`CLAUDE.md` 或平台 Rule；规则与项目知识继续保持不同职责。
- 不增加自定义排除模式、文件类型选择器或单路径独立权重。
- 不扫描 Markdown 以外的 PDF、Office、源码或配置文件。
- 不改变 Remote Provider 协议；自定义本地路径只对 Local Provider 生效。
- 不替换或关闭现有内置语料发现。

## 配置模型

项目配置增加可选字段：

```yaml
knowledge:
  provider: local
  local:
    include:
      - docs/architecture/**/*.md
      - packages/*/README.md
      - decisions/**/*.md
```

`knowledge.local.include` 是字符串数组，默认值为空数组。空数组表示只使用现有内置来源。Provider 切换为 `remote` 时保留该配置但不使用；切回 `local` 后重新生效。

模式采用以下规则：

- 必须是项目相对路径并使用 `/` 作为分隔符；
- 支持 `*`、`**` 和 `?`；
- 禁止绝对路径、反斜杠、空字符串、NUL 和 `..` 路径段；
- 只接收以 `.md` 结尾的模式，扩展名匹配不区分大小写；
- 重复模式在标准化时去重，保持首次出现的顺序；
- 匹配结果与内置来源按项目相对路径去重。

本期要求用户显式填写文件模式。目录不能作为隐式的递归扫描请求，例如应填写 `docs/architecture/**/*.md`，而不是只填写 `docs/architecture`，从而让配置的实际覆盖范围保持可审计。

## 语料发现

现有内置发现完成后，Local Provider 执行额外路径发现：

1. 从标准化项目配置读取 `knowledge.local.include`。
2. 在项目根目录内匹配每个 glob，只接受普通 Markdown 文件。
3. 忽略符号链接，并在读取前再次确认真实路径仍位于项目根目录内。
4. 把匹配结果标记为独立的自定义文档来源类型。
5. 与内置 Native、Classic、Superpowers 来源按项目相对路径合并和去重。
6. 继续通过现有本地索引同步、检索排序、诊断和上下文预算处理。

无匹配不是错误。非法模式属于配置错误，阻止配置保存或 Provider 初始化，并指出数组索引与错误原因。文件在匹配后消失或无法读取时记录有界诊断，其他有效来源仍可使用。

额外来源继续受项目知识语料现有的文件数量、单文件大小、总字节数与发现时间边界约束。本功能不引入第二套预算，也不改变上下文最多返回条数和字符数。

## Dashboard

Dashboard 总设置的“项目规则”区域在 Local Provider 配置下增加“额外知识文档”字段：

- 使用可增删的路径列表，每项编辑一个 glob；
- 提供 `docs/architecture/**/*.md` 和 `packages/*/README.md` 示例；
- 在输入项旁直接展示格式校验错误；
- Remote Provider 下字段保持可见但禁用，并提示“仅本地 Provider 生效，配置会被保留”；
- 保存时与其他项目配置一起提交，使用现有 revision 防止覆盖并发修改；
- 保存成功后刷新 Project Knowledge 页面，使“数据来源”展示新发现的文档；
- 无匹配时保持保存成功，并在来源状态中说明当前模式尚未发现文档。

界面使用现有 Ant Design 表单和紧凑设置样式，不增加独立设置页面或新的侧边栏入口。

## 组件边界

### Workflow Config

`domains/workflow-contract` 负责配置类型、默认值、标准化、安全校验、注释生成和 YAML 往返写入。Dashboard 不自行解析或拼接 YAML。

### Project Knowledge Corpus

`domains/project-knowledge` 负责安全 glob 匹配、来源类型、语料合并和诊断。Provider 与索引只接收发现后的标准文档对象，不理解 Dashboard 表单结构。

### Dashboard Settings

`domains/dashboard` 负责把标准化配置映射为可序列化设置模型，并通过现有配置更新入口保存。Web UI 只编辑字符串数组并展示服务端校验结果。

## 兼容性

- 未配置 `knowledge.local.include` 的项目行为完全不变。
- 已有 `knowledge.provider` 和 `knowledge.remote` 配置保持有效。
- 初始化或更新旧项目配置时不强制写出空的 `local.include`，避免无意义的文件改动；用户首次保存非空列表时才写入。
- 删除全部额外路径后移除 `knowledge.local` 空映射，恢复简洁配置。

## 测试策略

采用测试驱动实现，按以下顺序建立失败用例：

1. Workflow Config：默认空数组、合法数组往返、去重，以及绝对路径、反斜杠、`..`、非 Markdown 模式拒绝。
2. Corpus：自定义 glob 追加到内置来源、递归匹配、多个模式去重、无匹配、符号链接与项目外路径保护。
3. Provider/CLI：Local 查询能命中自定义文档，Remote 不执行本地自定义发现。
4. Dashboard 服务：设置收集与更新能够读写 `knowledge.local.include`，revision 冲突行为不变。
5. Dashboard 浏览器：添加、删除、校验、保存和重新加载路径；Remote 状态下保留但禁用。

先运行各模块最小相关测试；由于改动横跨配置、领域、Dashboard 和 Runtime 集成，最终交付前运行构建、lint 与全量测试。

## 验收标准

1. 用户可以在 `.comet/config.yaml` 配置多个 `knowledge.local.include` glob。
2. 自定义文档与内置 Native、Classic 和 Superpowers 文档同时参与 Local 召回。
3. `*`、`**` 和 `?` 能按项目相对路径正确匹配 Markdown 文件。
4. 相同文件被多个模式或内置来源命中时只索引一次。
5. 绝对路径、父目录穿越、反斜杠和非 Markdown 模式无法保存或加载。
6. 符号链接不能让语料发现越出项目根目录。
7. 无匹配模式不会阻断其他知识来源或普通任务。
8. Remote Provider 不读取自定义本地路径，但切换 Provider 不删除配置。
9. Dashboard 能编辑多个模式，展示校验反馈，并在保存后看到更新后的数据来源。
10. 未配置该字段的已有项目保持原有行为与 YAML 结构。

## 已确认决策

- 采用方案 A：`knowledge.local.include`。
- 自定义路径追加到内置语料，不替换默认来源。
- 每个模式显式选择 Markdown 文件，不把裸目录自动扩展为递归扫描。
- 自定义路径只作用于 Local Provider。
