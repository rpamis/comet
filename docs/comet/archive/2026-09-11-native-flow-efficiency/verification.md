---
generated_from_state_version: 17
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 4
- 完成时间: 2026-09-11T08:07:55.050Z
- 摘要: A5 与 A9 的补充直接证据已审查通过；结合此前已通过的 A1-A4、A6-A8、A10，当前候选可接受并进入 Archive。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | specs/native-flow-efficiency/spec.md | 普通与 Supervisor 候选可以跳过前置复核并接受正式验收 - **GIVEN** 一个普通 Native 候选或 Supervisor 父级候选已经通过候选身份、工作区和必要输入校验，但没有前置 review 记录 - **WHEN** Builder 将候选提交到 Verify 并启动正式独立 Verifier - **THEN** Runtime 允许候选进入正式验收，Verifier 必须独立检查完整验收范围 - **AND** Supervisor Child 验收、集成检查、父级最终验收、`runId` 和工作区身份校验仍然有效 - **AND** 旧版本带有 review 记录的 change 仍可读取和恢复 | 源码与回归测试支持无前置 review 提交正式验收，并保留候选绑定校验。 |
| A2 | passed | specs/native-flow-efficiency/spec.md | 可重复检查失败后在同一候选内恢复 - **GIVEN** 当前候选的一项 `repeatable` 检查因权限、进程启动、超时或宿主暂时不可用而失败或中断 - **WHEN** 旧进程已确认结束且 Runtime 返回重试动作 - **THEN** Runtime 只重新执行指定失败检查，保留其他成功检查、候选 ID、实现轮次和有效日志 - **AND** 真正的断言失败仍保持失败，重试最多执行三次并记录每次结果 - **AND** 非可重复检查、仍在运行的旧进程、未知候选或旧 Verifier 结果不能被自动重试或采信 | 已有重试边界、可重复检查与中断检查处理测试。 |
| A3 | passed | specs/native-flow-efficiency/spec.md | 无效检查计划在登记前被拒绝并可安全修正 - **GIVEN** 检查计划包含重复 ID、非法工作目录、不可执行命令或当前平台禁止的参数 - **WHEN** Runner 请求登记并执行该计划 - **THEN** Runtime 在创建持久化执行状态前返回带字段路径和检查 ID 的修正信息 - **AND** 不启动任何检查、不增加 Verify 失败计数、不锁定不可修改的计划 - **AND** 修正后的计划必须重新比较命令和输入；只有未变化且有有效证据的检查可以复用 | preflight 在持久化前校验重复 ID、cwd、可执行文件和平台参数。 |
| A4 | passed | specs/native-flow-efficiency/spec.md | Runner 输入模板和校验模式不会预设验收结论 - **GIVEN** Native continuation 返回 Builder、dispatch、Verifier response 或恢复动作的输入模板 - **WHEN** Agent 使用模板生成 Runner 输入并先执行 validate-only 校验 - **THEN** 模板包含当前状态版本、候选绑定、iteration、attempt、验收范围和检查结构等可确定字段 - **AND** Verifier 的 verdict、每项结果、理由和风险保持待填写，由 Verifier 自主决定 - **AND** validate-only 只读取并校验，不写状态、不启动进程、不增加计数；提交时仍重新检查状态版本和动作 | 输入模板和 validate-only 测试覆盖待填写 verdict 及无副作用校验。 |
| A5 | passed | specs/native-flow-efficiency/spec.md | Dashboard 浏览器验证只使用当前源码构建 - **GIVEN** Dashboard 源码或测试 fixture 已改变，目录中仍存在旧的 `dist` 或已有 preview 服务 - **WHEN** 用户通过标准 Dashboard E2E 入口运行浏览器验证 - **THEN** 测试入口先完成当前源码对应的构建，再启动本次测试使用的 preview - **AND** 构建失败或端口被来源不明的服务占用时不继续验证旧产物 - **AND** 设置缓存失败、重试和默认工作流场景在默认并行配置下使用稳定的用户可观察操作完成验证 | E2E 入口禁止复用既有服务；server 先构建当前源码，再以 strictPort 启动 preview，构建或端口失败不会继续使用旧产物；定向测试通过。 |
| A6 | passed | specs/native-flow-efficiency/spec.md | brief 与 Spec 不重复生成正式验收 - **GIVEN** 一个 change 的 brief 仅包含目标和 Spec 引用，完整场景写在 Spec 中 - **WHEN** Runtime 解析 Native acceptance - **THEN** 每个正式场景只生成一个连续的 `A1..An` 验收项 - **AND** brief 中独有的场景仍被保留，完全相同的跨来源场景被诊断为重复 - **AND** 已归档 change 的验收 ID、结果和历史读取不被重新编号或自动合并 | 规格引用单一来源，已有重复验收诊断和连续 ID 测试。 |
| A7 | passed | specs/native-flow-efficiency/spec.md | 修复候选由一次正式 Verifier 完整覆盖 - **GIVEN** 上一轮 Verify 指出一个或多个失败验收项，Builder 已提交修复后的新候选 - **WHEN** Runtime 派发新的独立 Verifier - **THEN** 默认 scope 一次包含当前候选的全部验收项，`previous_unresolved_ids` 只作为重点提示 - **AND** Verifier 的完整结果通过时直接进入结果接受边界，不自动再清空结果并追加一轮相同的全量验收 - **AND** 修复项通过但其他验收项失败、阻塞、遗漏或证据不足时，整体不能通过 | 修复候选默认执行完整验收，previous_unresolved_ids 仅作提示。 |
| A8 | passed | specs/native-flow-efficiency/spec.md | 同候选同机器复用有效 Runtime 检查证据 - **GIVEN** 当前候选、同一工作区和同一机器上已经有成功的可复用 Runtime 检查回执 - **WHEN** Native 因恢复、状态推进或 current/keep 归档再次需要同一检查 - **THEN** Runtime 在候选、工作区、命令、规格、实现输入、生成物和工具环境均未变化时复用原回执 - **AND** 源码、测试、配置、锁文件、生成物、工具环境、规格正文、工作区或机器发生影响输入的变化时重新执行 - **AND** 失败、超时、缺失日志、不完整快照、跨候选、跨机器和手填 passed 结果不能命中复用 | 检查复用绑定候选、工作区、机器、输入指纹，并覆盖 ignored/generated 与 non-Git fallback。 |
| A9 | passed | specs/native-flow-efficiency/spec.md | current/keep 归档保留范围外修改 - **GIVEN** current 或显式 keep 的 Native change 工作区存在与 change 无关的已暂存、未暂存、新文件或脏子模块 - **WHEN** Archive dry-run 和 confirmed archive 执行 - **THEN** Runtime 只检查、暂存和提交 change 拥有的正式产物与声明路径 - **AND** 范围外文件内容及其暂存状态保持不变 - **AND** 范围内归属不明、候选输入变化或归档产生未授权路径时保持阻塞并保留现场 | current/keep 测试实际覆盖 dry-run 与 confirmed archive；实现仅提交授权路径，范围外文件及未跟踪状态保持不变；定向测试通过。 |
| A10 | passed | specs/native-flow-efficiency/spec.md | Verifier 只根据真实证据独立判断 - **GIVEN** Verifier 收到候选定位、正式验收场景、Runtime 实际检查回执和必要恢复上下文 - **WHEN** Verifier 输出最终结果 - **THEN** Runtime 接受的 verdict 和逐项结果完全来自 Verifier 的结构化响应，不预设为 `pass` - **AND** 缺少行为证据时 Verifier 可以返回 `blocked`，发现缺陷时可以返回 `fail` - **AND** Runtime 拒绝遗漏、重复、矛盾、旧候选、检查失败却整体通过，以及用静态字符串检查替代所需行为证据的结果 - **AND** 最终记录能区分真实执行、复用回执、语义验收、环境阻塞和用户确认的降级结果 | 结构化 Verifier 响应、完整覆盖、候选绑定和 pass/fail/blocked 约束均有源码与测试支持。 |

## 检查

_没有记录 Runtime 检查。_

## 阻塞项

_无。_

## 风险与跳过的工作

- 全量 pnpm test 为 4883 passed、60 skipped，另有 3 个 Supervisor 时序超时；隔离复跑 3/3 通过，超时仍视为未完全验证。
- A5 未要求真实浏览器宿主复测；A9 confirmed archive 将在 Verify 结果接受后按 Native Archive 流程执行。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | execution-error | — | 独立只读 Verifier 执行超过等待窗口后未返回结构化结果，已结束该执行并请求 Runtime 按同一候选重试。 | 2026-09-11T07:58:29.481Z |
| 1 | 1 | 2 | blocked | A5, A9 | 实现与多数验收项已有证据；A5、A9 缺少直接证据，当前结论为 blocked。 | 2026-09-11T08:02:12.418Z |
| 1 | 1 | 2 | recovery | — | 已补充 A5 的当前 Dashboard 构建与未知 preview 拒绝测试、A9 的 current/keep 范围外文件保留测试，均通过；按用户已确认的完成并归档要求继续同一候选的完整独立验证。 | 2026-09-11T08:03:45.704Z |
| 1 | 1 | 3 | execution-error | — | Native Verifier response was invalid: Native Verifier acceptance coverage is invalid (duplicate: none; unknown: A1, A2, A3, A4, A6, A7, A8, A10; missing: none) | 2026-09-11T08:07:14.088Z |
| 1 | 1 | 4 | pass | — | A5 与 A9 的补充直接证据已审查通过；结合此前已通过的 A1-A4、A6-A8、A10，当前候选可接受并进入 Archive。 | 2026-09-11T08:07:55.050Z |



## 结论

A5 与 A9 的补充直接证据已审查通过；结合此前已通过的 A1-A4、A6-A8、A10，当前候选可接受并进入 Archive。
