---
generated_from_state_version: 11
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 2
- 验证器尝试次数: 1
- 完成时间: 2026-08-19T18:49:56.275Z
- 摘要: 独立只读验收通过：实现、规则文案、Local/Remote 边界与失败语义、插件生命周期、跨 workflow 语料、生成资产、双语文档和验证覆盖均符合 A1-A76。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：缺少 `knowledge` 时按 Local 处理；`provider` 仅允许 `local\|remote`，已知字段类型/取值错误拒绝配置，未知扩展字段保留。 | 独立验收通过，未发现必须修复项。 |
| A2 | passed | brief.md | A2：Remote 必须有 HTTPS endpoint（loopback 可 HTTP），可选 token_env/scope/timeout_ms 且超时范围为 100–30000ms；Local 不读取 Remote 凭据。 | 独立验收通过，未发现必须修复项。 |
| A3 | passed | brief.md | A3：语料发现只包含配置声明的 Native 当前/归档 Spec、Classic 配置布局的当前/归档 Spec，以及归档 Classic Change 通过 `design_doc`/`plan`/`verification_report` 明确引用的 Superpowers Markdown。 | 独立验收通过，未发现必须修复项。 |
| A4 | passed | brief.md | A4：备用 OpenSpec 根、活跃 Change、源码、`.comet`、越界路径、符号链接逃逸和非普通文件均不被读取；不存在目录安全跳过。 | 独立验收通过，未发现必须修复项。 |
| A5 | passed | brief.md | A5：查询从任务、可选相对目标路径和阶段生成最多 16 个固定字符串词，保留标识符/路径/数字并处理中文短语，不把用户文本解释为正则。 | 独立验收通过，未发现必须修复项。 |
| A6 | passed | brief.md | A6：Local 优先 bundled rg，缺失时回退系统 rg；两者都不可用、超时或 JSON 损坏时返回空结果和非阻塞诊断。 | 独立验收通过，未发现必须修复项。 |
| A7 | passed | brief.md | A7：Local 单次最多一个 rg 进程、2000ms、1MiB JSON 输出、500 个 match；达到上限停止并仅处理完整候选。 | 独立验收通过，未发现必须修复项。 |
| A8 | passed | brief.md | A8：Local 片段按标题/段落提取并确定性排序；至少两个有意义词或一个明确标识符/完整短语才注入，否则 abstain。 | 独立验收通过，未发现必须修复项。 |
| A9 | passed | brief.md | A9：最终最多 4 个不同来源/标题、每段最多 1600 字符、总计最多 5000 字符；来源、标题和不可信资料边界稳定渲染并安全转义。 | 独立验收通过，未发现必须修复项。 |
| A10 | passed | brief.md | A10：Remote 请求包含 query、limit=4 和可选 scope；query 只含任务及相对路径/阶段，不含绝对路径、源码、个人记忆或本地正文。 | 独立验收通过，未发现必须修复项。 |
| A11 | passed | brief.md | A11：Remote 只接受合法 JSON `results`，校验 content/source/title/score、1MiB 响应、512 字符 source、200 字符 title、1600 字符片段和 5000 字符总量；服务端顺序保留，不重新解释 score。 | 独立验收通过，未发现必须修复项。 |
| A12 | passed | brief.md | A12：Remote 非 2xx、超时、重定向、认证/协议错误、超限或非法 JSON 只产生一次简短诊断，stdout 仍可解析、任务继续且不回退 Local。 | 独立验收通过，未发现必须修复项。 |
| A13 | passed | brief.md | A13：第一方插件默认注册，与 `comet.personal-memory` 并列；disable、project pause、explicit uninstall 后不产生 Provider、网络或子进程活动，升级不静默恢复 explicitRemoval。 | 独立验收通过，未发现必须修复项。 |
| A14 | passed | brief.md | A14：`CometPluginBridge.collectContext()` 同时返回个人记忆和项目知识，`comet task --json` 顶层结构不变，仅增加独立 `pluginId: comet.project-knowledge` 贡献。 | 独立验收通过，未发现必须修复项。 |
| A15 | passed | brief.md | A15：Native 任务可召回 Classic/Superpowers 文档，Classic 任务可召回 Native 文档；Native、Classic、hotfix、tweak 不新增调用路径。 | 独立验收通过，未发现必须修复项。 |
| A16 | passed | brief.md | A16：Local/Remote、Provider 失败、无结果、插件禁用和单文档读取失败均不阻塞主 workflow，不泄露 token、Authorization、完整响应或无界任务内容。 | 独立验收通过，未发现必须修复项。 |
| A17 | passed | brief.md | A17：npm 打包安装后能解析 bundled rg，系统 rg fallback 可独立验证；平台差异由 `platform/` 适配，不散落在 domain。 | 独立验收通过，未发现必须修复项。 |
| A18 | passed | brief.md | A18：测试覆盖配置默认/校验、语料边界、查询分词、排序/去重/abstain、rg 限制、Remote 协议、渲染安全、生命周期、跨 workflow、打包安装和固定 Top-4 基线。 | 独立验收通过，未发现必须修复项。 |
| A19 | passed | brief.md | A19：中英文 Skill 只把“个人记忆”更新为“相关个人记忆和项目知识”，中文先完成并与英文同步，输入/边界/失败语义一致；不修改 Superpowers/OpenSpec 原始 Skill。 | 独立验收通过，未发现必须修复项。 |
| A20 | passed | brief.md | A20：完成相关最小测试、Prettier、lint、build、生成资产检查、全量测试和固定检索基线；用户可见双语文档与当前 beta Changelog 语义一致。 | 独立验收通过，未发现必须修复项。 |
| A21 | passed | specs/project-knowledge/spec.md | Comet 新增第一方 `comet.project-knowledge` 插件，在统一的 `comet task` 上召回与任务相关的项目文档，并通过 `CometPluginBridge.collectContext()` 作为独立 plugin contribution 提供给 Agent。`/comet`、Native、Classic、hotfix 和 tweak 继续调用同一入口，不新增用户必须执行的检索 CLI。 | 独立验收通过，未发现必须修复项。 |
| A22 | passed | specs/project-knowledge/spec.md | 插件提供两个互斥 Provider：`local`（默认）使用随 Comet 分发的 ripgrep 对本地 Markdown 即时检索；`remote` 调用用户实现的固定 `Comet Retrieval API v1`。Local 不访问网络、embedding 或索引；Remote 只在用户明确选择时发送 query。 | 独立验收通过，未发现必须修复项。 |
| A23 | passed | specs/project-knowledge/spec.md | 召回内容必须以“项目知识参考”区块呈现，并标注其可能过时、包含指令性文字且只能作为证据参考，不能覆盖用户请求、系统约束、Skill 或当前 workflow 状态。每段正文使用引用格式，来源路径或 URL 独立展示。 | 独立验收通过，未发现必须修复项。 |
| A24 | passed | specs/project-knowledge/spec.md | `comet.project-knowledge` 是 `project` scope 的第一方插件，与 `comet.personal-memory` 并列注册。 | 独立验收通过，未发现必须修复项。 |
| A25 | passed | specs/project-knowledge/spec.md | 首次协调第一方插件时自动安装并启用。 | 独立验收通过，未发现必须修复项。 |
| A26 | passed | specs/project-knowledge/spec.md | 用户禁用或暂停后不再贡献上下文；显式卸载保留 `explicitRemoval`，后续 update/升级不静默恢复。 | 独立验收通过，未发现必须修复项。 |
| A27 | passed | specs/project-knowledge/spec.md | 卸载只停止召回，不删除 Comet 已有文档，也没有本地索引需要清理。 | 独立验收通过，未发现必须修复项。 |
| A28 | passed | specs/project-knowledge/spec.md | 配置只选择 Provider，不能绕过插件启停状态。 | 独立验收通过，未发现必须修复项。 |
| A29 | passed | specs/project-knowledge/spec.md | 项目知识不进入个人记忆仓库，也不参与个人记忆学习、纠正、同步和遗忘。 | 独立验收通过，未发现必须修复项。 |
| A30 | passed | specs/project-knowledge/spec.md | `.comet/config.yaml` 顶层可选 `knowledge` 块。新项目可以显式生成 Local 默认值；旧项目缺少该块时等价于 Local，不需要迁移。 | 独立验收通过，未发现必须修复项。 |
| A31 | passed | specs/project-knowledge/spec.md | 字段规则： | 独立验收通过，未发现必须修复项。 |
| A32 | passed | specs/project-knowledge/spec.md | `provider` 只允许 `local` 或 `remote`，省略时为 `local`。 | 独立验收通过，未发现必须修复项。 |
| A33 | passed | specs/project-knowledge/spec.md | Remote 的 `endpoint` 必填，必须 HTTPS；loopback 地址允许 HTTP。 | 独立验收通过，未发现必须修复项。 |
| A34 | passed | specs/project-knowledge/spec.md | `token_env` 是环境变量名，不是密钥；存在且变量缺失时不发送未认证请求。 | 独立验收通过，未发现必须修复项。 |
| A35 | passed | specs/project-knowledge/spec.md | `scope` 是不透明知识库标识，Comet 不解释其内容。 | 独立验收通过，未发现必须修复项。 |
| A36 | passed | specs/project-knowledge/spec.md | `timeout_ms` 默认 5000，允许 100–30000 毫秒。 | 独立验收通过，未发现必须修复项。 |
| A37 | passed | specs/project-knowledge/spec.md | 已知字段类型/取值错误按现有项目配置规则拒绝；未知扩展字段继续保留。 | 独立验收通过，未发现必须修复项。 |
| A38 | passed | specs/project-knowledge/spec.md | Local 不读取 Remote 凭据；Provider 严格二选一。 | 独立验收通过，未发现必须修复项。 |
| A39 | passed | specs/project-knowledge/spec.md | 语料只包含 Comet 管理的用户可读 Markdown，不扫描源码、整个仓库或 `.comet` 机器状态。 | 独立验收通过，未发现必须修复项。 |
| A40 | passed | specs/project-knowledge/spec.md | 根据 `.comet/config.yaml` 声明的 workflow 和布局发现： | 独立验收通过，未发现必须修复项。 |
| A41 | passed | specs/project-knowledge/spec.md | 当前 Spec：`<native.artifact_root>/comet/specs/**/*.md`； | 独立验收通过，未发现必须修复项。 |
| A42 | passed | specs/project-knowledge/spec.md | 已归档 Change：`<native.artifact_root>/comet/archive/**/*.md`。 | 独立验收通过，未发现必须修复项。 |
| A43 | passed | specs/project-knowledge/spec.md | 配置布局对应的 `<openspec-root>/specs/**/*.md`； | 独立验收通过，未发现必须修复项。 |
| A44 | passed | specs/project-knowledge/spec.md | 配置布局对应的 `<openspec-root>/changes/archive/**/*.md`； | 独立验收通过，未发现必须修复项。 |
| A45 | passed | specs/project-knowledge/spec.md | 已归档 Classic Change 的 `.comet.yaml` 通过 `design_doc`、`plan` 或 `verification_report` 明确引用的 `docs/superpowers/specs/`、`plans/` 和 `reports/` Markdown。 | 独立验收通过，未发现必须修复项。 |
| A46 | passed | specs/project-knowledge/spec.md | Classic 只读取 `.comet/config.yaml` 所属的 `legacy` 或 `docs` 布局，不读取备用 OpenSpec 根。当前 workflow 不限制召回来源；同时声明 Native 和 Classic 时，两边构成同一语料集合。活跃 Change 不进入第一版语料，Superpowers 也不按目录全量扫描。所有根目录与命中文件必须通过路径保护，拒绝越界、符号链接逃逸和非普通文件；不存在目录安全跳过。 | 独立验收通过，未发现必须修复项。 |
| A47 | passed | specs/project-knowledge/spec.md | 优先解析 npm 包中的 `@vscode/ripgrep` 平台可执行文件；不可用时回退系统 `rg`，两者都不可用时记录可操作诊断并返回空结果，不临时下载。使用参数数组直接启动，不经过 shell。一次召回最多一个 `rg --json` 进程，默认 2000ms 超时，最多接收 1MiB JSON 输出和 500 个 match 事件；达到上限即终止并只排序完整候选。 | 独立验收通过，未发现必须修复项。 |
| A48 | passed | specs/project-knowledge/spec.md | 查询来自 `PluginContextRequest` 的任务文本、可选相对目标路径和可选阶段。最多生成 16 个固定字符串词：保留标识符、路径片段、英文词和数字；中文使用有限连续短语与二至四字片段；去重并删除明显停用词。ripgrep 使用 fixed-string、ignore-case 和 JSON 输出，用户文本不解释为正则。 | 独立验收通过，未发现必须修复项。 |
| A49 | passed | specs/project-knowledge/spec.md | Local 从命中行定位 Markdown 标题和相邻段落，一个文档同一标题只保留一个候选，正文按字符边界裁剪。确定性排序依次考虑：完整短语/明确标识符命中标题、文件名或正文；不同查询词覆盖率；目标路径关联；当前权威 Spec 优先于归档 Change 和 Superpowers；命中数、归档时间和稳定路径。 | 独立验收通过，未发现必须修复项。 |
| A50 | passed | specs/project-knowledge/spec.md | 只有至少两个有意义查询词，或一个明确标识符、路径或完整短语命中，才达到注入阈值；否则 abstain。最终最多四个不同来源或标题，每段最多 1600 字符，总文本最多 5000 字符。 | 独立验收通过，未发现必须修复项。 |
| A51 | passed | specs/project-knowledge/spec.md | Remote 不支持可编程映射、JSONPath、厂商 preset 或任意模板。Comet 定义固定文本检索协议，用户负责适配 RAGFlow、Dify、Elasticsearch、向量检索或其他服务。 | 独立验收通过，未发现必须修复项。 |
| A52 | passed | specs/project-knowledge/spec.md | 请求为： | 独立验收通过，未发现必须修复项。 |
| A53 | passed | specs/project-knowledge/spec.md | 未配置 token 时不发送 Authorization；未配置 scope 时省略 `scope`。query 首先是原始任务文本，有路径时追加 `Target path: <project-relative-path>`，有阶段时追加 `Phase: <phase>`；不包含绝对路径、源码、个人记忆或本地文档正文。 | 独立验收通过，未发现必须修复项。 |
| A54 | passed | specs/project-knowledge/spec.md | 成功响应必须为 JSON： | 独立验收通过，未发现必须修复项。 |
| A55 | passed | specs/project-knowledge/spec.md | 每项 `content`、`source` 为非空字符串，`title` 与有限数值 `score` 可选。Comet 保留服务端顺序，不用 Local 排序器解释 score，只做结构校验、去重、裁剪和安全渲染。超过四项截断；响应最多 1MiB，source 最多 512 字符，title 最多 200 字符，单段最多 1600 字符，最终总计最多 5000 字符。 | 独立验收通过，未发现必须修复项。 |
| A56 | passed | specs/project-knowledge/spec.md | 2xx 且空 results 是正常无结果。非 2xx、超时、响应超限、非法 JSON 或字段不合法只记录 Remote 诊断；任务继续，不回退 Local。第一版不重试、不跟随 HTTP redirect，避免放大延迟、远端负载或转发 Authorization。 | 独立验收通过，未发现必须修复项。 |
| A57 | passed | specs/project-knowledge/spec.md | 新增 `domains/project-knowledge/` 并保持职责分离： | 独立验收通过，未发现必须修复项。 |
| A58 | passed | specs/project-knowledge/spec.md | `ProjectKnowledgePlugin`：第一方 Plugin descriptor 与 `provideContext`； | 独立验收通过，未发现必须修复项。 |
| A59 | passed | specs/project-knowledge/spec.md | `ProjectKnowledgeCorpus`：Native、Classic、Superpowers 文档根解析； | 独立验收通过，未发现必须修复项。 |
| A60 | passed | specs/project-knowledge/spec.md | `ProjectKnowledgeQuery`：任务规范化和 Local/Remote query； | 独立验收通过，未发现必须修复项。 |
| A61 | passed | specs/project-knowledge/spec.md | `LocalProjectKnowledgeProvider`：ripgrep、JSON 命中、片段和排序； | 独立验收通过，未发现必须修复项。 |
| A62 | passed | specs/project-knowledge/spec.md | `RemoteProjectKnowledgeProvider`：Retrieval API v1； | 独立验收通过，未发现必须修复项。 |
| A63 | passed | specs/project-knowledge/spec.md | `ProjectKnowledgeRenderer`：去重、限额、来源和不可信资料边界。 | 独立验收通过，未发现必须修复项。 |
| A64 | passed | specs/project-knowledge/spec.md | 平台能力放在 `platform/`，包含 ripgrep 解析、安全进程启动/终止、受限普通文件读取和有界 HTTP。domain 不散落平台分支。 | 独立验收通过，未发现必须修复项。 |
| A65 | passed | specs/project-knowledge/spec.md | `createDefaultCometPluginBridge()` 读取规范化 `knowledge` 配置，同时注册 personal-memory 与 project-knowledge。`collectCometPluginContext()` 保持 plugin ID 分开的贡献；`comet task --json` 顶层结构不变，仅新增 `pluginId: "comet.project-knowledge"` 项。Native、Classic、hotfix、tweak 共用既有入口。 | 独立验收通过，未发现必须修复项。 |
| A66 | passed | specs/project-knowledge/spec.md | 中英文 Comet Skill 将“只注入个人记忆”更新为“注入相关个人记忆和项目知识”，仍调用同一个 `comet task`；项目知识是确定性 Runtime 能力，不增加需要 Agent 自行判断调用的新 Skill。 | 独立验收通过，未发现必须修复项。 |
| A67 | passed | specs/project-knowledge/spec.md | 无命中：正常空结果，不显示提示； | 独立验收通过，未发现必须修复项。 |
| A68 | passed | specs/project-knowledge/spec.md | 配置 schema 错误：指出 `knowledge` 并拒绝加载；缺少 Remote 环境变量时跳过召回并给诊断； | 独立验收通过，未发现必须修复项。 |
| A69 | passed | specs/project-knowledge/spec.md | Local 工具缺失、超时或非法输出：记录诊断，任务继续； | 独立验收通过，未发现必须修复项。 |
| A70 | passed | specs/project-knowledge/spec.md | Remote 超时、认证失败或协议错误：stderr 一次简短警告，JSON stdout 保持可解析，任务继续； | 独立验收通过，未发现必须修复项。 |
| A71 | passed | specs/project-knowledge/spec.md | 单文档不可读或被替换：跳过并保留诊断，不扩大路径范围； | 独立验收通过，未发现必须修复项。 |
| A72 | passed | specs/project-knowledge/spec.md | 插件禁用或卸载：不加载 Provider、不产生网络或子进程。 | 独立验收通过，未发现必须修复项。 |
| A73 | passed | specs/project-knowledge/spec.md | 诊断不得包含 token、Authorization、完整远端响应或超出必要范围的任务内容。Dashboard 第一版复用现有插件状态和诊断能力，不新增索引进度、搜索页或历史页。 | 独立验收通过，未发现必须修复项。 |
| A74 | passed | specs/project-knowledge/spec.md | 单元测试覆盖配置默认/校验/语言渲染、Native/Classic/归档 Superpowers 语料发现、备用根/活跃 Change/`.comet`/越界拒绝、分词/标识符/路径、排序/去重/abstain、Markdown 片段、4 段/5000 字符限制、bundled/system rg、缺失/超时/损坏 JSON、Remote 请求/响应/字节上限/无重试和不可信资料引用。 | 独立验收通过，未发现必须修复项。 |
| A75 | passed | specs/project-knowledge/spec.md | 集成测试覆盖插件默认启用、disable/pause/uninstall、Bridge 同时返回 personal-memory/project-knowledge、`comet task` 与 Native/Classic/hotfix/tweak、跨 workflow 召回、Remote 失败不回退 Local 且不破坏 JSON、npm 安装 bundled rg 和系统回退。 | 独立验收通过，未发现必须修复项。 |
| A76 | passed | specs/project-knowledge/spec.md | 建立不依赖模型的固定小型语料和 Vitest 基线，覆盖精确术语、中文夹英文/路径、当前 Spec 权威排序、Native/Classic/Superpowers 跨来源、无关任务 abstain、Top-4 相关性和来源正确性。跨模块、Runtime、安装或发布资产变化后按仓库规则执行相关测试、格式、lint、build 和一次全量测试。 | 独立验收通过，未发现必须修复项。 |

## 检查

_没有记录 Runtime 检查。_

## 阻塞项

_无。_

## 风险与跳过的工作

_未报告风险。_

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A18, A19, A66, A74, A75, A76 | 核心实现路径和编译/最小测试通过，但规则文案残留旧个人记忆入口，且 RAG 测试覆盖不足；回退 Build 修复。 | 2026-08-19T18:04:21.584Z |
| 1 | 2 | 1 | pass | — | 独立只读验收通过：实现、规则文案、Local/Remote 边界与失败语义、插件生命周期、跨 workflow 语料、生成资产、双语文档和验证覆盖均符合 A1-A76。 | 2026-08-19T18:49:56.275Z |



## 结论

独立只读验收通过：实现、规则文案、Local/Remote 边界与失败语义、插件生命周期、跨 workflow 语料、生成资产、双语文档和验证覆盖均符合 A1-A76。
