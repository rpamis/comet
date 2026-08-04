# Native 命令参考

只在需要主 Skill 未列出的参数、receipt、partial scope 或恢复命令时读取本文件。

## 项目与 change

先判断当前意图；不要按本节顺序逐条执行。只读命令用于确认事实，写命令只在对应条件满足时执行。执行写命令后立即重读 `status <change-name>`，按返回的 phase 和 continuation 决定下一步。

### 首次启用 Native

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
```

只在项目尚未启用 Native，或需要补齐 Native 目录与语言配置时使用。它会创建所需目录并写入 `.comet/config.yaml`；已有配置会保留当前 artifact root，但可更新语言。`init` 不迁移已有 artifact root；显式 `--root` 与现有配置冲突时命令会失败。

完成后运行 `root show` 确认实际位置。不要在已经存在 change 时把 `init` 当作恢复命令。

### 查看或迁移 artifact root

```text
comet native root show
comet native root move <artifact-root>
```

`artifact-root` 是项目内相对路径。

- `root show` 是只读命令，返回项目根、配置的 artifact root、实际 Native 目录、语言和未完成迁移。
- `root move` 是事务性写操作，只在用户明确要迁移整个 Native artifact root 时执行；它会移动 Native 数据并更新配置。不要直接编辑配置模拟迁移。

迁移未完成时，其他 Native 写操作会被阻塞。先运行只读 `doctor`，再按报告使用 `doctor --repair` 恢复。

### 发现并读取 change（只读）

```text
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native show <change-name>
```

无 change 名称的 `status` 返回分页候选。存在多个合理候选时，把候选及 phase 展示给用户选择，不要猜测。

- `status <change-name>` 返回 phase、revision、检查摘要、下一条命令和 continuation；需要 findings、checkpoint 细节或 acceptance 时加 `--details`。
- `show` 返回 state、brief 和 proposed specs；只在已经确定目标 change 后使用它读取需求与规格，不用它代替 phase/continuation 检查。
- `findingsTruncated` 为 true 时，先处理已返回项，再重新读取。
- `acceptancePage.nextCursor` 非空时，用 `--acceptance-cursor` 继续读取。
- change 集合的 `nextCursor` 非空时，用 `--cursor` 继续读取。

这些命令都不修改当前 change、phase 或 change 内容。

### 恢复已有 change

```text
comet native select <change-name>
```

只在目标 change 已唯一确定或由用户明确选择后执行。`select` 只更新当前 Native change，不改变 phase；成功结果会返回该 change 的 continuation。

选择后重新读取 `status <change-name>`，确认 phase，再加载该 phase 对应的 reference。不要把 `select` 当作阶段推进命令。

### 创建新 change

```text
comet native new <change-name> [--language en|zh-CN] \
  [--isolation current|branch|worktree] \
  [--change-branch <branch>] \
  [--target-branch <branch>]
```

只有扫描当前仓库已登记工作目录并确认没有对应 active change 时才运行 `new`。配置缺失时，它会创建默认 Native 配置与 `docs/comet/`；随后创建一个 Shape change、把它设为当前 change，并返回 continuation 和 workspace 绑定。

`--isolation` 缺省为 `current`。`branch` 和 `worktree` 要求 Agent 先创建/切换实际分支或 worktree，并明确传入创建时所在的 `--target-branch`；Runtime 会核对 `--change-branch` 与当前分支。`worktree` 只能在 linked Git worktree 中创建。新 change 的 workspace 绑定会记录工作方式、change 分支、目标分支和物理工作目录身份，后续写入必须保持一致。

退出码 `73` 且 `error.code: workspace-isolation-required` 表示同一个工作目录已在本次 mutation lock 中发现其他 active change。只有原方式是系统默认 `current` 时才自动改用新 worktree；若用户明确选择的方式失效，重新确认。

创建后立即运行 `show <change-name>` 与 `status <change-name>`，然后进入 Shape 澄清与共享理解确认。不要创建新 change 来绕过旧 change 的阻塞、冲突或恢复问题。

### 修正规格轨迹

```text
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
```

这两条都不是普通文件编辑命令。`spec remove` 把 capability 记录为待移除的规格操作；只在目标行为确实要求移除该 capability 时使用。`spec rebase` 只处理 canonical 规格发生并发变化的情况：先重读 canonical 规格并改写完整目标规格，再用摘要记录 rebase 原因。

`spec remove` 和 `spec rebase` 都会修改 change 的规格轨迹并返回新的 continuation。执行后立即重读 `status <change-name>`；不要手改 operation、base hash 或 Runtime 状态。

## Checkpoint 与检查

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
comet native evidence format [--entries <path>]
```

checkpoint 只保存恢复摘要和真实产物引用，不改变 phase，也不能代替完成证据。

`check` 是 Native 内置检查，不替代项目测试。发现问题或证据失效时返回退出码 `1`。

`evidence format` 从 stdin 或 `--entries` 读取验收条目，输出可原样粘贴到 `verification.md` 的规范机器块。

提交 `pass` 时，Runtime 会先校验报告格式、完整验收矩阵和 acceptance receipt；只有校验通过后才执行或复用当前 scope 的内置 required check。报告校验失败时先按错误信息修正 `verification.md`，不要重复提交同一个 `next`。`next` 不接受 `--receipt`，也不需要调用方传入 required-check receipt。

## Acceptance receipt

自动验证：

```text
comet native receipt automated <change-name> \
  [--acceptance <id>]... \
  [--timeout-ms <milliseconds>] \
  -- <executable> [args...]
```

人工观察：

```text
comet native receipt manual <change-name> \
  --acceptance <id>... \
  --step <text> \
  --observation <text>
```

只为真实执行的命令或人工观察生成 receipt。失败、跳过、阻塞或超时结果不能作为 pass。

批量刷新过期 receipt：

```text
comet native receipt refresh <change-name> [--apply]
```

receipt 绑定生成时的 revision、contract、scope、snapshot 与 artifact。任何一次状态写入（checkpoint、规格刷新、阶段推进）都会让 revision 递增，导致此前签发的 receipt 绑定过期。`next --result` 会因此报 `verification-receipt-binding-mismatch` 并列出每个过期 receipt 及其不一致字段。

不带 `--apply`（默认）为预览：只报告哪些 manual receipt 过期、哪些 automated receipt 需重跑、哪些 required-check receipt 需用 `comet native check` 重生成，不改动任何文件。

带 `--apply` 时：只对绑定不一致仅限于 `sourceRevision` 的过期 manual receipt 按当前 revision 重新签发，并把规范证据块写回 verification.md 的 `# Acceptance evidence` 段；contract、scope、snapshot 或 artifact 不一致仍会阻塞并要求重新人工验证。automated receipt 不会被静默重签（它证明一次真实命令执行），refresh 只报告需重跑的命令让你用 `receipt automated` 重新执行。

## 阶段推进

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run [--finish merge|push|pull-request|keep]
comet native archive <change-name> --expect-preflight <sha256> [--confirmed]
```

- Shape：只有用户确认最终共享理解后才传 `--confirmed`。
- Build：提供真实 `--artifact`；确实没有项目文件变化时使用 `--no-code-reason`。如果需求变化引入新的用户决定，先保持在 Build 并重新完成澄清与确认；确认后更新正式产物，再执行 Runtime 返回的 transition 命令并传入 `--confirmed`。
- Partial scope：先向用户说明 Runtime 返回的具体缺口和风险。超出已返回明细预算的变化由 `scope-detail-overflow` 数量和内容 hash 汇总；只有用户接受后才使用完全匹配的 scope hash、理由和 `--confirmed`。
- Verify：提供 `--result` 和完整报告。标准报告路径提交为 `comet native next <change-name> --summary <摘要> --result pass|fail --report verification.md`。Runtime 先校验报告格式、完整验收矩阵和 acceptance receipt，再在 pass 时执行或复用当前 scope 的内置 required check；不要传入 `--receipt`。报告中的 acceptance 条目直接引用 automated/manual receipt。已执行但失败的条目引用对应失败 receipt，未执行的条目写明 `skipped_reason`。repair 的失败 acceptance 和检查标识由 Runtime 从报告与 receipt 自动推导。
- Repair override：只使用 status 返回的 signature，并且只在有一个明确新修复假设时执行。
- Archive：current 直接 dry-run；branch/worktree 在用户完成联合收尾选择后，用 `--finish` 把选择持久化并生成新的 preflight。后续使用本次预演返回的精确 preflight hash；`required` 模式还需要用户明确确认。不得把 `--finish` 与 `--expect-preflight` 同时传入。

## 诊断与恢复

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

先运行只读 doctor。只有报告给出可修复动作时才使用 `--repair`。普通阶段 transition 只支持 `continue`；Archive 或 root move 是否允许 rollback 以 doctor 返回为准。

## 输出与退出码

所有命令支持 `--json`。JSON 模式返回一个包含 `command`、`exitCode`、`data`，以及失败时 `error` 的对象。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 内置检查发现问题或结果失效 |
| `64` | 参数或用法错误 |
| `65` | 配置、状态或产物无效 |
| `73` | 锁、事务、并发或根目录冲突 |
| `75` | repair stagnation 或失败预算阻塞继续 |
| `70` | 未预期的内部失败 |
