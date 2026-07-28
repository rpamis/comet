# classic-config-block

## 目标

`.comet/config.yaml` 按「全局 / 工作流专属」两层组织：全局字段留在顶层，Classic 工作流专属字段收纳在 `classic:` 嵌套映射下，与 `native:` 嵌套块对称。所有消费者共享同一份类型、规范化和路径边界契约。

## 配置结构

`comet.project.v1` 配置文件结构如下：

```yaml
schema: comet.project.v1
default_workflow: native | classic
workflows:
  - native
  - classic
ambient_resume: true | false
native:
  artifact_root: <relative-path>
  language: en | zh-CN
classic:
  artifact_layout: legacy | docs
  language: en | zh-CN
  context_compression: off | beta
  review_mode: off | standard | thorough
  auto_transition: true | false
```

顶层 `schema`、`default_workflow`、`workflows`、`ambient_resume` 是全局字段。`native:` 仅作用于 Native，`classic:` 仅作用于 Classic。

Classic 字段：

- `artifact_layout`：Classic 产物布局，取值 `legacy | docs`。缺失时 Runtime 默认 `legacy`；全新 Classic / Both 项目 init 默认 `docs`；已有缺失字段的项目 update 写入 `legacy`。
- `language`：Classic 产物语言，取值 `en | zh-CN`，默认 `zh-CN`。
- `context_compression`：新建 Classic change 的上下文压缩模式，取值 `off | beta`，默认 `off`。
- `review_mode`：新建 Classic change 的审查深度，取值 `off | standard | thorough`，默认 `standard`。
- `auto_transition`：Classic 阶段通过后是否自动进入下一阶段，取值 `true | false`，默认 `true`。

`classic:` 块整体可选；缺失时行为等价于已发布 Classic：layout 为 `legacy`，其余字段回退既有默认值。

## 共享读取边界

项目配置的结构类型、托管字段、枚举规范化和项目相对路径验证由 `domains/workflow-contract/` 提供稳定契约：

- Classic 领域读取共享解析结果，只实现 Classic 行为，不定义 Native 字段。
- Native 领域读取共享解析结果，只实现 Native 行为，不定义 Classic 字段。
- Entry、Factory、Dashboard、Skill 安装/卸载不得用正则或字符串切片重新解析 YAML。
- `native.artifact_root` 必须经过共享的项目内相对路径规范化后才能传给 `path.join` 或文件系统 API；绝对路径、`..` 越界、空段、特殊对象边界和无效配置失败关闭。
- 配置解析失败的消费者报告不可用或明确错误，不猜测默认路径后继续扫描或写入。

共享契约不合并 Native 与 Classic 的状态机、Guard 或 artifact resolver。

## Classic 读取行为

Classic 只从 `classic:` 块读取上述字段：

- 块和字段存在：校验类型 / 枚举后使用。
- 块或字段缺失：使用该字段的 Runtime 默认值。
- `artifact_layout` 非 `legacy | docs` 时，所有依赖布局的写操作失败关闭。

Classic 不从顶层读取旧平铺字段。Native 不读取 `classic:`。

字段读取继续使用既有 error-tolerant YAML 机制；布局 resolver 对实际使用的 `artifact_layout` 执行严格枚举验证。完整项目配置写入仍执行唯一键、大小和边界保护。

## 写入与迁移

`comet init` 与 `comet update`：

- 生成带双语注释的 `classic:` 块。
- 保留显式的新格式字段；旧顶层字段仅按既有契约迁入对应 Classic 字段，新格式值优先。
- 对全新且启用 Classic 的项目写 `artifact_layout: docs`。
- 对已有配置或 legacy 项目缺失 `artifact_layout` 的情况写 `artifact_layout: legacy`，不移动目录。
- 重复执行保持幂等，不改变显式 layout。
- 只更新 Comet 管理的 Classic 字段；`classic:` 内未知自定义字段逐项保留。
- 保留顶层全局字段、完整 `native:` 块、未知顶层字段和其他未知嵌套块。

目录移动不属于普通 config merge。只有 Classic root move 事务成功后才能把 `artifact_layout` 从 `legacy` 切换为 `docs`；事务必须把原配置内容 hash 和预期写入结果绑定到 journal。

## 类型契约

`CometProjectConfig.classic` 包含可选 `artifact_layout?: 'legacy' | 'docs'` 以及既有四项字段。Native 配置解析和写入保留完整 Classic 块；Classic merge 保留完整 Native 块。

共享类型位于 workflow-contract；Classic 和 Native 不互相导入对方领域的 config/types 来获得项目配置契约。

## 非目标

- 不改变 `native:`、顶层全局字段或既有 Classic 四字段值域。
- 不在 Runtime 兼容旧顶层平铺 Classic 字段。
- 不允许通过多个低层路径字段配置互相矛盾的目录。
- 不通过普通 init / update 自动移动 Classic 产物。
- 不调整 Classic change 级 `.comet.yaml` schema。
