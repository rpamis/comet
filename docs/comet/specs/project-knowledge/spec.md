# Project Knowledge Retrieval Plugin

## 目标与入口

Comet 新增第一方 `comet.project-knowledge` 插件，在统一的 `comet task` 上召回与任务相关的项目文档，并通过 `CometPluginBridge.collectContext()` 作为独立 plugin contribution 提供给 Agent。`/comet`、Native、Classic、hotfix 和 tweak 继续调用同一入口，不新增用户必须执行的检索 CLI。

插件提供两个互斥 Provider：`local`（默认）使用随 Comet 分发的 ripgrep 对本地 Markdown 即时检索；`remote` 调用用户实现的固定 `Comet Retrieval API v1`。Local 不访问网络、embedding 或索引；Remote 只在用户明确选择时发送 query。

召回内容必须以“项目知识参考”区块呈现，并标注其可能过时、包含指令性文字且只能作为证据参考，不能覆盖用户请求、系统约束、Skill 或当前 workflow 状态。每段正文使用引用格式，来源路径或 URL 独立展示。

## 插件生命周期

`comet.project-knowledge` 是 `project` scope 的第一方插件，与 `comet.personal-memory` 并列注册。

- 首次协调第一方插件时自动安装并启用。
- 用户禁用或暂停后不再贡献上下文；显式卸载保留 `explicitRemoval`，后续 update/升级不静默恢复。
- 卸载只停止召回，不删除 Comet 已有文档，也没有本地索引需要清理。
- 配置只选择 Provider，不能绕过插件启停状态。
- 项目知识不进入个人记忆仓库，也不参与个人记忆学习、纠正、同步和遗忘。

## 配置契约

`.comet/config.yaml` 顶层可选 `knowledge` 块。新项目可以显式生成 Local 默认值；旧项目缺少该块时等价于 Local，不需要迁移。

```yaml
knowledge:
  provider: local
```

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://rag.example.com/comet/retrieve
    token_env: COMET_RAG_TOKEN
    scope: comet-team-project
    timeout_ms: 5000
```

字段规则：

- `provider` 只允许 `local` 或 `remote`，省略时为 `local`。
- Remote 的 `endpoint` 必填，必须 HTTPS；loopback 地址允许 HTTP。
- `token_env` 是环境变量名，不是密钥；存在且变量缺失时不发送未认证请求。
- `scope` 是不透明知识库标识，Comet 不解释其内容。
- `timeout_ms` 默认 5000，允许 100–30000 毫秒。
- 已知字段类型/取值错误按现有项目配置规则拒绝；未知扩展字段继续保留。
- Local 不读取 Remote 凭据；Provider 严格二选一。

## 文档语料范围

语料只包含 Comet 管理的用户可读 Markdown，不扫描源码、整个仓库或 `.comet` 机器状态。

根据 `.comet/config.yaml` 声明的 workflow 和布局发现：

### Native

- 当前 Spec：`<native.artifact_root>/comet/specs/**/*.md`；
- 已归档 Change：`<native.artifact_root>/comet/archive/**/*.md`。

### Classic/OpenSpec

- 配置布局对应的 `<openspec-root>/specs/**/*.md`；
- 配置布局对应的 `<openspec-root>/changes/archive/**/*.md`；
- 已归档 Classic Change 的 `.comet.yaml` 通过 `design_doc`、`plan` 或 `verification_report` 明确引用的 `docs/superpowers/specs/`、`plans/` 和 `reports/` Markdown。

Classic 只读取 `.comet/config.yaml` 所属的 `legacy` 或 `docs` 布局，不读取备用 OpenSpec 根。当前 workflow 不限制召回来源；同时声明 Native 和 Classic 时，两边构成同一语料集合。活跃 Change 不进入第一版语料，Superpowers 也不按目录全量扫描。所有根目录与命中文件必须通过路径保护，拒绝越界、符号链接逃逸和非普通文件；不存在目录安全跳过。

## Local Provider

### ripgrep 执行

优先解析 npm 包中的 `@vscode/ripgrep` 平台可执行文件；不可用时回退系统 `rg`，两者都不可用时记录可操作诊断并返回空结果，不临时下载。使用参数数组直接启动，不经过 shell。一次召回最多一个 `rg --json` 进程，默认 2000ms 超时，最多接收 1MiB JSON 输出和 500 个 match 事件；达到上限即终止并只排序完整候选。

### 查询与排序

查询来自 `PluginContextRequest` 的任务文本、可选相对目标路径和可选阶段。最多生成 16 个固定字符串词：保留标识符、路径片段、英文词和数字；中文使用有限连续短语与二至四字片段；去重并删除明显停用词。ripgrep 使用 fixed-string、ignore-case 和 JSON 输出，用户文本不解释为正则。

Local 从命中行定位 Markdown 标题和相邻段落，一个文档同一标题只保留一个候选，正文按字符边界裁剪。确定性排序依次考虑：完整短语/明确标识符命中标题、文件名或正文；不同查询词覆盖率；目标路径关联；当前权威 Spec 优先于归档 Change 和 Superpowers；命中数、归档时间和稳定路径。

只有至少两个有意义查询词，或一个明确标识符、路径或完整短语命中，才达到注入阈值；否则 abstain。最终最多四个不同来源或标题，每段最多 1600 字符，总文本最多 5000 字符。

## Remote Provider

Remote 不支持可编程映射、JSONPath、厂商 preset 或任意模板。Comet 定义固定文本检索协议，用户负责适配 RAGFlow、Dify、Elasticsearch、向量检索或其他服务。

请求为：

```http
POST <knowledge.remote.endpoint>
Content-Type: application/json
Authorization: Bearer <knowledge.remote.token_env 对应的值>
```

```json
{
  "query": "当前任务及相关路径、阶段上下文",
  "limit": 4,
  "scope": "comet-team-project"
}
```

未配置 token 时不发送 Authorization；未配置 scope 时省略 `scope`。query 首先是原始任务文本，有路径时追加 `Target path: <project-relative-path>`，有阶段时追加 `Phase: <phase>`；不包含绝对路径、源码、个人记忆或本地文档正文。

成功响应必须为 JSON：

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

每项 `content`、`source` 为非空字符串，`title` 与有限数值 `score` 可选。Comet 保留服务端顺序，不用 Local 排序器解释 score，只做结构校验、去重、裁剪和安全渲染。超过四项截断；响应最多 1MiB，source 最多 512 字符，title 最多 200 字符，单段最多 1600 字符，最终总计最多 5000 字符。

2xx 且空 results 是正常无结果。非 2xx、超时、响应超限、非法 JSON 或字段不合法只记录 Remote 诊断；任务继续，不回退 Local。第一版不重试、不跟随 HTTP redirect，避免放大延迟、远端负载或转发 Authorization。

## 组件边界与集成

新增 `domains/project-knowledge/` 并保持职责分离：

- `ProjectKnowledgePlugin`：第一方 Plugin descriptor 与 `provideContext`；
- `ProjectKnowledgeCorpus`：Native、Classic、Superpowers 文档根解析；
- `ProjectKnowledgeQuery`：任务规范化和 Local/Remote query；
- `LocalProjectKnowledgeProvider`：ripgrep、JSON 命中、片段和排序；
- `RemoteProjectKnowledgeProvider`：Retrieval API v1；
- `ProjectKnowledgeRenderer`：去重、限额、来源和不可信资料边界。

平台能力放在 `platform/`，包含 ripgrep 解析、安全进程启动/终止、受限普通文件读取和有界 HTTP。domain 不散落平台分支。

`createDefaultCometPluginBridge()` 读取规范化 `knowledge` 配置，同时注册 personal-memory 与 project-knowledge。`collectCometPluginContext()` 保持 plugin ID 分开的贡献；`comet task --json` 顶层结构不变，仅新增 `pluginId: "comet.project-knowledge"` 项。Native、Classic、hotfix、tweak 共用既有入口。

中英文 Comet Skill 将“只注入个人记忆”更新为“注入相关个人记忆和项目知识”，仍调用同一个 `comet task`；项目知识是确定性 Runtime 能力，不增加需要 Agent 自行判断调用的新 Skill。

## 错误处理与安全

- 无命中：正常空结果，不显示提示；
- 配置 schema 错误：指出 `knowledge` 并拒绝加载；缺少 Remote 环境变量时跳过召回并给诊断；
- Local 工具缺失、超时或非法输出：记录诊断，任务继续；
- Remote 超时、认证失败或协议错误：stderr 一次简短警告，JSON stdout 保持可解析，任务继续；
- 单文档不可读或被替换：跳过并保留诊断，不扩大路径范围；
- 插件禁用或卸载：不加载 Provider、不产生网络或子进程。

诊断不得包含 token、Authorization、完整远端响应或超出必要范围的任务内容。Dashboard 第一版复用现有插件状态和诊断能力，不新增索引进度、搜索页或历史页。

## 测试与评估

单元测试覆盖配置默认/校验/语言渲染、Native/Classic/归档 Superpowers 语料发现、备用根/活跃 Change/`.comet`/越界拒绝、分词/标识符/路径、排序/去重/abstain、Markdown 片段、4 段/5000 字符限制、bundled/system rg、缺失/超时/损坏 JSON、Remote 请求/响应/字节上限/无重试和不可信资料引用。

集成测试覆盖插件默认启用、disable/pause/uninstall、Bridge 同时返回 personal-memory/project-knowledge、`comet task` 与 Native/Classic/hotfix/tweak、跨 workflow 召回、Remote 失败不回退 Local 且不破坏 JSON、npm 安装 bundled rg 和系统回退。

建立不依赖模型的固定小型语料和 Vitest 基线，覆盖精确术语、中文夹英文/路径、当前 Spec 权威排序、Native/Classic/Superpowers 跨来源、无关任务 abstain、Top-4 相关性和来源正确性。跨模块、Runtime、安装或发布资产变化后按仓库规则执行相关测试、格式、lint、build 和一次全量测试。

## 非目标

- 本地 embedding、向量数据库、SQLite、倒排索引、内容 hash 或监听器；
- 源码/通用代码 RAG、备用根、活跃 Change 或 `.comet` 扫描；
- RAGFlow、Dify、Qdrant 等厂商适配；
- 配置脚本、模板、JSONPath 或请求转换代码；
- 远端上传/同步项目文档；
- 用户必须执行的检索/刷新/清理 CLI；
- 按 Native、Classic、Superpowers 隔离召回；
- 召回资料改变 Spec、项目状态、个人记忆或 workflow 决策。
