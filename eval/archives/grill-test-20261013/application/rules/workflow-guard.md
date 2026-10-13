# Grill Test 业务规则

依照原始 Skill 职责执行：grill 是访谈与理解确认，不要求业务文件；to-spec 综合同一会话生成正式 Spec；to-tickets 将 Spec 拆为依赖明确的本地票据；implement 按批准票据实现、测试、双轴审查和本地提交。

只执行当前已领取 Action 的范围。获批 Spec/票据只读；改变需求后重新确认。业务代码、测试、评审与 SDK 状态分别验收。批准必须来自当前真实用户决定，不能伪造 auto_user 回答。Hook 拒绝时停止并保留证据，不通过另一工具绕过。凭据不进入持久化文件；固定包、Runtime 状态和平台配置由正式入口维护。


## SDK 通用规则

# grill-test 应用规则

固定应用 grill-test@3；Runtime 0.5.0；基础流程 standalone。Skill 入口与 Runtime 属于同一应用，SDK Run 是进度、执行尝试、批准与恢复的唯一依据。

## 当前工作与批准

开始和恢复时读取 Runtime 当前响应，沿同一 Run 的 Action 或 Wait 继续。核对 application 身份、固定 Skill 摘要、actionId/attempt/inputHash 或 waitId/proposalHash；来源不匹配时恢复原固定资源。
ask_user 只提交用户对当前提案的真实决定。审批发生在等待点，Skill 加载或自报完成不构成用户批准。内容、范围或执行上下文变化后处理新的确认，不沿用旧决定。

## 实际步骤

| 步骤 | 类型 | 固定 Skill | 声明的写入范围 | 批准来源 |
| --- | --- | --- | --- | --- |
| grill-test/authorize-implementation | ask_user | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| grill-test/grill | child_workflow | grill-me | ** | 由子流程确认 |
| grill-test/implement | child_workflow | implement | ** | 由子流程确认 |
| grill-test/reject | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| grill-test/spec | child_workflow | to-spec | ** | 由子流程确认 |
| grill-test/tickets | child_workflow | to-tickets | ** | 由子流程确认 |
| grill-test/verify | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| grill-me/complete | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| grill-me/confirm-understanding | ask_user | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| grill-me/grill | handoff | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| grill-me/reject | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-spec/complete | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-spec/confirm-spec | ask_user | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-spec/reject | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-spec/spec | handoff | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-tickets/complete | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-tickets/confirm-tickets | ask_user | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-tickets/reject | call_tool | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| to-tickets/tickets | handoff | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |
| implement/implement | handoff | — | 只读或 Runtime 本地端口 | 按当前 Action/Wait |

## 必需产物

- grill-me/grill：The original grilling Skill produces a conversation and shared understanding, not a brief file. Preserve its actual conversation in the host session and its summary in the SDK outcome; confirm understanding through the child Wait.
- to-spec/spec：.scratch/grill-test/spec.md；完成前校验实际文件、内容条件与 SHA-256。
- to-tickets/tickets：.scratch/grill-test/tickets.json；完成前校验实际文件、内容条件与 SHA-256。
- implement/implement：.scratch/grill-test/implementation.json；完成前校验实际文件、内容条件与 SHA-256。
- grill-test/verify：.scratch/grill-test/verification.json；完成前校验实际文件、内容条件与 SHA-256。
- grill-test/grill：The parent records completion of the conversation and understanding approval; grilling has no mandatory file output.
- grill-test/spec：The isolated child workflow validates its own stage files and approval; the parent records its child completion.
- grill-test/tickets：The isolated child workflow validates its own stage files and approval; the parent records its child completion.
- grill-me/reject：Record actual user rejection and stop the child; no business file is produced.
- to-spec/reject：Record actual user rejection and stop the child; no business file is produced.
- to-tickets/reject：Record actual user rejection and stop the child; no business file is produced.
- grill-test/reject：Record actual user rejection without writing business files.
- grill-test/implement：The root approval authorizes this child; the child validates the actual implementation record and completed tickets.
- grill-me/complete：Record the actual approved child Wait and complete this Skill stage; no new business file is generated.
- to-spec/complete：Record the actual approved child Wait and complete this Skill stage; no new business file is generated.
- to-tickets/complete：Record the actual approved child Wait and complete this Skill stage; no new business file is generated.

实际文件与当前结果证据一致后才能完成阶段；下游领取前重新检查依赖。内容变化时修正原产物或沿已声明的修复步骤继续。

## 写入与证据

在当前 Action 领取完成后执行其工作。SDK 默认 Guard 只允许已批准、当前 running Action 的声明写入范围，并核对同一应用子流程与实际工作区。pending、unknown、验证及等待决定期间不扩大实现权限。业务额外 Guard 在 SDK 控制资源保护与声明权限内增加约束。
运行时状态、选择记录、固定应用包与宿主配置通过正式 Runtime 或安装入口维护。临时请求放在 .comet/requests/*.json；过程证据放在 .comet/evidence/grill-test/。这些文件不代替 Runtime 状态、实际检查或独立审查。
执行端口完成实际工作后回传原 Action 的真实结果与工件。Schema、验证器或摘要拒绝时保留结果与文件，修正后继续原动作；状态字符串不能代替实际业务验收。

## 恢复与宿主

未知执行先核对原结果，保留原执行者、attempt、inputHash 和 claimToken，不以断连当作未执行。冷恢复读取同一 SDK Run，已完成动作与批准不重复执行。已结束 Run 的声明产物保持固定；继续修改时启动新的 Run。
正式安装预览包括 Skill、Rule、共享 Hook Router 和平台配置。只安装当前被明确批准的预览，配置漂移、用户文件冲突或链接导致范围不明时保留现场。平台不支持 Hook 或仍需要启用/信任时如实说明。
规则文本、配置安装、实际 Hook 调用、SDK Run 和业务测试分别提供证据。Hook 只覆盖宿主投递的事件范围，不能将文件复制或一次模型运行称为所有平台完整验收。
