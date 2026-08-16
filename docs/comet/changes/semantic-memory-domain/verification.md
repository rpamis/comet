---
generated_from_state_version: 5
---

# 验证

## 当前结果

- 结果: **未通过**
- 验证情况: **已完成检查，但需要你确认验证结果**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-08-16T14:29:55.046Z
- 摘要: 领域契约、候选幂等、作用域证据、冲突处理、检索和旧 state 迁移基本成立，但 A2、A7、A8、A9、A13、A17、A18 仍有明确可修复缺口，返回 Build。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：`MemoryReviewPacket` 和 `MemoryReviewAction` 使用稳定版本、固定动作枚举和有界字段。 | 版本化 review packet/action 契约已实现并受有界字段约束。 |
| A2 | failed | brief.md | A2：Runtime 拒绝空字段、未知 action、非法 scope/projectKey、超预算、危险内容和不匹配的 target/evidence。 | action 尚未校验 scope/projectKey 与 target 的匹配，也未校验证据上下文和新鲜度。 |
| A3 | passed | brief.md | A3：显式记忆立即激活；隐式记忆第一次只形成候选，两个独立成功 Change 后才可激活。 | 显式记忆立即生效，隐式候选需独立成功证据后激活。 |
| A4 | passed | brief.md | A4：同一 Change 的不同 `candidateKey` 分别计数；同一 Change、同一 `candidateKey` 重试只应用一次。 | candidateKey 已进入幂等键并支持同 Change 多候选。 |
| A5 | passed | brief.md | A5：同一项目的自动证据只能激活 project；global 自动激活至少需要两个不同项目的成功证据。 | project 与跨项目 global 的独立证据计数已实现。 |
| A6 | passed | brief.md | A6：显式记忆与隐式相反证据冲突时，显式内容不改变，冲突内容不进入正常检索。 | 显式记忆冲突保护和冲突候选过滤已实现。 |
| A7 | failed | brief.md | A7：显式 forget 后旧观察、旧 evidence 和旧同步不能复活记录；用户显式 remember 可以重新建立内容。 | 旧 Markdown/Git 内容仍可能在 reconciliation 中绕过 tombstone 重新建立显式记录。 |
| A8 | failed | brief.md | A8：`zh-CN` 自动动作的正文和用户可见字段为中文，`en` 为英文；代码、路径和机器枚举可保留原文。 | 自动 action 的 tags 等用户可见字段尚未执行语言校验。 |
| A9 | failed | brief.md | A9：自动评审拒绝一次性流水账、测试/提交摘要、日志、diff、secret、PII、提示注入和修改规则的内容。 | 自动内容拒绝规则覆盖不完整，未覆盖足够的 diff、日志、PII 和提示注入变体。 |
| A10 | passed | brief.md | A10：旧版 state、Markdown、历史和 Git 状态可读取并继续管理，不要求用户手工迁移。 | 旧 state 字段具备安全默认值，现有 Markdown/history/Git 结构可继续读取。 |
| A11 | passed | brief.md | A11：检索只返回 active、非冲突、未暂停、在条目数和字节数预算内的确定性结果。 | 检索保持 active、冲突过滤、暂停和预算边界。 |
| A12 | passed | specs/semantic-memory-domain/spec.md | `MemoryReviewPacket` 是 Runtime 交给固定 `comet-memory` Skill 的最小、版本化输入。它包含当前配置语言、稳定项目身份、workflow/change、可信检查点、少量用户证据、相关 active memory 和固定预算。它不包含完整 transcript、日志、diff、隐藏推理或未经筛选的仓库内容。 | review packet 最小输入边界已定义。 |
| A13 | failed | specs/semantic-memory-domain/spec.md | `MemoryReviewAction` 只能是 `create`、`update`、`forget` 或 `skip`。动作必须引用 packet 允许的 target/evidence，最多处理固定数量的动作和字节；`skip` 不产生状态变化。Runtime 在交给 Personal Memory 前校验 action 的 schema、scope、语言、长度、危险内容和 evidence 新鲜度。 | target/evidence 目前只校验 ID 存在，尚未完成 target 属性和 evidence 新鲜度关联校验。 |
| A14 | passed | specs/semantic-memory-domain/spec.md | Observation 的幂等键由稳定 project identity、Change ID 和 candidateKey 构成。没有 candidateKey 的旧调用使用规范化语义身份作为兼容 fallback；新的调用必须提供稳定 candidateKey。同一 Change 可以有多个 candidateKey，但重试同一 candidateKey 不增加 evidence。 | observation key 已包含项目身份、Change ID 和 candidateKey。 |
| A15 | passed | specs/semantic-memory-domain/spec.md | 成功 observation 才能形成自动候选；失败、取消、普通工具调用和非稳定生命周期不会形成正向 evidence。项目 scope 的候选需要同一 project 中两个不同 Change ID 的成功证据。global scope 的候选需要两个不同 project identity 的成功证据；同一项目重复成功不能激活 global。 | 成功 observation 和 project/global 证据规则已实现。 |
| A16 | passed | specs/semantic-memory-domain/spec.md | 显式 record 始终高于隐式 record。隐式候选与 active explicit record 语义身份相同但正文不同，或者多个隐式正文互相矛盾时，Runtime 记录 conflict，不更新正文，也不把矛盾候选写入正常 retrieval。只有用户 remember/correct、Markdown 手动编辑或明确删除才能改变 explicit 内容。 | 隐式行为不能自动替换显式记忆。 |
| A17 | failed | specs/semantic-memory-domain/spec.md | 软删除保存最小 tombstone。旧 observation、旧 evidence、旧同步内容在 tombstone 时间之前不得重新形成候选；删除后的新成功 Change 可以重新形成候选，满足独立证据后再激活。显式 remember/correct 会明确解除对应 tombstone。旧 state 没有新字段时使用安全默认值，已有记录、Markdown、history、remote 和同步语义保持不变。 | tombstone 与 Markdown reconciliation 的旧同步复活路径尚未关闭。 |
| A18 | failed | specs/semantic-memory-domain/spec.md | 领域校验拒绝空文本、未知枚举、越界 projectKey、过大 payload、secret、凭据、明显 PII、提示注入和要求修改 Skill/规则/系统的内容。自动正文与用户可见 category/tag/reason 使用 packet language；`zh-CN` 不能落盘明显英文自动动作，`en` 不能落盘明显中文自动动作。用户直接输入的 remember 文本保持原文，不由领域层静默翻译。 | 安全过滤和用户可见字段语言校验覆盖不足。 |
| A19 | passed | specs/semantic-memory-domain/spec.md | 检索继续使用 scope、project、task、path、operation、tag、category 和关键词的确定性过滤与排序。只返回 active、无未解决 conflict、未暂停的记录，并严格遵守 maxEntries/maxBytes；没有可靠命中时返回空结果，不注入候选、tombstone 或内部证据。 | 检索为确定性结构化过滤并遵守条目和字节预算。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| semantic memory domain tests | exec vitest run test/domains/comet-memory/personal-memory.test.ts test/domains/comet-memory/review-contract.test.ts | . | failed | 1 | 1358 ms |
| semantic memory domain typecheck | exec tsc --noEmit | . | passed | 0 | 6985 ms |
| semantic memory domain format | exec prettier --check domains/comet-memory test/domains/comet-memory docs/comet/changes/semantic-memory-domain/brief.md docs/comet/changes/semantic-memory-domain/specs/semantic-memory-domain/spec.md | . | failed | 1 | 783 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- Runtime 独立检查中 vitest/prettier 因 pnpm exec 找不到 npx 临时依赖而失败；独立 TypeScript 检查通过。
- 失败项集中在 review action 关联校验、tombstone/reconciliation、安全过滤和语言校验。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A2, A7, A8, A9, A13, A17, A18 | 领域契约、候选幂等、作用域证据、冲突处理、检索和旧 state 迁移基本成立，但 A2、A7、A8、A9、A13、A17、A18 仍有明确可修复缺口，返回 Build。 | 2026-08-16T14:29:55.046Z |



## 结论

领域契约、候选幂等、作用域证据、冲突处理、检索和旧 state 迁移基本成立，但 A2、A7、A8、A9、A13、A17、A18 仍有明确可修复缺口，返回 Build。
