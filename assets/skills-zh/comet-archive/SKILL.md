---
name: comet-archive
description: "仅在用户明确调用 /comet-archive，或由 Comet 根 Skill/runtime 路由到 archive 阶段时使用；确认归档、合并 delta spec 并完成分支收尾。"
---

# Comet 阶段 5：归档（Archive）

## 前置条件

- 验证已通过（阶段 4 完成）
- 归档提交和分支处理尚未完成（`branch_status: pending`）
- `openspec/changes/<name>/.comet.yaml` 中 `verify_result: pass`

## 步骤

### 0. 输出语言约束

归档摘要和生命周期闭环说明必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言。

### 0b. 入口状态验证（Entry Check）

按 `comet/reference/scripts.md` 使用稳定 `comet` CLI，然后执行入口验证；从任意入口恢复时先按 `comet/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <name> archive
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

### 1. 归档前最终确认（阻塞点）

入口验证通过后，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户确认是否立即归档**。不得在用户确认前运行 `comet archive "<change-name>"`。

确认前必须向用户展示简短摘要：
- change 名称
- 验证报告路径和结论
- 当前分支/工作区和未提交改动归因摘要
- 本次归档将执行的不可逆动作：按 OpenSpec delta 语义合并主 spec、标注 design doc / plan、移动 change 到 archive 目录

用户确认问题必须以单选题形式呈现，包含以下选项：
- 「确认归档」— 写入最终确认状态后执行归档脚本，完成 spec 合并和 change 移动
- 「需要调整或重新验证」— 不执行归档；运行 `comet state transition <change-name> archive-reopen` 回到 `phase: verify`，再调用 `/comet-verify`。若验证阶段确认需要修复，再按 `/comet-verify` 的验证失败决策回到 `/comet-build`
- 「暂不归档」— 不执行归档，保留当前 `phase: archive` 状态，等待用户稍后再次调用 `/comet-archive`

用户选择「确认归档」后，立即执行：

```bash
comet state transition <change-name> archive-confirm
```

如 transition 返回非零退出码，报告错误并停止。只有 transition 成功后，才允许继续 Step 2。用户选择「需要调整或重新验证」后，必须先执行 `archive-reopen` 状态回退，不得手动编辑 `.comet.yaml`。

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
- change 目录从 `openspec/changes/<name>/` 移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`
- 主 spec 按 delta 语义合并的内容
- design doc / plan 的归档元数据标注

归档后先读取 `git status --short`，并以归档前的 dirty-worktree 归因记录为基线。只允许暂存可归因于当前 change 的路径：原 active change 路径、脚本输出的实际 archive 路径、被本次 delta 更新的 main specs，以及当前 Design Doc/Plan 的归档元数据。存在无法归因的路径时停止并请求用户处理。

使用显式 pathspec 暂存核对后的路径，再检查 staged diff；不得使用全仓库暂存，也不得把用户已有改动混入归档提交：

```bash
git add -- <逐项核对后的归档路径...>
git diff --cached --stat
git commit -m "chore: archive <change-name>"
```

提交失败或 staged diff 含无关路径时停止，不得继续分支处理。

### 5. 归档提交后的分支处理

归档提交成功后，**立即执行：** 使用 Skill 工具加载 Superpowers `finishing-a-development-branch` 技能。该步骤必须位于归档与归档提交之后，确保最终分支/PR 包含 spec 合并和归档元数据。

如该技能不可用，停止流程并提示安装或启用；不得把 `branch_status` 标记为完成。技能加载后，按 `comet/reference/decision-point.md` 暂停让用户选择：

1. 本地合并到主分支
2. 推送并创建 PR
3. 保持当前分支稍后处理

归档已经完成，因此这里不提供“丢弃工作”选项。只有用户选择的操作成功完成（或明确选择保持分支）后，才运行：

```bash
comet state set <change-name> branch_status handled
comet guard <change-name> archive
comet state clear-selection
```

archive guard 必须同时确认归档产物完整且 `branch_status: handled`；失败时流程仍未完成。

## 退出条件

- 归档脚本执行成功（退出码 0）
- 归档目录 `openspec/changes/archive/YYYY-MM-DD-<change-name>/` 存在
- 归档后的 `.comet.yaml` 中 `archived: true`
- 归档改动已通过精确 pathspec 提交
- 用户选择的分支处理已完成，归档状态中的 `branch_status: handled`
- `comet guard <change-name> archive` 通过

归档脚本会把 `openspec/changes/<name>/` 移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`。

`comet guard <change-name> archive` 会按原 change 名解析实际归档目录；不要手工拼接日期目录名。

## 完成

Comet 流程全部完成。如需开始新工作，调用 `/comet` 或 `/comet-open`。

## 上下文压缩恢复

按 `comet/reference/context-recovery.md` 执行，phase 参数为 `archive`。若 `archived: true` 且归档目录存在，归档已完成，无需再次执行归档操作。
