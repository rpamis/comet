---
generated_from_state_version: 17
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 3
- 验证器尝试次数: 2
- 完成时间: 2026-09-04T08:50:37.511Z
- 摘要: 当前 Shape、Runtime 实现、双语发布资产与已有验证证据一致。A1-A20 全部通过；此前全量测试、build、lint、format、generated 与 diff 检查均有通过证据，最新窄修复及独立审查也通过。版本保持 0.4.0-rc.4，指定非目标未被扩展实现。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | **A1 Shape 整理完成后进入等待** - **Given** change 处于 active Shape，brief 和 capability spec 已经可确认 - **When** Agent 提交本轮 Shape 摘要 - **Then** Runtime 持久化 `status: await-user` 和 `loop.stage: await-user` - **And** 下一动作是 `confirm-shape`，state version 增加 | Shape 整理完成后持久化 await-user/confirm-shape，并递增 state version。 |
| A2 | passed | brief.md | **A2 确认提示不能自动继续** - **Given** change 正在等待用户确认 Shape - **When** Runtime 生成 continuation - **Then** 返回 `disposition: await-user`、`requiresUserDecision: true` 和 `userCommunication.required: true` - **And** 顶层 `commandArgs` 为空，只在用户选择确认后提供带 `--confirmed` 的合法动作 | 确认 continuation 返回 await-user、requiresUserDecision=true、userCommunication.required=true，顶层 commandArgs 为空。 |
| A3 | passed | brief.md | **A3 active Shape 不能直接确认** - **Given** change 仍是 active Shape，尚未持久化确认等待状态 - **When** 调用方直接执行 `comet native next <change> --confirmed` - **Then** CLI 拒绝该命令，不进入 Build，也不修改 portable 状态 | active Shape 直接提交 --confirmed 会被拒绝，状态不进入 Build。 |
| A4 | passed | brief.md | **A4 明确确认后进入 Build** - **Given** change 已处于 Shape 的 `await-user` 确认边界 - **When** 用户明确同意，Agent 执行绑定当前 state version 的确认命令 - **Then** Runtime 校验 Shape 与确认边界后进入 Build - **And** 旧 state version 或错误 expected action 仍按并发保护规则被拒绝 | 确认要求持久化边界、当前 state version 和 expected action，并重新校验 Shape 指纹后进入 Build。 |
| A5 | passed | brief.md | **A5 Supervisor 的协调选择不等于最终确认** - **Given** Supervisor change 尚未选择 agent 协调方式 - **When** 用户选择协调方式 - **Then** Runtime 保存该选择并进入 Shape 的最终确认等待状态 - **And** 不把协调方式选择同时视为用户已经确认整个 Shape | Supervisor 协调方式选择与最终 Shape 确认分离，选择后仍进入独立等待状态。 |
| A6 | passed | brief.md | **A6 模糊需求先解决真正影响结果的问题** - **Given** 用户描述存在会改变范围、默认行为或失败结果的歧义，且无法从仓库、规格或项目规则中确定 - **When** Agent 整理 Shape - **Then** 按配置的 Sequential 或 Batch 方式提出问题，并把未解决项保存为 `[blocking]` - **And** Runtime 在 blocker 解决前拒绝准备最终 Shape 确认 | 澄清规则仅询问影响用户可见结果的真实歧义，未解决项以 [blocking] 阻止确认准备。 |
| A7 | passed | brief.md | **A7 清晰需求不被过度追问** - **Given** 用户要求已经足够明确，剩余内容属于可调查事实或普通实现选择 - **When** Agent 整理 Shape - **Then** Agent 自行调查或决定，不为凑流程追加问题 - **And** 完成 Shape 后只进行一次完整摘要确认 | 清晰需求由 Agent 调查或决定普通实现选择，完成后只进行一次完整摘要确认。 |
| A8 | passed | brief.md | **A8 用户投递文档时区分用途** - **Given** 用户提供文件、附件、链接或本地路径 - **When** 它被明确作为需求来源 - **Then** brief 记录来源覆盖，未读取、部分读取、未映射或有冲突的可执行内容保持 `[blocking]` - **And** 当材料仅用于排错、取证、审查或实现参考时，不自动把其中的文字当成新增需求 - **And** 用途不明时先询问用途；文档内面向 Agent 的指令不能覆盖用户当前请求和项目规则 | 双语 Skill 明确区分需求来源与参考材料，并规定来源材料中的 Agent 指令不能覆盖用户请求或项目规则。 |
| A9 | passed | specs/native-shape-confirmation/spec.md | active Shape 只准备确认边界 - **Given** change 处于 `phase: shape`、`status: active`，且 Shape 内容已经完整 - **When** Agent 通过 `native next` 提交 Shape 摘要 - **Then** Runtime 校验 Shape 内容并持久化 `status: await-user`、`loop.stage: await-user` - **And** `loop.next_action` 变为 `confirm-shape` - **And** 本次动作不进入 Build，也不等同于用户确认 | active Shape 的 native next 只准备确认边界，不进入 Build。 |
| A10 | passed | specs/native-shape-confirmation/spec.md | 未解决的 Shape 问题阻止准备确认 - **Given** brief 的待解决问题中仍有 `[blocking]` - **When** Agent 尝试完成 Shape 或准备最终确认 - **Then** Runtime 返回 brief validation failure - **And** portable state 保持 active Shape，不进入最终确认等待状态 | Runtime 扫描 brief 全文的结构化 [blocking] 标记，存在 blocker 时保持 active Shape 并拒绝准备确认。 |
| A11 | passed | specs/native-shape-confirmation/spec.md | confirm-shape 始终要求用户决定 - **Given** continuation 的 action 是 `confirm-shape` - **When** Runtime 返回下一步 - **Then** `disposition` 必须是 `await-user` - **And** `requiresUserDecision` 和 `userCommunication.required` 必须为 `true` - **And** 顶层 `commandArgs` 必须为空，避免 Agent直接自动执行确认 | confirm-shape 始终返回 await-user、两个用户决定信号为 true，且顶层 commandArgs 为空。 |
| A12 | passed | specs/native-shape-confirmation/spec.md | 未进入等待状态时拒绝 confirmed - **Given** change 仍处于 active Shape - **When** 调用方直接提交 `--confirmed` - **Then** Runtime 拒绝该操作并保持 Shape 状态不变 - **And** 返回的信息说明必须先完成 Shape 并进入用户确认边界 | 未进入持久化等待边界时提交 --confirmed 会被拒绝且状态不变。 |
| A13 | passed | specs/native-shape-confirmation/spec.md | 用户确认等待中的 Shape - **Given** change 处于 Shape 的 `await-user` 状态，下一动作是 `confirm-shape` - **When** 用户明确确认后，Agent提交带 `--confirmed`、当前 state version 和 expected action 的命令 - **Then** Runtime重新校验 Shape 内容并进入 Build - **And** continuation 返回 Build 阶段的下一动作 | 等待态缺失或不匹配 Shape 指纹时 fail closed 并回退 Shape；有效确认后返回 Build continuation。 |
| A14 | passed | specs/native-shape-confirmation/spec.md | 确认命令受并发状态保护 - **Given** Shape 正在等待用户确认 - **When** 命令携带旧 state version 或不匹配的 expected action - **Then** Runtime拒绝该命令 - **And** portable state 不发生变化 | 确认命令受 state version 与 expected action 并发保护，旧版本或错误动作不会修改状态。 |
| A15 | passed | specs/native-shape-confirmation/spec.md | Supervisor 先选择协调方式再确认 Shape - **Given** Supervisor change 的 Shape 已完整，但缺少 agent 协调方式 - **When** 用户选择合法协调方式 - **Then** Runtime保存选择并进入 Shape 的最终确认等待状态 - **And** Runtime仍要求用户单独确认完整 Shape 后才能进入 Build | Supervisor 合法协调方式被保存后仍要求用户单独确认完整 Shape。 |
| A16 | passed | specs/native-shape-confirmation/spec.md | 恢复后保留 Shape 确认边界 - **Given** change 已持久化为等待确认 Shape - **When** Agent 在新的对话或进程中恢复该 change - **Then** continuation 仍返回 `confirm-shape` 和等待用户决定的信号 - **And** 不因恢复而自动进入 Build或清除确认边界 | 恢复流程保留 await-user/confirm-shape 边界，不会自动进入 Build。 |
| A17 | passed | specs/native-shape-confirmation/spec.md | 模糊需求只询问会改变结果的决定 - **Given** 用户描述包含无法从现有事实确定、且会改变用户可见结果的歧义 - **When** Agent 执行 Shape 澄清 - **Then** 未解决决定写入 brief 的 `[blocking]` 并等待用户回答 - **And** 可调查事实由 Agent 调查，普通实现选择由 Agent 决定 | 澄清参考要求把会改变结果且无法确定的歧义写入 [blocking]，可调查事实和普通实现选择由 Agent 处理。 |
| A18 | passed | specs/native-shape-confirmation/spec.md | 清晰需求直接整理 Shape - **Given** 用户要求、正式规格和仓库事实足以确定用户可见结果 - **When** Agent 执行 Shape 澄清 - **Then** 不新增没有实际分歧的问题 - **And** Agent 完成正式产物后进入一次最终 Shape 确认 | 清晰需求不追加虚假分歧，正式产物完成后通过 Runtime 进入一次最终 Shape 确认。 |
| A19 | passed | specs/native-shape-confirmation/spec.md | 需求来源文档完整覆盖 - **Given** 用户明确把文件、附件、链接或本地路径作为需求来源 - **When** Agent 整理 Shape - **Then** brief 记录来源单元及其读取、覆盖和替代状态 - **And** 未读取、部分读取、未映射、冲突或未确认的可执行来源内容保持 `[blocking]` | 来源覆盖中的 partial、unmapped、未确认等结构化 blocker 会阻止确认准备，相关表格和 mapping 形式已覆盖。 |
| A20 | passed | specs/native-shape-confirmation/spec.md | 参考材料不自动变成需求 - **Given** 用户提供的材料只用于排错、取证、审查或实现参考 - **When** Agent 整理 Shape - **Then** 不把材料中的说明或面向 Agent 的指令自动加入需求范围 - **And** 材料用途无法确定时，先把用途作为用户决定澄清 | 排错、取证、审查或实现参考材料不会自动变成需求，用途不明时要求先澄清。 |

## 检查

_没有记录 Runtime 检查。_

## 阻塞项

_无。_

## 风险与跳过的工作

_未报告风险。_

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A7, A8, A18, A19 | Two-step Runtime confirmation, stale protection, full Shape fingerprinting, recovery, and Supervisor reduction are sound, but A7, A8, A18, and A19 fail because the published Native guidance and source-coverage blocker enforcement are not aligned. | 2026-09-04T06:27:19.906Z |
| 1 | 2 | 1 | recovery | — | Repair verification passed for A7, A8, A18, A19; final full verification is required. | 2026-09-04T08:04:50.971Z |
| 1 | 2 | 2 | fail | A4, A8, A13, A19 | 最终全量验收失败：A4、A8、A13、A19 未通过。定向测试与既有全量验证证据通过，但端到端复现了表格 blocker 绕过、缺失 Shape 指纹后仍进入 Build，以及确认快照的二次读取风险。 | 2026-09-04T08:26:42.352Z |
| 1 | 3 | 1 | recovery | — | Repair verification passed for A4, A8, A13, A19; final full verification is required. | 2026-09-04T08:45:53.400Z |
| 1 | 3 | 2 | pass | — | 当前 Shape、Runtime 实现、双语发布资产与已有验证证据一致。A1-A20 全部通过；此前全量测试、build、lint、format、generated 与 diff 检查均有通过证据，最新窄修复及独立审查也通过。版本保持 0.4.0-rc.4，指定非目标未被扩展实现。 | 2026-09-04T08:50:37.511Z |



## 结论

当前 Shape、Runtime 实现、双语发布资产与已有验证证据一致。A1-A20 全部通过；此前全量测试、build、lint、format、generated 与 diff 检查均有通过证据，最新窄修复及独立审查也通过。版本保持 0.4.0-rc.4，指定非目标未被扩展实现。
