---
name: grill-test
description: 依次执行原始 grill、to-spec、to-tickets、implement Skill，通过真实会话、审批和实际测试完成代码任务。
---

# Grill Test

用户明确选择这条链路时使用。先读取[执行与恢复](references/execution.md)，沿同一 SDK 根 Run 和当前子 Run 执行。

## 原始 Skill 的职责

1. grill：加载固定的 grill-me 原文；它仅要求执行 grilling 会话，没有文件输出。

   **立即执行：** 使用 Skill 工具加载 grilling 技能。禁止跳过此步骤。

   技能加载后，按原始 design tree/frontier 规则访谈。环境事实由子 Agent 调查，实际决定询问用户并等待回答。frontier 为空后，请用户确认共同理解。保留真实会话，并将会话摘要回传 SDK grill Action；通过该子 Run 的 confirm-understanding Wait 保存理解确认。此阶段不创建 brief 或其他业务文档，不借用 Native 的阶段产物。

2. to-spec：读取固定的 to-spec 原文，综合已确认的会话和代码事实，不再次访谈已有决定。按原模板七个章节生成第一份正式文档，确认测试 seams，发布至本地 tracker 的 .scratch/grill-test/spec.md。通过 confirm-spec 保存实际确认。

3. to-tickets：读取固定的 to-tickets 原文，展示 tracer-bullet 切片、粒度和 blocking edges，取得用户决定后按原模板一票一文件写入 .scratch/grill-test/issues/，使用 ready-for-agent 标签。tickets.json 仅是本应用为核对实际文件和依赖而保存的索引，不是原 Skill 自带的产物。通过 confirm-tickets 保存实际确认。

4. implement：根 Run 的 authorize-implementation 获批后，读取固定 implement 原文。按已批准票据实现，使用 tdd 在约定 seams 验证，执行相关检查与最终完整业务测试，按 code-review 原文开展 Standards/Spec 双轴子 Agent 审查，只在隔离项目本地提交。implementation.json 是应用的执行记录，不称为原 Skill 的产物。

grill-me、to-spec、to-tickets、implement 的原文件含 disable-model-invocation，宿主无法嵌套调用时读取当前包固定原文，并如实记录文件加载；grilling、tdd、code-review 可用时必须通过实际 Skill 工具加载。不修改原始 Skill 的 frontmatter 或正文。

## 验收与恢复

输入为 goal、acceptance[{id,description}] 和 testCommand 数组；本地 tracker 由用户事先选择。所有业务检查使用原测试命令；verify 的机器执行端口真实运行测试，验证器只读检查结果。独立 Eval 另外运行原始测试，不能以报告或字符串代替任务完成。

获批 Spec 与票据在实现阶段保持只读。真实批准或 Skill 能力缺失时停在当前步骤，保留原 Run；running/unknown 先核对宿主和实际结果。只使用当前 Action/Wait 身份，不伪造会话回答、批准或成功状态。只有实际 SDK 根 Run completed、业务测试通过且评审证据可查，才能报告业务任务完成。

凭据仅留在执行环境。固定应用、SDK 状态、安装目录由正式 Runtime 维护。本应用不授权远端 Issue、PR、推送、发布或真实消息。

四个阶段都在 SDK 子流程中保留原 Skill 的执行职责；根 Run 的 authorize-implementation 仍在 implement 子流程启动前确认实现范围。应用 Guard 只允许已领取子 Action 的实际阶段产物，grill 无业务文件范围。


## SDK 执行协议

固定组合：e0a776e8c9940ecf07ee97c8399d4500bdaa6889e717966487c075ef33a19fa5
Runtime：0.5.0；基础流程：standalone。

用 comet runtime dispatch --application-file <本目录>/application.json --project-root <项目> --request <临时JSON> 启动下列流程：
- grill-test@3
- grill-me@1
- to-spec@1
- to-tickets@1
- implement@1

查询和恢复使用 --application grill-test 与原 Run ID，先 inspect 原 Action；保留 attempt、inputHash 和 claimToken。未知执行先核对结果。审批只沿 Runtime 当前 Wait 提交。

当前 Action 返回 skillWork 或当前 Wait 返回 waitSkillWork 时，逐项读取 skill.files["SKILL.md"] 的真实 name；没有 name 时按该固定目录的宿主命名规则确定，无法确定时阻塞。skill.id 只是逻辑绑定，不能用应用名称或别名代替实际 Skill 名称。

**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。

技能加载后，核对实际加载来源对应当前 skill.root，并核对 SKILL.md、脚本和资源的完整内容摘要与 skill.contentHash 一致；同名不能代替固定版本。宿主无法加载该固定版本时阻塞，保留原 Action。核对通过后，Action 保留 actionId、attempt、inputHash；Wait 保留 waitId、proposalHash，不能把等待点当作 Action 领取。传递当前输入、范围和固定指导，执行工作后提交真实结果；等待点指导不等同用户决定或 machine-check 证据，审批仍只提交当前 Wait 的用户决定。

流程与绑定见 application.json，安装与恢复身份见 installation.json。不能以完成字符串代替实际 Schema、候选或工件检查；检查拒绝后保留现场，修正实际产物后继续原动作。
本包通过组合结构和实际注册实现检查；真实宿主、模型执行与完整业务验收须另行记录。

逐阶段必需产物见 application.json 的 artifactContracts 与应用规则。succeeded 回报前检查真实文件与内容条件；有 sha256From 时回传对应实际 SHA-256，否则 outcome.artifacts 提供 uri/sha256。SDK 执行端口会收集文件证据。下游启动与完成前复验原 Action 的依赖；文件变化时保留现场，按已声明的修复步骤重新检查。

执行前读取[应用规则](rules/workflow-guard.md)。Rule 与流程和写入声明一起生成；宿主集成通过正式安装预览部署。
