# Native 产物参考

只在需要编辑 brief、完整目标规格、verification 或验收证据时读取本文件。

## 产物边界

Agent 主要编辑：

```text
<artifact-root>/comet/changes/<change-name>/
  brief.md
  specs/<capability>/spec.md
  verification.md
```

项目配置、当前 change、change 状态和 `runtime/workspace.json` 用于读取，不要手工改变 Runtime 管理的 phase、确认、规格操作、workspace 绑定、scope、evidence、checkpoint、锁或事务字段。

新建 change 的 `comet.native.workspace.v3` 记录 `isolation`、`changeBranch`、`targetBranch`、Archive 前由 `--finish` 持久化的收尾决定和物理目录身份。它用于跨会话恢复和写入保护，不是会话 lease；旧 v1/v2 元数据保持兼容，不得为了启用隔离而手工迁移。

Native artifact root 只由 `.comet/config.yaml` 指定。不要扫描其他 workflow 的目录，也不要自行创建第二个状态根。

## Scope 快照边界

Git 快照包含 tracked 和未被 ignore 的 untracked 文件，submodule/gitlink 作为原子条目。非 Git 项目使用有界物理树快照。

- `git-selection-changed`：等待 Git 写入稳定后重试，不能授权为 partial scope。
- `physical-selection-changed` 或 `physical-enumeration-limit`：等待文件系统稳定或缩小项目树后重试，不能授权为 partial scope。
- scope 明细超出预算时，Runtime 用 `scope-detail-overflow` 的数量与内容 hash 汇总，而不是猜测遗漏路径。不要手改证据或把不完整快照视为完整。

## 项目配置

与 Agent 行为直接相关的配置：

```yaml
native:
  artifact_root: docs
  language: zh-CN
  clarification_mode: sequential
  archive_confirmation: automatic
  max_verify_failures: 5
```

- `clarification_mode`：`sequential` 或 `batch`。
- `archive_confirmation`：`automatic` 或 `required`。
- `max_verify_failures`：同一份已确认 contract 允许提交的 Verify fail 总数。

字段缺失时分别使用 `sequential`、`automatic` 和 `5`。配置改变不会让旧证据继续有效，也不会自动清除已有阻塞项。

## Brief

`brief.md` 使用以下一级标题：

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

Outcome、Scope、Non-goals 和 Acceptance examples 必须有实质内容。

Open questions 中的阻塞项使用固定格式：

```text
- [blocking] <Sequential 当前问题>
- [blocking] Q1: <问题>
- [blocking] CONFIRM: <最终共享理解>
```

未回答或不明确的问题继续保留。用户确认后，把决定写入 Decisions 和完整目标规格，再移除对应阻塞项。不要保存隐藏推理。

## 完整目标规格

规格写在：

```text
changes/<change-name>/specs/<capability>/spec.md
```

它描述归档后 capability 应有的完整行为，不是相对旧文本的增量 patch。

- 新 capability：创建完整规格。
- 已有 capability：写出替换后的完整规格。
- 删除 capability：运行 `comet native spec remove`，不要只删除文件。

Runtime 负责记录 create、replace、remove 和 canonical 基线。发生 canonical 冲突时，先重读并改写完整目标规格，再使用 `spec rebase`；不要手改 Runtime 状态或 hash。

## Verification

`verification.md` 使用以下非空一级标题：

```text
# Acceptance evidence
# Commands and results
# Skipped checks
# Spec consistency
# Known limitations and risks
# Conclusion
```

记录真实命令、结果和可复核事实。未运行的检查放在 Skipped checks；失败结果不能写成 pass。

## Acceptance evidence

使用 Runtime 返回的 acceptance ID，不要自行计算。先准备条目数组，再运行：

```text
comet native evidence format [--entries <path>]
```

把命令输出原样放入 `# Acceptance evidence`。输入条目的基本形式：

```json
[
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "passed",
    "evidence_refs": ["runtime/evidence/receipts/<sha256>.json"]
  },
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "failed",
    "evidence_refs": [],
    "skipped_reason": "实际失败或未完成原因"
  }
]
```

- `passed` 引用当前有效的 typed receipt。
- `failed` 说明真实失败或跳过原因。

不要手工排版机器块，不要复用旧 change 的 evidence ref，也不要把失败、跳过或阻塞结果写成通过。
