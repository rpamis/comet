# 工作流应用编译器

`@rpamis/comet/applications/compiler` 将已确认的组合方案装配为完整 SDK 应用包。Native、Classic 和独立报告分别调用现有公开工厂；编译器不实现新的状态机，也不修改第三方 Skill。

调用顺序：

1. 调查并固定实际 Skill 目录、资源摘要和适配契约。组合方案包含应用身份、基础流程、Skill 绑定、组合位置，以及固定实现模块的源文本。
2. 调用 `prepareWorkflowApplicationPlan({ proposal, projectRoot, packageRoot, dependencyRoot })`。它加载实际实现集合，按组合位置装配有效流程，再返回包含有效定义的 JSON 方案。此步骤只查询工厂和执行路由，不执行业务 Action。
3. 展示方案、步骤、Skill、验收和失败恢复路径，取得当前方案的用户确认。用 `hashRuntimeValue(plan)` 保存确认摘要；摘要本身不能证明用户已经授权。
4. 调用 `compileWorkflowApplication({ plan, confirmationHash, projectRoot, packageRoot, dependencyRoot })`。编译器重新读取依赖、装配真实工厂并核对有效定义。方案变化后需重新展示和确认。
5. 使用生成的 `application.json` 和公开 `comet runtime dispatch` 启动应用。恢复沿原应用身份与 Run ID，先查询原 Action，再按原 attempt、inputHash 和 claimToken 继续。

`packageRoot` 必须是尚不存在的目录，其父目录须能解析已安装的 Comet 包。相对依赖目录必须显式提供 `dependencyRoot`；依赖读入后复制到包内的 `skills/<身份>/`，原文件保持不变。已有目标不会被覆盖。

确认摘要是完整 `plan` 的规范化 JSON SHA-256：包含有效流程定义（含转移、状态约束及转移处理器/验证器版本引用）、组合种类与选项、应用和恢复身份、执行/指导绑定、每个 Skill 的目录与全部资源摘要/适配审查，以及固定实现模块的实际源文本。不是只绑定用户展示的标题或图。`confirmationHash` 只证明本次编译与已经确认的那份数据一致；Creator 必须保存真实用户决定及其来源，再传入该摘要。

组合种类和固定实现：

| kind      | 方案选择                                               | 生成行为                                                                               |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `native`  | `extensions`：身份、Skill、scopes、工件和验证器引用    | 按声明顺序增加 Native 候选、父级、Child 或集成检查，并装配对应纯转移处理器             |
| `classic` | `profile`、`replacements`、`extensions` 和可选 `order` | 替换兼容的执行 Skill，在允许的领域检查点增加有失败恢复路径的工作；原领域批准和验收保留 |
| `report`  | 独立报告样板                                           | 装配子工作流、报告内容检查、用户审批、有界修改和本地发布恢复                           |

Native/Classic 的 `modules['bindings.mjs']` 必须导出 `createBindings(context)`，返回 `{ validators, executors }`。验证器提供固定的 `id`、`version` 和真实 `validate`；执行端口可用 `context.createSkillExecutor(host)` 创建，必须支持对应 Skill 路由、声明所需能力并提供领取预检。实现集合不能返回 `workflows` 或覆盖领域转移处理器。`application.mjs` 由编译器生成，不能由调用者覆盖。模块导入须符合完整应用加载器的固定依赖规则；加载阶段须使用已经审查、无业务副作用的工厂。

输出包包括同源的 `application.json`、`application.mjs`、`SKILL.md`、`installation.json`、固定模块和全部 Skill 资源。安装材料保存流程摘要、绑定、Runtime 版本及应用恢复身份。相同方案和固定依赖产生相同字节摘要；无效转换、缺失验证器、无法路由的执行端口、重复或冲突身份，以及声明图与实际工厂不一致，均在生成目标前被拒绝。

`@rpamis/comet/applications` 的 `createApplicationArtifactValidator` 用于实际产物检查。配置必须包含工件路径、JSON Schema/内容要求或业务检查、当前真实候选读取函数，以及原 Action 候选读取函数。成功回报仅允许 `{ bindingHash, candidateHash, artifactHashes }`，分别绑定原 Action 输入、当前且仍与 Action 一致的候选和实际文件 SHA-256。JSON 工件先解析真实字节再运行 Schema；`validateActual` 可继续检查实际内容的业务含义。候选或文件在异步验收期间变化也会被拒绝。

拒绝不会改写实际文件；SDK 保留原 Action、领取和被拒结果，返回修正说明。修正实际产物后，使用新的 outcomeId 回报；候选变化时按应用声明的修复路径重新派发检查。`completedChecks` 字段、完成字符串或文件存在都不能替代验证。

可运行的本地报告消费者见 `scripts/lib/workflow-application-compiler-example.mjs`。包级测试将它复制到真实 npm 消费者中，先验证审批前等待，再在新进程显式审批并发布同一 Run。组合检查、定向测试、npm 消费者、真实宿主与模型验收分别报告；编译成功不表示后两项已经通过。
