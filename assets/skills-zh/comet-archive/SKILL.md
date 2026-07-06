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

归档摘要和生命周期闭环说明必须使用 `"$COMET_BASH" "$COMET_STATE" get <name> language` 读取到的 Comet 配置产物语言。

### 0b. 入口状态验证（Entry Check）

按 `comet/reference/scripts.md` 定位脚本（定位 `comet-env.mjs`），然后执行入口验证；从任意入口恢复时先按 `comet/reference/context-recovery.md` 运行恢复检查：

```bash
node "$COMET_STATE" check <name> archive
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

### 1. 归档前最终确认（阻塞点）

入口验证通过后，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户确认是否立即归档**。不得在用户确认前运行 `node "$COMET_ARCHIVE" "<change-name>"`。

确认前必须向用户展示简短摘要：
- change 名称
- 验证报告路径和结论
- 分支处理状态
- 本次归档将执行的不可逆动作：按 OpenSpec delta 语义合并主 spec、标注 design doc / plan、移动 change 到 archive 目录

用户确认问题必须以单选题形式呈现，包含以下选项：
- 「确认归档」— 立即执行归档脚本，完成 spec 合并和 change 移动
- 「需要调整或重新验证」— 不执行归档；运行 `node "$COMET_STATE" transition <change-name> archive-reopen` 回到 `phase: verify`，再调用 `/comet-verify`。若验证阶段确认需要修复，再按 `/comet-verify` 的验证失败决策回到 `/comet-build`
- 「暂不归档」— 不执行归档，保留当前 `phase: archive` 状态，等待用户稍后再次调用 `/comet-archive`

只有用户选择「确认归档」后，才允许继续 Step 2。用户选择「需要调整或重新验证」后，必须先执行 `archive-reopen` 状态回退，不得手动编辑 `.comet.yaml`。

### 2. 执行归档

运行归档脚本，自动完成以下全部步骤：

```bash
node "$COMET_ARCHIVE" "<change-name>"
```

脚本自动执行：
1. 入口状态验证（phase=archive, verify_result=pass, archived=false）
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

如分支处理（阶段 4）选择尚未合并到主分支，提交后按所选方式（合并 / PR / 保持分支）一并收尾。

## 退出条件

- 归档脚本执行成功（退出码 0）
- 归档目录 `openspec/changes/archive/YYYY-MM-DD-<change-name>/` 存在
- 归档后的 `.comet.yaml` 中 `archived: true`

归档脚本会把 `openspec/changes/<name>/` 移动到 `openspec/changes/archive/YYYY-MM-DD-<name>/`。

> **WARNING**: 归档成功后**不要再对原 change 名运行** `node "$COMET_GUARD" <change-name> archive`，因为原活跃目录已经不存在。误调会导致 guard 报错"change directory not found"。归档完整性以脚本退出码和归档目录状态为准。

## 完成

Comet 流程全部完成。如需开始新工作，调用 `/comet` 或 `/comet-open`。

## 上下文压缩恢复

按 `comet/reference/context-recovery.md` 执行，phase 参数为 `archive`。若 `archived: true` 且归档目录存在，归档已完成，无需再次执行归档操作。
