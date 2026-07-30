# native-verification-evidence

## 目标

对采用本规格的新 Native change，Verify 的通过结果必须由 Runtime 根据当前类型化证据计算，Archive 必须在预检和提交锁内重新验证该计算。人类可读报告用于解释，不能单独充当验收通过凭据。

## 验收矩阵

- Runtime 从 brief 与拟议完整规格派生稳定 acceptance ID。
- 每个 acceptance ID 必须恰有一条 canonical matrix entry，状态仅可为 `passed` 或 `failed`。
- `passed` entry 必须关联至少一条当前有效的类型化 acceptance receipt；`failed` entry 使验证不能通过。
- Runtime 必须拒绝重复、未知、缺失或与当前 acceptance set 不匹配的 ID。

## 类型化证据 receipt

- automated-check receipt 记录规范化命令、退出码、开始与结束时间、工作树/提交身份、适用 scope、输出摘要和当前 contract/snapshot/artifact 哈希。
- static-inspection receipt 记录被检查对象、规则、结果和相同的绑定事实；`comet native check` 的 receipt 属于此类。
- manual-evidence receipt 记录可复现步骤、观察结果、明确责任人和绑定事实；签发时要求显式确认，且不能伪装为 automated-check。
- receipt 使用 Runtime canonical serialization 和内容寻址。裸文件路径、“tests passed”字符串或只存在 verification.md 的引用都不是充分的通过证据。

## 通过与阻断

- Verify 的 `pass` 仅在所有 acceptance entries 均为 `passed`、每条 required check 均有当前通过的 static-inspection receipt，且所有 receipt 对当前 revision、scope、snapshot、contract 与 artifact 有效时成立。
- required check 或 acceptance receipt 的 `failed`、`skipped`、`blocked`、timeout、无法读取、证据不完整、越界或 `scan-limit` 均阻断 `pass`。
- scope 必须完整；不再根据路径类型划分需要额外签名复核的高风险等级。
- Archive preflight 与 archive commit 均重新计算验收矩阵、required checks 和 receipt 绑定；任何漂移或未解决阻断都使 Archive 不就绪。

## 漂移与兼容

- Verify 后 contract、implementation scope、当前工作树、verification report 或 receipt 任一变化，当前通过结论失效并回退到重新 Verify 的受控流程。
- 当前 parser 仅接受 automated-check、static-inspection 与 manual-evidence receipt，以及不含已移除复核字段的当前 envelope/trace。旧签名复核、waiver 和相关 receipt 不提供迁移或兼容读取。

## 验证要求

- 覆盖报告自称 pass 但缺验收证据、required check 非通过、receipt 属于旧 revision/snapshot/scope、manual evidence 未确认、Verify 后漂移，以及已移除 schema/字段被拒绝。
- 增加真实生命周期 Eval，至少从 Native change 创建、Build、Verify 到 Archive，覆盖 docs-layout treatment 的实际 Runtime 行为。
- 中英文 Native Skills、Native runtime 源码和生成 asset 必须同步。
