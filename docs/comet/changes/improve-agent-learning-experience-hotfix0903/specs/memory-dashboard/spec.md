# 个人记忆与项目知识 Dashboard

## 领域边界

`domains/dashboard` 负责把 Plugin Runtime 的公开页面贡献和能力调用投递到 Dashboard，并把领域快照准确表达给用户。`domains/comet-memory`、`domains/project-knowledge` 和 `domains/agent-learning` 分别拥有个人记忆、项目知识和学习循环状态；Dashboard 不维护第二份记录、生命周期或健康状态。

个人记忆与项目知识是两个独立中心，但共享以下展示语义：

- 有效内容：`trial | proven | enforced`，其中 Personal Memory 不使用 enforced；
- 历史内容：`superseded`；
- 遗忘保护：tombstone，仅属于 Personal Memory 数据状态；
- 已处理事件不等于已形成记录；
- 插件已启用不等于服务健康，也不等于已经学到内容；
- 文件、投影、索引语料和知识/记忆 Record 是不同对象。

### Scenario: Dashboard 不自行推导领域状态

- **Given** 插件已启用但 Provider 不健康或有效记录为零
- **When** Dashboard 渲染中心页
- **Then** 页面使用领域快照显示真实错误或零记录
- **And** 不得仅根据 configured/disabled、文件数量或事件数量显示“服务正常”或“已学习”

## 页面发现与隔离

- Dashboard Server 接收一个插件 Host，Host 使用 `PluginRuntime.dashboardPages({ scope: 'project', projectId })` 返回已安装插件页面。
- 页面列表只公开 `pluginId`、用户可读标题、稳定路由和当前插件状态；停用插件仍返回页面并标记 `disabled`，卸载插件不返回页面。
- 一个插件页面加载失败、能力调用失败或数据解析失败时，Host 返回带插件标识的诊断；其他页面和 workflow 页面继续正常响应。
- 现有工作流导航保留；个人记忆和项目知识入口不改变当前 workflow/change 选择。
- 页面请求拥有独立 loading/error 边界；切换项目、页面或刷新不会把前一项目/插件的数据写入当前页面。

### Scenario: 页面错误不会污染其他中心

- **Given** 项目知识快照加载失败
- **When** 用户打开个人记忆或 workflow 页面
- **Then** 其他页面继续显示各自数据
- **And** 项目知识页面单独显示可重试诊断

## HTTP and capability boundary

在现有项目路由下提供：

- `GET /api/dashboard/projects/:projectId/plugins`：返回页面列表、插件状态和诊断摘要；
- `GET /api/dashboard/projects/:projectId/plugins/:pluginId`：返回对应中心页的用户可读快照；
- `POST /api/dashboard/projects/:projectId/plugins/:pluginId/invoke`：接收 `{ capability, input }`，调用公开插件能力，返回领域结果；
- `POST /api/dashboard/projects/:projectId/plugins/:pluginId/lifecycle`：接收 `{ action: "enable" | "disable" | "uninstall" }`，只调用 Runtime 生命周期 API，卸载不删除插件数据。

项目 ID 必须先通过现有 Dashboard project directory 校验；接口不得接受任意路径。未知能力、停用插件和失败返回结构化、用户可读错误。响应不泄露 Runtime 文件路径、内部评分、凭据或无界证据正文；稳定 Record/application ID 可以在管理动作和详情跳转中内部使用，但界面默认显示用户可读名称。

所有写操作后重新读取领域快照。后台学习与刷新不阻塞首屏，页面先显示最近一致快照，再明确展示刷新中状态。

## Personal Memory center

个人记忆中心以 Record 为中心，提供：

- **Core Profile**：当前有效画像与作用范围；
- **协作策略**：trial/proven Collaboration Policy、适用项目/路径/阶段、证据和最近应用；
- **个人经历**：可解释成功、纠正或失败的 Personal Episode，默认保持精简；
- **历史与遗忘**：superseded 版本、替代关系和 tombstone；
- **当前任务上下文**：下一任务可能应用的 Context Manifest 预览。

概览分别显示有效记录、trial、历史、遗忘保护、最近形成/纠正、最近应用结果、反馈覆盖和同步状态。“自动学习已开启”只显示配置权限；实际学习结果由新增/更新/noop/deferred/failed 状态表达。

投影文件位于“数据与同步”详情，只展示用途、同步和重建状态，不计入记忆条数。`profile_char_limit` 与 `task_context_char_limit` 文案说明单次注入预算，不暗示记忆总容量。

页面支持新增、纠正、遗忘、回滚、expand、同步和重新生成投影。显式操作失败保持原状态并显示原因；后台学习默认安静，只在存在诊断或用户需要行动时提示。

### Scenario: 零个人记忆有明确解释

- **Given** 学习和检索配置均开启、投影文件存在，但权威状态没有有效 Record
- **When** 用户打开个人记忆中心
- **Then** 概览显示有效记忆为零
- **And** 投影文件只出现在数据详情
- **And** 空状态显示最近没有合格信号、等待复用、延迟或失败中的真实原因及可用操作

### Scenario: 个人记忆详情可解释应用

- **Given** 一条 Collaboration Policy 曾被选择并得到 application outcome
- **When** 用户查看详情
- **Then** 页面显示正文、作用范围、authority、生命周期、证据摘要、whyApplied 和最近结果
- **And** 纠正前后的版本关系清楚可追溯

## Project Knowledge center

项目知识中心以知识单元为中心，分为：

- **项目模型**：当前 topology、fact、dependency；
- **项目策略**：当前 decision、pattern、procedure、constraint、failure-resolution；
- **索引来源**：可参与检索的文档、代码和配置 corpus；
- **历史版本**：superseded Record 和替代关系。

概览显示有效总数、trial、proven、enforced、历史、最近模型刷新、最近语义学习、跳过/延迟/失败数量和 application feedback 覆盖。默认有效视图包含 trial/proven/enforced；历史不混入当前列表。

“索引来源”与“结论证据”分开：前者说明哪些材料可参与检索，后者属于某条 Record 并说明该结论由什么支持。一个文件同时承担两者时也分别表达其角色。

页面支持按模型/策略 kind、生命周期、作用范围和文本筛选；从来源或关系跳转到目标 Record 时自动调整当前 tab/filter 并准确选中，不因目标处于 trial、enforced 或 history 而落空。

### Scenario: 有效记录与历史记录不会混淆

- **Given** Store 中有 0 条有效 Record 和 24 条 superseded Record
- **When** 用户打开项目知识中心
- **Then** 概览显示“有效 0、历史 24”
- **And** 当前知识列表为空，历史列表显示 24 条或明确的分页/截断信息
- **And** 页面不把 24 条历史描述为已收录的当前知识

### Scenario: 所有有效生命周期默认可见

- **Given** 当前记录同时包含 trial、proven 和 enforced
- **When** 用户打开默认有效视图
- **Then** 三种状态都可浏览并有明确标签
- **And** 用户可按单一状态缩小范围

## Source and relationship detail

来源详情的首要任务是解释“这个文件和哪些结论有什么关系”，内容顺序为：

1. 来源身份、类型、索引状态、project-relative 路径和真实文件更新时间；
2. 按逻辑知识分组的关联 Record，每项显示类型、生命周期、当前/历史、完整结论、关系类型、版本和替代关系；
3. 与该结论对应的 anchor、引用片段、内容摘要/版本和验证方式；
4. 按需展开的有界文件原文，并明确是否截断。

同一逻辑知识的多个历史版本在一个版本链内展示，不以相同标题、相同摘要的并列行伪装成多条不同结论。列表中的“最近更新”必须明确是文件更新时间、Record 更新时间还是最近索引时间，不复用一个标签表达不同含义。

### Scenario: 六个历史版本显示为一条版本链

- **Given** 同一逻辑知识存在一个当前版本和五个 superseded 版本，全部引用同一文件
- **When** 用户打开该来源详情
- **Then** 页面显示一个关联知识及其六个版本的版本链
- **And** 默认突出当前结论和精确引用
- **And** 不显示六条无法区分的相同标题摘要

### Scenario: 文件原文截断可见

- **Given** 来源文件超过预览上限
- **When** 用户展开文件原文
- **Then** 页面显示有界内容并明确标记已截断
- **And** 关联结论和引用片段不因整文件截断而消失

## Health, telemetry, and empty states

中心页健康状态来自领域快照，至少综合：插件生命周期、Provider 可用性、索引可用性、快照新鲜度、后台队列和最近错误。状态使用“正常”“刷新中”“需要处理”“已停用”等简短事实表达；存在错误或数据不完整时不得显示“服务正常”。

项目知识快照公开最近查询耗时、候选数量、索引文档数、结果是否截断和最近刷新；个人记忆快照公开最近学习结果、投影/同步和反馈覆盖。前端只展示快照实际提供的字段，不保留永远为空的占位统计。

所有固定上限和分页都必须暴露 `truncated`/总数/当前显示数。空状态按真实原因区分：尚无合格信号、等待第二次验证、没有当前有效知识、来源失效、语义学习延迟、Provider/索引错误、筛选无结果。每种状态提供至多一个直接相关的下一步，不使用泛化鼓励文案。

### Scenario: 健康状态反映真实故障

- **Given** 插件已启用但 Local Index 损坏或 Provider 查询失败
- **When** 用户打开项目知识中心
- **Then** 顶部显示“需要处理”及对应层级的简短诊断
- **And** 不显示“服务正常”
- **And** 不受影响的缓存内容仍可按领域允许的方式查看

### Scenario: 查询统计来自真实快照

- **Given** Provider 已执行一次查询并返回耗时、候选数和截断状态
- **When** Dashboard 刷新
- **Then** 页面显示同一快照中的真实统计
- **And** 不因前后端字段未接通而继续显示“尚无查询统计”

## Visual and content language

界面沿用 Dashboard 现有紧凑视觉语言和 AntD 组件，优先使用 `Tabs`、`Table`、`List`、`Descriptions`、`Tag`、`Alert`、`Empty`、`Modal/Drawer` 和现有工具栏模式。

不得为本 change 引入以下表达：

- 大面积 Hero、宣传式指标卡墙或层层嵌套卡片；
- 渐变光晕、漂浮装饰、拟人化助手语气或“AI 正在思考/成长”等文案；
- 重复标题、重复摘要、无信息量的状态句和模板化建议；
- 为了显得智能而隐藏确定性状态、ID 关系、失败原因或数据边界。

页面用用户任务语言命名对象，例如“个人记忆”“项目模型”“项目策略”“索引来源”“历史版本”“最近使用结果”。设置入口使用“项目知识设置”，不使用已废弃或含义不同的“项目规则设置”。正常状态保持安静，诊断和操作结果按现有 Dashboard 级别显示。

### Scenario: 页面保持克制且可扫描

- **Given** 用户在桌面宽度和窄屏宽度打开两个中心
- **When** 浏览概览、列表和详情
- **Then** 关键信息使用现有紧凑布局在首屏可扫描
- **And** 没有宣传式卡片墙、渐变装饰、拟人化文案或重复大标题
- **And** 交互控件保持可访问标签、键盘焦点和响应式可用性

## Lifecycle and failure behavior

停用页面显示“已停用”和“重新启用”；卸载后入口从侧边栏移除，但后端保留领域文件和 Runtime 数据。关闭学习不删除已有记录，关闭检索不影响管理。

刷新、整理、纠正、遗忘、回滚或生命周期动作发生冲突时，页面显示真实错误并重新读取当前快照，不使用乐观成功状态覆盖服务器结果。后台学习、索引或 reviewer 故障不阻塞 workflow 页面。

## Verification

- Server/API 测试覆盖项目路径、插件标识、能力名、生命周期动作、跨项目隔离、错误边界和刷新后一致性。
- 浏览器测试覆盖个人记忆和项目知识的真实计数、有效/历史筛选、来源版本链、关联跳转、截断、空状态、健康状态、查询统计和管理动作。
- 视觉回归或结构断言覆盖现有紧凑 Dashboard 语言、响应式和可访问性，并防止宣传式卡片墙、重复标题和拟人化文案回归。
