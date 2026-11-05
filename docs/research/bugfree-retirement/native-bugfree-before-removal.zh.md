# Native Verify 的 bugfree 模式

bugfree 在 Native 最终 Verify 中保留一个独立只读 Verifier，由它阅读需求、最终实现及必要上下文，依靠语义理解完成验收，并自主选择需要的补查。目标是在保持交付正确率的前提下减少耗时和 token；模型质量与成本收益需要单独取得实际对照证据。

## 启用与固定策略

创建新 change 前，在项目 `.comet/config.yaml` 设置：

```yaml
native:
  verify_mode: bugfree
```

缺省为 `standard`，允许值只有 `standard` 和 `bugfree`。Run 创建时保存明确模式，Shape 与具名状态查询显示实际模式。后续修改项目配置只影响新 change；已有 Run 和历史缺字段 Run 保持原策略。

```text
comet native new my-change --isolation current
comet native status my-change --json
```

普通 SDK Native 和 Supervisor 父级最终 Verify 可以启用。Supervisor Child 验收与集成检查继续现有 Build 协议；Compat、Classic、历史归档和旧固定定义不会因此切换策略。

## 审查过程

Runtime 先绑定候选并处理已声明检查，再交给独立 Verifier。没有命令计划时，仍检查候选完整性，但不启动命令或生成测试通过记录。

Verifier 接收已批准需求、全部验收项、创建基线到当前候选的变化、真实检查摘要，以及当前领取和结果提交模板。领取响应通过 `reviewInput` 一次交付原始请求、需求原文、变更文本、实际存在的适用目录规则和现有检查。状态查询不重复携带正文，正文也不写入 Run。未修改调用方、二进制、删除和已声明生成物按需要补读；成功日志及完整开发对话仍按需读取。Supervisor 父级任务包区分正式材料所在项目与实际集成代码所在工作区。

变更文件的字节或执行权限与候选观察不符时，材料标记不完整，不交付该文件的旧正文。`reviewInput` 的完整状态只表示材料读取完成，不能作为验收通过或命令执行证据。原审查会话合法恢复且有相邻候选差异时，交付增量材料；新独立会话仍接收创建基线以来的全部变化。候选、批准、执行身份和检查证据仍按原流程核对。

首轮使用未参与实现的独立会话。修复后，需求和工作区归属未变、原会话仍独立且旧执行已结束时，可以继续原会话；它根据相邻候选变化确认全部当前验收项。会话不可恢复时启动新独立审查。用户要求重新验收时使用新的独立上下文。

补查使用当前 `request-checks` 请求，Runtime 完成后交回同一个会话。等待工具超时继续跟踪原任务；执行未知时先核对原执行。报告生成失败只恢复报告步骤。

## 检查与结论

用户、项目规则和已确认验收明确要求的执行检查仍必须有适用的真实通过证据。Runtime 的候选、工作区、批准、Action、执行身份、检查收据与归档事务核对保持有效。

`verificationChecks` 是已经决定必须执行或复用的计划。bugfree 模板默认空数组，未确定必要的诊断留给 Verifier 选择。当前候选已登记的失败不能通过删除计划、换 ID 或引用旧成功消除。

修复后的后继候选保留前轮失败信息。对于 Agent 自主追加的诊断，独立 Verifier 可根据当前代码确认原问题已修复，也可请求重跑；报告必须保留原失败和本轮是否重跑的事实。明确要求的执行检查仍须遵守原要求。

阅读足以判断时可以直接回报。存在明确不符合需求的行为时为 fail，缺少必要信息或环境时为 blocked。未执行、超时、候选变化和结果未知不能成为通过证据。

## 紧凑回报

使用 Runtime 提供的当前模板。bugfree 允许在最终结果中用 `passedAcceptanceIds` 明确列出已经判断通过的 ID，`acceptance` 只包含失败或阻塞项及具体原因。两者共同覆盖全部当前验收 ID，遗漏、重复、额外或冲突 ID 均被拒绝。

领取响应先给出 `resultRequest`、填写说明和 `acceptanceResultTemplate`，再交付审查正文，避免为查字段反复读取完整 Run 或 Runtime 源码。`reviewInput.checkInput` 保留 Runtime 对当前候选和检查适用性的判断；审查者不必重复计算这些绑定，发现实际矛盾时再调查。其他完整协议字段保持可用，最终提交仍执行原核对。

Runtime 展开逐项结论，保留原响应，并生成报告。通过项的依据是独立语义审查；不会补造命令、文件定位或测试结果。原有完整逐项结果继续可用，standard 不接受 bugfree 专用格式。

用户接受当前结果后继续原 Archive 流程。模式不会授予 Git 提交、推送、PR、清理或 Eval 权限。

## Native SDK 扩展应用

新 Native 工厂保留所有登记的扩展步骤。通过通用 SDK 启动 bugfree Run 时，调用方在启动前准备真实输入基线，并把它与模式一起写入不可变输入：

```ts
import { prepareNativeVerificationBaseline } from '@rpamis/comet/applications/native';

const verificationBaseline = await prepareNativeVerificationBaseline(projectRoot, 'docs', runId);
const input = {
  name: runId,
  artifactRootRef: 'docs',
  verifyMode: 'bugfree',
  verificationBaseline,
};
```

应用仍提供原有初始状态、固定 workflow 和宿主执行契约。旧固定定义使用原验证器；新的字段不能解除旧定义的约束。基线记录丢失、损坏或不完整时须恢复真实材料，不能从当前代码补造历史基线。

## 验证范围

普通测试分别验证配置、协议、状态转换、输入绑定、续审和恢复。公开 CLI、自包含 bundle、npm 包及真实 Agent 平台需要各自的证据。模型指令遵循、漏检率及性能对照只有在用户明确授权具体场景、样本和轮次后执行。

对照同时记录所有修复轮的 Verify 时间、主 Agent 与 Subagent 总 token、误报、漏检和最终正确率。初始化基线的额外读取时间也应单独报告，避免把 Verify 之外的成本变化遗漏。没有采集到的数据保持缺失，未执行的对照保持待验证。

完整产品边界、测试矩阵和对照设计见[设计与实施计划](../research/2026-11-03-native-bugfree-design.zh.md)。
