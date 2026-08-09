# native-scope-reopen

## 目标

Native 必须区分三类后续写入：当前目标的实现继续、改变用户可见结果的正式需求修改，以及无关请求。实现继续使当前候选失效并返回 Build；正式需求修改返回 Shape 重新确认；无关请求不得归入当前 change。

新路径不封存 content-addressed scope，也不通过项目 snapshot 或文件哈希证明“没有任何变化”。Runtime 只对宿主实际上报的写入动作和受控状态转换负责。

## Requirement: 显式返回 Build

Runtime MUST 支持 `comet native next <change-name> --summary <summary> --return-to-build`，并且只允许当前 phase 为 Verify 或 Archive。

#### Scenario: Verify 后需要继续实现

- **WHEN** 用户明确要求继续修改当前已确认目标的实现
- **THEN** Runner MUST 先调用显式 return-to-Build action
- **AND** Runtime MUST 在 mutation lock 内进入 Build、增加 iteration 并持久化 summary
- **AND** Builder MUST 在新的稳定边界继续实现

#### Scenario: 不适用 phase

- **WHEN** Shape 或 Build 调用 `--return-to-build`
- **THEN** Runtime MUST 返回结构化 usage error
- **AND** MUST NOT 修改 phase、state version、Loop 或本机 overlay

#### Scenario: 参数边界

- **WHEN** `--return-to-build` 与 Shape confirmation、Verifier retry 或已移除的 Agent 自报验收参数组合
- **THEN** Runtime MUST 在写入前拒绝
- **AND** Agent MUST NOT 通过 CLI 提交 Builder/Verifier 身份或 pass 结论

## Requirement: 候选失效

Returning to Build MUST invalidate the current candidate and pass while preserving the change identity, confirmed acceptance text and workspace binding.

#### Scenario: 清理当前验收结论

- **WHEN** Verify 或 Archive change 成功返回 Build
- **THEN** Runtime MUST set `phase: build`, `loop.stage: repairing`, increment iteration and reset attempt
- **AND** MUST reset all acceptance results to pending
- **AND** MUST clear the current Builder handoff, Verifier result, blocker, verification result and report reference
- **AND** MUST preserve goal cycle, Spec declarations, workspace isolation/branches/finish, failure budget and compact history
- **AND** MUST NOT 把这次用户驱动返回计为 Verify fail 或停滞

#### Scenario: 新候选重新验收

- **WHEN** Builder 完成继续实现并提交新候选
- **THEN** Runtime MUST 生成新的 random candidate ID 并记录可信 Builder execution ref
- **AND** Runtime MUST 对新候选执行必要检查并分派新的独立 Verifier execution
- **AND** 旧 candidate 与旧 pass MUST NOT 被复用

## Requirement: 宿主观察到实现写入

支持写入动作事件的平台 MUST 在 Verify 或 Archive 观察到当前项目实现写入时取消当前候选并返回 Build。

#### Scenario: Guard 接收实现写入

- **WHEN** selected portable change 处于 Verify 或 Archive，且 Hook Router 把项目实现写入归属到该 change
- **THEN** Runtime MUST 先在 mutation lock 内执行与显式 return-to-Build 相同的失效转换
- **AND** Guard MAY 在转换成功后允许该写入
- **AND** 返回结果 MUST 明确新的 Build iteration

#### Scenario: 宿主没有写入事件

- **WHEN** 平台无法提供实现写入动作序列
- **THEN** Runtime MUST NOT 声称能够发现编辑器、后台进程或绕过 Comet 的并发变化
- **AND** Verify MUST 不复用 Builder 自报检查，而是为候选执行一次最终必要检查

## Requirement: 正式需求变化返回 Shape

brief、完整目标 Spec 或验收项的变化 MUST 开始新的目标周期，而不是作为普通实现继续处理。

#### Scenario: Build 或更晚阶段编辑正式需求

- **WHEN** Guard 观察到对当前 change 的 `brief.md` 或 `specs/**` 写入，且 phase 不是 Shape
- **THEN** Runtime MUST 在写入前返回 Shape 并增加 `goal_cycle`
- **AND** MUST clear confirmed acceptance、Builder handoff、current verification、blockers and Loop failure counters
- **AND** Guard MAY 在成功转换后允许正式文档写入
- **AND** 用户 MUST 重新确认由更新后 brief/Spec 解析出的完整验收清单

#### Scenario: Shape 中编辑正式需求

- **WHEN** 当前 phase 已是 Shape
- **THEN** Agent MAY 编辑 brief 与目标 Spec
- **AND** `comet-state.yaml` 与 `verification.md` MUST remain Runtime-owned

## Requirement: 请求归属

#### Scenario: 当前 change 的实现扩展

- **WHEN** requested work 只补充已确认行为的实现，不改变 outcome、验收项或 non-goals
- **THEN** Agent MAY 保留在当前 change
- **AND** Verify/Archive 中 MUST 先返回 Build

#### Scenario: 用户可见范围变化

- **WHEN** requested work 改变 outcome、范围、验收标准或 non-goals
- **THEN** Agent MUST 更新 brief 与完整目标 Spec
- **AND** Runtime MUST 返回 Shape 并要求新的确认边界

#### Scenario: 无关请求

- **WHEN** requested work 与 active change 无关
- **THEN** Agent MUST NOT 把它写入当前 change 的 handoff 或正式 Spec
- **AND** MUST 保留当前 portable 状态，并引导用户创建或选择独立 Native change/worktree

## Requirement: 状态与恢复安全

- 返回 Shape/Build 都 MUST 使用 mutation lock、原子 YAML 替换和单调 `state_version`；本机 JSON 只能基于新版本重建。
- 转换中断后，status/doctor MUST 从 portable 稳定边界或明确的本机 interrupted operation 恢复，不得通过扫描项目内容猜测结果。
- Hook MUST 拒绝 Agent 直接写 `comet-state.yaml`、`verification.md` 或其他 Runtime control state。
- 当前 change 的 workspace/branch 无法匹配时 MUST `await-user`，不得为了执行返回操作而静默重绑。

## 双语与验证

- 中文和英文 Native Skill/command reference MUST 描述相同的 request ownership、return Shape/Build 与重新验收语义。
- 回归测试 MUST 覆盖显式返回、Hook 自动失效、正式需求返回 Shape、参数互斥、iteration/goal-cycle 计数、portable/local 版本对齐和中断恢复。
- Native Runtime source 变化后 MUST 重建 self-contained runtime 与命令 bundle，并由 repository asset tests 校验。

## 非目标

- 不改变 Classic workflow。
- 不保证发现宿主没有上报的外部写入。
- 不新增 Native phase、项目内容证明链、外部 Skill 依赖或手工状态编辑能力。
