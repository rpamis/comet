# Native 产物参考

只在编辑 brief、完整目标规格，或查看 Runtime 生成的验收报告时读取。

## 编辑边界

每个 active change 目录只保留用户可读、可随 Git 同步的正式产物：

```text
<artifact-root>/comet/changes/<change-name>/
  comet-state.yaml
  brief.md
  children.yaml
  specs/<capability>/spec.md
  verification.md
```

Agent 只编辑 brief、完整目标规格和 Supervisor Change 的 `children.yaml`。`comet-state.yaml` 与 `verification.md` 由 Runtime 管理；Runtime 第一次接受 Verifier 结果后生成报告。

本机 Runtime 固定保存在被 Git 忽略的 `.comet/runtime/native/`。每个 active change 的本机状态和日志位于 `changes/<change-name>/state.json` 与 `logs/`；项目级锁和短期事务也放在这个 Runtime 目录中。这些机器文件始终交给 Runtime 创建、迁移和修复。

## 跨设备状态与报告

`comet-state.yaml` 是跨设备恢复时唯一可信的工作流状态，记录当前阶段、状态、版本、验收循环次数、验收结果、Builder 交接摘要、阻塞原因、下一步、检查摘要和精简历史。本机进程、绝对路径和完整命令输出只保留在本机 Runtime 中。该文件由 Runtime 更新。

`verification.md` 是 Runtime 根据同一版本的 YAML 生成的可读验收报告。报告缺失或版本落后时，Runtime 只重建报告，不会因此重新运行检查或 Verifier。工作流进度始终以 YAML 为准，不能通过修改 Markdown 报告来推进。

`.comet/config.yaml` 决定使用哪种工作流，以及 change 产物保存在哪个目录。使用非默认产物目录并需要跨设备恢复时，应同步该文件；其余 `.comet/*` 只保留在本机。

## Brief

`brief.md` 是 Native 的持久化澄清产物，使用以下非空一级标题：

```text
# Outcome
# Scope
# Non-goals
# Acceptance examples
# Constraints and invariants
# Decisions
# Open questions
# Verification expectations
```

Open questions 中只有真实未解决的用户问题使用：

```text
- [blocking] <Sequential 当前问题>
- [blocking] Q1: <Batch 问题>
- [blocking] CONFIRM: <最终共享理解>
```

每个决定确认后立即写入 Decisions 和完整目标规格，再移除对应阻塞项。正式产物只记录结论和理由，不记录模型的隐藏推理过程。`brief.md` 是 Native 的持久化澄清产物；用户直接提供文件、附件、链接或本地路径作为需求来源时，在 `brief.md` 的 `# Scope` 下建立 `## Source coverage` 作为唯一来源覆盖映射，完整目标 Spec 不重复来源表，只完整表达所有当前有效可执行语义。

验收标准必须具体、可观察且互不重复。使用简单顺序 ID，例如 `A1`、`A2`、`A3`；ID 只用于结果映射，不从内容计算，也不代表文件身份。Runtime 在 Shape 确认时保存完整验收文字及其来源。直接来源覆盖映射为每个单元记录来源定位、`complete`/`partial`/`unavailable` 读取状态、保留语义、对应的 Spec 位置、对应的验收 ID、`covered`/`needs-clarification`/`background`/`non-goal`/`superseded` 覆盖状态以及理由或替代关系；当前有效可执行单元必须同时具有 Spec 位置和验收 ID，背景、非目标和已废止来源单元不要求 Spec 位置或验收 ID；验收条件至少覆盖原始来源的全部当前有效可执行语义，`partial`、`unavailable`、未覆盖内容或缺少双重映射的可执行单元保持阻塞。Supervisor Change 的新 `children.yaml` 使用 `comet.native.children.v2`：`acceptance_index` 为 brief 派生的父级验收 ID 保存 `source` 和完整 `text`，每个 child 仍只包含 `name`、`depends_on` 和 `covers`，且 `covers` 必须覆盖索引中的全部 ID。Spec 派生验收仍保留在 Runtime 完整验收矩阵中；只有修复阶段才把实际失败的 Spec ID 连同来源和文字补入索引。名称必须唯一，依赖必须存在且无环。历史 `comet.native.children.v1` 继续接受其原有的完整验收覆盖格式；修改后 Supervisor Change 返回 Shape。

## 完整目标规格

每个 `specs/<capability>/spec.md` 描述归档后 capability 的完整行为，而不是只写相对旧文本的变化：

- 新 capability：写完整规格；
- 已有 capability：写修改后的完整规格；
- 删除 capability：使用 CLI 的 `spec remove`，不只删除文件。

如果项目中已经归档的正式 Spec 与当前 change 发生冲突，先重读最新 Spec，再按用户意图改写当前 change 的完整目标规格，最后执行 Runtime 返回的重新对齐（rebase）动作。Spec 操作类型和工作流状态仍由 Runtime 管理。

## Verification

报告展示每个验收项的结果和原因、实际检查的脱敏命令预览与状态、阻塞项、风险以及精简的验收循环历史。完整命令输出只保留在本机日志中。

验收结论由 Runtime 根据 YAML 生成。失败、阻塞、未运行或超时的项目保持原状态；只有当前候选的全部验收项都有结论，并且必要检查成功，最终结果才是通过。
