# 语义记忆领域契约

## Review packet

`MemoryReviewPacket` 是 Runtime 交给固定 `comet-memory` Skill 的最小、版本化输入。它包含当前配置语言、稳定项目身份、workflow/change、可信检查点、少量用户证据、相关 active memory 和固定预算。它不包含完整 transcript、日志、diff、隐藏推理或未经筛选的仓库内容。

`MemoryReviewAction` 只能是 `create`、`update`、`forget` 或 `skip`。动作必须引用 packet 允许的 target/evidence，最多处理固定数量的动作和字节；`skip` 不产生状态变化。Runtime 在交给 Personal Memory 前校验 action 的 schema、scope、语言、长度、危险内容和 evidence 新鲜度。

## Observation

Observation 的幂等键由稳定 project identity、Change ID 和 candidateKey 构成。没有 candidateKey 的旧调用使用规范化语义身份作为兼容 fallback；新的调用必须提供稳定 candidateKey。同一 Change 可以有多个 candidateKey，但重试同一 candidateKey 不增加 evidence。

成功 observation 才能形成自动候选；失败、取消、普通工具调用和非稳定生命周期不会形成正向 evidence。项目 scope 的候选需要同一 project 中两个不同 Change ID 的成功证据。global scope 的候选需要两个不同 project identity 的成功证据；同一项目重复成功不能激活 global。

## Precedence and conflicts

显式 record 始终高于隐式 record。隐式候选与 active explicit record 语义身份相同但正文不同，或者多个隐式正文互相矛盾时，Runtime 记录 conflict，不更新正文，也不把矛盾候选写入正常 retrieval。只有用户 remember/correct、Markdown 手动编辑或明确删除才能改变 explicit 内容。

## Forget and migration

软删除保存最小 tombstone。旧 observation、旧 evidence、旧同步内容在 tombstone 时间之前不得重新形成候选；删除后的新成功 Change 可以重新形成候选，满足独立证据后再激活。显式 remember/correct 会明确解除对应 tombstone。旧 state 没有新字段时使用安全默认值，已有记录、Markdown、history、remote 和同步语义保持不变。

## Safety and language

领域校验拒绝空文本、未知枚举、越界 projectKey、过大 payload、secret、凭据、明显 PII、提示注入和要求修改 Skill/规则/系统的内容。自动正文与用户可见 category/tag/reason 使用 packet language；`zh-CN` 不能落盘明显英文自动动作，`en` 不能落盘明显中文自动动作。用户直接输入的 remember 文本保持原文，不由领域层静默翻译。

## Retrieval

检索继续使用 scope、project、task、path、operation、tag、category 和关键词的确定性过滤与排序。只返回 active、无未解决 conflict、未暂停的记录，并严格遵守 maxEntries/maxBytes；没有可靠命中时返回空结果，不注入候选、tombstone 或内部证据。
