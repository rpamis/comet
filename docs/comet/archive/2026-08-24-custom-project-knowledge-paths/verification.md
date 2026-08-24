---
generated_from_state_version: 7
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-08-24T09:30:24.225Z
- 摘要: 只读验收通过：聚焦 4 个 Vitest 文件 90/90 通过，TypeScript、Dashboard 构建、生成物一致性、格式和 diff 检查均通过；配置、安全校验、glob 语料追加、Remote 保留、索引来源和 Dashboard 刷新链路均符合规格。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1: 未配置 `knowledge.local.include` 的项目行为和 YAML 结构保持不变。 | 缺省配置行为保持不变，聚焦测试通过。 |
| A2 | passed | brief.md | A2: 多个合法 glob 可以追加匹配 Markdown 文件，结果与内置语料一起参与 Local 检索。 | Local corpus 追加多个 glob 并进入检索链路。 |
| A3 | passed | brief.md | A3: `*`、`**`、`?`、多模式去重和大小写不敏感的 `.md` 扩展名按约定工作。 | 支持 *、**、?、大小写不敏感 .md 与 Map 去重。 |
| A4 | passed | brief.md | A4: 绝对路径、反斜杠、`..`、空模式和非 Markdown 模式被拒绝，并指出具体配置项。 | 配置层拒绝绝对路径、反斜杠、..、空值和非 Markdown。 |
| A5 | passed | brief.md | A5: 符号链接或越界真实路径不会进入语料；无匹配模式不会阻断其他来源。 | 安全路径检查跳过越界/符号链接，无匹配正常降级。 |
| A6 | passed | brief.md | A6: Remote Provider 不读取自定义本地路径，切换 Provider 不删除该配置。 | Remote 不发现本地自定义文档，切换时保留配置。 |
| A7 | passed | brief.md | A7: Dashboard 可新增、删除、保存、重新加载多个模式；Remote 时字段保留但禁用并说明仅 Local 生效。 | Dashboard 可编辑数组，Remote 保留但禁用。 |
| A8 | passed | brief.md | A8: 保存或刷新后，Dashboard 数据来源能展示匹配到的自定义文档。 | 保存后刷新索引并在来源列表展示自定义文档。 |
| A9 | passed | specs/project-knowledge-custom-corpus/spec.md | Local Project Knowledge Provider 在保留内置 Native、Classic 和 Superpowers 来源的基础上，允许项目维护者通过配置追加多个项目相对 glob，把指定 Markdown 文档纳入本地知识检索。Dashboard 总设置提供同一配置的可视化管理入口。 | 配置、语料、索引、插件和 Dashboard 全链路实现。 |
| A10 | passed | specs/project-knowledge-custom-corpus/spec.md | 项目配置支持： | 支持 knowledge.local.include 配置结构。 |
| A11 | passed | specs/project-knowledge-custom-corpus/spec.md | `knowledge.local.include` 是字符串数组，缺失时等同于空数组。空数组不写入 YAML，表示不追加自定义来源。配置更新须保留未知字段，并沿用现有 `.comet/config.yaml` revision 并发保护。 | 数组缺省为空，空数组省略 YAML，保留未知字段和 revision。 |
| A12 | passed | specs/project-knowledge-custom-corpus/spec.md | 每个模式必须满足： | 模式规则集中在统一归一化校验函数。 |
| A13 | passed | specs/project-knowledge-custom-corpus/spec.md | 是项目相对路径； | 限制为项目相对路径。 |
| A14 | passed | specs/project-knowledge-custom-corpus/spec.md | 使用 `/` 分隔符； | 反斜杠被拒绝并使用正斜杠。 |
| A15 | passed | specs/project-knowledge-custom-corpus/spec.md | 支持 `*`、`**` 和 `?`； | glob matcher 实现 *、**、?。 |
| A16 | passed | specs/project-knowledge-custom-corpus/spec.md | 不含绝对路径、反斜杠、空字符串、NUL 或 `..` 路径段； | 拒绝绝对路径、反斜杠、空段、.、.. 和 NUL。 |
| A17 | passed | specs/project-knowledge-custom-corpus/spec.md | 以 `.md` 结尾，扩展名匹配不区分大小写。 | .md 扩展名检查和匹配均不区分大小写。 |
| A18 | passed | specs/project-knowledge-custom-corpus/spec.md | 标准化时去除空白、过滤空项、去重并保留首次出现顺序。目录本身不是有效文档模式；用户须显式填写 `dir/**/*.md`。 | trim、过滤空项、按首次顺序去重，目录需显式 glob。 |
| A19 | passed | specs/project-knowledge-custom-corpus/spec.md | Local Provider 按以下顺序建立语料： | 按 Native、Classic、Superpowers、自定义顺序建立语料。 |
| A20 | passed | specs/project-knowledge-custom-corpus/spec.md | 发现当前已启用 Native 的 `<native.artifact_root>/comet/specs/**/*.md` 和 `archive/**/*.md`。 | Native specs/archive 来源保持。 |
| A21 | passed | specs/project-knowledge-custom-corpus/spec.md | 发现当前已启用 Classic 布局的 `openspec/specs/**/*.md`、`changes/archive/**/*.md`，或 `docs/openspec` 对应路径。 | Classic legacy/docs 来源保持。 |
| A22 | passed | specs/project-knowledge-custom-corpus/spec.md | 发现归档 Classic Change 的 `.comet.yaml` 明确引用的 Superpowers 文档。 | 归档 Classic 的 Superpowers 来源保持。 |
| A23 | passed | specs/project-knowledge-custom-corpus/spec.md | 匹配 `knowledge.local.include` 中的每个模式。 | Local provider 下发现每个自定义模式。 |
| A24 | passed | specs/project-knowledge-custom-corpus/spec.md | 将所有来源按项目相对路径合并，重复文件只保留一个文档对象。 | 按 source 合并并按 kind rank 保留内置来源优先。 |
| A25 | passed | specs/project-knowledge-custom-corpus/spec.md | 自定义文档使用独立的自定义来源类型，保留相对 `source` 和绝对读取路径，进入现有索引同步、FTS 检索、排序、去重和上下文格式化流程。自定义来源不创建或修改项目内的 Comet 知识文件。 | custom 文档带相对 source 和绝对路径，进入索引/FTS 流程。 |
| A26 | passed | specs/project-knowledge-custom-corpus/spec.md | 发现安全规则： | 安全发现规则由路径和文件检查统一执行。 |
| A27 | passed | specs/project-knowledge-custom-corpus/spec.md | 只接受普通 Markdown 文件； | 仅接受普通 Markdown 文件。 |
| A28 | passed | specs/project-knowledge-custom-corpus/spec.md | 不跟随符号链接； | 目录和文件符号链接均跳过。 |
| A29 | passed | specs/project-knowledge-custom-corpus/spec.md | 匹配和读取前确认真实路径位于项目根目录内； | 读取前确认真实路径位于项目根目录。 |
| A30 | passed | specs/project-knowledge-custom-corpus/spec.md | 文件消失或读取失败时记录有界诊断，其他来源继续工作； | 读取失败记录有界诊断并继续其他来源。 |
| A31 | passed | specs/project-knowledge-custom-corpus/spec.md | 无匹配模式是正常状态，不产生失败结果。 | 无匹配模式返回空结果，不产生失败。 |
| A32 | passed | specs/project-knowledge-custom-corpus/spec.md | 自定义语料继续使用现有的最大文件数、单文件大小、总字节数和发现时间边界。超出边界的文件按现有诊断方式跳过，不引入第二套预算。 | 复用现有时间、文件数、单文件和总字节预算。 |
| A33 | passed | specs/project-knowledge-custom-corpus/spec.md | 当 `knowledge.provider` 为 `local` 时，自定义来源参与 status、rebuild、list、query 和 Dashboard 数据来源展示。当 Provider 为 `remote` 时，保留并显示配置，但不读取本地自定义路径、不上传本地文档，也不静默回退到 Local。切换回 Local 后，下次索引或查询重新发现这些来源。 | Local 使用 custom sources；Remote 不建本地 corpus。 |
| A34 | passed | specs/project-knowledge-custom-corpus/spec.md | Dashboard 总设置中的项目知识配置区域提供“额外知识文档”列表： | 总设置增加额外知识文档区域。 |
| A35 | passed | specs/project-knowledge-custom-corpus/spec.md | 每项编辑一个 glob； | 每个输入项对应一个 glob。 |
| A36 | passed | specs/project-knowledge-custom-corpus/spec.md | 支持添加和删除项； | 提供新增和删除数组项操作。 |
| A37 | passed | specs/project-knowledge-custom-corpus/spec.md | 提供 Markdown glob 示例； | 提供 Markdown glob 示例和 placeholder。 |
| A38 | passed | specs/project-knowledge-custom-corpus/spec.md | 服务端返回具体模式的校验错误； | 服务端错误包含具体 include 索引。 |
| A39 | passed | specs/project-knowledge-custom-corpus/spec.md | Local Provider 下可编辑并保存； | Local provider 下可编辑并保存。 |
| A40 | passed | specs/project-knowledge-custom-corpus/spec.md | Remote Provider 下保留内容但禁用编辑，提示“仅本地 Provider 生效”； | Remote 下禁用编辑并提示仅本地生效。 |
| A41 | passed | specs/project-knowledge-custom-corpus/spec.md | 保存成功后刷新配置、Local 索引和来源列表； | 保存后刷新配置、Local 索引和来源列表。 |
| A42 | passed | specs/project-knowledge-custom-corpus/spec.md | 未匹配的合法模式显示为已保存但尚未发现文档。 | 合法未匹配模式保留并提示暂无来源。 |
| A43 | passed | specs/project-knowledge-custom-corpus/spec.md | Dashboard 使用现有 Ant Design 表单、项目设置接口和 revision 校验，不新增独立插件生命周期或侧边栏入口。 | 复用 AntD、项目设置接口和 revision 保护。 |
| A44 | passed | specs/project-knowledge-custom-corpus/spec.md | 没有 `knowledge.local.include` 的项目行为不变。 | 无 include 时不进入自定义发现。 |
| A45 | passed | specs/project-knowledge-custom-corpus/spec.md | 自定义来源不覆盖 Native、Classic 或 Superpowers 内置来源。 | 内置来源优先级确保不被 custom 覆盖。 |
| A46 | passed | specs/project-knowledge-custom-corpus/spec.md | 项目知识仍是检索上下文，不覆盖系统约束、用户要求、宿主 Rule、Skill 或当前工作流状态。 | 仅扩展项目知识检索，不改变系统或工作流优先级。 |
| A47 | passed | specs/project-knowledge-custom-corpus/spec.md | 用户显式配置的 `AGENTS.md` 或其他 Rule Markdown 文件可作为额外文档读取，但不会因此改变宿主 Rule 的加载或优先级。 | 显式配置的 Rule Markdown 作为文档读取，不改变宿主 Rule。 |
| A48 | passed | specs/project-knowledge-custom-corpus/spec.md | A1 未配置字段时配置解析、默认值和现有语料结果不变。 | 未配置字段的解析和既有结果保持。 |
| A49 | passed | specs/project-knowledge-custom-corpus/spec.md | A2 合法多模式追加结果进入 Local 索引并可被任务查询命中。 | 多模式结果进入 Local 索引并可查询。 |
| A50 | passed | specs/project-knowledge-custom-corpus/spec.md | A3 glob 运算覆盖 `*`、`**`、`?`、扩展名大小写和重复结果。 | glob、扩展名和重复结果均有覆盖。 |
| A51 | passed | specs/project-knowledge-custom-corpus/spec.md | A4 不安全或非 Markdown 模式在配置层拒绝。 | 非法模式在配置层拒绝。 |
| A52 | passed | specs/project-knowledge-custom-corpus/spec.md | A5 越界、符号链接、消失文件和无匹配场景安全降级。 | 越界、符号链接、消失文件和无匹配安全降级。 |
| A53 | passed | specs/project-knowledge-custom-corpus/spec.md | A6 Remote Provider 不访问自定义本地文档并保留配置。 | Remote 保留配置且不访问本地文档。 |
| A54 | passed | specs/project-knowledge-custom-corpus/spec.md | A7 Dashboard 能完整编辑、校验、保存和重载数组。 | Dashboard 能编辑、校验、保存和重载数组。 |
| A55 | passed | specs/project-knowledge-custom-corpus/spec.md | A8 来源面板显示自定义文档的项目相对路径和状态。 | 来源面板展示自定义文档项目相对路径和状态。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| custom Project Knowledge and settings tests | exec vitest run test/domains/project-knowledge/project-knowledge.test.ts test/domains/project-knowledge/project-knowledge-index.test.ts test/domains/workflow-contract/workflow-contract.test.ts test/domains/dashboard/project-config-settings.test.ts | . | passed | 0 | 16566 ms |
| TypeScript compilation | exec tsc --noEmit | . | passed | 0 | 7454 ms |
| Dashboard production build | build:dashboard | . | passed | 0 | 18892 ms |
| runtime generation consistency | check:generated | . | passed | 0 | 1931 ms |
| format check | format:check | . | passed | 0 | 17751 ms |
| git diff whitespace check | diff --check | . | passed | 0 | 288 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 完整 pnpm test 有当前分支既有 Native source-coverage 合约失败。
- Dashboard 浏览器套件有与本功能无关的 dark-theme selector 失败。
- 工作区包含用户既有未提交修改及 .codex-remote-attachments，未触碰。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | pass | — | 只读验收通过：聚焦 4 个 Vitest 文件 90/90 通过，TypeScript、Dashboard 构建、生成物一致性、格式和 diff 检查均通过；配置、安全校验、glob 语料追加、Remote 保留、索引来源和 Dashboard 刷新链路均符合规格。 | 2026-08-24T09:30:24.225Z |



## 结论

只读验收通过：聚焦 4 个 Vitest 文件 90/90 通过，TypeScript、Dashboard 构建、生成物一致性、格式和 diff 检查均通过；配置、安全校验、glob 语料追加、Remote 保留、索引来源和 Dashboard 刷新链路均符合规格。
