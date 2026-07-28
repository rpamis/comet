# native-init-workspace-defaults

## 目标

Comet Native 在项目没有既有 Native 配置且用户未显式指定 root 时，统一使用 `docs` 作为 artifact root。初始化创建的 Native 工作区、写入的项目配置、JSON 结果、完成摘要和后续 Ambient Resume 必须指向同一真实位置。

## Native 默认 artifact root

- `comet init` 选择 Native 或 Both，且项目没有既有 `.comet/config.yaml`、用户没有提供 `--root` 时，`native.artifact_root` 为 `docs`。
- `comet native init` 在没有既有配置且未提供 `--root` 时，同样使用 `docs`。
- 共享默认配置构造器在未传 artifact root 时生成 `native.artifact_root: docs`。
- 用户显式提供 `--root <relative-path>` 时使用该路径，包括显式 `--root .`。
- 项目已有合法 `native.artifact_root` 时，重复初始化保留该值；新默认不得触发隐式 root move。

默认 Native 目录布局为：

```text
docs/comet/
├── specs/
├── changes/
├── archive/
└── runtime/
```

未显式选择 `--root .` 时，初始化不得在项目根创建等价的 `comet/` 目录树。

## 初始化完成摘要

项目范围 `comet init` 的人类可读完成摘要按实际启用 workflow 输出工作目录：

- Native-only：输出解析后的 `<artifact-root>/comet/`，不输出 `docs/superpowers/*`。
- Classic-only：输出 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`，不输出 Native 工作目录。
- Both：同时输出 Native 工作目录与两个 Classic 工作目录。

Native 路径来自本次 `InitWorkflowDecision.artifactRoot`，不能硬编码为 `docs`，因此显式自定义 root 和已有配置会显示真实路径。中英文文案遵循同一条件与路径语义。

## 跨设备默认恢复

`.comet/config.yaml` 与 `.comet/current-change.json` 可以不随 Git 同步。对于使用默认布局的项目，各设备重新执行 Native 初始化后都得到 `native.artifact_root: docs`，因此 `resume-probe` 扫描 `docs/comet/changes` 并能发现已同步的 active change。缺失本地 selection 时，单一 active change 仍按现有无歧义恢复规则处理。

本能力不为自定义 artifact root 引入自动猜测或跨目录扫描；自定义 root 仍由项目配置明确指定。

## Classic review mode 默认值

Classic 项目配置中 `classic.review_mode` 的值域保持 `off | standard | thorough`。字段或整个 `classic:` 块缺失时，Classic 读取默认值 `standard`；显式值保持不变。Native 默认 root 与摘要调整不得改变该行为。

## 非目标

- 不移动已有 Native root。
- 不删除非空旧目录。
- 不改变 Classic 工作目录、状态机或 review mode 值域。
- 不扫描配置 root 之外的候选 Native changes。
