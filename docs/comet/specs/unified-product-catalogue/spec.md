# unified-product-catalogue

## 目标

Comet 在项目内提供统一、可移植且失败关闭的产品产物目录。Native、OpenSpec 与 Superpowers 默认分别位于 `docs/comet/`、`docs/openspec/`、`docs/superpowers/`；目录相邻不改变 Native 与 Classic 的工作流所有权、状态机或 Guard。

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

Runtime 不扫描另一布局来寻找 fallback，不根据哪个目录先出现决定所有权。配置指定布局与磁盘事实冲突、或 legacy/docs 两个 OpenSpec 根同时存在时，所有写操作失败关闭；只读 status / doctor 报告两个根及修复命令。配置缺失或无效时，只读消费者报告布局不可用，不猜测 legacy 路径继续扫描。

跨 workflow 的项目配置类型、字段规范化和相对路径边界属于 `domains/workflow-contract/`。Classic、Native、Entry、Factory、Dashboard 与 Skill 安装可以消费该契约，但不得分别以正则、字符串拼接或重复 YAML 解析重新定义它。

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

Comet-owned Skill、Rule、reference、runtime 与用户可复制的命令必须使用该 adapter。用户也可以在解析后的 OpenSpec root 直接运行官方 CLI。项目内 docs 布局不创建、注册或依赖 OpenSpec store ID。

Skill 或文档需要表达 change、tasks、delta spec、handoff、archive 等路径时，使用 resolver 产生的逻辑根，例如 `<classic-change-dir>`、`<classic-changes-root>` 或明确引用 Classic layout reference；不得把历史物理路径 `openspec/...` 包装成“逻辑路径”后继续作为可复制指导。

## OpenSpec 安装与初始化

OpenSpec CLI / 平台工具资产安装与项目 artifact root 初始化是两个独立动作：

- CLI 安装和平台 Skill / command 文件继续落在项目对应的平台目录。
- artifact root 初始化只在解析后的 OpenSpec root 创建官方 `openspec/` 结构，不把平台工具目录嵌套到 `docs/`。
- docs 布局可以通过 `openspec init <project>/docs --tools none` 或等价的官方无工具初始化完成 root 创建。
- 工具资产需要 OpenSpec 生成时，在隔离 staging project 生成并通过现有 platform adapter 合并；不得在真实项目根留下临时 `openspec/`。
- update 分别更新平台工具资产和配置的 artifact root，不以项目根存在 `openspec/` 为前提。

## 路径消费者

以下能力必须使用布局 resolver，并在写入前执行双根/配置可写断言：

- Classic state、validate、guard、handoff、archive、resume probe、current selection 与 Hook Guard。
- Entry status、Ambient Resume 与 Hook Router 的 Classic change 枚举。
- Dashboard 的 active/archive 扫描、artifact preview 和 project root 计算。
- init、update、doctor、uninstall 与完成摘要。
- Workflow contract 的 Classic state、tasks、delta spec、Superpowers artifact 路径。
- Comet-owned 中英文 Skill、reference、Rule 与生成的 Classic / Entry runtime。

Dashboard 与 Entry 从显式项目根和解析后的 layout 构造 changes 目录，不通过名为 `openspec` 的祖先反推项目根。配置解析失败时返回结构化不可用状态，不回退到固定 legacy 路径。

Workflow contract 使用逻辑 path base 表达 Classic OpenSpec root 与 Superpowers root；协议不固化配置后的绝对路径，也不假设 root `openspec/changes`。

新写入的 project-relative artifact pointer 使用当前布局。读取历史 legacy archive 时，resolver 可以兼容旧前缀；兼容读取不得为了目录移动重写历史 handoff hash、Run、checkpoint、trajectory 或已归档证据。

## 事务化迁移

Classic 提供：

```text
comet classic root move docs --dry-run
comet classic root move docs --apply
```

`--dry-run` 是只读操作，输出：

- source、target 与 staging 的项目相对身份；
- 文件数、总字节、逐文件集合摘要与内容 hash；
- 当前配置 hash、计划中的配置变化与内部迁移身份；
- 冲突与 pending/recovery 状态；冲突和阻塞原因各自逐行输出；
- 不会重写的历史 evidence / pointer 清单；
- apply 的前置条件和允许的恢复策略。

`--dry-run` 明确说明不会修改文件，并提示用户运行 `--apply`。`--apply` 本身即为迁移授权；
Runtime 在内部生成计划身份、取得独占锁并在锁内重新预检，不接受用户传入的
`--plan <id>`。迁移命令按项目配置的 `classic.language` 输出中文或英文。

Apply 迁移完整的 legacy `openspec/` 树，包括 active、unmanaged、尚未完成归档或带有恢复状态的 change。迁移只要求：

- docs 目标不存在或为空且由本次事务拥有；
- 源树只有受支持的普通文件与目录，不含 symlink、junction 或其他特殊对象；
- 源、目标、staging 和 `.comet/config.yaml` 均在项目边界内且身份稳定；
- dry-run 后文件集合、大小、内容 hash、配置 hash 与 layout 没有变化。

Apply 使用 staging、内容校验和有界 journal。Journal 中的 source、target、staging、config path、transaction id、plan hash 与阶段必须按项目根和固定布局规则重新推导并逐项校验；来自持久化 journal 的路径不得直接传给 rename、remove 或递归文件系统 API。

完成并复核文件移动后，最后原子写入 `classic.artifact_layout: docs`。配置切换前可以 rollback；切换后只有在验证新旧树状态满足事务契约时才清理旧树。任何配置、树身份或文件内容漂移都保留所有可恢复对象并失败关闭。

迁移中断时，普通写命令失败关闭。只读 doctor 报告 transaction id、阶段、source、target、staging 和允许的 `continue | rollback` 策略；显式 doctor repair 必须执行调用方选定且当前阶段允许的策略，不默认替用户选择。无法证明树身份、hash、配置或 journal 一致时保留所有文件并停止。

迁移不把 `.comet/current-change.json` 改成路径；selection 继续只保存 `workflow + change`，因此 active change 在配置切换后自然解析到新根目录。

## Doctor 与卸载

Doctor 检查：

- layout 枚举、配置与启用 workflows 的一致性；
- OpenSpec root 健康状态；
- legacy/docs 双根冲突；
- 未完成迁移 journal 及其完整身份；
- platform tool 资产与 artifact root 是否错误耦合。

Doctor 不自动移动用户产物。只有显式 repair 可以继续或回滚可证明安全的迁移事务。

Uninstall 只删除 Comet 管理且为空的真实目录。任意 specs、changes、archive、Superpowers 文档、未知文件、symlink、junction 或其他特殊对象存在时保留对象并报告；不得跟随链接、递归删除用户产物或用特殊对象目标的“空”状态决定删除。

## Eval 与兼容

- `039-release`、`040-beta` 等冻结 benchmark 保持不变。
- 当前 Classic treatment / fixture 显式选择 layout，validator 根据该 layout 断言路径。
- legacy 与 docs 两种布局都覆盖真实完整 Classic 生命周期，而不是只验证 treatment loader 或 fixture 可被读取。
- 新 docs-layout 覆盖不能通过修改冻结 baseline 获得通过。

## 验收完整性

最终验证必须把 Issue #173 最新方案中的每个 MUST 映射到实现和测试证据。至少覆盖配置、resolver、init/update、adapter、state/resume/guard/handoff/archive、Entry、Dashboard、workflow contract、Skill/Rule/reference、迁移 dry-run/apply/continue/rollback、doctor/uninstall、Windows/POSIX、生成 runtime 与 live Eval。

发现未解决的路径穿越、项目外访问、递归删除风险、P0/P1、固定物理根消费者或未覆盖 MUST 时，不得把能力声明为完成。

## 非目标

- 不支持任意组合的 OpenSpec / Superpowers 自定义根。
- 不使用 OpenSpec store registry 作为项目内目录重定位。
- 不修改外部 OpenSpec / Superpowers 原始 Skill。
- 不合并 Native 与 Classic。
- 首版不迁移 active change。
