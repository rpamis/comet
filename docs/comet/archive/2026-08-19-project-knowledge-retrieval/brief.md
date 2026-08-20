# Outcome

在 Comet 的统一 `comet task` 上增加第一方 `comet.project-knowledge` 插件：从 Comet 管理的 Native、Classic/OpenSpec 和已明确引用的 Superpowers 用户文档中，确定性召回与当前任务相关的项目知识，并把有界、带来源且明确标注为不可信参考的内容注入 Agent 上下文。Local 是默认 Provider，Remote 是用户实现的固定 Retrieval API v1 适配；两者严格互斥。

# Scope

- 新增 `domains/project-knowledge/`，拆分插件描述、语料发现、查询规范化、Local/Remote Provider 和统一渲染。
- 增加 `knowledge.provider` 配置，支持 `local`（默认）和 `remote`，包括 HTTPS/loopback、token 环境变量、scope 与 100–30000ms 超时校验。
- Local 使用随包分发的 `@vscode/ripgrep`，不可用时回退系统 `rg`；使用固定字符串、JSON 输出、单进程、有界输出和 2000ms 超时。
- 语料只读取配置声明的 Native/Classic 规格、归档 Change，以及归档 Classic Change 明确引用的 Superpowers 文档；排除活跃 Change、源码、`.comet` 和备用 OpenSpec 根。
- Remote 使用固定 POST JSON 协议，严格校验响应、大小、字段、来源和结果数量，不重试、不跟随重定向、失败不回退 Local。
- 接入 `PluginRuntime`、`CometPluginBridge`、`comet task`、Native/Classic/Hotfix/Tweak 入口，以及中英文 Comet Skill 文案和生成资产。
- 增加配置、语料边界、查询/排序、Provider、渲染、插件生命周期、跨 workflow、打包安装和固定检索基线测试，并更新用户可见双语文档与当前 beta Changelog。

# Non-goals

- 不运行 embedding、向量数据库、SQLite、索引刷新、文件监听或内容 hash。
- 不扫描源码、完整仓库、活跃 Change 或 `.comet` 机器状态。
- 不内置 RAGFlow、Dify、Qdrant 等厂商适配，不支持脚本、模板、JSONPath 或请求转换代码。
- 不上传或同步项目文档，不增加用户必须执行的检索/刷新/清理 CLI。
- 不让召回资料修改 Spec、项目状态、个人记忆或 workflow 决策。

# Acceptance examples

- A1：缺少 `knowledge` 时按 Local 处理；`provider` 仅允许 `local|remote`，已知字段类型/取值错误拒绝配置，未知扩展字段保留。
- A2：Remote 必须有 HTTPS endpoint（loopback 可 HTTP），可选 token_env/scope/timeout_ms 且超时范围为 100–30000ms；Local 不读取 Remote 凭据。
- A3：语料发现只包含配置声明的 Native 当前/归档 Spec、Classic 配置布局的当前/归档 Spec，以及归档 Classic Change 通过 `design_doc`/`plan`/`verification_report` 明确引用的 Superpowers Markdown。
- A4：备用 OpenSpec 根、活跃 Change、源码、`.comet`、越界路径、符号链接逃逸和非普通文件均不被读取；不存在目录安全跳过。
- A5：查询从任务、可选相对目标路径和阶段生成最多 16 个固定字符串词，保留标识符/路径/数字并处理中文短语，不把用户文本解释为正则。
- A6：Local 优先 bundled rg，缺失时回退系统 rg；两者都不可用、超时或 JSON 损坏时返回空结果和非阻塞诊断。
- A7：Local 单次最多一个 rg 进程、2000ms、1MiB JSON 输出、500 个 match；达到上限停止并仅处理完整候选。
- A8：Local 片段按标题/段落提取并确定性排序；至少两个有意义词或一个明确标识符/完整短语才注入，否则 abstain。
- A9：最终最多 4 个不同来源/标题、每段最多 1600 字符、总计最多 5000 字符；来源、标题和不可信资料边界稳定渲染并安全转义。
- A10：Remote 请求包含 query、limit=4 和可选 scope；query 只含任务及相对路径/阶段，不含绝对路径、源码、个人记忆或本地正文。
- A11：Remote 只接受合法 JSON `results`，校验 content/source/title/score、1MiB 响应、512 字符 source、200 字符 title、1600 字符片段和 5000 字符总量；服务端顺序保留，不重新解释 score。
- A12：Remote 非 2xx、超时、重定向、认证/协议错误、超限或非法 JSON 只产生一次简短诊断，stdout 仍可解析、任务继续且不回退 Local。
- A13：第一方插件默认注册，与 `comet.personal-memory` 并列；disable、project pause、explicit uninstall 后不产生 Provider、网络或子进程活动，升级不静默恢复 explicitRemoval。
- A14：`CometPluginBridge.collectContext()` 同时返回个人记忆和项目知识，`comet task --json` 顶层结构不变，仅增加独立 `pluginId: comet.project-knowledge` 贡献。
- A15：Native 任务可召回 Classic/Superpowers 文档，Classic 任务可召回 Native 文档；Native、Classic、hotfix、tweak 不新增调用路径。
- A16：Local/Remote、Provider 失败、无结果、插件禁用和单文档读取失败均不阻塞主 workflow，不泄露 token、Authorization、完整响应或无界任务内容。
- A17：npm 打包安装后能解析 bundled rg，系统 rg fallback 可独立验证；平台差异由 `platform/` 适配，不散落在 domain。
- A18：测试覆盖配置默认/校验、语料边界、查询分词、排序/去重/abstain、rg 限制、Remote 协议、渲染安全、生命周期、跨 workflow、打包安装和固定 Top-4 基线。
- A19：中英文 Skill 只把“个人记忆”更新为“相关个人记忆和项目知识”，中文先完成并与英文同步，输入/边界/失败语义一致；不修改 Superpowers/OpenSpec 原始 Skill。
- A20：完成相关最小测试、Prettier、lint、build、生成资产检查、全量测试和固定检索基线；用户可见双语文档与当前 beta Changelog 语义一致。

# Constraints and invariants

- 正式产物使用 `zh-CN`；代码、路径、schema、Provider 和 plugin ID 保持英文稳定。
- 召回资料始终只是可能过时的证据参考，低于用户请求、系统约束、Skill 和当前 workflow 状态。
- Provider 严格二选一；Remote 失败不回退 Local，Local 无结果不请求 Remote。
- 所有文件根、来源和 HTTP 响应均受大小、路径、普通文件、超时和输出边界保护。
- 领域模块不直接分支 Windows/macOS/Linux；runtime 源码修改后必须重建对应 bundle。
- 不改变 Native/Classic 状态机、Guard、Archive 或个人记忆语义；项目知识不进入 Personal Memory。

# Decisions

- 采用现有 `docs/superpowers/specs/2026-08-18-project-knowledge-retrieval-design.md` 作为用户目标来源，并转为本 Change 的完整 Native Spec。
- 按用户指示不再新增澄清问题；Provider、限额、语料边界、生命周期和非目标以该 Spec 的明确语义为准。
- 使用独立 worktree `comet/project-knowledge-retrieval`，目标分支为 `beta20`，避免旧 detached 验证 worktree 干扰。
- 采用单一统一 `comet task` 入口和独立插件贡献，不新增用户显式检索命令。

# Open questions

无。用户已确认继续执行完整实现、验证和归档。

# Verification expectations

- 先完成配置、语料边界、Provider 协议和渲染的确定性回归测试，再实现插件桥接与入口接线。
- 运行相关 domain/platform/app 测试、生成 runtime 检查、Prettier、lint、build、全量测试和固定本地 Top-4 检索基线。
- 远端测试使用本地 mock，不访问真实生产 RAG 服务；打包安装测试验证 bundled rg 与系统 fallback。
- 完整规格的每项验收均由 Runtime/独立只读 Verifier 逐项判定后才能 Archive。
