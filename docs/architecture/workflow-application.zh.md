# SDK 应用加载与宿主执行契约

完整应用包通过 `comet runtime dispatch --application-file <包目录>/application.json --project-root <项目> --request <临时JSON>` 启动。请求与已有 SDK 协议相同。启动后，可用 `--application <应用id>` 及原 Run ID 查询、领取、回报和继续；恢复入口从 Run 的固定归属找到原包。请求文件留在包目录之外。

公共类型和加载函数从 `@rpamis/comet/applications` 导出。源码入口为 `domains/workflow-application/index.ts`；执行调度和 Run 推进仍由 `@rpamis/comet/runtime` 实现。

## 应用包与固定身份

`application.json` 使用 `comet.workflow.application.v1`，声明 `id`、`version`、`base`、`runtimeVersion`、`entrySkill`、`module`、`skills` 和 `bindings`。`base` 表示 standalone、Native 或所选 Classic profile，不等同于应用身份。应用目录必须与项目状态目录分开；入口文件固定命名为 `application.json`。

`module` 指向自包含 `.mjs` 工厂，导出 `createApplication(context)`。模块及其相对代码依赖只支持可检查的 `.mjs`；JSON 资源可引用。非字面量动态导入、包外相对导入和未固定的第三方包拒绝加载。第三方依赖先 bundle；模块不得有顶层 await。SDK 的公共入口按声明的 Runtime 版本固定。适配代码是经用户选择的可信代码，加载器不提供代码沙箱。

工厂收到 `manifest`、实际读取的 `skills`、`projectRoot`、`packageRoot`、`identity` 和 `createSkillExecutor(host)`，返回 SDK `workflows`、纯转移处理器、验证器与执行器。不能只改变图而遗漏对应实现。`inspectHook(run, request)` 读取相同 SDK Run；缺少 Guard 时当前应用的写入被阻塞。

所有包文件、Skill 文件、引用资源、适配契约和实现绑定都进入内容摘要。活动 Run 保存应用身份、项目实际路径、包实际路径和摘要。每次读取与原子提交都重新核对当前文件，持续进程也不能沿用加载时的旧摘要。相同版本的内容变化会拒绝继续；恢复原文件后继续原 Run。不同项目和 linked worktree 使用各自的项目路径与 Store；不会沿 Git 主仓库路径合并同名 Run。

应用归属和 SDK Run 保存在 `.comet/runtime/applications/<id>` 的同一原子版本记录中。归属不负责业务转移。领域工厂可返回 `wrapStore(store, identity)`，包裹此 Store 来维护 `comet-state.yaml`、`.comet.yaml` 等领域投影和恢复事实；必须保留原 SDK Run 的比较与交换语义，不能用投影替代 Run。Native、Classic 的候选、授权、独立验收、Supervisor 与 Archive 规则仍归各自领域模块。

当前选择统一写入 `.comet/current-change.json`，`workflow: application` 配合 `applicationId` 和 `change`（Run ID）。选择内置 Native/Classic 会覆盖同一文件，不保留另一份优先指针。终止的应用不再调用其 Guard；切回另一流程须使用该流程公开选择入口。编辑说明或投影不能改变 SDK 的依赖、领取、确认和 Outcome 检查。

## 真实 Skill 与适配审查

`inspectApplicationSkill(root)` 只读实际 SKILL.md、脚本及资源，检查本地 Markdown 引用并固定整个目录。第三方原文件不会被改写。`adaptApplicationSkill` 要求固定的内容摘要、输入输出 Schema、范围、宿主能力、交互、副作用、失败与恢复条件，以及绑定实际文件片段的适配审查。

审查记录的 `reviewedBy` 是关联标识，不是身份认证。适配审查必须由人工或 Creator 调查真实内容后形成；不能把名称、关键词、加载声明当作能力证据。无法确认时使用 `requires-review`，必需依赖会阻塞。绑定声明所需 `capability`，该能力必须出现在内容审查中。

只读且不接管交互/审批的 Skill 可作为 `guidance`。产出或检查 Skill 绑定 `invoke_skill`，输出 Schema 必须与流程一致；机器检查或独立评审需注册实际验证器。接管审批的完整流程只能显式适配为 `child_workflow`。并行写入范围冲突须声明顺序或隔离，不能由多个普通绑定竞争同一范围。静态图没有依赖路径时拒绝加载；跨修复循环的可达性不能证明本轮串行，执行器与 Store 会在领取前核对实际 pending/running/unknown Action 的共享范围，冲突时保留现场并阻止调用宿主。合法串行修复只产生一个当前写入 Action，可以沿原 Run 继续。

`skillWork` 返回当前 Action 对应的固定 Skill 内容、资源和适配契约，供实际宿主/Child 执行。它只证明加载了哪些内容。宿主完成声明、SDK Schema/业务验证器的机器检查、独立评审是不同证据；前一层不代替后一层。独立评审的执行者区分与领域条件由注册验证器核对。

## 宿主授权与未知结果

`createApplicationSkillExecutor` 接收宿主 `capabilities`、无副作用的 `authorize`、真实 `invokeSkill` 和可选 `reconcile`。凭据由宿主闭包或本次环境注入，不保存到包或 Run。宿主授权适配器核对 Action、范围、实际 Skill 与现有用户授权；Skill 指令不能扩大授权。

SDK 先执行无副作用的 `preflight`，再原子领取 Action，然后调用宿主。缺少能力、输入不匹配、无授权或外部操作缺少核对能力时保留 pending，宿主不被调用。有副作用的绑定引用 `authorizationFrom` 和允许的 `authorizationChoices`；必须继承当前 Wait 的决定、序列和提案。同一步骤有多个激活时，按当前 Action 继承的精确 Wait 核对批准，不能取该步骤最后一项替代；旧提案和不匹配的批准不能复用。Supervisor 等领域可声明已确认的实际选项，不强制新增一次通用批准。

宿主返回的原始输出和工件交给 SDK 验证；Schema 或业务检查拒绝时保存到 `rejectedOutcomes`，保留原因，不把已返回结果误报为未知。执行已派发但宿主抛错或断连时才进入 unknown，保留原 Action、attempt 和 claimToken。不得再次调用 execute 来重发。

`reconcileApplicationSkill` 读取原 running/unknown Action 的外部结果。已执行时返回绑定原 Action 的 Outcome，再沿 SDK 回报；确认未执行时提供可核对证据，再沿 SDK retry。缺少核对能力或结果无法确认时保持原现场。这个接口不会重发外部操作，也不宣称本地 Run 与外部服务之间具有原子提交。

## 当前开发验证边界

基础层通过真实磁盘脚本 Skill 与公开 CLI 的跨进程执行/恢复，验证固定依赖、归属、并行完成、输入输出拒绝和未知结果协议。真实 Codex/Claude Code 的模型 Skill 执行、平台 Hook/交接矩阵、完整 Native/Classic 样板、安装和 npm 包消费者验收由后续 Child 完成。脚本测试不能替代这些证据。
