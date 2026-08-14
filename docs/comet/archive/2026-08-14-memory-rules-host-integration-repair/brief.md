# Outcome

让个人记忆和项目规则真正进入 Comet 的日常使用路径。用户只使用 Comet Skill 或已有的 Native、Classic、Hotfix、Tweak 工作流时，Comet 自动选择相关记忆和项目规则、记录完成结果，并在需要时运行仓库已有的检查；用户不需要打开 Dashboard，也不需要为了这两个能力手动运行 CLI。

# Scope

- 把两个第一方插件的公开 bridge 接到 Comet Entry、Native、Classic 和 Skill fallback；普通任务、带 active change 的任务以及任务完成/验证节点都使用同一套插件状态和上下文选择。
- 个人记忆使用专用 Git memory repository，默认以稳定仓库 identity 区分项目；工作流完成后自动 checkpoint/sync，用户可以从 Skill、CLI 或 Dashboard 管理同步、暂停、纠正和恢复。
- 项目规则在任务开始、目标路径明确后和验证前按需选择；规则候选在任务结束合并为一条摘要，用户可以在当前对话中加入、忽略或稍后处理。没有 Hook 或 Dashboard 时，Skill 调用同一 service 完成这些动作。
- 发现仓库已有的 package script、Maven、Gradle、测试、linter、CI 或其他插件验证入口，优先复用其失败结果；规则无法确定性执行时写入最相关的 Agent 指令或普通 Markdown 规则，不复制内部 Runtime 字段。
- 修复 Native、Classic、Hotfix、Tweak 和普通 Skill 任务的集成测试，证明两个插件可以独立停用/卸载，健康的工作流和另一个插件继续工作。

# Non-goals

- 不改变 Native、Classic、Hotfix 或 Tweak 的状态机、Guard、change 目录布局或归档语义。
- 不新增账户服务、云端记忆服务、自动安装第三方依赖或自定义 linter 运行时；仓库现有命令和配置仍由项目自己维护。
- 不要求用户学习插件内部 schema，不把完整对话、工具轨迹、原始 diff 或命令输出写入长期记忆。
- 不把 Dashboard 作为唯一入口，也不为 Dashboard 保存一份独立的记忆或规则副本。

# Acceptance examples

- 用户只在 Comet Skill 中完成一个普通任务时，任务开始能得到个人画像和当前项目相关的规则片段；任务结束自动记录成功结果，且不会要求用户打开 Dashboard 或手动执行 CLI。
- Native、Classic、Hotfix、Tweak 的成功完成、验证和归档都产生有来源的生命周期事件；个人记忆和项目规则分别消费事件，不把个人偏好写成团队规则。
- 用户关闭个人记忆学习/检索或暂停某个项目后，项目规则和基础 workflow 仍工作；停用项目规则后，个人记忆和基础 workflow 仍工作；卸载只移除入口，不删除已有数据或仓库规则。
- 个人记忆存储在专用 Git repository；完成节点自动提交并按配置同步，另一会话、设备、同仓库 worktree 或重新克隆可以通过稳定 project identity 读取相同内容。
- 项目规则上下文按任务、目标路径和验证阶段路由，固定保守上限；没有 Hook 时由 Skill 使用同一 selector，不复制整份规则到宿主配置。
- 两次独立成功任务形成同一规则候选后，Skill 在任务结束只显示一条可读摘要；用户可以一次加入、忽略或稍后，不创建规则专用 Comet change。
- 用户明确添加规则时，若已有可用 linter、测试、编译器、构建插件或 CI 且存在匹配适配器，Comet 生成/定位对应原生配置或测试改动；没有匹配适配器时生成可读提案，不猜测未知 DSL；无法确定性检查的要求写入最相关的 Agent 指令或普通 Markdown 规则。
- Agent 修改代码后，项目规则服务能够运行实际可用的仓库验证入口；只有命令失败才返回修复诊断，warning 且命令成功不被误报为阻塞；宿主或 Skill 提供修复回调时才进入“Agent 修复 -> 重新验证”循环，没有回调时不重复执行命令冒充自动修复。
- Dashboard、Skill 和 CLI 调用同一插件 runtime、service、状态和存储；Dashboard 失效时 Skill/CLI 仍可完成上下文、候选、规则和记忆操作。
- 缺少或失败的一个插件只产生带插件标识的诊断，健康插件和基础 workflow 继续运行；相关集成测试覆盖跨项目、跨插件和旧请求不回写。

# Constraints and invariants

- 本 child 只修复父级 Verify 指出的宿主集成缺口；不重新打开已经归档的 child。
- 任何插件失败都不能让 Comet workflow 失败；插件只能使用公开 bridge，不能写入另一个插件的私有存储或改变 workflow 内部状态。
- 用户文件保持可读 Markdown；机器状态集中在 `.comet/runtime` 或专用记忆仓库，普通项目 Git diff 不出现个人记忆提交。
- 所有新行为必须有最小相关测试；涉及 Entry、Skill、Runtime、Dashboard 和生成 bundle 的修改按仓库约定同步检查。

# Decisions

- repair child 名称为 `memory-rules-host-integration-repair`，依赖已归档的 `memory-rules-dashboard`，最终合入父级 `beta20`。
- 采用“公开插件 bridge + Skill fallback + 可选 Hook”三条入口共用领域 service；Hook 只在平台支持时提供动态投递或检查，不改变普通未启用 Comet 项目。
- 自动同步在完成/归档 checkpoint 触发；远端认证、冲突和不可用时保留本地文件并把状态作为可读诊断返回，不阻塞基础 workflow。
- 用户已确认项目规则载体采用可插拔适配器：发现 Maven、Gradle、linter、测试、构建插件或 CI 入口时，适配器可以生成或修改对应原生配置/测试；没有适配器时只生成可读、可选择的规则提案，不猜测项目 DSL，也不直接改写未知配置。
- 用户已确认验证修复采用宿主回调：Comet 默认运行实际验证并返回失败诊断，宿主或 Skill 提供 Agent 修复回调后再重新验证；`maxAttempts` 不能用重复执行命令冒充修复闭环。

# Open questions

无。产品范围沿用父级已确认决定；实现细节由测试和现有仓库能力确定。

# Verification expectations

- 运行修复 child 的 Entry、插件 bridge、memory、project-rules、Skill fallback、Hook 和 Dashboard 集成测试。
- 运行 `pnpm exec tsc --noEmit`、`pnpm run lint:architecture`、受影响文件 Prettier 检查；涉及生成 runtime 时运行对应 build 和 generated check。
- 独立 Verifier 只读复核完整 child brief、父级失败验收项和最终 `beta20` 集成结果。
