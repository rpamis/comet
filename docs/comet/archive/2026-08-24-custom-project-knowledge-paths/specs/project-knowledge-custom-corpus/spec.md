# 项目知识自定义文档语料

## 目标

Local Project Knowledge Provider 在保留内置 Native、Classic 和 Superpowers 来源的基础上，允许项目维护者通过配置追加多个项目相对 glob，把指定 Markdown 文档纳入本地知识检索。Dashboard 总设置提供同一配置的可视化管理入口。

## 配置

项目配置支持：

```yaml
knowledge:
  provider: local
  local:
    include:
      - docs/architecture/**/*.md
      - packages/*/README.md
      - decisions/**/*.md
```

`knowledge.local.include` 是字符串数组，缺失时等同于空数组。空数组不写入 YAML，表示不追加自定义来源。配置更新须保留未知字段，并沿用现有 `.comet/config.yaml` revision 并发保护。

每个模式必须满足：

1. 是项目相对路径；
2. 使用 `/` 分隔符；
3. 支持 `*`、`**` 和 `?`；
4. 不含绝对路径、反斜杠、空字符串、NUL 或 `..` 路径段；
5. 以 `.md` 结尾，扩展名匹配不区分大小写。

标准化时去除空白、过滤空项、去重并保留首次出现顺序。目录本身不是有效文档模式；用户须显式填写 `dir/**/*.md`。

## 语料发现

Local Provider 按以下顺序建立语料：

1. 发现当前已启用 Native 的 `<native.artifact_root>/comet/specs/**/*.md` 和 `archive/**/*.md`。
2. 发现当前已启用 Classic 布局的 `openspec/specs/**/*.md`、`changes/archive/**/*.md`，或 `docs/openspec` 对应路径。
3. 发现归档 Classic Change 的 `.comet.yaml` 明确引用的 Superpowers 文档。
4. 匹配 `knowledge.local.include` 中的每个模式。
5. 将所有来源按项目相对路径合并，重复文件只保留一个文档对象。

自定义文档使用独立的自定义来源类型，保留相对 `source` 和绝对读取路径，进入现有索引同步、FTS 检索、排序、去重和上下文格式化流程。自定义来源不创建或修改项目内的 Comet 知识文件。

发现安全规则：

- 只接受普通 Markdown 文件；
- 不跟随符号链接；
- 匹配和读取前确认真实路径位于项目根目录内；
- 文件消失或读取失败时记录有界诊断，其他来源继续工作；
- 无匹配模式是正常状态，不产生失败结果。

自定义语料继续使用现有的最大文件数、单文件大小、总字节数和发现时间边界。超出边界的文件按现有诊断方式跳过，不引入第二套预算。

## Provider 行为

当 `knowledge.provider` 为 `local` 时，自定义来源参与 status、rebuild、list、query 和 Dashboard 数据来源展示。当 Provider 为 `remote` 时，保留并显示配置，但不读取本地自定义路径、不上传本地文档，也不静默回退到 Local。切换回 Local 后，下次索引或查询重新发现这些来源。

## Dashboard 行为

Dashboard 总设置中的项目知识配置区域提供“额外知识文档”列表：

- 每项编辑一个 glob；
- 支持添加和删除项；
- 提供 Markdown glob 示例；
- 服务端返回具体模式的校验错误；
- Local Provider 下可编辑并保存；
- Remote Provider 下保留内容但禁用编辑，提示“仅本地 Provider 生效”；
- 保存成功后刷新配置、Local 索引和来源列表；
- 未匹配的合法模式显示为已保存但尚未发现文档。

Dashboard 使用现有 Ant Design 表单、项目设置接口和 revision 校验，不新增独立插件生命周期或侧边栏入口。

## 兼容与优先级

- 没有 `knowledge.local.include` 的项目行为不变。
- 自定义来源不覆盖 Native、Classic 或 Superpowers 内置来源。
- 项目知识仍是检索上下文，不覆盖系统约束、用户要求、宿主 Rule、Skill 或当前工作流状态。
- 用户显式配置的 `AGENTS.md` 或其他 Rule Markdown 文件可作为额外文档读取，但不会因此改变宿主 Rule 的加载或优先级。

## 验收

- A1 未配置字段时配置解析、默认值和现有语料结果不变。
- A2 合法多模式追加结果进入 Local 索引并可被任务查询命中。
- A3 glob 运算覆盖 `*`、`**`、`?`、扩展名大小写和重复结果。
- A4 不安全或非 Markdown 模式在配置层拒绝。
- A5 越界、符号链接、消失文件和无匹配场景安全降级。
- A6 Remote Provider 不访问自定义本地文档并保留配置。
- A7 Dashboard 能完整编辑、校验、保存和重载数组。
- A8 来源面板显示自定义文档的项目相对路径和状态。
