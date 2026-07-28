# unified-product-catalogue

## 目标

Comet 在项目内提供统一、可移植的产品产物目录。Native、OpenSpec 与 Superpowers 默认分别位于 `docs/comet/`、`docs/openspec/`、`docs/superpowers/`；目录相邻不改变 Native 与 Classic 的工作流所有权、状态机或 Guard。

## Classic 布局

Classic 支持两个受控布局：

```text
legacy:
  <project>/openspec/
  <project>/docs/superpowers/

docs:
  <project>/docs/openspec/
  <project>/docs/superpowers/
```

布局由 `.comet/config.yaml` 的 `classic.artifact_layout` 唯一指定。Classic 的 OpenSpec root、changes、archive、specs 以及 Superpowers specs、plans、reports 都必须由同一个布局 resolver 推导。

Runtime 不扫描另一布局来寻找 fallback，不根据哪个目录先出现决定所有权。配置指定布局与磁盘事实冲突、或 legacy/docs 两个 OpenSpec 根同时存在时，写操作失败关闭；只读 status / doctor 报告两个根及修复命令。

## 新项目与已有项目

- 全新项目通过 `comet init` 启用 Classic 或 Both 时，写入 `classic.artifact_layout: docs`。
- docs 布局初始化 `docs/openspec/changes/`、`docs/openspec/changes/archive/`、`docs/openspec/specs/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`、`docs/superpowers/reports/`。
- Native-only 初始化不创建 Classic 目录。
- 已有 Classic 配置缺失 `artifact_layout` 时，Runtime 按 `legacy` 读取。
- `comet update` 处理缺失字段的已有项目时写入 `legacy`，不得移动目录或改变当前 change 的物理位置。
- 重复 init / update 保持显式 layout，不触发隐式迁移。

## OpenSpec 命令适配

Comet 提供：

```text
comet classic openspec -- <openspec-args...>
```

该命令发现项目根、读取并验证 Classic layout，将进程 cwd 设为解析后的 OpenSpec root，然后执行配置的 OpenSpec CLI。legacy 的 cwd 是项目根，docs 的 cwd 是 `<project>/docs`。

Adapter 原样转发 stdout、stderr 和退出码；命令不存在、配置无效、双根冲突或 root 不健康时返回明确错误，不切换另一布局重试。

Comet-owned Skill、runtime 与用户可复制的命令使用该 adapter。用户也可以在解析后的 OpenSpec root 直接运行官方 CLI。项目内 docs 布局不创建、注册或依赖 OpenSpec store ID。

## OpenSpec 安装与初始化

OpenSpec CLI / 平台工具资产安装与项目 artifact root 初始化是两个独立动作：

- CLI 安装和平台 Skill / command 文件继续落在项目对应的平台目录。
- artifact root 初始化只在解析后的 OpenSpec root 创建官方 `openspec/` 结构，不把平台工具目录嵌套到 `docs/`。
- docs 布局可以通过 `openspec init <project>/docs --tools none` 或等价的官方无工具初始化完成 root 创建。
- 工具资产需要 OpenSpec 生成时，在隔离 staging project 生成并通过现有 platform adapter 合并；不得在真实项目根留下临时 `openspec/`。
- update 分别更新平台工具资产和配置的 artifact root，不以项目根存在 `openspec/` 为前提。

## 路径消费者

以下能力必须使用布局 resolver：

- Classic state、validate、guard、handoff、archive、resume probe、current selection 与 Hook Guard。
- Entry status、Ambient Resume 与 Hook Router 的 Classic change 枚举。
- Dashboard 的 active/archive 扫描、artifact preview 和 project root 计算。
- init、update、doctor、uninstall 与完成摘要。
- Workflow contract 的 Classic state、tasks、delta spec、Superpowers artifact 路径。
- Comet-owned 中英文 Skill、reference、Rule 与生成的 Classic / Entry runtime。

Dashboard 与 Entry 从显式项目根和解析后的 layout 构造 changes 目录，不通过名为 `openspec` 的祖先反推项目根。

Workflow contract 使用逻辑 path base 表达 Classic OpenSpec root 与 Superpowers root；协议不固化配置后的绝对路径，也不假设 root `openspec/changes`。

新写入的 project-relative artifact pointer 使用当前布局。读取历史 legacy archive 时，resolver 可以兼容旧前缀；兼容读取不得为了目录移动重写历史 handoff hash、Run、checkpoint、trajectory 或已归档证据。

## 事务化迁移

Classic 提供：

```text
comet classic root move docs --dry-run
comet classic root move docs --apply
```

`--dry-run` 是只读操作，输出源、目标、文件清单摘要、冲突、配置变化、阻塞 change 和不会重写的历史证据。

首版 apply 只接受满足全部条件的 legacy 项目：

- 没有 active Classic change 或 unmanaged OpenSpec change；
- 没有 pending action、未完成 archive 或 Classic recovery；
- docs 目标不存在或为空且由本次事务拥有；
- 源树只有受支持的普通文件与目录，不含 symlink、junction 或其他特殊对象；
- 源、目标和 `.comet/config.yaml` 均在项目边界内且身份稳定；
- dry-run 后文件集合、大小、内容 hash 与配置没有变化。

Apply 使用 staging、内容校验和有界 journal。完成并复核文件移动后，最后原子写入 `classic.artifact_layout: docs`。配置切换前可以 rollback；切换后只有在验证新旧树状态满足事务契约时才清理旧树。

迁移中断时，普通写命令失败关闭。只读 doctor 报告 transaction id、阶段、源、目标和允许的恢复策略；显式 `comet doctor --repair` 或 Classic doctor adapter 执行 continue / rollback。无法证明树身份、hash 或 journal 一致时保留所有文件并停止。

迁移不把 `.comet/current-change.json` 改成路径；selection 继续只保存 `workflow + change`。首版不提供 active change override。

## Doctor 与卸载

Doctor 检查：

- layout 枚举、配置与启用 workflows 的一致性；
- OpenSpec root 健康状态；
- legacy/docs 双根冲突；
- 未完成迁移 journal；
- platform tool 资产与 artifact root 是否错误耦合。

Doctor 不自动移动用户产物。只有显式 repair 可以继续或回滚可证明安全的迁移事务。

Uninstall 只删除 Comet 管理且为空的目录。任意 specs、changes、archive、Superpowers 文档、未知文件或特殊对象存在时保留目录并报告；不得递归删除用户产物。

## Eval 与兼容

- `039-release`、`040-beta` 等冻结 benchmark 保持不变。
- 当前 Classic treatment / fixture 显式选择 layout，validator 根据该 layout 断言路径。
- legacy 与 docs 两种布局都覆盖完整 Classic 生命周期。
- 新 docs-layout 覆盖不能通过修改冻结 baseline 获得通过。

## 非目标

- 不支持任意组合的 OpenSpec / Superpowers 自定义根。
- 不使用 OpenSpec store registry 作为项目内目录重定位。
- 不修改外部 OpenSpec / Superpowers 原始 Skill。
- 不合并 Native 与 Classic。
- 首版不迁移 active change。
