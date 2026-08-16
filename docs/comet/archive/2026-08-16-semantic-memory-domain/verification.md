---
generated_from_state_version: 17
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 4
- 验证器尝试次数: 1
- 完成时间: 2026-08-16T15:15:30.708Z
- 摘要: All semantic-memory-domain acceptance items pass. The shared domain is ready to merge; lifecycle bridge propagation remains explicitly deferred to the integration child.

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：`MemoryReviewPacket` 和 `MemoryReviewAction` 使用稳定版本、固定动作枚举和有界字段。 | Versioned packet/action schemas, fixed action enum and bounded fields are enforced. |
| A2 | passed | brief.md | A2：Runtime 拒绝空字段、未知 action、非法 scope/projectKey、超预算、危险内容和不匹配的 target/evidence。 | Runtime validates empty fields, scope/project keys, budgets, safety, target/evidence and freshness. |
| A3 | passed | brief.md | A3：显式记忆立即激活；隐式记忆第一次只形成候选，两个独立成功 Change 后才可激活。 | Explicit memories activate immediately and inferred memories require two independent successful changes. |
| A4 | passed | brief.md | A4：同一 Change 的不同 `candidateKey` 分别计数；同一 Change、同一 `candidateKey` 重试只应用一次。 | candidateKey separates candidates and retries of the same change/candidate are idempotent. |
| A5 | passed | brief.md | A5：同一项目的自动证据只能激活 project；global 自动激活至少需要两个不同项目的成功证据。 | Project evidence counts distinct changes and global evidence counts distinct project identities. |
| A6 | passed | brief.md | A6：显式记忆与隐式相反证据冲突时，显式内容不改变，冲突内容不进入正常检索。 | Explicit memories are protected and conflicting inferred memories are excluded from normal retrieval. |
| A7 | passed | brief.md | A7：显式 forget 后旧观察、旧 evidence 和旧同步不能复活记录；用户显式 remember 可以重新建立内容。 | Explicit forget blocks old evidence and old sync, while explicit remember can rebuild the content. |
| A8 | passed | brief.md | A8：`zh-CN` 自动动作的正文和用户可见字段为中文，`en` 为英文；代码、路径和机器枚举可保留原文。 | Automatic observations require language and reject mismatched or clearly mixed user-visible language. |
| A9 | passed | brief.md | A9：自动评审拒绝一次性流水账、测试/提交摘要、日志、diff、secret、PII、提示注入和修改规则的内容。 | Automatic content filters cover summaries, logs, diffs, credentials, PII, prompt injection and rule/Skill modification requests. |
| A10 | passed | brief.md | A10：旧版 state、Markdown、历史和 Git 状态可读取并继续管理，不要求用户手工迁移。 | Legacy state, Markdown and history remain readable with safe defaults. |
| A11 | passed | brief.md | A11：检索只返回 active、非冲突、未暂停、在条目数和字节数预算内的确定性结果。 | Retrieval remains active-only, conflict-free, pause-aware, deterministic and bounded. |
| A12 | passed | specs/semantic-memory-domain/spec.md | `MemoryReviewPacket` 是 Runtime 交给固定 `comet-memory` Skill 的最小、版本化输入。它包含当前配置语言、稳定项目身份、workflow/change、可信检查点、少量用户证据、相关 active memory 和固定预算。它不包含完整 transcript、日志、diff、隐藏推理或未经筛选的仓库内容。 | The review packet is minimal, versioned and budgeted. |
| A13 | passed | specs/semantic-memory-domain/spec.md | `MemoryReviewAction` 只能是 `create`、`update`、`forget` 或 `skip`。动作必须引用 packet 允许的 target/evidence，最多处理固定数量的动作和字节；`skip` 不产生状态变化。Runtime 在交给 Personal Memory 前校验 action 的 schema、scope、语言、长度、危险内容和 evidence 新鲜度。 | Actions are bound to valid targets/evidence, including projectIdentity-only packet context. |
| A14 | passed | specs/semantic-memory-domain/spec.md | Observation 的幂等键由稳定 project identity、Change ID 和 candidateKey 构成。没有 candidateKey 的旧调用使用规范化语义身份作为兼容 fallback；新的调用必须提供稳定 candidateKey。同一 Change 可以有多个 candidateKey，但重试同一 candidateKey 不增加 evidence。 | The shared domain observation key includes project identity, change ID and candidateKey. |
| A15 | passed | specs/semantic-memory-domain/spec.md | 成功 observation 才能形成自动候选；失败、取消、普通工具调用和非稳定生命周期不会形成正向 evidence。项目 scope 的候选需要同一 project 中两个不同 Change ID 的成功证据。global scope 的候选需要两个不同 project identity 的成功证据；同一项目重复成功不能激活 global。 | Successful evidence and project/global independence rules hold in the shared domain. |
| A16 | passed | specs/semantic-memory-domain/spec.md | 显式 record 始终高于隐式 record。隐式候选与 active explicit record 语义身份相同但正文不同，或者多个隐式正文互相矛盾时，Runtime 记录 conflict，不更新正文，也不把矛盾候选写入正常 retrieval。只有用户 remember/correct、Markdown 手动编辑或明确删除才能改变 explicit 内容。 | Explicit records remain authoritative and inferred conflicts are not retrieved. |
| A17 | passed | specs/semantic-memory-domain/spec.md | 软删除保存最小 tombstone。旧 observation、旧 evidence、旧同步内容在 tombstone 时间之前不得重新形成候选；删除后的新成功 Change 可以重新形成候选，满足独立证据后再激活。显式 remember/correct 会明确解除对应 tombstone。旧 state 没有新字段时使用安全默认值，已有记录、Markdown、history、remote 和同步语义保持不变。 | Legacy tombstones migrate hashes when possible, safely block unknown old Markdown, and distinguish user-remove from Markdown-delete correction. |
| A18 | passed | specs/semantic-memory-domain/spec.md | 领域校验拒绝空文本、未知枚举、越界 projectKey、过大 payload、secret、凭据、明显 PII、提示注入和要求修改 Skill/规则/系统的内容。自动正文与用户可见 category/tag/reason 使用 packet language；`zh-CN` 不能落盘明显英文自动动作，`en` 不能落盘明显中文自动动作。用户直接输入的 remember 文本保持原文，不由领域层静默翻译。 | Domain validation covers safety, language, budgets, enums and preserves direct user input without translation. |
| A19 | passed | specs/semantic-memory-domain/spec.md | 检索继续使用 scope、project、task、path、operation、tag、category 和关键词的确定性过滤与排序。只返回 active、无未解决 conflict、未暂停的记录，并严格遵守 maxEntries/maxBytes；没有可靠命中时返回空结果，不注入候选、tombstone 或内部证据。 | Category and tags are independent query filters with deterministic bounded retrieval. |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| semantic memory domain tests | vitest run test/domains/comet-memory/personal-memory.test.ts test/domains/comet-memory/review-contract.test.ts | . | passed | 0 | 4234 ms |
| semantic memory domain typecheck | exec tsc --noEmit | . | passed | 0 | 7159 ms |
| semantic memory domain format | prettier --check domains/comet-memory test/domains/comet-memory docs/comet/changes/semantic-memory-domain/brief.md docs/comet/changes/semantic-memory-domain/specs/semantic-memory-domain/spec.md | . | passed | 0 | 1985 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- Lifecycle bridge must preserve candidateKey and include scope/project identity in its observation identity in the later integration child.
- The independent verifier did not edit the worktree.

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A2, A7, A8, A9, A13, A17, A18 | 领域契约、候选幂等、作用域证据、冲突处理、检索和旧 state 迁移基本成立，但 A2、A7、A8、A9、A13、A17、A18 仍有明确可修复缺口，返回 Build。 | 2026-08-16T14:29:55.046Z |
| 1 | 2 | 1 | fail | A1, A2, A7, A8, A9, A17, A18, A19 | 基础候选、作用域、冲突、迁移和检索边界成立，但 A1、A2、A7、A8、A9、A17、A18、A19 仍有明确可修复缺口，返回 Build。 | 2026-08-16T14:43:44.510Z |
| 1 | 3 | 1 | fail | A7, A8, A9, A13, A17, A18 | Domain contract and retrieval behavior are mostly correct, but legacy tombstone migration, deleted-memory correction semantics, strict automatic language/safety filtering and identity-only target context still require repair. | 2026-08-16T15:01:09.278Z |
| 1 | 4 | 1 | pass | — | All semantic-memory-domain acceptance items pass. The shared domain is ready to merge; lifecycle bridge propagation remains explicitly deferred to the integration child. | 2026-08-16T15:15:30.708Z |



## 结论

All semantic-memory-domain acceptance items pass. The shared domain is ready to merge; lifecycle bridge propagation remains explicitly deferred to the integration child.
