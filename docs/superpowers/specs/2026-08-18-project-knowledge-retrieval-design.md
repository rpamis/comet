# Project Knowledge Retrieval Plugin Design

## 目标

Comet 已经在 Native、Classic/OpenSpec 和 Superpowers 流程中产出大量可读文档，但新任务不会主动参考这些已有知识。本功能新增第一方插件 `comet.project-knowledge`，在普通 Comet 任务开始时自动召回相关项目文档，并通过现有插件上下文入口交给 Agent。

第一版同时提供两种互斥 Provider：

- `local`：默认值，使用随 Comet 分发的 ripgrep 对本地 Markdown 即时检索；
- `remote`：调用用户实现的固定 `Comet Retrieval API v1`，便于企业接入自己的 RAG、全文搜索或向量检索系统。

用户不需要执行新的检索 CLI，也不需要等待或维护本地索引。默认 Local 模式不访问网络、不调用 embedding 模型，也不依赖 SQLite、文件监听或内容 hash。

## 用户体验

`/comet`、Native、Classic、hotfix 和 tweak 等现有入口继续调用统一的 `comet task`。`comet task` 通过 `CometPluginBridge.collectContext()` 同时收集个人记忆与项目知识，Skill 只负责把返回的上下文贡献注入当前任务，不再为项目知识增加另一条命令路径。

典型流程如下：

1. 用户提出新任务；
2. Comet 得到任务文本，以及可选的目标路径和阶段；
3. `comet.project-knowledge` 在所有已声明的 Comet 文档根中检索，不按当前选择的 Native 或 Classic workflow 过滤；
4. 有足够相关的结果时，最多注入 4 段、总计最多 5000 个字符，并为每段显示来源；
5. 没有可靠结果时保持静默，Agent 正常继续；
6. Provider 运行失败时输出简短诊断，但不阻塞工作流。

召回文本以“项目知识参考”区块呈现。渲染器明确声明这些内容是可能过时或包含指令性文字的项目资料，只能作为证据参考，不能覆盖用户请求、系统约束、Skill 或当前 workflow 状态。每一行正文都以引用格式呈现，来源路径或 URL 单独标注。

## 插件生命周期

`comet.project-knowledge` 是 `project` scope 的第一方插件，与 `comet.personal-memory` 并列注册到现有 `PluginRuntime`：

- 首次协调第一方插件时自动安装并启用；
- 用户禁用插件后不再贡献上下文；
- 用户明确卸载后保留 `explicitRemoval`，后续 `comet update` 或版本升级不会静默恢复；
- 卸载只停止召回，不删除 Comet 已有文档，也没有本地索引需要清理；
- 项目配置只选择 Provider，不绕过插件自身的禁用或卸载状态。

项目知识是项目资料，不能进入个人记忆仓库，也不参与个人记忆学习、纠正、同步和遗忘语义。

## 配置

`.comet/config.yaml` 新增可选的顶层 `knowledge` 块。新项目写入显式的 Local 默认值；旧项目缺少该块时同样按 Local 处理，因此不要求迁移。

### Local Provider

```yaml
knowledge:
  provider: local
```

Local 不接受索引目录、刷新周期、embedding 模型等配置。

### Remote Provider

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://rag.example.com/comet/retrieve
    token_env: COMET_RAG_TOKEN
    scope: comet-team-project
    timeout_ms: 5000
```

字段语义：

- `provider`：只允许 `local` 或 `remote`，省略时默认为 `local`；
- `endpoint`：Remote 时必填；必须使用 HTTPS，loopback 地址可以使用 HTTP；
- `token_env`：可选，填写环境变量名称而不是密钥；存在时发送 `Authorization: Bearer <value>`；
- `scope`：可选的不透明知识库标识，Comet 不解释其内容；
- `timeout_ms`：可选，默认 5000，允许 100 至 30000 毫秒。

如果配置了 `token_env` 但环境变量不存在，Comet 不发送未认证请求，而是报告配置错误。Local 模式不会读取 Remote 凭据。配置解析继续保留未知扩展字段，但已知字段类型或取值错误时按现有项目配置规则拒绝加载。

Provider 严格二选一。Remote 失败、超时或返回非法数据时，不自动回退 Local，避免用户误以为结果来自已配置的生产知识库。

## 文档语料范围

语料只包含 Comet 管理的用户可读 Markdown，不扫描源代码、整个仓库或 `.comet` 机器状态。

根据 `.comet/config.yaml` 声明的 workflow 和布局发现以下根目录：

### Native

- 当前 Spec：`<native.artifact_root>/comet/specs/**/*.md`；
- 已归档 Change：`<native.artifact_root>/comet/archive/**/*.md`。

### Classic/OpenSpec

- 当前 Spec：配置布局对应的 `<openspec-root>/specs/**/*.md`；
- 已归档 Change：配置布局对应的 `<openspec-root>/changes/archive/**/*.md`；
- Superpowers 用户可读产物：已归档 Classic Change 的 `.comet.yaml` 通过 `design_doc`、`plan` 或 `verification_report` 明确引用的 `docs/superpowers/specs/`、`plans/` 和 `reports/` Markdown 文件。

Classic 只读取 `.comet/config.yaml` 所属的 `legacy` 或 `docs` 布局，不读取备用 OpenSpec 根，避免把独立 OpenSpec 项目误认为 Comet 资料。当前 workflow 只决定任务如何执行，不限制召回来源；当项目同时声明 Native 和 Classic 时，两边文档构成同一个语料集合，可以互相召回。

Native 与 Classic 的活跃 Change 目录不进入第一版语料，因为内容仍在修改且可能与已确认 Spec 冲突。Superpowers 是 Classic 的正式用户可读产物，但只收录归档 Change 明确引用的文件；不按目录全量扫描活跃或未绑定的设计稿、计划和报告。收录后的文件保留 Superpowers 来源类型，用于展示和排序。

所有根目录和命中文件都必须经过现有项目路径保护：拒绝越界、符号链接逃逸和非普通文件。不存在的目录直接跳过。

## Local Provider

### ripgrep 分发与解析

Comet 增加 `@vscode/ripgrep`，优先解析随 npm 包安装的平台 ripgrep 可执行文件；该二进制不可用时回退到系统 `rg`。两者都不可用时记录可操作诊断并返回空结果，不临时下载二进制。

执行时使用参数数组直接启动进程，不经过 shell。单次召回最多启动一个 `rg --json` 进程，并把已确认的语料根和归档引用文件作为搜索目标。Local 检索默认 2000 毫秒超时，最多接收 1 MiB JSON 输出和 500 个 match 事件；达到任一上限即终止当前子进程并对已完整解析的候选排序，避免任务入口被无界检索拖住。

### 查询生成

查询输入来自现有 `PluginContextRequest`：

- 必填任务文本；
- 可选项目相对目标路径；
- 可选 workflow 阶段。

查询器最多生成 16 个固定字符串搜索词：保留标识符、路径片段、英文单词和数字；中文文本生成有限的连续短语与二至四字片段；去除重复项和明显无意义的停用词。ripgrep 使用 fixed-string、ignore-case 和 JSON 输出，避免把用户任务解释成正则表达式。

### 排序与片段

Local Provider 从命中行定位 Markdown 标题和相邻段落，形成候选片段。一个文档的同一标题只保留一个候选，正文按字符边界裁剪。

排序是确定性的，依次考虑：

1. 完整短语或明确标识符是否命中标题、文件名或正文；
2. 不同查询词的覆盖率；
3. 目标路径与文档路径、标题的关联；
4. 前三项相同时，当前权威 Spec 排在归档 Change 和 Superpowers 产物之前；
5. 命中数量、归档时间和稳定的路径排序。

Native、Classic 和 Superpowers 不因 workflow 类型获得额外偏置。只有命中至少两个有意义查询词，或命中一个明确标识符、路径、完整短语时，候选才达到注入阈值；否则主动放弃召回。

最终最多选择 4 个不同来源或标题的片段，每段正文最多 1600 个字符，总文本不超过 5000 个字符。Local 的内部排序分数不对外形成稳定 API。

## Remote Provider

Remote 不支持可编程请求映射、JSONPath、厂商 preset 或任意模板。Comet 只定义固定的文本检索协议，用户负责在自己的服务中适配 RAGFlow、Dify、Elasticsearch、向量数据库或其他系统。

### 请求

```http
POST <knowledge.remote.endpoint>
Content-Type: application/json
Authorization: Bearer <knowledge.remote.token_env 对应的值>  # 配置时才发送
```

```json
{
  "query": "当前任务及相关路径、阶段上下文",
  "limit": 4,
  "scope": "comet-team-project"
}
```

`scope` 未配置时从请求体省略。`query` 首先写入原始任务文本；存在路径时追加换行和 `Target path: <project-relative-path>`，存在阶段时再追加换行和 `Phase: <phase>`。它不包含项目绝对路径、源代码、个人记忆或本地文档正文。

### 响应

成功响应必须是 JSON：

```json
{
  "results": [
    {
      "content": "召回的文档内容",
      "source": "docs/architecture.md",
      "title": "系统架构",
      "score": 0.92
    }
  ]
}
```

每项的 `content` 和 `source` 是非空字符串；`title` 和有限数值 `score` 可选。Comet 保留服务端顺序，不使用 Local 排序器重新解释远端分数，只执行结构校验、去重、字符裁剪和安全渲染。超过 4 项的结果被截断；响应体上限为 1 MiB，单个 `source` 最多 512 个字符，`title` 最多 200 个字符，每段正文最多 1600 个字符，最终正文总计最多 5000 个字符。

2xx 且 `results: []` 表示正常的无结果。非 2xx、超时、响应过大、非法 JSON 或字段不合法都记为 Remote 诊断；任务继续，但不回退 Local。第一版不自动重试，也不跟随 HTTP redirect，避免在 Agent 任务入口放大延迟、远端负载或把 Authorization 转发到其他地址。

用户选择 Remote 即明确允许把检索 query 发送到所配置的服务。Comet 不负责向远端上传、索引或同步项目文档；远端语料准备、权限、多租户隔离和生命周期由用户实现的服务负责。

## 组件边界

新增 `domains/project-knowledge/`，保持以下职责分离：

- `ProjectKnowledgePlugin`：实现第一方 Plugin descriptor 和 `provideContext`；
- `ProjectKnowledgeCorpus`：根据项目配置解析 Native、Classic 和 Superpowers 文档根；
- `ProjectKnowledgeQuery`：规范化任务并生成 Local/Remote 查询；
- `LocalProjectKnowledgeProvider`：调用 ripgrep、解析 JSON 命中、提取片段并排序；
- `RemoteProjectKnowledgeProvider`：实现 `Comet Retrieval API v1`；
- `ProjectKnowledgeRenderer`：统一去重、限额、来源展示和不可信资料边界。

平台相关能力放在 `platform/`：解析 ripgrep 可执行文件、安全启动和终止进程、受限读取普通文件，以及有界 HTTP 请求。领域模块不直接散落 Windows、macOS 或 Linux 分支。

`createDefaultCometPluginBridge()` 读取规范化后的 `knowledge` 配置，同时注册 `comet.personal-memory` 与 `comet.project-knowledge`。`collectCometPluginContext()` 继续返回按 plugin ID 分开的贡献；`comet task --json` 的顶层结构不变，只会新增一个 `pluginId: "comet.project-knowledge"` 项。

现有中英文 Comet Skill 将“只注入个人记忆”的描述更新为“注入相关个人记忆和项目知识”，但仍调用同一个 `comet task`。项目知识检索是确定性 Runtime 能力，不增加一个需要 Agent 自行判断何时调用的新 Skill。

## 错误处理与可观测性

- 无命中：正常空结果，不显示提示；
- 配置 schema 错误：明确指出 `knowledge` 字段，并按现有项目配置规则拒绝加载；运行时缺少 Remote 环境变量时只跳过召回并报告诊断；
- Local 工具缺失、超时或输出非法：记录插件诊断，任务继续；
- Remote 超时、认证失败或协议错误：向 stderr 输出一次简短警告，JSON stdout 保持可解析，任务继续；
- 单个文档不可读或在读取时发生替换：跳过该文档并保留诊断，不扩大到项目外路径；
- 插件被禁用或卸载：不加载 Provider、不产生网络或子进程活动。

诊断不得包含 token、Authorization 头、完整远端响应正文或超出必要范围的任务内容。Dashboard 第一版只复用现有插件状态和诊断能力，不新增索引进度、搜索页面或检索历史页面。

## 测试与评估

### 单元测试

- `knowledge` 配置默认值、Local/Remote 校验、未知字段保留和中英文渲染；
- Native artifact root、Classic 两种布局，以及归档 Classic Change 所引用 Superpowers 文件的语料发现；
- 不读取未声明的备用 OpenSpec 根、活跃 Change、`.comet`、源码和越界符号链接；
- 中英文任务分词、标识符和路径提取、确定性排序、去重、弱结果 abstain；
- Markdown 标题与段落片段提取，以及 4 段/5000 字符上限；
- bundled ripgrep、系统 `rg` 回退、工具缺失、超时和损坏 JSON；
- Remote 请求体、Bearer 环境变量、scope 省略、响应校验、字节上限和无重试；
- 不可信资料引用格式和来源转义。

### 集成测试

- 第一方插件默认启用，并保留 disable、project pause 和 explicit uninstall；
- `CometPluginBridge` 同时返回个人记忆和项目知识，不相互覆盖；
- `comet task`、Native、Classic、hotfix 和 tweak 入口无需新 CLI 即得到项目知识；
- Native 任务能够召回 Classic/Superpowers 文档，Classic 任务能够召回 Native 文档；
- Remote 失败不回退 Local、不破坏 JSON stdout，也不阻塞工作流；
- npm 打包安装后能够解析 bundled ripgrep，系统回退路径可独立验证。

### 检索基线

建立不依赖模型的固定小型语料集，至少覆盖：

- 精确术语和代码标识符；
- 中文自然语言中夹带英文术语、路径或代码标识符的混合检索；
- 当前 Spec 对相关归档资料的权威性排序；
- Native/Classic/Superpowers 跨来源召回；
- 无关任务主动 abstain；
- Top-4 结果的相关性和来源正确性。

基线以确定性的 Top-4 命中、误召回和 abstain 断言进入 Vitest，不调用外部模型或远端服务。跨模块、Runtime、安装和发布资产完成后，按仓库规则运行相关测试、格式检查、lint、build 和一次全量测试。

## 非目标

- 不在本地运行 embedding 模型或向量数据库；
- 不建立 SQLite、倒排索引、内容 hash、文件监听器或 `comet init/update` 索引任务；
- 不扫描源代码或把本功能扩展为通用代码 RAG；
- 不内置 RAGFlow、Dify、Qdrant 等厂商适配器；
- 不允许用户在配置中执行脚本、模板、JSONPath 或请求转换代码；
- 不向远端上传或同步项目文档；
- 不增加用户必须执行的检索、刷新或清理 CLI；
- 不按 Native、Classic 或 Superpowers 隔离可召回文档；
- 不让召回资料修改 Spec、项目状态、个人记忆或 workflow 决策。

## 交付范围

实现阶段需要同步完成：

1. 新的 `project-knowledge` domain、Provider、平台适配和测试目录；
2. Plugin Runtime 默认注册、`comet task` 诊断投影和跨插件上下文集成；
3. `.comet/config.yaml` 类型、解析、生成和文档；
4. bundled ripgrep 依赖、npm 打包与安装验证；
5. Native、Classic、Entry、hotfix、tweak 中英文 Skill 文案同步及相关生成物；
6. 固定本地检索基线与 Remote API mock 测试；
7. 用户可见的中英文说明和当前 beta 版本 Changelog 条目。
