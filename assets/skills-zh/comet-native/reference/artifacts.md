# Native 产物参考

## 目录

```text
<project>/comet.config.yaml
<artifact-root>/comet/
  specs/<capability>/spec.md
  changes/<change-name>/
    change.yaml
    brief.md
    specs/
    verification.md
    runtime/
  archive/YYYY-MM-DD-<change-name>/
  runtime/
    current-change.json
    locks/
    transactions/
```

`artifact-root` 由项目配置唯一指定。Native 不使用隐藏的 change 目录，也不从其他需求目录发现状态。

## 项目配置

```yaml
schema: comet.project.v1
default_workflow: native
native:
  artifact_root: docs
```

根目录迁移期间会出现 runtime 管理的 `pending_root_move`。存在该字段时普通写命令必须停止，不能自行选择旧根或新根。

## Change 状态

```yaml
schema: comet.native.v1
name: add-sentence-counting
language: zh-CN
phase: shape
brief: brief.md
approval: null
spec_changes:
  - capability: sentence-counting
    operation: create
    source: specs/sentence-counting/spec.md
    base_hash: null
verification_result: pending
verification_report: null
archived: false
created_at: 2026-07-14
run_id: null
```

不要直接编辑 runtime 管理字段。`approval`、`spec_changes`、operation 和 `base_hash` 由 runtime 管理。需要改变需求时只更新 brief 和 `specs/<capability>/spec.md`；删除 capability 使用 `comet native spec remove`，再由命令检查并推进。

## Brief

`brief.md` 固定使用八个一级标题：

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

前四节必须有实质内容。仍阻塞实现的问题在 Open questions 下以 `- [blocking]` 开头；普通备注不会阻塞 Shape。

## 完整目标规格

拟议规格固定写在 `changes/<change-name>/specs/<capability>/spec.md`，描述归档后 capability 应有的完整行为，不写只在旧文本上成立的增量片段。每个 capability 只能出现一次操作：

| operation | canonical 现状 | source | base_hash |
| --- | --- | --- | --- |
| `create` | 必须不存在 | 必填 | `null` |
| `replace` | 必须存在 | 必填 | 当前 canonical 文件 SHA-256 |
| `remove` | 必须存在 | 禁止 | 当前 canonical 文件 SHA-256 |

`next` 首次发现 proposed spec 时推断 create/replace 并冻结 hash；`spec remove` 为 remove 冻结 hash。归档在锁内重新计算 hash，实际值与 `base_hash` 不同表示并发变化，必须重新读取并改写完整目标规格，再用 `spec rebase` 受控刷新基线、回到 Build 并重新验证，不能覆盖或手改 hash。

## Verification

`verification.md` 固定使用六个非空一级标题：

```text
# Acceptance evidence
# Commands and results
# Skipped checks
# Spec consistency
# Known limitations and risks
# Conclusion
```

保存可复核事实，不保存隐藏推理文本。未运行的检查放在 Skipped checks，失败结果不能写成 pass。
