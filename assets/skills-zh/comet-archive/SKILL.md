---
name: comet-archive
description: "Use when Comet change 验证已通过，需要用户确认归档、合并 delta spec，或恢复 archive 阶段。"
---

# Comet 阶段 5：归档（Archive）

## 前置条件

- 验证已通过（阶段 4 完成）
- 分支已处理
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
- 分支处理状态
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

归档成功后清理当前执行上下文；该命令幂等：

```bash
comet state clear-selection
```
脚本摘要中的 `X/Y steps succeeded` 以真实执行步骤计数，不会因 delta spec 同步或文档标注重复累计。

脚本会调用 OpenSpec 归档能力按 `ADDED/MODIFIED/REMOVED/RENAMED` 语义合并主 spec，并在归档后校验主 spec 中没有残留 delta-only section 标题。

如需预览而不实际执行，使用 `--dry-run` 参数。

### 3. 生命周期闭环

Spec 生命周期在此完成：
```
brainstorming → delta spec → 实施 → 验证 → 主 spec 合并 → design doc 标注 → 归档
```

### 4. 提交归档改动

归档脚本只移动文件和合并 spec，不会自动提交。归档完成后工作区会有以下未提交改动：
- change 目录从 `openspec/changes/<name>/` 移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`
- 主 spec 按 delta 语义合并的内容
- design doc / plan 的归档元数据标注

**必须提示用户提交这些归档改动**，否则归档成果会停留在工作区。展示待提交文件后建议执行：

```bash
git add -A
git commit -m "chore: archive <change-name>"
```

提交归档 commit 后，读取 `isolation` 与 `branch_action`，按下列场景处理这个新 commit 是否需要推送：

- **场景 A — `branch_action: push`**（`current` 模式，验证阶段已 push 过当前分支）：验证阶段已授权 push 这条分支，archive commit 落在同一分支上，**直接执行 `git push`**（无需 `-u`，tracking 已存在），并告知用户"archive commit 已随之前的 push 一起同步到远端"。这是延续同一个已授权动作，不再二次确认。
- **场景 B — `branch_action: pushed-pr`**（`branch`/`worktree` 模式，之前选了"推送并创建 PR"）：PR 分支已 `push -u` 且有 tracking，archive commit 落在同一条分支上，性质同场景 A，**直接执行 `git push`**（无需 `-u`），告知用户"archive commit 已追加推送到 PR 分支 `<branch>`"。
- **场景 C — `branch_action: merged-locally`**（`branch`/`worktree` 模式，之前选了"本地合并到主分支"）：合并动作从未 push 过 base 分支，base 本地领先 `origin/<base>`（含合并内容与本次 archive commit）。**不自动 push**：按 `comet/reference/decision-point.md` 协议暂停，询问用户"base 分支本地已领先远端，是否现在一起 push"，由用户现场决定。不持久化这次决策。
- **场景 D — `branch_action: keep-local`**（`current` 或 `branch`/`worktree` 均可能）：不执行 push，只在回复里明确提示"archive commit 目前只在本地，尚未推送"，尊重用户"稍后自己处理"的原始选择。
- **兜底 — `branch_action` 为空**（升级前创建、未走过新版 verify 流程的存量 change）：退回散文提示，询问用户要不要 push；不因字段缺失报错或阻塞。

不要假设一定存在独立开发分支、合并动作或 PR 收尾——以 `isolation` 与 `branch_action` 的实际取值为准。

## 退出条件

- 归档脚本执行成功（退出码 0）
- 归档目录 `openspec/changes/archive/YYYY-MM-DD-<change-name>/` 存在
- 归档后的 `.comet.yaml` 中 `archived: true`

归档脚本会把 `openspec/changes/<name>/` 移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`。

> **WARNING**: 归档成功后**不要再对原 change 名运行** `comet guard <change-name> archive`，因为原活跃目录已经不存在。误调会导致 guard 报错"change directory not found"。归档完整性以脚本退出码和归档目录状态为准。

## 完成

Comet 流程全部完成。如需开始新工作，调用 `/comet` 或 `/comet-open`。

## 上下文压缩恢复

按 `comet/reference/context-recovery.md` 执行，phase 参数为 `archive`。若 `archived: true` 且归档目录存在，归档已完成，无需再次执行归档操作。
