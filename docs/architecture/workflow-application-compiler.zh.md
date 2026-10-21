# 工作流应用编译器

`@rpamis/comet/applications/compiler` 将已确认的组合方案装配为完整 SDK 应用包。Native、Classic 和独立报告分别调用现有公开工厂；编译器不实现新的状态机，也不修改第三方 Skill。

调用顺序：

1. 调查并固定实际 Skill 目录、资源摘要和适配契约。组合方案包含应用身份、基础流程、Skill 绑定、组合位置，以及固定实现模块的源文本。
2. 调用 `prepareWorkflowApplicationPlan({ proposal, projectRoot, packageRoot, dependencyRoot })`。它加载实际实现集合，按组合位置装配有效流程，再返回包含有效定义的 JSON 方案。此步骤只查询工厂和执行路由，不执行业务 Action。
3. 展示方案、步骤、Skill、验收和失败恢复路径，取得当前方案的用户确认。用 `hashRuntimeValue(plan)` 保存确认摘要；摘要本身不能证明用户已经授权。
4. 调用 `compileWorkflowApplication({ plan, confirmationHash, projectRoot, packageRoot, dependencyRoot })`。编译器重新读取依赖、装配真实工厂并核对有效定义。方案变化后需重新展示和确认。
5. 安装后在 Agent 中调用生成的 Skill，由包内入口启动和继续应用。自定义宿主也可使用公开 `comet runtime dispatch`；恢复沿原应用身份与 Run ID，先查询原 Action，再按原 attempt、inputHash 和 claimToken 继续。

`packageRoot` 必须是尚不存在的目录，其父目录须能解析已安装的 Comet 包。相对依赖目录必须显式提供 `dependencyRoot`；依赖读入后复制到包内的 `skills/<身份>/`，原文件保持不变。已有目标不会被覆盖。

确认摘要是完整 `plan` 的规范化 JSON SHA-256：包含有效流程定义（含转移、状态约束及转移处理器/验证器版本引用）、组合种类与选项、应用和恢复身份、执行/指导绑定、每个 Skill 的目录与全部资源摘要/适配审查，以及固定实现模块的实际源文本。不是只绑定用户展示的标题或图。`confirmationHash` 只证明本次编译与已经确认的那份数据一致；Creator 必须保存真实用户决定及其来源，再传入该摘要。

组合种类和固定实现：

| kind      | 方案选择                                               | 生成行为                                                                               |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `native`  | `extensions`：身份、Skill、scopes、工件和验证器引用    | 按声明顺序增加 Native 候选、父级、Child 或集成检查，并装配对应纯转移处理器             |
| `classic` | `profile`、`replacements`、`extensions` 和可选 `order` | 替换兼容的执行 Skill，在允许的领域检查点增加有失败恢复路径的工作；原领域批准和验收保留 |
| `report`  | 独立报告样板                                           | 装配子工作流、报告内容检查、用户审批、有界修改和本地发布恢复                           |

Native/Classic 的 `modules['bindings.mjs']` 必须导出 `createBindings(context)`，返回 `{ validators, executors }`。验证器提供固定的 `id`、`version` 和真实 `validate`；执行端口可用 `context.createSkillExecutor(host)` 创建，必须支持对应 Skill 路由、声明所需能力并提供领取预检。实现集合不能返回 `workflows` 或覆盖领域转移处理器。`application.mjs` 由编译器生成，不能由调用者覆盖。模块导入须符合完整应用加载器的固定依赖规则；加载阶段须使用已经审查、无业务副作用的工厂。

输出包包括同源的 `application.json`、`application.mjs`、`workflow.json`、`SKILL.md`、`installation.json`、固定模块和全部 Skill 资源。安装材料保存流程摘要、绑定、Runtime 版本及应用恢复身份。相同方案和固定依赖产生相同字节摘要；无效转换、缺失验证器、无法路由的执行端口、重复或冲突身份，以及声明图与实际工厂不一致，均在生成目标前被拒绝。

## 在 Dashboard 展示自定义流程

用户安装应用后，直接在 Agent 对话中调用生成的 Skill。生成器把启动和恢复指令放在入口正文前面，并提供固定包内的 `scripts/comet-run.mjs`；原有业务正文和资源引用继续保留。Agent 使用入口创建 Run，先领取需要自行执行的步骤，再提交真实结果；机器步骤使用已注册执行器，用户决定仍在当前对话中取得并提交。用户无需操作 Dashboard 或手动维护步骤状态。

入口响应提供同一 Run 的当前 Action、Wait、固定 Skill 和后续命令。结果回执绑定原 Action 的尝试、输入摘要与领取凭证；确认回执绑定原 Wait 和提案摘要。已声明产物的摘要由入口读取真实文件收集，再由 SDK 核对；额外工件仍须提供真实引用和摘要。输入与结果 JSON 是临时请求，推进状态始终由 SDK 保存。恢复使用原 Run ID 查询；新会话没有 Run ID 时可先查询当前应用的唯一未结束任务，多项任务需用户选择。已领取或结果未知的工作先核对原结果；新的独立任务创建新的 Run。入口沿 Run 固定的应用版本恢复，不套用后来安装的新版本。

Dashboard 自动读取这些运行记录，默认优先显示正在进行的应用 Run；创作记录仍可单独切换查看。完整调用链路的验收须从实际安装的 Skill 入口开始，覆盖 Agent 执行、对话确认、恢复及 Dashboard 观测；直接调用 SDK 的测试只覆盖其中一部分。

`resume` 恢复未结束 Run 的当前应用归属，让后续宿主写入仍由对应应用的 Hook 检查；它不重新领取或推进步骤。`inspect` 只读查看，不切换当前需求。宿主环境和认证材料只经本次调用上下文传给执行端口，不写入运行输入、生成包或 Dashboard 记录。

需要初始状态的应用可由业务初始化入口取得当前项目的真实状态，并通过 `start --initial-state-file <JSON文件>` 提供；通用入口只传给原 SDK 校验，不猜测领域默认值，也不复制评估用例的初始状态。

组合器把实际流程定义保存到 `workflow.json`，由 `application.json` 的 `definition` 引用。文件随应用一起分发，不依赖原项目的 Creator 记录。装配和加载时会核对它与实际执行定义一致，Dashboard 读取时还会核对当前 Run 固定的定义摘要。查看页面不会执行应用模块。

在 `proposal.presentation` 中填写面向用户的名称、阶段和输出字段，例如：

```json
{
  "title": "每周报告",
  "description": "生成草稿，审阅后发布",
  "steps": [
    {
      "workflowId": "report-publishing",
      "stepId": "generate",
      "title": "生成报告草稿",
      "phase": "准备",
      "description": "整理来源并保存可审阅的草稿。",
      "outputFields": [{ "path": "compose.ref", "label": "草稿文件" }]
    }
  ]
}
```

`workflowId` 和 `stepId` 必须引用实际步骤。`outputFields.path` 从当前执行记录的 `output` 读取字段，使用点分路径；数组项可用数字下标。不支持脚本或表达式，缺失字段不会被猜测。展示信息参与方案与固定包摘要，修改后应重新确认、编译和分发。

Dashboard 将完整定义与真实执行记录组合，显示阶段、尚未执行的节点、候选分支、并行汇合、子流程和循环中的各轮执行。点击未执行节点可查看定义和必需产物；点击已发生的节点可查看实际输入输出、等待与产物。计划中的连接只表示允许的路径，不表示它已经执行，也不据此计算完成百分比。

一个 Skill 若把搜索、写稿、审核等全部放在一次调用内，页面只能观察这次调用及其结果。需要分别观察时，应在方案中拆成显式步骤或 `child_workflow`；Creator 的分析动作会提示作者说明这类观测范围。SDK 的完成状态只证明声明的流程已完成，业务结果仍由对应验证器与实际产物证明。

没有定义文件的旧应用继续显示执行记录。固定材料缺失、发生变化或与 Run 不一致时，页面说明原因并保留实际记录，不套用其他版本的流程图。

`@rpamis/comet/applications` 的 `createApplicationArtifactValidator` 用于实际产物检查。配置必须包含工件路径、JSON Schema/内容要求或业务检查、当前真实候选读取函数，以及原 Action 候选读取函数。成功回报仅允许 `{ bindingHash, candidateHash, artifactHashes }`，分别绑定原 Action 输入、当前且仍与 Action 一致的候选和实际文件 SHA-256。JSON 工件先解析真实字节再运行 Schema；`validateActual` 可继续检查实际内容的业务含义。候选或文件在异步验收期间变化也会被拒绝。

拒绝不会改写实际文件；SDK 保留原 Action、领取和被拒结果，返回修正说明。修正实际产物后，使用新的 outcomeId 回报；候选变化时按应用声明的修复路径重新派发检查。`completedChecks` 字段、完成字符串或文件存在都不能替代验证。

可运行的本地报告消费者见 `scripts/lib/workflow-application-compiler-example.mjs`。包级测试将它复制到真实 npm 消费者中，先验证审批前等待，再在新进程显式审批并发布同一 Run。组合检查、定向测试、npm 消费者、真实宿主与模型验收分别报告；编译成功不表示后两项已经通过。
