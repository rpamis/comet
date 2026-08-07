---
name: comet-archive
description: "Comet Classic 阶段 5 —— 确认归档、合并 delta spec 并完成分支收尾。"
disable-model-invocation: true
---

# Comet 阶段 5：归档（Archive）

开始或恢复前必须先读取并执行 `comet-classic/reference/classic-layout.md`；本文件中的 OpenSpec CLI 调用必须使用 adapter，文件路径必须使用该协议绑定的 `<classic-*>` 逻辑根。

## 前置条件

- 验证已通过（阶段 4 完成）
- 归档提交和分支处理尚未完成（`branch_status: pending`）
- `<classic-change-dir>/.comet.yaml` 中 `verify_result: pass`

## 步骤

### 0. 输出语言约束

归档摘要和生命周期闭环说明必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言。

### 0b. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用稳定 `comet` CLI，然后执行入口验证；从任意入口恢复时先按 `comet-classic/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <name> archive
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

### 1. 归档与交付前最终确认（阻塞点）

入口验证通过后，先读取 `comet state get <change-name> isolation`，再**按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户确认是否立即归档和远端交付**。不得在用户确认前运行 `comet state transition <change-name> archive-confirm` 或 `comet archive "<change-name>"`。

确认前必须向用户展示简短摘要：
- change 名称
- 验证报告路径和结论
- 当前分支/工作区和未提交改动归因摘要
- 本次归档将执行的不可逆动作：按 OpenSpec delta 语义合并主 spec、标注 design doc / plan、移动 change 到 archive 目录
- 归档完成后将执行的远端交付：只推送当前绑定分支，或推送后创建 PR

用户确认问题必须以单选题形式呈现，包含以下选项：
- 「确认归档并立即推送」— 完成归档、创建唯一归档提交并推送当前绑定分支
- 「确认归档、立即推送并创建 PR」— 完成归档、创建唯一归档提交、推送当前绑定分支并创建 PR
- 「需要调整或重新验证」— 不执行归档；运行 `comet state transition <change-name> archive-reopen` 回到 `phase: verify`，再调用 `/comet-verify`。若验证阶段确认需要修复，再按 `/comet-verify` 的验证失败决策回到 `/comet-build`
- 「暂不归档」— 不执行 `archive-confirm` 或归档命令，保留 active change、`phase: archive` 和 `branch_status: pending`，等待用户稍后再次调用 `/comet-archive`

只有用户选择前两个立即交付选项之一后，才记录其选择并立即执行：

```bash
comet state transition <change-name> archive-confirm
```

如 transition 返回非零退出码，报告错误并停止。只有 transition 成功后，才允许继续 Step 2。用户选择「需要调整或重新验证」后，必须先执行 `archive-reopen` 状态回退，不得手动编辑 `.comet.yaml`。用户选择「暂不归档」后直接停止，不得归档、提交、推送或把 `branch_status` 设为 `handled`。

### 2. 执行归档

运行归档脚本：

```bash
comet archive "<change-name>"
```

脚本自动执行：
1. 入口状态验证（phase=archive, verify_result=pass, archive_confirmation=confirmed, archived=false）
2. Design doc 前置元数据标注（archived-with, status）
3. Plan 前置元数据标注（archived-with）
4. 调用 OpenSpec archive 按 delta 语义合并主 spec 并移动 change 到归档目录
5. 校验主 spec 未残留 delta-only section 标题
6. 在 OpenSpec 实际归档目录中更新 archived 状态，并协调 pending recovery 元数据

如脚本返回非零退出码，报告错误并停止。
如脚本返回零退出码，归档完成。

脚本摘要中的 `X/Y steps succeeded` 以真实执行步骤计数，不会因 delta spec 同步或文档标注重复累计。

脚本会调用 OpenSpec 归档能力按 `ADDED/MODIFIED/REMOVED/RENAMED` 语义合并主 spec，并在归档后校验主 spec 中没有残留 delta-only section 标题。

如需预览而不实际执行，使用 `--dry-run` 参数。

### 3. 生命周期闭环

Spec 生命周期在此完成：
```
brainstorming → delta spec → 实施 → 验证 → 主 spec 合并 → design doc 标注 → 归档
```

### 4. 精确提交归档改动

归档脚本只移动文件和合并 spec，不会自动提交。归档完成后工作区会有以下未提交改动：
- change 目录从 `<classic-change-dir>/` 移动到 `<classic-archive-root>/YYYY-MM-DD-<name>/`
- 主 spec 按 delta 语义合并的内容
- design doc / plan 的归档元数据标注

先把已确认的交付方式持久化到归档状态，再运行最终 archive guard：

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
```

这里的 `handled` 只表示用户已经确认如何远端交付这次完整归档提交，不表示 push 或 PR 创建已经成功。状态写入或 guard 失败时停止，不得提交或执行远端操作。

归档后读取 `git status --short`，并以归档前的 dirty-worktree 归因记录为基线。只允许暂存可归因于当前 change 的路径：原 active change 路径、脚本输出的实际 archive 路径、归档目录中已更新为 `branch_status: handled` 的 `.comet.yaml`、被本次 delta 更新的 main specs，以及当前 Design Doc/Plan 的归档元数据。存在无法归因的路径时停止并请求用户处理。

使用显式 pathspec 暂存核对后的路径，再检查 staged diff；不得使用全仓库暂存，也不得把用户已有改动混入归档提交：

```bash
git add -- <逐项核对后的归档路径...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

提交失败或 staged diff 含无关路径时停止，不得继续分支处理。

### 5. 交付归档提交并完成

归档提交成功后，只执行 Step 1 中用户已经确认的远端交付方式：

- 「确认归档并立即推送」：推送当前绑定分支一次。
- 「确认归档、立即推送并创建 PR」：先推送当前绑定分支一次，再通过已配置的 GitHub 集成创建 PR；Step 1 的明确选择就是创建 PR 的授权，不得再次改成其他分支处置方式。

push 失败时报告错误，保留 current selection 记录，不得清除选择或宣告完成；当前任务中只重试同一个 push。PR 创建失败时分支已经包含完整归档提交，报告错误并保留 current selection 记录；当前任务中只重试创建 PR。不得在失败后自动切换、删除、变基或改写分支。

只有用户选择的远端交付操作全部成功后，才运行 `comet state clear-selection` 并宣告 Classic workflow 完成。

归档阶段不再调用 Superpowers `finishing-a-development-branch`。本地合并、保留分支稍后处理或暂不推送都不会立即形成远端最终状态，必须在 Step 1 选择「暂不归档」，不能在归档后再选择。

## 退出条件

- 归档脚本执行成功（退出码 0）
- 归档目录 `<classic-archive-root>/YYYY-MM-DD-<change-name>/` 存在
- 归档后的 `.comet.yaml` 中 `archived: true`
- 归档状态中的 `branch_status: handled` 已包含在唯一归档提交中
- `comet guard <change-name> archive` 通过
- 唯一归档提交已按用户在归档前确认的方式成功推送；若用户选择创建 PR，PR 已成功创建
- current selection 已在远端交付成功后清除

归档脚本会把 `<classic-change-dir>/` 移动到 `<classic-archive-root>/YYYY-MM-DD-<name>/`。

`comet guard <change-name> archive` 会按原 change 名解析实际归档目录；不要手工拼接日期目录名。

## 完成

Comet Classic 流程全部完成。如需开始新的 Classic 工作，调用 `/comet-classic` 或 `/comet-open`。

## 上下文压缩恢复

按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `archive`。若 `archived: true` 且归档目录存在，不得再次执行归档操作；只有当前任务的上下文已明确记录 Step 1 选择的远端交付方式时，才能重试同一个 push 或 PR 创建操作。本 Skill 不承诺用户脱离流程、自行改变分支拓扑后的自动恢复。
