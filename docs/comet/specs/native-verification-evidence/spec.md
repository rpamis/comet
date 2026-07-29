# native-verification-evidence

## 目标

对采用本规格的新 Native change，Verify 的通过结果必须由 Runtime 计算，Archive 必须在预检和提交锁内重新验证该计算。人类可读报告用于解释，不能单独充当验收通过凭据。

## 验收矩阵

- Runtime 从拟议完整规格中的每条 mandatory requirement / MUST 派生稳定 acceptance ID；brief 示例不得替代该清单。
- 每个 acceptance ID 必须恰有一条 canonical matrix entry，状态为 `passed`、`failed` 或 `waived`。
- `passed` entry 必须关联至少一条当前有效的类型化 receipt；`failed` entry 使验证不能通过。
- `waived` entry 必须关联结构化 waiver、替代证据和用户显式确认记录。没有确认或绑定失效的 waiver 不得用于通过。
- Runtime 必须拒绝重复、未知、缺失或与当前 acceptance set 不匹配的 ID。

## 类型化证据 receipt

- automated-check receipt 记录规范化命令、退出码、开始与结束时间、工作树/提交身份、适用 scope、输出摘要和当前 contract/snapshot/artifact 哈希。
- static-inspection receipt 记录被检查对象、规则、结果和相同的绑定事实；`comet native check` 的 receipt 属于此类。
- manual-evidence receipt 记录可复现步骤、观察结果、明确责任人和绑定事实；它不能伪装为 automated-check。
- independent-review receipt 记录审查者身份、审查范围、MUST 覆盖矩阵、统一读写入口检查、对抗性/失败路径、生成物同步、真实生命周期 Eval，以及按 P0/P1/P2 分类的 finding 与处置状态。
- 每种 receipt 使用 Runtime canonical serialization 和内容寻址。裸文件路径、“tests passed”字符串或只存在 verification.md 的引用都不是充分的通过证据。

## 通过、阻断与 waiver

- Verify 的 `pass` 仅在所有 acceptance entries 为 passed 或已确认 waived、每条 required check 已通过、所有 receipt 对当前 scope/snapshot/contract/artifact 有效、且所需 review 已通过时成立。
- required check 的 `failed`、`skipped`、`blocked`、timeout、无法读取、证据不完整或 `scan-limit` 默认阻断 `pass`。
- waiver 至少记录适用 acceptance ID、被豁免的检查/阻断、原因、风险、替代证据、确认人和确认绑定哈希。Runtime 只接受显式 confirmation 操作生成的 waiver。
- Archive preflight 与 archive commit 均重新计算 required checks、waiver、矩阵和 receipt 的绑定；任何漂移或未解决阻断都使 Archive 不就绪。

## 高风险独立复核

当 implementation scope 涉及路径解析、文件删除/移动、事务恢复、权限或安全边界、不可信持久化数据、跨模块 runtime/安装/路由/生成物、状态机/持久化 schema/迁移，或大范围 Skill/命令契约时，Runtime 将 change 标记为 high-risk。

- high-risk change 在 Archive 前必须有当前有效的 independent-review receipt。
- 审查者身份必须与 implementation author 不同；Native 不依赖外部 Skill，但可由独立审查调用提交结构化 receipt。
- 未解决的 P0/P1 finding、缺失 MUST 覆盖、未执行的要求审查项或失效 review 均阻断 Archive。

## 漂移与兼容

- Verify 后 contract、implementation scope、当前工作树、verification report、receipt、waiver 或 review 任一变化，当前通过结论失效并回退到重新 Verify 的受控流程。
- 新协议使用版本化 evidence schema。不含已删除 `signed-v2` 创建授权格式的旧 archive、旧 envelope 和旧 report 继续支持 show/status/doctor 的只读解析，不要求回填 acceptance matrix 或 receipt；已删除的创建授权格式不提供兼容读取。

## 验证要求

- 新增负向契约测试：报告自称 pass 但缺 MUST 证据、required check failed/skipped/scan-limit、receipt 属于旧 snapshot/scope、高风险无独立 review、review 有未解决 P0/P1、Verify 后漂移和旧 archive 读取。
- 增加真实生命周期 Eval，至少从 Native change 创建、Build、Verify 到 Archive，覆盖 docs-layout treatment 的实际 Runtime 行为。
- 中英文 Native Skills、Native runtime 源码和生成 asset 必须同步。
