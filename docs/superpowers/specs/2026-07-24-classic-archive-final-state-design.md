# Classic 归档最终状态持久化设计

## 背景

Issue #237 指出 Classic workflow 的归档顺序会在归档提交和推送完成后，才把归档目录中 `.comet.yaml` 的 `branch_status` 从 `pending` 改为 `handled`。这次状态修改没有进入后续提交，因此正常完成的流程会留下一个未提交文件，远端归档状态也永久停留在 `pending`。

当前 `branch_status` 同时被用于描述分支处理状态和满足 archive guard。实际流程只需要它证明用户已经确定如何交付归档提交；推送或 PR 创建是否成功仍应由对应 Git 操作的结果决定。

## 目标

- 完整归档只产生一个归档提交和一次推送。
- 归档提交中的 `.comet.yaml` 包含 `branch_status: handled`。
- 推送成功后的本地工作区保持干净。
- 推送或 PR 创建失败时保留 current selection 记录，也不宣告流程完成。
- 不新增 Runtime 状态、恢复命令或 `.comet.yaml` 字段。
- 中英文 Classic Skill 和字段说明保持一致。

## 非目标

- 不支持用户在归档过程中脱离 Comet，自行切换、删除、变基或改写分支后的自动恢复。
- 不新增归档后远端操作失败的 `/comet` 自动恢复能力；失败后的重试限于当前任务中重复同一 Git 操作。
- 不为已发布版本中残留的 `branch_status: pending` 归档提供迁移命令。
- 不修改 Native workflow。
- 不让 archive guard 负责验证远端分支或 PR 状态。

## 状态语义

`branch_status: handled` 表示：

> 用户已经确认当前归档提交的交付方式，归档产物可以作为一个完整提交交付。

它不表示远端推送或 PR 创建已经成功。远端操作成功是清除 current selection 和宣告 workflow 完成的前置条件，由 Skill 按 Git 命令结果判断。

为避免“确认暂不推送”产生只有本地存在的最终状态，暂不交付必须在执行归档前停止。此时 change 保持 active，`branch_status` 保持 `pending`。

## 流程

### 1. 归档前确认交付

在不可逆归档确认中同时确定是否立即交付：

- **立即推送**：确认后继续归档。
- **立即推送并创建 PR**：确认后继续归档。
- **暂不处理**：包括保留本地分支或仅本地合并等不立即形成远端最终状态的选择；不执行 `archive-confirm` 和 `comet archive`，保留 active change，稍后重新进入 `/comet-archive`。

只有前两种选择能进入后续步骤。

### 2. 执行归档并写入最终仓库状态

执行现有归档命令，确认归档产物完整后运行：

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
```

guard 失败时停止，不创建归档提交。

### 3. 创建唯一归档提交

按现有 dirty-worktree 归因规则，只暂存：

- 原 active change 路径及实际 archive 路径；
- 本次 delta 更新的 main specs；
- 当前 Design Doc 和 Plan 的归档元数据；
- 归档目录中已更新为 `branch_status: handled` 的 `.comet.yaml`。

检查 staged diff 后创建：

```bash
git commit -m "chore: archive <change-name>"
```

提交失败时停止，不执行远端操作。

### 4. 交付并完成

- “立即推送”执行一次 push。
- “立即推送并创建 PR”先执行一次 push，再创建 PR。
- 任一操作失败时保留 current selection 记录，不输出完成结论；当前任务可直接重试失败的 Git 操作。
- 所有选定操作成功后运行 `comet state clear-selection`，然后宣告归档完成。

## 失败处理

- **归档命令失败**：状态仍由现有 archive recovery 处理，不提交、不推送。
- **状态写入或 guard 失败**：保留归档工作区，修复失败原因后重新执行对应步骤。
- **归档提交失败**：保留 staged 或工作区状态，不推送。
- **推送失败**：归档提交已经完整且工作区干净；保留 current selection 记录，并在当前任务中提示用户重试同一 push。
- **PR 创建失败**：分支已经包含完整归档提交；保留 current selection 记录，并在当前任务中提示重试创建 PR。

本设计不承诺失败后通过新的 `/comet` 调用自动恢复，也不增加跨分支自动恢复。检测到当前分支与 change 绑定不一致时，继续使用现有 fail-closed 行为。

## 修改范围

- `assets/skills-zh/comet-archive/SKILL.md`
- `assets/skills/comet-archive/SKILL.md`
- `assets/skills-zh/comet/reference/comet-yaml-fields.md`
- `assets/skills/comet/reference/comet-yaml-fields.md`
- 相关 `test/domains/skill/` 契约测试

不修改 `domains/comet-classic/` Runtime 源码，因此不需要重新生成 `comet-runtime.mjs`。

## 测试

契约测试必须同时验证中英文内容：

- 分支交付选择发生在 `archive-confirm` 和 `comet archive` 之前。
- “暂不处理”明确保持 active change，不进入归档。
- `branch_status handled` 和 archive guard 位于归档提交之前。
- 唯一归档提交包含最终 `.comet.yaml`。
- push 和 PR 创建位于归档提交之后。
- `clear-selection` 只位于远端操作成功路径。
- 文档不再把 `handled` 描述为远端操作已经成功。

验证命令按 Skill 内容修改范围执行：

```bash
npx vitest run test/domains/skill/workflow-optimization-contract.test.ts test/domains/skill/skills.test.ts
npx prettier --check assets/skills-zh/comet-archive/SKILL.md assets/skills/comet-archive/SKILL.md assets/skills-zh/comet/reference/comet-yaml-fields.md assets/skills/comet/reference/comet-yaml-fields.md test/domains/skill/workflow-optimization-contract.test.ts test/domains/skill/skills.test.ts
```

本次实现不修改 Runtime；除非实施过程中扩大到源码或生成物，否则不要求本地全量测试或 build。

## 发布说明

该修复会改变用户可见的 Classic 归档行为，应在实现完成并同步中英文 Skill 后，追加到当前高于 `origin/master` 的 `0.4.0-beta.9` Changelog `Fixed` 分组。`package.json` 已是 `0.4.0-beta.9`，不新增版本。
