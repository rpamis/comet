---
name: comet-any
description: '根据目标调查 Skills，创作 Native 扩展、Classic 编排或独立应用的完整入口 Skill 与业务 Rule；确认后由 SDK 装配 Runtime、接入 Hook 并预览安装。不用于一般 Skill 的整理或评审。'
disable-model-invocation: true
---

# Comet Any

根据用户目标调查真实 Skills，创作组合应用的正文、流程和业务实现。通过 `comet creator` 保存方案与进度，每完成一个阶段就读取当前动作，推进到完成、需要用户决定或外部能力阻塞。

Agent 编写入口 Skill、业务 Rule、执行端口与验证器；SDK 保留正文，追加执行协议和通用保护规则，并装配 Runtime。业务 Rule 描述业务约束，Runtime 与 Guard 控制动作、批准和写入权限。安装使用 SDK 正式分发。

## 开始或继续

1. 已知创作名称时运行 `comet creator status <name> --project <项目> --json`，再执行 `comet creator next <name> --project <项目> --json`。保留原名称与 Run；中断后先查询原 Action，不重复发起已完成工作。
2. 新创作先读取 `comet creator guide --project <项目> --json`。从用户描述确定目标与安装位置；只有无法调查且会改变结果的选择才询问用户。使用 `comet creator start <name> --project <项目> --goal <用户目标> --install-target <相对目录> --host codex|claude-code --json` 启动。
3. 首次领取或提交动作前，读取[创作动作与恢复](reference/sdk-creation.md)。使用返回的 Action、attempt、inputHash 和本次宿主会话标识；当前动作没有所需能力时明确阻塞，保留现场。

## 分析与方案

`analyze` 由宿主调查和创作。需要委派时，传递原目标、当前动作、工作范围和固定依赖。

1. 用 `comet creator candidates --project <项目> --json` 发现候选；读取候选的 `SKILL.md`、脚本和必要资源。检查实际输入、输出、授权、宿主能力、结束条件、失败与恢复；不按名称推测能力，不改第三方原文件。
2. 对方案中必须使用的 Skill：

   **立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。

   技能加载后，依据实际内容填写适配契约与内容摘要；自行审批或发布的 Skill 须声明相应能力与副作用。

3. 选择用户需要的起点：Native 增加步骤、指导和审查；Classic 在 full、hotfix、tweak 的允许位置编排；独立流程声明顺序、分支、汇合、子流程和有界修复。将用户交互、共同理解确认和实施步骤纳入 Runtime。
4. 编写完整入口 Skill：frontmatter 的 name 等于应用 id，description 写清触发场景；正文说明输入、依赖 Skill 的调用、交互与审批、产物、验收、失败和恢复。业务 Rule 约束具体业务行为；详细材料按需放入 references，并写明读取条件。
5. 按参考中的 `documents` 结构回传正文，与流程和业务端口组成当前方案。缺少正文、实现、验证器、依赖或能力时补齐分析；已有方案则走 revise 后重新确认。

## 确认、验证与交付

1. `next` 到达方案确认时，展示完整正文、内容摘要、实际步骤、Skill 绑定、产物、检查、失败路径与能力限制，并说明编译后可选择 Eval。
2. 用户明确确认当前方案后，提交当前 `confirm-plan` 的用户决定。摘要只是方案标识；得到摘要不等于获得授权。拒绝则保留现场；修改方案走 `revise`，受影响的确认与验证重新执行。
3. 连续调用 `next` 完成编译与实际加载验证。失败时保留现场，修正方案或产物后沿原 Action 恢复。
4. 到达 `confirm-eval` 时，展示 Agent、模型、用例数、交互轮数和总时限，让用户选择 evaluate、skip 或 revise。evaluate 后调用 `next` 执行并保存报告；重试复用原用例，修订应用后优先沿用。失败或未完成时停在 `review-eval`，展示报告与未覆盖路径，让用户选择 retry、revise 或明确 skip；跳过仍保留实际状态。
5. 安装前展示导出目录、平台入口、固定依赖、Runtime、Rule/Hook 配置、冲突与 Eval 状态；预览不写安装目标。`install-target` 使用与平台入口分开的导出目录，例如 `.comet/creator/exports/<应用名>`。只在用户明确批准当前预览后提交 `confirm-install`，由 Creator 导出并正式安装。预览失败或安装中断时，按参考中的恢复步骤处理；目标、依赖、文件、配置或评估报告变化后重新确认。
6. 交付包与入口位置、实际检查、Eval 报告、未执行项和限制。分别列出真实 Skill 加载、Rule 配置、Hook 执行、SDK Run 和业务断言的结果；配置安装成功不代表 Hook 已生效。

## 恢复边界

- 使用原 Run ID、当前 Action/Wait 和输入摘要继续，不复用陈旧请求。
- 未知执行先核对原实验、进程或产物；无法确认时保留现场并阻塞，不盲目重试。
- 凭据仅通过执行环境注入，不写入方案、源码、生成包、Run 或报告。
