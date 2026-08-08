# native-init-workspace-defaults

## 目标

Comet Native 在项目没有既有 Native 配置且用户未显式指定 root 时，统一使用 `docs` 作为 artifact root。初始化创建的用户文档工作区、写入的项目配置、JSON 结果、完成摘要和所有后续消费者必须指向同一、经过共享边界验证的真实位置；机器 Runtime 独立存放在项目根 `.comet/runtime/native`。

## Native 默认 artifact root

- `comet init` 选择 Native 或 Both，且项目没有既有 `.comet/config.yaml`、用户没有提供 `--root` 时，`native.artifact_root` 为 `docs`。
- `comet native init` 在没有既有配置且未提供 `--root` 时，同样使用 `docs`。
- 共享默认配置构造器在未传 artifact root 时生成 `native.artifact_root: docs`。
- 用户显式提供 `--root <relative-path>` 时使用该路径，包括显式 `--root .`。
- 项目已有合法 `native.artifact_root` 时，重复初始化保留该值；Classic layout 的变化不得触发 Native root move。

默认 Native 用户文档目录布局为：

```text
docs/comet/
├── specs/
├── changes/
└── archive/
```

默认 Native 机器 Runtime 布局为：

```text
.comet/runtime/native/
├── changes/
├── locks/
└── transactions/
```

初始化不得在 `docs/comet/` 创建 `runtime/`。未显式选择 `--root .` 时，也不得在项目根创建等价的 `comet/` 用户文档目录树。

## Root 共享边界

所有读取 `native.artifact_root` 的消费者，包括 Native runtime、Entry、Factory、Dashboard、安装与生成逻辑，都必须复用 workflow-contract 的配置解析和项目内相对路径规范化：

- 不以正则从 YAML 文本提取 root。
- 不把未验证值直接传给 `path.join`、目录枚举或文件读写。
- 绝对路径、`..` 越界、空值、非法类型或无效配置返回明确错误/不可用状态，不回退到 `docs` 或 `.` 猜测继续。
- Factory 生成 workflow package 时只读取已验证的 Native用户文档 root，并保证所有打包路径仍位于项目根。

Native Runtime 根固定从已验证 project root 解析为 `.comet/runtime/native`，不受 `native.artifact_root` 变化影响。共享边界不得降低 Native protected I/O、snapshot、workspace identity 或 root move 语义。

## 初始化完成摘要

项目范围 `comet init` 的完成摘要按实际启用 workflow 与解析后的 layout 输出：

- Native-only：输出解析后的 `<native.artifact_root>/comet/` 用户文档根；可以另行说明 Runtime 使用本地 `.comet/runtime/native/`，但不得把它描述为需要提交的产物。
- Classic-only：legacy 布局输出 `openspec/` 与 `docs/superpowers/{specs,plans,reports}/`；docs 布局输出 `docs/openspec/` 与 `docs/superpowers/{specs,plans,reports}/`，不输出 Native 工作目录。
- Both：同时输出 Native 用户文档目录与解析后的 Classic 工作目录。

Native 路径来自共享配置契约验证后的 `InitWorkflowDecision.artifactRoot`，Classic 路径来自 Classic layout resolver；中英文文案遵循相同条件与真实路径。

## 跨设备默认恢复

`.comet/config.yaml`、`.comet/current-change.json` 与 `.comet/runtime/native` 可以不随 Git 同步。对于 Native 默认布局，各设备重新执行 Native 初始化后都得到 `native.artifact_root: docs`，因此 `resume-probe` 扫描 `docs/comet/changes` 并能发现已同步的 active change。

缺少 Runtime 时，恢复只能重建执行上下文并重新 Verify，不能恢复原设备的精确 Run、trajectory、baseline 或机器 evidence。Classic docs layout 不改变 Native discovery。缺失 selection 时，单一 active change仍按工作流归属与无歧义恢复规则处理；多个 Native / Classic 候选由共享 Entry 协议失败关闭。

本能力不为自定义 Native artifact root 引入自动猜测或跨目录扫描。

## Classic 配置默认值

Classic 项目配置保持既有字段值域与默认值：

- `review_mode` 为 `off | standard | thorough`，缺失时默认 `standard`。
- `artifact_layout` 为 `legacy | docs`；Runtime 缺失时默认 `legacy`，全新 Classic / Both init 默认 `docs`。

Native 默认 root 和本地 Runtime 不覆盖、迁移或推断 Classic layout。

## 非目标

- 不自动移动已有 Native artifact root。
- 不删除非空旧 Native 目录或旧 per-change Runtime。
- 不改变 Native clarification 模式或 Classic workflow。
- 不扫描配置 root 之外的候选 Native changes。
- 不因 Classic layout 与 Native 默认同处 `docs/` 而合并两个 workflow。
- 不把 `.comet/runtime/native` 变成可提交的跨设备状态后端。
