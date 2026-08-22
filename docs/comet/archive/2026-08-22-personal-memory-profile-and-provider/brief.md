# 目标

把 Personal Memory 做成一个真正能长期学会用户偏好、又不会把 Agent 工作流水账当成偏好的默认能力，并达到 Hermes 类产品中“稳定用户画像 + 按任务检索记忆”的实际使用效果：

1. 增加独立的 **User Profile** 产品层，保存当前稳定、紧凑、跨任务可用的用户画像。
2. 保留并加强 **Task-matched Personal Memory**，按项目、任务、操作和路径检索相关偏好、协作习惯与个人经验。
3. 在两层之下提供可替换的完整 **Provider**，本期交付 Local 与通用 Remote Provider；不直接集成 Mem0，但协议和边界允许以后增加 Mem0 adapter。
4. 让用户在 Dashboard 中管理 User Profile、项目记忆、待确认内容和 Provider 设置。

最终结构是：

```text
用户证据 -> Personal Memory 领域服务 -> User Profile 上下文
                              -> Task-matched Memory 上下文
                              -> Local / Remote Provider
```

User Profile 与任务记忆是两个独立的语义和检索层，但共享同一组规范化记忆记录。Local Provider 继续把 User Profile 投影到现有 `profile.md`，不再创建一份重复的 `user-profile.md`。

# 范围

- 引入 `user-fact`、`user-preference`、`collaboration-habit`、`project-convention` 四类记忆，并保留 `explicit | inferred` 来源语义。
- 只从用户表达、选择和纠正中形成记忆；显式长期偏好立即生效，隐式偏好按独立证据晋升。
- 将检索拆成独立 User Profile 与任务匹配记忆两个上下文区块，分别限制条目数和字节预算，并消除重复注入。
- 保留 global/project 作用域、稳定 Git 项目标识、worktree 共享、项目隔离和现有项目记忆管理。
- 定义统一 Provider 接口：`status()`、`query(request)`、`apply(mutation)`。
- Local Provider 继续使用用户可读 Markdown、用户级 Runtime 和现有私有 Git 同步。
- Remote Provider 使用单一版本化 HTTPS envelope，支持用户接入自建服务；只发送有界用户证据，返回规范化记录。
- Provider 在用户级配置；项目只控制当前项目是否学习与检索。
- Dashboard 增加用户画像、项目记忆、待确认内容和 Provider 设置，并保留纠正、遗忘、回滚、暂停与同步能力。
- Classic、Native、Hotfix、Tweak、CLI、Dashboard 和插件上下文统一走同一 Personal Memory 领域能力。
- 为形成质量、检索精度、迁移、Provider 一致性和失败隔离增加测试与 Eval。

实现按一个 Native change 完成，避免为紧密耦合的模型、检索和 Provider 边界引入额外编排层：

1. 规范化记录模型、User Profile 投影和旧数据迁移。
2. 用户证据过滤、候选形成、晋升、纠正与冲突规则。
3. User Profile 与任务匹配双通道检索及上下文渲染。
4. Provider 抽象层、Local/Remote Provider 实现和用户级配置。
5. Dashboard、CLI 与各 workflow 接入。
6. 回归测试、质量 Eval、构建与浏览器验收。

# 非目标

- 本期不提供内置 Mem0 adapter，不在 Comet 核心、配置或 Dashboard 中暴露 Mem0 专属字段。
- 不保存或搜索完整会话，不建设会话归档、向量数据库、知识图谱或 Comet 托管记忆服务。
- 不支持 Local/Remote 双写、静默回退、自动迁移、Provider marketplace、动态 JS Provider、能力协商、复杂重试或熔断。
- 切换 Provider 不复制、不迁移、也不删除任一后端的数据。
- Personal Memory 的项目记忆不替代、不修改 Project Knowledge lifecycle、项目规则、Specs 或仓库事实。
- 不为 User Profile 新增第二份可读存储文件；现有 `profile.md` 就是 Local Provider 的 User Profile 投影。

# 验收示例

- **A1 显式画像**：用户说“以后都用中文回答”或“记住：回答简洁一些”后，该偏好立即成为 active User Profile，下一次任务能够使用，无需等待第二次证据。
- **A2 一次性要求**：用户说“这次只列三条”只影响当前请求，不进入候选、User Profile 或项目记忆。
- **A3 排除 Agent 工作信息**：CLI 用法、Change 状态、测试结果、提交摘要、工具输出、Agent 自己的计划和 `workflow-operation` 内容不会形成候选，也不会进入任何上下文。
- **A4 独立 User Profile**：检索开启时，系统单独生成完整的紧凑 User Profile 区块；不设条目数上限，默认按 2,000 个 Unicode 字符控制容量，能够包含姓名/角色/时区/技术背景、语言、沟通方式和稳定协作偏好，不依赖当前任务关键词才出现。
- **A5 任务匹配记忆**：系统另行按默认 6,000 个 Unicode 字符预算返回相关记忆，不设固定条目数；项目、操作、任务、路径或关键词不匹配的内容不注入，并与 User Profile 去重。
- **A6 项目记忆不受影响**：现有 `projects/<project-key>.md`、项目作用域记录和 Dashboard 管理继续可用；同仓库 worktree 共享，不同仓库或 fork 默认隔离。
- **A7 隐式晋升**：同一项目中两个不同成功 Change 的一致用户证据可晋升 project 记忆；global 隐式记忆需要两个不同项目的一致证据或用户明确确认。
- **A8 纠正优先级**：用户纠正或遗忘立即生效；隐式冲突不能覆盖显式记忆，candidate、conflict、inactive 和 tombstone 不参与正常注入。
- **A9 当前要求优先**：当前用户要求和项目规则高于历史记忆；记忆不能授权提交、推送、删除、发布等副作用。
- **A10 Provider 接口一致性**：领域层只依赖统一的 `status/query/apply` 接口；Local 与 Remote 实现产生相同的规范化记录、状态和管理语义。
- **A11 Remote 边界**：Remote Provider 通过 `comet.personal-memory.provider.v1` 接收有界用户证据，不接收完整 transcript；响应只能包含规范化记录，不能直接注入任意 Markdown 或提示词。
- **A12 配置分层**：用户在 `~/.comet/config.yaml` 选择 Local/Remote 及 endpoint、token 环境变量名、profile、timeout、User Profile 字符容量和任务上下文字符预算；项目 `.comet/config.yaml` 只保留 `memory.learning` 与 `memory.retrieval`。
- **A13 Provider 切换**：同一时刻只有一个 Provider 生效；切换不自动迁移或删除旧数据，也不静默回退到另一个 Provider。
- **A14 失败隔离**：显式记忆或管理操作失败时给出明确错误且不伪报成功；自动学习或检索失败时记录非阻塞诊断，当前 workflow 继续，检索失败时不注入记忆。
- **A15 Dashboard**：个人记忆页能查看和管理“用户偏好”“项目记忆”“待确认”，并能配置、测试和启用 Provider；Remote 模式不显示 Local Git 同步操作，token 值不写入配置。
- **A16 兼容迁移**：现有 `profile.md`、项目 Markdown、Runtime 历史和 Git remote 保留；可确认的旧偏好迁入新分类，明显属于 Agent 工作流水账的旧记录保留历史但转为 inactive。
- **A17 全入口一致**：Classic、Native、Hotfix、Tweak、CLI 与 Dashboard 对同一记录的检索、纠正、遗忘和 Provider 状态一致；插件停用或 Provider 失败不阻断 workflow。
- **A18 质量目标**：固定 Eval 中有效偏好 recall 为 1、检索 precision 不低于 0.9、Agent 工作信息和一次性要求的错误保存数为 0。
- **A19 未来 Mem0 兼容**：可以在不改变领域层、Dashboard 信息架构和上下文格式的前提下增加 Mem0 adapter；本期不存在对 Mem0 的运行时依赖。

# 约束与不变量

- Personal Memory 仍是默认安装但可独立停用或卸载的第一方插件，失败时不得阻断主 workflow。
- 记忆只来自用户证据。Agent 输出、工具结果、仓库日志和任务过程不能作为用户偏好的正向证据。
- 用户级私有数据不写入项目仓库；Local Provider 继续使用用户可读 Markdown 与用户级 Runtime。
- User Profile 是独立产品层和独立检索结果，但不是重复存储层；同一条规范化记录只维护一个权威状态。
- Provider 是完整、互斥的后端。Comet 负责证据过滤、接口与协议数据校验、统一上下文渲染和 Dashboard；Provider 负责持久化、候选/晋升/冲突状态、检索和管理动作。
- Remote Provider 凭据只通过用户指定的环境变量读取，配置和 Dashboard 只保存环境变量名。
- Local Provider 的现有 Git remote、历史、项目身份与可读文件路径保持兼容。
- 自动生成的可读内容遵循 active workflow 配置语言；机器 schema 和枚举保持稳定英文。

# 决策

- **独立 User Profile**：由 active global `user-fact`、`user-preference` 和稳定的 global `collaboration-habit` 投影而成，承担类似 Hermes `USER.md` 的作用；Local Provider 继续使用 `profile.md` 作为可读投影。
- **任务匹配记忆**：project 作用域记录、`project-convention` 和带 selectors 的相关 global 记录按当前任务检索，承担类似 Hermes `MEMORY.md` 的作用；不会把完整会话作为第三个存储层。
- **四类记忆**：`user-fact` 表示姓名、角色、时区、技术背景等稳定用户事实，`user-preference` 表示个人偏好，`collaboration-habit` 表示跨任务稳定的协作方式，`project-convention` 表示只对某个项目有用的个人工作约定。
- **字符容量而非条目上限**：User Profile 默认 2,000 个 Unicode 字符，任务匹配上下文默认 6,000 个 Unicode 字符，均可在用户级配置中调整。容量按字符而非字节计算，避免中文被三字节编码不公平压缩。
- **Profile 快照**：每个 workflow 任务开始时加载一次完整、紧凑的 User Profile 快照，任务内保持稳定；新写入在当前对话中仍由原始用户消息生效，并在下一任务的快照中出现。
- **容量整理**：Profile 接近容量时优先合并等价或可归并的条目；不能容纳新内容时不静默截断或删除，显式操作返回可处理的容量提示，自动 inferred 内容保留在待确认区。
- **显式含义**：用户直接表达长期偏好即为 explicit，不要求必须使用“记住”关键词；明确的一次性措辞仍不保存。
- **双通道渲染**：User Profile 和任务匹配记忆分别预算、分别排序、最终去重；当前请求和项目规则始终优先。
- **Provider 抽象层**：领域层只依赖统一的 `status/query/apply` Provider 接口。`query` 支持 `profile`、`task` 和 `manage` 视图，`apply` 支持观察、记住、纠正、遗忘和回滚；不引入多套专用接口。
- **Remote Provider 协议**：所有操作通过一个版本化 HTTPS envelope 发送到用户 endpoint，返回规范化记录；未来 Mem0 adapter 在 Provider 实现内部映射，不污染 Comet 领域模型。
- **用户级 Provider**：Provider 选择属于用户，而不是项目；项目只能选择本项目是否参与学习和检索。
- **迁移策略**：升级现有 Local 数据而非重建；旧的明显 Agent 工作记录转为 inactive 并保留可追溯历史，不自动删除。

# 待解决问题

- [blocking] CONFIRM: 是否确认以上共享理解作为本期完整范围，并据此进入 Build？如果还要调整 User Profile、项目记忆、Provider 或 Dashboard 的边界，请在确认前提出。

# 验证预期

- 领域单元测试覆盖分类、用户证据过滤、显式生效、隐式晋升、冲突、遗忘、双通道检索预算与去重。
- Provider 接口一致性测试对 Local 与 Remote 实现运行同一组行为用例，并验证无双写、无回退和失败隔离。
- 迁移测试使用现有 profile、项目记忆、候选、历史和错误 `workflow-operation` 样本，确认数据保留与错误内容隔离。
- CLI、各 workflow 和 Dashboard 集成测试验证统一状态与配置优先级。
- Eval 验证 recall、precision 和噪声保存目标；普通回归测试不写入用户可见 Changelog。
- Dashboard 完成浏览器验收，包括 Provider 配置、连接测试、用户画像/项目记忆管理、错误态、响应速度和明显卡顿检查。
- 涉及跨模块、Runtime、Dashboard 与发布资产，Build 完成后运行相关测试、构建和一次全量测试，再进入 Verify。
