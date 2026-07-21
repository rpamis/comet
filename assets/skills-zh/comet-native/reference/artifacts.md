# Native 产物参考

## 目录

```text
<project>/.comet/config.yaml
<project>/.comet/current-change.json       # Native/Classic 共享的当前需求归属
<artifact-root>/comet/
  specs/<capability>/spec.md
  changes/<change-name>/
    comet-state.yaml
    brief.md
    specs/
    verification.md
    runtime/
      baseline-manifest.json
      workspace.json                 # process-free 物理 root 身份；只作提示
      run-state.json                 # 通过 Native Protected Run I/O 读写
      trajectory.jsonl               # 有事件数、单事件和总字节预算
      pending-action.json            # 可选；仅在 Run 有待处理动作时存在
      context.md                     # 可选；Run context ref
      artifacts.json                 # 可选；Run artifact refs
      transition.json                # 可选；未完成阶段推进日志
      checkpoint-journal.json        # 可选；未完成 progress checkpoint 日志
      checkpoints/
        latest.json                  # 最近阶段边界 checkpoint
        progress.json
        manifests/<sha256>.json
      evidence/
        scopes/<sha256>.json
        snapshots/<sha256>.json
        allowances/<sha256>.json
        verifications/<sha256>.json
        check-receipts/<sha256>.json
  archive/YYYY-MM-DD-<change-name>/
  runtime/
    locks/
    transactions/<transaction-id>/
      transaction.json
      events.jsonl
```

`artifact-root` 由项目配置唯一指定。Native 不使用隐藏的 change 目录，也不从其他需求目录发现状态。项目级 `.comet/config.yaml` 是持久配置例外；`root move` 中断恢复期间还可能在源/目标 artifact root 旁出现 Runtime 管理的临时 staging 或 quarantine，事务收口后会清除。它们不是第二个可写 Native change 根。

## 项目配置

```yaml
schema: comet.project.v1
default_workflow: native
workflows:
  - native
native:
  artifact_root: docs
  language: zh-CN
  clarification_mode: sequential
```

`clarification_mode` 只控制 Native 如何组织用户决定：`sequential` 每轮询问一个最上游问题，`batch` 每轮询问所有前置条件已经确定的问题。字段缺失时使用 `sequential`。它不改变 change schema、生命周期、Guard、安全确认或调用方停点。

根目录迁移期间会出现 runtime 管理的 `pending_root_move`。存在该字段时普通写命令必须停止，不能自行选择旧根或新根。

## 当前需求归属

```json
{
  "schema": "comet.selection.v2",
  "workflow": "native",
  "change": "add-sentence-counting",
  "branch": null
}
```

`.comet/current-change.json` 是 Native 与 Classic 共用的当前需求 selection，不是 Native change 产物。Native 的 `new` 和 `select` 会写入 `workflow: native`；Hook Router 每次只把写入交给这一个 workflow 的 Guard。selection 缺失时只有全项目恰好一个 active Comet change 才能只读推断；多个候选、失效 selection 或已归档目标都会失败关闭。

项目配置最多 64 KiB，selection 最多 16 KiB，change YAML 最多 256 KiB。brief 与单个拟议规格最多各 1 MiB；一个 change 最多 64 个拟议规格，contract 的 brief + specs 总读取最多 4 MiB。拟议规格目录还限制可枚举条目，`show` 的序列化载荷最多 10 MiB。超过预算时 Runtime 保留原文件并失败关闭，不以静默截断替代完整需求。

## Change 状态

```yaml
schema: comet.native.v3
minimum_runtime_version: 3
revision: 1
name: add-sentence-counting
language: zh-CN
phase: shape
brief: brief.md
approval: null
approved_contract_hash: null
spec_changes:
  - capability: sentence-counting
    operation: create
    source: specs/sentence-counting/spec.md
    base_hash: null
verification_result: pending
verification_report: null
implementation_scope: null
verification_evidence: null
partial_allowance: null
archived: false
created_at: 2026-07-14
run_id: null
```

不要直接编辑 Runtime 管理字段。`phase`、`revision`、`approval`、`approved_contract_hash`、`spec_changes`、operation、`base_hash`、三个 evidence ref、`run_id` 和 `archived` 都由 Runtime 管理。

`approved_contract_hash` 把 approval 绑定到当时的 brief/spec contract。contract 发生变化后，必须由用户重新确认。需要改变需求时，只更新 brief 和 `specs/<capability>/spec.md`；删除 capability 使用 `comet native spec remove`，再由命令检查并推进。

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

Sequential 模式的 Open questions 同时保存一个最上游阻塞问题。Batch 模式使用 `- [blocking] Q1: <问题>`、`- [blocking] Q2: <问题>` 保存本轮全部可回答问题；该无序列表前缀是 Runtime 识别阻塞的固定格式，不能改成 Markdown 有序列表。未回答项继续保持 `[blocking]`。本轮问题处理完且完整性复核通过后，Batch 模式使用 `- [blocking] CONFIRM: <确认内容>` 保存共享理解确认，明确确认前不能进入 Build。

问题编号只服务于当前澄清轮次。已确认答案应写入 Decisions 和完整目标规格；不要新增决策树产物，也不要把隐藏推理写入 brief。

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

Runtime 最多从 brief 与拟议规格合计派生 1024 个验收项，超出就拒绝继续，不会先构造无界列表再截断。`acceptancePage` 每页最多 16 项；单项文字最多 512 UTF-8 字节、context 最多 4 项且每项最多 256 字节，整页最多 32 KiB。文字或 context 截断会显式标记，验收 ID 不会因分页或截断而丢失；cursor 绑定当前 acceptance hash，契约变化后旧 cursor 会失效。

`# Acceptance evidence` 下必须恰好有一个固定机器块。ID 由 Runtime 从 brief/spec 派生，通过 Build 结果或 `status --details` 返回；不要自行计算或改写：

```text
<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-<sha256>",
    "evidence_refs": [
      "src/feature.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-<sha256>",
    "evidence_refs": [],
    "skipped_reason": "该平台当前不可用。"
  }
]
<!-- comet-native:acceptance-evidence:end -->
```

数组按 `acceptance_id` 排序，`evidence_refs` 也排序。每项只能二选一：至少一个项目相对 evidence ref，或空数组加非空 `skipped_reason`。不能同时给证据和跳过理由，也不能引用绝对路径、Native 外部路径、`.git` 或 `.env*`。

## 内容寻址证据

- `baseline-manifest.json`：change 创建时的有界项目快照。它只记录项目相对路径、size、hash、capture provider 和省略事实，不保存文件内容。Git provider 纳入 tracked 和未被 ignore 的 untracked 文件，并把 submodule/gitlink 作为原子条目；非 Git 项目使用带前后枚举围栏的有界物理树 provider。创建时若项目所有范围内仍有省略项，`new` 会失败并清理未完成 change。
  - `git-selection-changed`：等待 Git 写入稳定后重试，不能授权为 partial scope。
  - `git-enumeration-limit`：先缩小或清理项目所有范围。只有 current snapshot 返回可授权 scope，且用户接受未知尾部的具体风险时，才能按精确 hash、理由与 `--confirmed` 使用 partial 协议。
  - `physical-selection-changed` 和 `physical-enumeration-limit`：稳定或缩小项目树后重试，不能授权为 partial scope。
  - 任何情况都不能手改 evidence 或猜测未枚举路径。
- `evidence/scopes/`：Build 离开时由 baseline、当前快照、声明产物和 contract 派生的 implementation scope。当前快照不完整时不会猜测删除；变化过多时只展开有界明细，其余由带数量与内容 hash 的 `scope-detail-overflow` 表示。scope 不完整时 Runtime 停止；用户显式接受后才生成 `allowances/`。
- `evidence/verifications/`：Verify 结论的 envelope，绑定 Runtime 身份、change revision、contract、acceptance coverage、scope、报告 hash 和可选 check receipt。任一绑定事实变化都会 stale。
- `evidence/check-receipts/`：`comet native check` 的内置策略结果。它只保存 policy/version、scope/snapshot 绑定、有界 issue 与计数，不保存文件内容，也不是测试完整性的证明。
- `checkpoints/`：阶段内恢复摘要与真实产物 manifest。checkpoint 会递增 revision，但不改变 phase，也不能代替 brief、规格、scope 或 verification。

所有 hash ref 都由 Runtime 写入并在读取时重算。不要复制旧 ref 到新状态、手改 JSON 或把 receipt 当作 pass；`next`、status 和 Archive 会重新读取并检查新鲜度。

Evidence retention 只能由 doctor 显式执行，不在普通工作流中后台删除文件。只读 doctor 报告候选；`doctor --repair` 只清理 active change 中至少 30 天、每种 evidence kind 最新 32 份之外，并且能从当前 state refs 及其依赖闭包证明未引用的 snapshot、scope、allowance、verification 和 check receipt。

候选按 dependents-before-dependencies 排序。每个文件先在父链与身份复核后改名到同目录唯一 `.gc` quarantine，再复核并删除。中断的 quarantine 会由后续 doctor 发现；显式 repair 仅在原路径不存在且内容与身份有效时无覆盖恢复。

出现原文件与 quarantine 冲突、多份 quarantine、归档 change、pending transition/checkpoint、缺失依赖、损坏文档、未知目录项、symlink 或其他特殊文件时，推迟或拒绝清理。不要把 retention 当作修复损坏证据的办法。

Build 与 Verify 使用 inspect-then-persist：先计算并校验 contract、scope、acceptance、repair、Run 与 trajectory，再把最终证据引用写入状态和 transition。Partial Build 可先内容寻址保存候选 scope 以返回稳定 hash，但没有确认时不会生成 allowance 或推进；被后续检查阻塞的 Verify 不会留下可被误认成已提交结论的 verification evidence。

Run state、trajectory、checkpoint、pending action、context 和 artifact refs 只能经过 Native Protected Run I/O。读取拒绝 symlink/junction、非普通文件、路径或文件身份变化和越界，并执行打开前后复核；写入在原子提交前复核父链和目标身份。

当前预算为：Run state 256 KiB；trajectory 8 MiB、4096 个事件、单事件 256 KiB；checkpoint 与 pending action 各 256 KiB；context 与 artifact refs 各 1 MiB。通用 Engine 存储函数不是 Native 文件边界。

阶段 transition journal 最多 512 KiB，baseline manifest 的硬上限为 8 MiB。Archive/root move transaction journal 最多 256 KiB；`events.jsonl` 最多 1 MiB 或 1024 个事件，单个事件最多 16 KiB。摘要、无代码理由、partial 理由、repair override 摘要与跳过理由在持久化前执行长度校验和凭据形态脱敏；不要把 token、密码、私钥或连接串写入 workflow 证据。
