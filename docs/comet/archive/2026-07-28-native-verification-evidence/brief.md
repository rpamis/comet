# Outcome

Comet Native 对新 change 的 Verify 与 Archive 必须根据可机器复核的验收矩阵、类型化证据、必要检查和独立复核结果推导完成状态。Agent 或报告文本不能单独把未证明完成的变更声明为通过。

# Scope

- 为每项 spec mandatory requirement 分配稳定 acceptance ID，并持久化 `passed`、`failed` 或 `waived` 的机器状态。
- 为自动化命令、静态检查、人工检查和独立复核定义带 snapshot、scope、工件哈希和身份的 receipt。
- 将必要检查失败、跳过、扫描上限、无效证据和未覆盖验收项设为 Verify 的阻断条件。
- 为高风险 Native change 增加 Native 自有的独立复核 receipt，并在 Archive 预检及锁内重算其有效性。
- 保持旧 archive 和旧 verification evidence 的只读兼容；仅新协议 change 使用新完成条件。
- 同步中英文 Native Skill、源码 runtime、生成资产、负向测试和真实生命周期 Eval。

# Non-goals

- 不要求对所有代码语义做形式化证明。
- 不重写、迁移或删除既有 archive 的证据。
- 不把外部 code-review Skill 作为 Native 主流程的运行时依赖。
- 不把普通项目测试替换为内置静态检查。

# Acceptance examples

- 某 MUST 没有有效 evidence receipt 时，即使报告写有 `pass`，Verify 也返回 Build 且 Archive 预检不可就绪。
- 必要检查的 receipt 为 `failed`、`skipped`、`blocked` 或含 `scan-limit` 时，除非存在与该 acceptance ID 绑定、带风险和替代证据的已确认 waiver，否则不能通过。
- 路径移动、删除、事务、持久化 schema、跨 runtime/生成物或大范围 Skill/命令契约变更没有通过的独立复核时，Archive 被阻断；P0/P1 finding 未解决同样阻断。
- Verify 后修改项目快照、scope、报告、receipt、spec 或 waiver，Archive 前的重新计算识别漂移并要求重新 Verify。
- 旧 archive 的 show、status、doctor 继续可读；它们不被要求补齐 v2 receipt。

# Constraints and invariants

- receipt 必须由 Runtime 规范化、内容寻址，并绑定当前 contract、implementation scope、快照和关联 artifact；不得只以任意文件路径或报告文本作为通过证据。
- `pass` 只能由完整 acceptance matrix、全部 required checks、全部 waiver 与（适用时）独立复核的机器状态推导。
- waiver 必须包含 acceptance ID、原因、风险、替代证据与显式确认记录；不得把扫描上限或跳过静默视为通过。
- 高风险判定、review 覆盖矩阵和 Archive 重检均归 Native runtime；不依赖外部 Skill 是否安装。
- 变更保持 Windows、macOS、Linux 的路径与时间行为，并通过生成资产检查。

# Decisions

- 协议以新的 evidence schema 版本生效；解析器保留历史 envelope/archive 的只读兼容分支。
- 新验证报告保留人类可读正文，但机器区使用 canonical typed evidence 数据，不能由自由文本覆盖。
- 用户已明确要求处理 #240，并授权在需要确认时采用最优推荐；本 change 采用“默认 fail-closed、仅显式结构化 waiver 可例外”的方案。

# Open questions

无。Issue #240 已明确完成条件；实现细节不改变用户可见行为，由 Native runtime 契约决定。

# Verification expectations

- 覆盖未绑定 MUST、failed/skipped/scan-limit receipt、旧 scope/snapshot receipt、高风险缺 review、遗留 P0/P1、Verify 后漂移和历史 archive 兼容的负向测试。
- 运行受影响 Native、workflow-contract、CLI/runtime-asset 测试，构建 Native runtime，并验证生成物。
- 增加至少一个从创建 change 到 Archive 的真实生命周期 Eval，证明 docs layout treatment 不只是 fixture loader。
