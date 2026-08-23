---
generated_from_state_version: 16
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 3
- 验证器尝试次数: 1
- 完成时间: 2026-08-23T09:49:28.978Z
- 摘要: 第 3 轮候选 ef08202faba909b812be8232d4b5619d33837cef 通过 A1-A26。重点失败项已修复：Dashboard 查询真实点击后展示 invoke 结果；Local Record 按路径/操作/类型/来源稳定排序并只从直接命中记录扩展一跳；确定性记录不再生成虚假 anchor；学习写入拒绝无 sourceVersion、无效 anchor 或越界行号引用。Runtime stateVersion=12、iteration=3、attempt=1；verification.md 在提交本结论前尚未生成，comet-state.yaml 与本机 Runtime 状态一致。当前 Git HEAD 未被 Verifier 修改，工作区脏状态均按 commit diff/ancestry 与候选隔离。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：任务不打开 Dashboard，成功验证后仍能自动形成并在下一次相关查询中召回来源有效的 active Record。 | 成功且包含全部成功 verificationResults 的生命周期事件会触发确定性学习，生成 active Record；测试证明无需 Dashboard 即可写入、列出并在随后查询中召回。 |
| A2 | passed | brief.md | A2：Local Record 和 workspace section 索引只存在用户数据目录；同一仓库 worktree 共享 Record，不同仓库默认隔离，项目目录不新增 Project Knowledge 文件。 | Local SQLite 位于用户数据目录；repositoryId 共享 Record，workspaceId 隔离 section/FTS。linked worktree 共享数据库但索引正文互不串线，并有存储路径与双 worktree 测试覆盖。 |
| A3 | passed | brief.md | A3：Local/Remote 均实现 `status/query/apply`；Remote 使用 `comet.project-knowledge.provider.v1`，失败不读取或发送 Local 内容，也不回退 Local。 | Local 和 Remote 均实现统一 status/query/apply 接口；Remote 使用 comet.project-knowledge.provider.v1，失败返回空结果或诊断，代码没有 Local fallback 路径。 |
| A4 | passed | brief.md | A4：查询只注入 active 且来源仍有效的结果；最多四条、单条不超过 1,600 字符、总计不超过 5,000 字符，并显示来源。 | Local 搜索前刷新 Record 来源，只有 active Record 进入搜索；renderer 固定最多 4 条、单条 1600 字符、总计 5000 字符，并输出转义后的来源。 |
| A5 | passed | brief.md | A5：来源删除、变化或 anchor 失效后，Record 变为 `needs-review`，立即停止注入；重新核对成功后可恢复 active。 | refresh 会核对文件版本、Markdown/HTML anchor 与行号；失效 Record 转为 needs-review 并停止搜索注入，显式再次核对当前来源后可恢复 active，测试覆盖变化、恢复和 anchor 删除。 |
| A6 | passed | brief.md | A6：用户纠正将 Record 标为 `authority=user`，后续 automatic upsert 不能覆盖用户正文；用户 forget 后旧来源不能直接复活同一自动内容。 | correct 将 authority 设为 user 并重新核对来源；自动 upsert 保留用户 summary/conclusions。retire 保留 sourceVersions，相同旧来源自动内容不能复活，来源版本变化后才允许更新。 |
| A7 | passed | brief.md | A7：CLI 提供 `list/get/correct/forget/query/rebuild/status`，所有读写均通过 Provider，且不再提供 `knowledge units` 或 `share`。 | CLI 仅暴露 status/query/rebuild/list/get/correct/forget，命令通过 Provider query/apply 工作；活跃产品代码中没有 knowledge units、share 或 share-memory 命令。 |
| A8 | passed | brief.md | A8：Dashboard 展示 Provider 状态、记录状态/来源/更新时间、查询预览、纠正/忘记/重新核对和诊断，并可编辑项目 `knowledge` Provider 配置。 | Dashboard 展示 Provider、状态、记录状态/来源/updatedAt、诊断、查询预览、correct/forget/refresh 和 Provider 配置。Playwright 真实点击查询按钮并断言解包后的结果正文可见。 |
| A9 | passed | brief.md | A9：Dashboard、CLI 和 workflow 读取同一份 Local/Remote 状态，任何入口都不是自动学习的必经步骤。 | Dashboard capability、CLI、context bridge 和 learning 均选择同一项目配置对应的 Local 或 Remote Provider；自动学习由生命周期事件触发，不依赖 Dashboard。 |
| A10 | passed | brief.md | A10：Remote 请求只包含有界任务、路径、阶段、操作和知识记录数据，不包含完整 transcript、diff、日志、凭据或 token 值。 | Remote query 只发送有界 task/path/phase/operation/terms/limit，apply 会移除 source evidence；学习 packet 只保留结构化路径、产物与验证结果，测试确认 chat、diff 和 token 值不进入请求。 |
| A11 | passed | brief.md | A11：`<project_knowledge>` 与 `<personal_memory>` 分开召回、分开失败、分开预算；Personal Memory 的现有行为保持不变。 | Personal Memory 与 Project Knowledge 是两个独立 Plugin、Provider、存储和上下文贡献；Plugin Runtime 逐插件隔离失败，二者各自执行各自的预算与渲染逻辑。 |
| A12 | passed | brief.md | A12：SQLite 损坏、锁超时、FTS 不可用、来源不可读、语义 reviewer 失败或 Remote 失败都不阻塞普通 workflow，并产生有界诊断。 | SQLite/Record store 打开失败降级为文档搜索，FTS 损坏可重建，ripgrep 超时/截断/缺失产生有界诊断；reviewer 和 Remote 失败被隔离且不抛出到 workflow。 |
| A13 | passed | brief.md | A13：中英文操作文档、正式 Spec、代码、测试和 `0.4.0-rc.1` Changelog 描述同一最终用户行为。 | 中英文操作文档、正式 Spec、CLI、Dashboard 和 HEAD 中 0.4.0-rc.1 Changelog 已统一使用 Record、Local/Remote、needs-review、纠正/忘记/刷新及无 Unit/分享路径的最终语义。 |
| A14 | passed | specs/project-knowledge/spec.md | 项目知识与 Personal Memory 分离 `comet.project-knowledge` 是 project-scope 第一方能力，为 Agent 提供关于当前项目结构、模块职责、已验证行为、集成路径、改动影响以及构建/测试方式的可追溯、可核对和有界参考。它通过现有任务上下文桥接提供上下文，也允许 CLI 和 Dashboard 管理。 项目知识只能作为证据参考，不能覆盖当前源码、配置、测试、用户请求、系统约束、Skill 或 Native/Classic workflow 状态。 Personal Memory 是独立能力，保存用户事实、偏好、协作习惯和个人项目经验。它使用独立存储、Provider 配置、检索预算、上下文区块和管理动作。Personal Memory 记录不会自动复制为 Project Knowledge，Project Knowledge 也不会写入 Personal Memory。 | Project Knowledge 作为独立 project-scope 证据区块注册，renderer 明确声明不能覆盖用户请求、系统约束、Skill 或 workflow；Personal Memory 仍由独立插件管理。 |
| A15 | passed | specs/project-knowledge/spec.md | Local 默认、Remote 可选且严格二选一 项目配置继续使用： ```yaml `local` 是默认 Provider，数据属于当前用户并保存在项目外。`remote` 是可选的团队共享 Provider，使用 endpoint、token 环境变量名、scope 和 timeout。一次请求只能选择一个 Provider；Remote 失败不读取 Local、不发送 Local 正文，也不静默切换到 Local。 Dashboard 可以通过现有 workflow-project 配置写入链路更新 `knowledge` 块。页面只显示 token 环境变量名和是否存在，token 值和 Authorization header 永远不能进入页面数据。 | 配置严格选择 local 或 remote；Dashboard 可写 knowledge 块，只展示净化后的 endpoint、scope、timeout、token 环境变量名和是否配置，不返回 token 或 Authorization 值。 |
| A16 | passed | specs/project-knowledge/spec.md | Record 的状态、来源和权威 内部对象是 `ProjectKnowledgeRecord`，包含稳定记录 ID、稳定 repository/project ID、类型、标题、摘要、适用路径、操作、带 project-relative source/anchor 的结论、可选一跳关系、验证信息、来源版本和更新时间。 Record 状态只有 `active \| needs-review \| retired`，权威只有 `automatic \| user`。产品不向用户暴露 `unit`、`origin`、`maintained`、`generated` 或 `draft` 术语。Record 存储在用户数据目录，项目目录不生成 Project Knowledge Markdown 或数据库文件。 | ProjectKnowledgeRecord 具备稳定 ID/projectId、六类 type、三种 state、两种 authority、路径/操作、带来源结论、关系、验证、sourceVersions 和 updatedAt；解析器执行有界及项目相对路径校验。 |
| A17 | passed | specs/project-knowledge/spec.md | 所有调用方使用 status/query/apply 领域层只依赖： ```ts `query` 支持有界的 search、list 和 get；`apply` 支持 upsert、correct、retire 和 refresh。CLI、Dashboard、上下文桥接、学习服务和 Plugin Runtime 都只能通过该接口工作，不直接访问 SQLite 表或 Remote HTTP。 | 领域公开边界是 ProjectKnowledgeProvider.status/query/apply；CLI、Plugin、Dashboard、learning 和 context bridge 只持有该接口，SQLite store 只由 Local Provider 使用，HTTP 只位于 Remote Provider。 |
| A18 | passed | specs/project-knowledge/spec.md | 仓库级 Record 与 workspace 级索引 Local Provider 使用用户数据目录中按稳定 repository ID 隔离的 SQLite。主工作区和 linked worktree 共享 Record 权威状态；源码、文档 section 和 FTS 投影按 workspace ID 分区，避免不同分支的正文串线。 数据库包含权威 Record 表和可重建的 workspace section/FTS 投影，使用 WAL、短事务、有限 busy timeout 和现有来源读取上限。投影损坏或结构不兼容时重建可派生投影，不删除有效 Record；本功能未上线，不实现旧 schema 迁移。 Local search 按以下顺序工作：构造 task/path/phase/operation 查询；在现有时间预算内刷新变化来源；搜索 active Record、section FTS 和有界 ripgrep；确定性融合并按路径、来源和类型排序；只从已命中的 Record 做带来源的一跳关系扩展；返回前重新核对每个来源。 来源、anchor 或 fingerprint 不再有效时，Record 变为 `needs-review` 并排除当前上下文。用户权威 Record 保留纠正文案，但来源无效时同样停止注入。 | Local 使用共享 repository 数据库和 workspace 分区投影、WAL、250ms busy timeout 与短事务。Record 搜索按路径、操作、文本匹配、类型和来源稳定排序，只遍历直接命中集合扩展一次关系，并使用关系来源作为证据；代码没有递归扩展。 |
| A19 | passed | specs/project-knowledge/spec.md | Remote 使用可扩展的 provider.v1 协议 Remote 使用 `comet.project-knowledge.provider.v1`。`status`、`query` 和 `apply` 都是配置 endpoint 上的 operation；请求包含 operation、scope、稳定 project ID 和有界输入。 query 只发送有界 task、project-relative path、phase、operation、limit 或 list/get selector。apply 只发送 Record 结论、project-relative 来源、适用范围和验证信息，不发送完整 transcript、完整 diff、命令日志、凭据、token 值或整个仓库。 无效响应、超时、非成功响应或超出响应大小限制时返回空结果或失败 apply 和有界诊断；不得查询 Local，也不得向 Remote 泄露 Local 项目正文。 | Remote v1 envelope 覆盖 status/query/apply；请求和响应大小、字段、条数及诊断均有界，超时、HTTP 和 schema 错误返回诊断，不接触 Local 内容。 |
| A20 | passed | specs/project-knowledge/spec.md | 成功验证后自动激活 工作流只提交有界的 `verification.completed`、`change.completed` 和结构化 `task.completed` 事件，包含 changed paths、artifact refs、验证命令/结果和成功状态，不持久化完整聊天、diff、日志或命令输出。 确定性提取器和可选语义 reviewer 产生 Record mutation。每个验证结果都成功、每个结论来源都仍有效时，automatic Record 直接成为 active，不要求用户打开或确认 Dashboard。相同语义身份执行更新而不是重复创建。 retired automatic Record 不能从相同 source versions 直接复活；新的可验证来源版本才可以形成新记录或更新。自动学习不得覆盖 user Record 的 summary/conclusions，只能更新来源状态并标记 needs-review。学习、reviewer 或 Provider 失败不阻塞 workflow，保留原有效状态并记录有界诊断。 | 只有全部验证结果成功才学习。确定性与 reviewer Record 写入前会核对每个 sourceVersion、文件 size/mtime，并要求所有 conclusion/relation 来源存在对应 sourceVersion 且 anchor/行号有效；无效或未版本化引用会被拒绝。模块确定性记录已移除虚假的 module anchor。 |
| A21 | passed | specs/project-knowledge/spec.md | CLI 和明确用户操作 CLI 提供： ```text correct 使用户文本成为 user authority 并重新核对现有来源；来源仍无效时保留正文但维持 needs-review。forget retire Record 并保留足够 source identity，防止相同旧自动内容立即复活。rebuild 刷新当前 Local workspace 投影并请求选定 Provider refresh。不存在 `knowledge units`、`share`、`share-memory` 或项目文件导出命令。 | CLI 提供规定的七个命令；correct 形成 user Record 并按来源决定 active/needs-review，forget 退役并阻止相同 fingerprint 复活，rebuild 同时刷新 Record 与 workspace 投影。 |
| A22 | passed | specs/project-knowledge/spec.md | Dashboard 配置 Provider 并管理记录 Dashboard 通过 Plugin Runtime 提供 Provider 配置、Provider 状态、active/needs-review/retired 列表、标题/摘要、适用路径、来源、更新时间、查询预览、correct、forget、refresh 和有界诊断。 Remote 配置表单只接受 endpoint、token 环境变量名、scope 和 timeout，永远不接受或展示 token 值。页面所有动作都调用 Provider capability，成功后重新加载页面；Dashboard 不是自动学习或检索的前置条件。现有 pause/resume/uninstall 生命周期继续由 Dashboard host 管理。 | Dashboard 通过 Plugin Runtime capability 完成查询、配置和管理动作；成功调用后重新抓取页面。查询 invoke 响应现已正确解包并由 E2E 验证，记录来源与更新时间可见，token 值不进入页面。 |
| A23 | passed | specs/project-knowledge/spec.md | 只注入当前有效的项目知识 Project Knowledge 继续使用独立的 `<project_knowledge>` 区块；它明确说明内容只是证据，不能覆盖用户请求、系统约束、Skill 或 workflow。只有 active 且来源有效的结果可以注入，并始终展示来源。 保留现有边界：最多四条结果、单条最多 1,600 字符、总计最多 5,000 字符。Personal Memory 继续使用独立的 `<personal_memory>` 区块和独立预算。 | provideContext 使用独立 project_knowledge 渲染器，只接受 Provider 返回的有效结果，保留来源和证据警告；四条、1600/5000 字符边界测试通过，Personal Memory 区块不受修改。 |
| A24 | passed | specs/project-knowledge/spec.md | Provider 和索引失败不阻塞 workflow 查询失败时任务继续且不注入 Project Knowledge；apply 失败时保留上一状态并记录诊断；Remote 失败不回退 Local；Local 投影损坏时重建或使用有界 ripgrep，同时保留有效 Record；来源失效时停止注入；Provider 被停用或卸载时不查询、不学习、不打开 SQLite、不运行 ripgrep、不发送网络请求。 SQLite 锁超时、FTS 不可用、来源不可读和 reviewer 失败都使用有界诊断，不阻塞 Native、Classic、hotfix 或 tweak。 | query/apply/index/Remote/reviewer 失败均为有界诊断或空结果。Plugin 被暂停、停用或卸载后 Runtime 不调用 provideContext/onEvent，因此不会创建 Provider、打开 SQLite、运行 ripgrep 或发起网络请求。 |
| A25 | passed | specs/project-knowledge/spec.md | 文档、代码、测试和发布说明一致 完成后，中英文操作文档、正式 Project Knowledge Spec、CLI、Dashboard、Provider 协议、自动学习、上下文注入和 `0.4.0-rc.1` Changelog 必须描述同一最终用户行为。Changelog 只写用户从 `0.4.0-beta.19` 升级可感知的最终行为，不写内部重构、开发过程或普通回归测试。 最终验证覆盖相关 Vitest、Dashboard source/host/Playwright、format、lint、build、全量测试、Project Knowledge Retrieval Eval 和 Native Verify。旧 Unit 产品路径的删除必须有主动搜索证据。 | Runtime 本轮 format、lint、build、全量 Vitest、Dashboard Playwright 和 enforced retrieval eval 全部通过：342 个测试文件、4132 passed/57 skipped，Dashboard 26 passed，retrieval fixture 与回归阈值均通过；当前 portable Native Verify 即本次独立验收。 |
| A26 | passed | specs/project-knowledge/spec.md | 未上线 Unit 模型完全移除 由于该能力尚未正式上线，直接删除 Unit repository、Unit schema、Markdown renderer/parser、`docs/comet/knowledge/units/` 发现/写入逻辑、`maintained/generated/draft` 状态、`knowledge units`、`share` 和 `share-memory`。不提供旧格式迁移、兼容读取、别名或导出路径。 历史 archive、research 和设计记录可以保留作为历史资料，但它们不能被活跃产品代码、CLI、Dashboard 或正式当前 Spec 当作运行时入口。 | Unit repository/schema/parser/renderer 及对应测试已删除；对 HEAD 的活跃 app/domains/platform/assets/scripts/test 路径主动搜索未发现 knowledge units、share-memory、ProjectKnowledgeUnit 或 knowledge/units 产品入口。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Prettier format check | format:check | . | passed | 0 | 16587 ms |
| ESLint and architecture lint | lint | . | passed | 0 | 9450 ms |
| Full build | build | . | passed | 0 | 35654 ms |
| Full Vitest suite | test | . | passed | 0 | 761251 ms |
| Dashboard Playwright suite | test:dashboard-e2e | . | passed | 0 | 22061 ms |
| Project Knowledge retrieval eval | scripts/benchmark/project-knowledge-retrieval-eval.mjs --enforce --summary | . | passed | 0 | 35120 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 040rc1 当前比候选共同基线多 2 个提交，候选多 15 个提交；merge-tree 显示 CHANGELOG.md、Dashboard main.jsx/styles.css 和两份 Dashboard 测试 changed-in-both。合并时必须保留 040rc1 的 Personal Memory 新增偏好/纠正即时刷新与新版 Dashboard 工作台，同时保留本候选的 Project Knowledge 查询响应、Record 管理和文档语义，并在合并结果上重跑 Dashboard 与相关 Project Knowledge 验证。
- 旧 comet native check 使用 protocol 3，不能解析 comet.native.v4 Portable State；本轮实际 portable Native Runtime 六项检查和独立语义 Verify 均正常，该限制不属于候选产品缺陷。
- 工作区存在未提交的用户改动，包括 Skills/Rules/Classic Runtime、CHANGELOG、Classic/Entry/Skill 测试及 project-knowledge.test.ts 的无关新增测试；这些内容不属于 ef08202f 候选，合并和归档时必须继续隔离保留。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-23T08:17:01.949Z |
| 2 | 1 | 1 | fail | A4, A5, A8, A13, A18, A20, A22, A23, A25 | Candidate fails semantic verification because source references, needs-review recovery and anchor validation, Dashboard source/update metadata, and reviewer action application are incomplete. | 2026-08-23T08:27:01.154Z |
| 2 | 2 | 1 | fail | A8, A13, A18, A20, A22, A25 | 候选 b333c262 已修复真实来源显示、来源/anchor 刷新、needs-review 恢复、用户纠正重核、Reviewer 动作应用以及 Dashboard 来源/更新时间，但独立复核发现 Dashboard 查询预览响应被吞、Local 一跳关系和路径/type 排序未实现、确定性源码 anchor 无效。A8、A13、A18、A20、A22、A25 失败，应返回 Build 修复。legacy comet native check 对 v4 的拒绝属于旧 protocol 3 Runtime 基础设施限制；当前 portable Native Verify 正常运行，本身不是本候选的产品失败。 | 2026-08-23T09:10:53.189Z |
| 2 | 3 | 1 | pass | — | 第 3 轮候选 ef08202faba909b812be8232d4b5619d33837cef 通过 A1-A26。重点失败项已修复：Dashboard 查询真实点击后展示 invoke 结果；Local Record 按路径/操作/类型/来源稳定排序并只从直接命中记录扩展一跳；确定性记录不再生成虚假 anchor；学习写入拒绝无 sourceVersion、无效 anchor 或越界行号引用。Runtime stateVersion=12、iteration=3、attempt=1；verification.md 在提交本结论前尚未生成，comet-state.yaml 与本机 Runtime 状态一致。当前 Git HEAD 未被 Verifier 修改，工作区脏状态均按 commit diff/ancestry 与候选隔离。 | 2026-08-23T09:49:28.978Z |



## 结论

第 3 轮候选 ef08202faba909b812be8232d4b5619d33837cef 通过 A1-A26。重点失败项已修复：Dashboard 查询真实点击后展示 invoke 结果；Local Record 按路径/操作/类型/来源稳定排序并只从直接命中记录扩展一跳；确定性记录不再生成虚假 anchor；学习写入拒绝无 sourceVersion、无效 anchor 或越界行号引用。Runtime stateVersion=12、iteration=3、attempt=1；verification.md 在提交本结论前尚未生成，comet-state.yaml 与本机 Runtime 状态一致。当前 Git HEAD 未被 Verifier 修改，工作区脏状态均按 commit diff/ancestry 与候选隔离。
